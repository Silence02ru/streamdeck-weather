// Яндекс Погода: GraphQL API с ключом, объединение запросов всех кнопок в один.
//
// У бесплатного ключа суточный лимит запросов, поэтому все кнопки с одним ключом
// получают погоду одним GraphQL-запросом: каждая точка — отдельный алиас
// (p0: weatherByPoint(...), p1: ...). Результат кэшируется по точке, а остальные
// кнопки этой группы получают событие "updated" и перерисовываются из кэша.
import { EventEmitter } from "node:events";
import { getJson } from "./http.js";

const YANDEX_URL = "https://api.weather.yandex.ru/graphql/query";
// Запросы, пришедшие в это окно (кнопки появились вместе, сработали таймеры), идут одним пакетом.
const BATCH_DELAY_MS = 500;
// Лимит бесплатного ключа: 30 запросов в сутки, 1000 в месяц (≈32 в день).
// Один пакетный запрос раз в час = 24 в сутки, ~744 в месяц — с запасом на ручные обновления.
// Данные считаются свежими чуть меньше минимального интервала обновления (60 мин).
const FRESH_MS = 55 * 60 * 1000;
// Долгое нажатие запрашивает заново, только если данным больше 15 минут.
const MANUAL_COOLDOWN_MS = 15 * 60 * 1000;

// Состояния Яндекс Погоды (enum Condition) → описание и тип иконки.
// https://yandex.ru/dev/weather/doc/ru/concepts/spectaql
const CONDITIONS = {
	CLEAR: ["Ясно", "clear"],
	PARTLY_CLOUDY: ["Малооблачно", "partly"],
	CLOUDY: ["Облачно", "partly"],
	OVERCAST: ["Пасмурно", "cloud"],
	LIGHT_RAIN: ["Небол. дождь", "drizzle"],
	RAIN: ["Дождь", "rain"],
	HEAVY_RAIN: ["Сильный дождь", "rain"],
	SHOWERS: ["Ливень", "rain"],
	SLEET: ["Мокрый снег", "snow"],
	LIGHT_SNOW: ["Небол. снег", "snow"],
	SNOW: ["Снег", "snow"],
	SNOWFALL: ["Снегопад", "snow"],
	HAIL: ["Град", "rain"],
	THUNDERSTORM: ["Гроза", "storm"],
	THUNDERSTORM_WITH_RAIN: ["Гроза с дождём", "storm"],
	THUNDERSTORM_WITH_HAIL: ["Гроза с градом", "storm"],
};

export function describeYandexCondition(condition) {
	const [text, icon] = CONDITIONS[condition] ?? ["—", "cloud"];
	return { text, icon };
}

/**
 * События: "updated" (ids кнопок, для которых в кэше появились свежие данные),
 * "request" (число точек в отправленном пакетном запросе — для лога).
 */
export const yandexEvents = new EventEmitter();

const buttons = new Map(); // id кнопки → { group (= ключ API), loc, lat, lon }
const results = new Map(); // `${group}|${loc}` → { time, point, serverTime }
const pending = new Map(); // group → { timer, apiKey, proxyUrl, waiters: Map<loc, { lat, lon, ids, list }> }
const inflight = new Map(); // group → { locs: Set, promise }

const locKey = (lat, lon) => `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;

/** Кнопка больше не показывает Яндекс (скрыта, удалена, сменён источник) — не запрашивать её город. */
export function forgetYandexButton(id) {
	buttons.delete(id);
}

/**
 * Погода для одной кнопки. Берёт свежий кэш или ставит точку в общий пакетный запрос.
 * force — долгое нажатие: запросить заново, если данным больше MANUAL_COOLDOWN_MS.
 */
export async function fetchYandex({ latitude, longitude, units, windUnit, yandexKey }, proxyUrl, { id, force = false } = {}) {
	const apiKey = (yandexKey ?? "").trim();
	if (!apiKey) throw keyError("не задан ключ API Яндекс Погоды");

	// Группа — только ключ: прокси общий для всех кнопок, и даже если у кнопок он разный
	// (старые настройки), лимит считается по ключу — запрос всё равно один.
	const group = apiKey;
	const loc = locKey(latitude, longitude);
	if (id) buttons.set(id, { group, loc, lat: Number(latitude), lon: Number(longitude) });

	const hit = results.get(`${group}|${loc}`);
	const age = hit ? Date.now() - hit.time : Infinity;
	if (age < (force ? MANUAL_COOLDOWN_MS : FRESH_MS)) return parseYandexPoint(hit, units, windUnit);

	// Точка уже запрашивается прямо сейчас — ждём этот же запрос.
	const running = inflight.get(group);
	if (running?.locs.has(loc)) {
		await running.promise;
		return parseYandexPoint(results.get(`${group}|${loc}`), units, windUnit);
	}

	const entry = await enqueue(group, apiKey, proxyUrl, loc, Number(latitude), Number(longitude), id);
	return parseYandexPoint(entry, units, windUnit);
}

function enqueue(group, apiKey, proxyUrl, loc, lat, lon, id) {
	let batch = pending.get(group);
	if (!batch) {
		batch = { apiKey, proxyUrl, waiters: new Map() };
		batch.timer = setTimeout(() => runBatch(group), BATCH_DELAY_MS);
		pending.set(group, batch);
	}
	// Прокси пакета — последний заданный (например, только что перенесённый в общие настройки).
	batch.proxyUrl = proxyUrl;
	return new Promise((resolve, reject) => {
		const w = batch.waiters.get(loc) ?? { lat, lon, ids: new Set(), list: [] };
		if (id) w.ids.add(id);
		w.list.push({ resolve, reject });
		batch.waiters.set(loc, w);
	});
}

async function runBatch(group) {
	const batch = pending.get(group);
	pending.delete(group);

	// В пакет идут точки, которые ждут, и все остальные кнопки этой группы —
	// так их данные обновятся тем же запросом.
	const points = new Map();
	for (const [loc, w] of batch.waiters) points.set(loc, { lat: w.lat, lon: w.lon });
	for (const b of buttons.values()) {
		if (b.group === group && !points.has(b.loc)) points.set(b.loc, { lat: b.lat, lon: b.lon });
	}
	const locs = [...points.keys()];

	yandexEvents.emit("request", locs.length);
	const promise = request(batch.apiKey, batch.proxyUrl, [...points.values()]);
	inflight.set(group, { locs: new Set(locs), promise });
	try {
		const data = await promise;
		const time = Date.now();
		locs.forEach((loc, i) => results.set(`${group}|${loc}`, { time, point: data[`p${i}`], serverTime: data.serverTime }));
		const waitingIds = new Set();
		for (const [loc, w] of batch.waiters) {
			w.ids.forEach((id) => waitingIds.add(id));
			const entry = results.get(`${group}|${loc}`);
			w.list.forEach((p) => p.resolve(entry));
		}
		// Остальные кнопки группы перерисуются из кэша (без нового запроса).
		const others = [...buttons].filter(([id, b]) => b.group === group && !waitingIds.has(id)).map(([id]) => id);
		if (others.length) yandexEvents.emit("updated", others);
	} catch (err) {
		for (const w of batch.waiters.values()) w.list.forEach((p) => p.reject(err));
	} finally {
		inflight.delete(group);
	}
}

// Яндекс отдаёт °C и м/с; в нужные единицы переводим сами,
// чтобы не зависеть от аргументов unit в схеме GraphQL.
// Только поля, доступные бесплатному ключу (те же, что в yandex/pogoda-home-assistant):
// humidity и precProbability на бесплатном тарифе дают "access denied for free role".
const POINT_FIELDS = `{
		now { condition daytime temperature feelsLike windSpeed windAngle windGust }
		forecast {
			days {
				summary {
					night { minTemperature maxTemperature condition }
					day { minTemperature maxTemperature condition }
				}
			}
		}
	}`;

/** Один GraphQL-запрос на все точки: p0, p1, … — алиасы weatherByPoint. */
export function buildYandexQuery(points) {
	const parts = points.map(
		({ lat, lon }, i) => `\tp${i}: weatherByPoint(request: { lat: ${Number(lat)}, lon: ${Number(lon)} }) ${POINT_FIELDS}`,
	);
	return `{\n\tserverTime\n${parts.join("\n")}\n}`;
}

let send = (apiKey, proxyUrl, body) =>
	getJson(YANDEX_URL, proxyUrl, { body, headers: { "X-Yandex-Weather-Key": apiKey } });

/** Только для тестов: подменить отправку запроса. */
export function setYandexTransport(fn) {
	send = fn;
}

async function request(apiKey, proxyUrl, points) {
	let res;
	try {
		res = await send(apiKey, proxyUrl, { query: buildYandexQuery(points) });
	} catch (err) {
		if (err.status === 401 || err.status === 403) {
			throw keyError(`Яндекс отклонил ключ (HTTP ${err.status}); новый ключ активируется до 5 минут`);
		}
		if (err.status === 429) throw new Error("Яндекс: превышен лимит запросов (HTTP 429)");
		throw err;
	}
	if (res.errors?.length) {
		const details = res.errors.map((e) => (e.path ? `${e.message} (${e.path.join(".")})` : e.message));
		throw new Error(`Яндекс: ${[...new Set(details)].join("; ")}`);
	}
	return res.data;
}

/** Ошибка, которую исправляет пользователь (ключ), а не повтор запроса. */
function keyError(message) {
	const err = new Error(message);
	err.kind = "key";
	return err;
}

/** Данные одной точки из ответа Яндекса → общий формат данных кнопки. */
export function parseYandexPoint({ point, serverTime }, units, windUnit) {
	const now = point.now;
	const today = point.forecast.days[0]?.summary ?? {};
	const parts = [today.night, today.day].filter(Boolean);
	const nums = (field) => parts.map((p) => p[field] ?? p.temperature).filter((x) => typeof x === "number");
	const highs = nums("maxTemperature");
	const lows = nums("minTemperature");
	const probs = parts.map((p) => p.precProbability).filter((p) => typeof p === "number");
	const dayCondition = today.day?.condition ?? today.night?.condition;

	const t = (c) => (c === null || c === undefined ? c : units === "fahrenheit" ? c * 1.8 + 32 : c);
	const v = (ms) => (windUnit === "kmh" ? ms * 3.6 : ms);
	return {
		temp: t(now.temperature),
		feels: t(now.feelsLike),
		humidity: now.humidity,
		description: describeYandexCondition(now.condition),
		isDay: now.daytime === "DAY",
		wind: v(now.windSpeed),
		windDir: now.windAngle,
		gust: typeof now.windGust === "number" ? v(now.windGust) : null,
		dayDescription: dayCondition ? describeYandexCondition(dayCondition) : null,
		max: t(highs.length ? Math.max(...highs) : null),
		min: t(lows.length ? Math.min(...lows) : null),
		precipProb: probs.length ? Math.max(...probs) * 100 : null,
		time: serverTime,
	};
}
