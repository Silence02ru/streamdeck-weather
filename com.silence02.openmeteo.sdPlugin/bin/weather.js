// Работа с Open-Meteo: запрос погоды, расшифровка WMO-кодов, кэш.
import { getJson, resolveProxy } from "./http.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

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

export function describeCode(code) {
	const [text, icon] = WMO[code] ?? ["—", "cloud"];
	return { text, icon };
}

const cache = new Map(); // key → { time, promise }
const CACHE_TTL_MS = 60 * 1000;

/**
 * Загружает текущую погоду и прогноз на сегодня.
 * Одинаковые запросы с нескольких кнопок за минуту объединяются.
 */
export function fetchWeather({ latitude, longitude, units, windUnit, proxy }) {
	const key = [latitude, longitude, units, windUnit, proxy].join("|");
	const hit = cache.get(key);
	if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.promise;

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

	const promise = resolveProxy(proxy)
		.then((proxyUrl) => getJson(`${FORECAST_URL}?${params}`, proxyUrl))
		.then((data) => {
			const c = data.current;
			const d = data.daily;
			return {
				temp: c.temperature_2m,
				feels: c.apparent_temperature,
				humidity: c.relative_humidity_2m,
				code: c.weather_code,
				description: describeCode(c.weather_code),
				isDay: c.is_day === 1,
				wind: c.wind_speed_10m,
				windDir: c.wind_direction_10m,
				precipitation: c.precipitation,
				max: d.temperature_2m_max[0],
				min: d.temperature_2m_min[0],
				precipProb: d.precipitation_probability_max[0],
				windUnit: windUnit === "kmh" ? "км/ч" : "м/с",
				time: c.time,
			};
		})
		.catch((err) => {
			cache.delete(key);
			throw err;
		});

	cache.set(key, { time: Date.now(), promise });
	return promise;
}
