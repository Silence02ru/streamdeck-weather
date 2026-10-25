// Источники погоды (Open-Meteo, Яндекс Погода), приведение к общему формату, кэш.
import { getJson, resolveProxy } from "./http.js";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const YANDEX_URL = "https://api.weather.yandex.ru/graphql/query";

// WMO weather codes → описание и тип иконки.
// https://open-meteo.com/en/docs (раздел "WMO Weather interpretation codes")
const WMO = {
	0: ["Ясно", "clear"],
	1: ["Малооблачно", "partly"],
	2: ["Облачно", "partly"],
	3: ["Пасмурно", "cloud"],
	45: ["Туман", "fog"],
	48: ["Изморозь", "fog"],
	51: ["Морось", "drizzle"],
	53: ["Морось", "drizzle"],
	55: ["Морось", "drizzle"],
	56: ["Лед. морось", "drizzle"],
	57: ["Лед. морось", "drizzle"],
	61: ["Дождь", "rain"],
	63: ["Дождь", "rain"],
	65: ["Ливень", "rain"],
	66: ["Лед. дождь", "rain"],
	67: ["Лед. дождь", "rain"],
	71: ["Снег", "snow"],
	73: ["Снег", "snow"],
	75: ["Снегопад", "snow"],
	77: ["Снежная крупа", "snow"],
	80: ["Ливень", "rain"],
	81: ["Ливень", "rain"],
	82: ["Ливень", "rain"],
	85: ["Снегопад", "snow"],
	86: ["Снегопад", "snow"],
	95: ["Гроза", "storm"],
	96: ["Гроза, град", "storm"],
	99: ["Гроза, град", "storm"],
};

// Состояния Яндекс Погоды (enum Condition) → описание и тип иконки.
// https://yandex.ru/dev/weather/doc/ru/concepts/spectaql
const YANDEX_CONDITIONS = {
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

export function describeCode(code) {
	const [text, icon] = WMO[code] ?? ["—", "cloud"];
	return { text, icon };
}

export function describeYandexCondition(condition) {
	const [text, icon] = YANDEX_CONDITIONS[condition] ?? ["—", "cloud"];
	return { text, icon };
}

const cache = new Map(); // key → { time, promise }
const CACHE_TTL_MS = 60 * 1000;

/**
 * Загружает текущую погоду и прогноз на сегодня из выбранного источника.
 * Одинаковые запросы с нескольких кнопок за минуту объединяются.
 */
export function fetchWeather(opts) {
	const { latitude, longitude, units, windUnit, proxy, source, yandexKey } = opts;
	const key = [source, latitude, longitude, units, windUnit, proxy, yandexKey].join("|");
	const hit = cache.get(key);
	if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.promise;

	const load = source === "yandex" ? fetchYandex : fetchOpenMeteo;
	const promise = resolveProxy(proxy)
		.then((proxyUrl) => load(opts, proxyUrl))
		.then((w) => ({ ...w, windUnit: windUnit === "kmh" ? "км/ч" : "м/с" }))
		.catch((err) => {
			cache.delete(key);
			throw err;
		});

	cache.set(key, { time: Date.now(), promise });
	return promise;
}

async function fetchOpenMeteo({ latitude, longitude, units, windUnit }, proxyUrl) {
	const params = new URLSearchParams({
		latitude: String(latitude),
		longitude: String(longitude),
		current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,precipitation",
		daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
		timezone: "auto",
		forecast_days: "1",
		temperature_unit: units === "fahrenheit" ? "fahrenheit" : "celsius",
		wind_speed_unit: windUnit === "kmh" ? "kmh" : "ms",
	});
	const data = await getJson(`${OPEN_METEO_URL}?${params}`, proxyUrl);
	const c = data.current;
	const d = data.daily;
	return {
		temp: c.temperature_2m,
		feels: c.apparent_temperature,
		humidity: c.relative_humidity_2m,
		description: describeCode(c.weather_code),
		isDay: c.is_day === 1,
		wind: c.wind_speed_10m,
		windDir: c.wind_direction_10m,
		max: d.temperature_2m_max[0],
		min: d.temperature_2m_min[0],
		precipProb: d.precipitation_probability_max[0],
		time: c.time,
	};
}

/** Ошибка, которую исправляет пользователь (ключ), а не повтор запроса. */
function keyError(message) {
	const err = new Error(message);
	err.kind = "key";
	return err;
}

// Яндекс отдаёт °C и м/с; в нужные единицы переводим сами,
// чтобы не зависеть от аргументов unit в схеме GraphQL.
const yandexQuery = (lat, lon) => `{
	serverTime
	weatherByPoint(request: { lat: ${Number(lat)}, lon: ${Number(lon)} }) {
		now { condition daytime temperature feelsLike humidity windSpeed windAngle }
		forecast {
			days {
				summary {
					night { minTemperature maxTemperature precProbability }
					day { minTemperature maxTemperature precProbability }
				}
			}
		}
	}
}`;

async function fetchYandex({ latitude, longitude, units, windUnit, yandexKey }, proxyUrl) {
	if (!yandexKey) throw keyError("не задан ключ API Яндекс Погоды");
	let res;
	try {
		res = await getJson(YANDEX_URL, proxyUrl, {
			body: { query: yandexQuery(latitude, longitude) },
			headers: { "X-Yandex-Weather-Key": yandexKey.trim() },
		});
	} catch (err) {
		if (err.status === 401 || err.status === 403 || err.status === 404) {
			throw keyError(`Яндекс отклонил ключ (HTTP ${err.status}); новый ключ активируется до 5 минут`);
		}
		if (err.status === 429) throw new Error("Яндекс: превышен лимит запросов (HTTP 429)");
		throw err;
	}
	if (res.errors?.length) throw new Error(`Яндекс: ${res.errors.map((e) => e.message).join("; ")}`);
	return parseYandex(res, units, windUnit);
}

/** Ответ GraphQL Яндекса → общий формат данных кнопки. */
export function parseYandex(res, units, windUnit) {
	const w = res.data.weatherByPoint;
	const now = w.now;
	const today = w.forecast.days[0]?.summary ?? {};
	const parts = [today.night, today.day].filter(Boolean);
	const nums = (field) => parts.map((p) => p[field] ?? p.temperature).filter((x) => typeof x === "number");
	const highs = nums("maxTemperature");
	const lows = nums("minTemperature");
	const probs = parts.map((p) => p.precProbability).filter((p) => typeof p === "number");

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
		max: t(highs.length ? Math.max(...highs) : null),
		min: t(lows.length ? Math.min(...lows) : null),
		precipProb: probs.length ? Math.max(...probs) * 100 : null,
		time: res.data.serverTime,
	};
}
