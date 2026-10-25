// Отрисовка картинки кнопки (SVG 144×144).

const SIZE = 144;
const FONT = "font-family='Segoe UI, Arial, sans-serif'";

function esc(s) {
	return String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function round(v) {
	if (v === null || v === undefined || Number.isNaN(v)) return "—";
	return String(Math.round(v)).replace("-", "−");
}

function shorten(s, max) {
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Фон зависит от времени суток.
function background(isDay) {
	const [a, b] = isDay ? ["#2b7bd6", "#0f3f7a"] : ["#1d2340", "#07091a"];
	return `<defs><linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs>
<rect width='${SIZE}' height='${SIZE}' fill='url(#bg)'/>`;
}

// --- иконки погоды, рисуются в квадрате 0..100 ---

function sun(cx, cy, r) {
	let rays = "";
	for (let i = 0; i < 8; i++) {
		const a = (i * Math.PI) / 4;
		const x1 = cx + Math.cos(a) * (r + 6), y1 = cy + Math.sin(a) * (r + 6);
		const x2 = cx + Math.cos(a) * (r + 14), y2 = cy + Math.sin(a) * (r + 14);
		rays += `<line x1='${x1.toFixed(1)}' y1='${y1.toFixed(1)}' x2='${x2.toFixed(1)}' y2='${y2.toFixed(1)}' stroke='#ffd23f' stroke-width='5' stroke-linecap='round'/>`;
	}
	return `${rays}<circle cx='${cx}' cy='${cy}' r='${r}' fill='#ffd23f'/>`;
}

function moon(cx, cy, r) {
	return `<path d='M ${cx + r * 0.3} ${cy - r} A ${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.35} A ${r * 0.8} ${r * 0.8} 0 0 1 ${cx + r * 0.3} ${cy - r} Z' fill='#f3e9b5'/>`;
}

function cloud(x, y, scale, color = "#ffffff") {
	return `<g transform='translate(${x} ${y}) scale(${scale})' fill='${color}'>
<circle cx='30' cy='30' r='16'/><circle cx='52' cy='22' r='20'/><circle cx='72' cy='34' r='14'/>
<rect x='14' y='30' width='72' height='18' rx='9'/></g>`;
}

function drops(color, count, len) {
	let s = "";
	for (let i = 0; i < count; i++) {
		const x = 30 + i * (44 / Math.max(1, count - 1));
		s += `<line x1='${x}' y1='72' x2='${x - 5}' y2='${72 + len}' stroke='${color}' stroke-width='5' stroke-linecap='round'/>`;
	}
	return s;
}

function flakes() {
	let s = "";
	for (const [x, y] of [[30, 80], [52, 88], [74, 80]]) {
		s += `<g stroke='#ffffff' stroke-width='3.5' stroke-linecap='round'>
<line x1='${x - 7}' y1='${y}' x2='${x + 7}' y2='${y}'/><line x1='${x - 4}' y1='${y - 6}' x2='${x + 4}' y2='${y + 6}'/><line x1='${x - 4}' y1='${y + 6}' x2='${x + 4}' y2='${y - 6}'/></g>`;
	}
	return s;
}

export function weatherIcon(type, isDay) {
	const sky = isDay ? sun(34, 34, 16) : moon(34, 34, 18);
	switch (type) {
		case "clear":
			return isDay ? sun(50, 50, 22) : moon(50, 50, 26);
		case "partly":
			return sky + cloud(14, 30, 0.9);
		case "cloud":
			return cloud(0, 10, 1.15, "#e6ecf3");
		case "fog":
			return cloud(4, 0, 1, "#d7dde5") +
				`<g stroke='#d7dde5' stroke-width='6' stroke-linecap='round'><line x1='16' y1='68' x2='84' y2='68'/><line x1='24' y1='82' x2='76' y2='82'/></g>`;
		case "drizzle":
			return cloud(4, 0, 1) + drops("#9fd4ff", 4, 9);
		case "rain":
			return cloud(4, 0, 1, "#cfd8e3") + drops("#4fb3ff", 4, 18);
		case "snow":
			return cloud(4, 0, 1) + flakes();
		case "storm":
			return cloud(4, 0, 1, "#9aa6b5") +
				`<path d='M 54 56 L 40 80 L 52 80 L 44 100 L 66 72 L 54 72 L 62 56 Z' fill='#ffd23f'/>`;
		default:
			return cloud(4, 10, 1);
	}
}

function text(x, y, size, value, { weight = 600, color = "#ffffff", anchor = "middle" } = {}) {
	return `<text x='${x}' y='${y}' ${FONT} font-size='${size}' font-weight='${weight}' fill='${color}' text-anchor='${anchor}'>${esc(value)}</text>`;
}

function toDataUrl(body) {
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}' viewBox='0 0 ${SIZE} ${SIZE}'>${body}</svg>`;
	return "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg);
}

const DIRS = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
function windDirection(deg) {
	return DIRS[Math.round(((deg % 360) / 45)) % 8];
}

/**
 * mode: 0 — сейчас, 1 — сегодня (макс/мин, осадки или погода днём), 2 — ветер и влажность (или порывы).
 */
export function renderWeather(w, { city, mode, showCity }) {
	const { text: desc, icon } = w.description;
	let body = background(w.isDay);
	const label = showCity && city ? shorten(city, 13) : shorten(desc, 13);

	if (mode === 1) {
		// Яндекс (бесплатный ключ) не даёт вероятность осадков — вместо неё погода днём.
		const day = w.dayDescription;
		const bottom = w.precipProb !== null && w.precipProb !== undefined
			? `осадки ${round(w.precipProb)}%`
			: shorten(day?.text ?? desc, 14);
		body += text(72, 24, 17, "Сегодня", { weight: 500, color: "#cfe3ff" });
		body += `<g transform='translate(8 32) scale(0.42)'>${weatherIcon(day?.icon ?? icon, true)}</g>`;
		body += text(132, 62, 30, `${round(w.max)}°`, { weight: 700, anchor: "end" });
		body += text(132, 96, 26, `${round(w.min)}°`, { weight: 500, color: "#a9c7ee", anchor: "end" });
		body += text(72, 130, 18, bottom, { weight: 500, color: "#cfe3ff" });
	} else if (mode === 2) {
		body += text(72, 24, 17, shorten(label, 13), { weight: 500, color: "#cfe3ff" });
		body += `<g transform='translate(72 62) rotate(${(w.windDir + 180) % 360})'>
<path d='M 0 -20 L 11 12 L 0 5 L -11 12 Z' fill='#ffffff'/></g>`;
		body += text(72, 108, 22, `${round(w.wind)} ${w.windUnit} ${windDirection(w.windDir)}`, { weight: 600 });
		// Яндекс (бесплатный ключ) не даёт влажность — вместо неё порывы ветра.
		const bottom = w.humidity !== null && w.humidity !== undefined
			? `влажн. ${round(w.humidity)}%`
			: w.gust !== null && w.gust !== undefined ? `порывы ${round(w.gust)}` : "";
		body += text(72, 132, 18, bottom, { weight: 500, color: "#cfe3ff" });
	} else {
		body += text(72, 22, 17, label, { weight: 500, color: "#cfe3ff" });
		body += `<g transform='translate(40 25) scale(0.64)'>${weatherIcon(icon, w.isDay)}</g>`;
		body += text(72, 122, 38, `${round(w.temp)}°`, { weight: 700 });
		body += text(72, 140, 13, `ощущ. ${round(w.feels)}°`, { weight: 500, color: "#cfe3ff" });
	}
	return toDataUrl(body);
}

/** Картинка-заглушка с сообщением (нет города, ошибка сети). */
export function renderMessage(line1, line2 = "", isError = false) {
	let body = background(false);
	body += cloud(37, 16, 0.7, isError ? "#ff8a8a" : "#7f8db0");
	body += text(72, 98, 18, line1, { weight: 600 });
	if (line2) body += text(72, 122, 15, line2, { weight: 500, color: "#b8c4dd" });
	return toDataUrl(body);
}
