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

// --- подпись (город) сверху кнопки ---

const LABEL_MAX_WIDTH = 136;
const LABEL_SIZE = 24; // px на картинке 144×144
const LABEL_MAX_SIZE = 30;
const LABEL_MIN_SIZE = 12;

// Ширина символов жирного Segoe UI в em, замерена в браузере (canvas measureText).
// Пары [символы, ширина]. Для других шрифтов из Title это оценка.
const CHAR_EM = new Map(
	[
		[".,", 0.27],
		["ijl ", 0.28],
		["I", 0.32],
		["()", 0.37],
		["f", 0.38],
		["t", 0.39],
		["r-", 0.4],
		["г", 0.41],
		["s", 0.44],
		["тJ", 0.45],
		["зсэcz", 0.48],
		["ГL", 0.51],
		["F", 0.52],
		["ЕЁE", 0.53],
		["аеёуaevy", 0.54],
		["хx", 0.55],
		["кьЗkS", 0.56],
		["я", 0.57],
		["0123456789в", 0.58],
		["ТT", 0.59],
		["лчhnu", 0.6],
		["бнопРУoPYZ", 0.61],
		["дрСЬЭbdgpqC", 0.62],
		["ий", 0.63],
		["БВЯB", 0.64],
		["цъКKR", 0.65],
		["ХX", 0.66],
		["V", 0.67],
		["АA", 0.7],
		["G", 0.71],
		["U", 0.72],
		["ЛЧ", 0.73],
		["D", 0.74],
		["ОЪOQ", 0.76],
		["ДНПH", 0.77],
		["мф", 0.78],
		["ИЙN", 0.79],
		["w", 0.8],
		["ы", 0.81],
		["Ц", 0.82],
		["Ф", 0.84],
		["ж", 0.85],
		["ш", 0.86],
		["ю", 0.88],
		["щЫ", 0.9],
		["m", 0.92],
		["МM", 0.96],
		["Ж", 0.99],
		["W", 1],
		["Ш", 1.01],
		["Ю", 1.06],
		["Щ", 1.07],
	].flatMap(([chars, em]) => [...chars].map((ch) => [ch, em])),
);

function widthEm(value, bold) {
	const em = [...value].reduce((sum, ch) => sum + (CHAR_EM.get(ch) ?? 0.65), 0);
	// Запас 6%: рендер Stream Deck может быть чуть шире браузерного.
	return (bold ? em : em * 0.95) * 1.06;
}

/**
 * Подпись сверху: жирная и крупная, сама уменьшается, чтобы влезть в ширину кнопки.
 * style — параметры Title из Stream Deck (шрифт, размер, стиль, цвет) или null — стиль по умолчанию.
 * Возвращает SVG-текст.
 */
function labelSvg(value, style) {
	if (!value) return "";
	const bold = style ? /bold/i.test(style.fontStyle ?? "") : true;
	const italic = style ? /italic/i.test(style.fontStyle ?? "") : false;
	// Размер Title в Stream Deck задан для кнопки 72 px, картинка у нас 144 px.
	const wanted = style?.fontSize ? Math.min(LABEL_MAX_SIZE, style.fontSize * 2) : LABEL_SIZE;
	const fit = Math.floor(LABEL_MAX_WIDTH / widthEm(value, bold));
	const size = Math.max(LABEL_MIN_SIZE, Math.min(wanted, fit));

	// Даже минимальным шрифтом не влезает — обрезаем с многоточием.
	let shown = value;
	while (shown.length > 1 && widthEm(shown, bold) * size > LABEL_MAX_WIDTH) shown = shown.slice(0, -2) + "…";

	const family = style?.fontFamily ? `"${style.fontFamily}", "Segoe UI", Arial, sans-serif` : `"Segoe UI", Arial, sans-serif`;
	const color = style?.titleColor || "#ffffff";
	const y = Math.round(3 + size * 0.82);
	return `<text x='72' y='${y}' font-family='${esc(family)}' font-size='${size}' font-weight='${bold ? 700 : 400}'` +
		`${italic ? " font-style='italic'" : ""}${style?.fontUnderline ? " text-decoration='underline'" : ""}` +
		` fill='${esc(color)}' text-anchor='middle'>${esc(shown)}</text>`;
}

/**
 * mode: 0 — сейчас, 1 — сегодня (макс/мин, осадки или погода днём), 2 — ветер и влажность (или порывы).
 * title — текст Title кнопки (заменяет название города), titleStyle — параметры Title или null,
 * hideLabel — подпись рисует сам Stream Deck (в Title включён «Показывать заголовок»).
 */
export function renderWeather(w, { city, mode, showCity, title = "", titleStyle = null, hideLabel = false }) {
	const { text: desc, icon } = w.description;
	let body = background(w.isDay);
	const place = title || (showCity && city ? city : "");
	const label = (value) => (hideLabel ? "" : labelSvg(value, titleStyle));

	if (mode === 1) {
		// Яндекс (бесплатный ключ) не даёт вероятность осадков — вместо неё погода днём.
		const day = w.dayDescription;
		const bottom = w.precipProb !== null && w.precipProb !== undefined
			? `осадки ${round(w.precipProb)}%`
			: shorten(day?.text ?? desc, 14);
		body += label(place || "Сегодня");
		body += `<g transform='translate(8 34) scale(0.42)'>${weatherIcon(day?.icon ?? icon, true)}</g>`;
		body += text(132, 66, 30, `${round(w.max)}°`, { weight: 700, anchor: "end" });
		body += text(132, 100, 26, `${round(w.min)}°`, { weight: 500, color: "#a9c7ee", anchor: "end" });
		body += text(72, 132, 18, bottom, { weight: 500, color: "#cfe3ff" });
	} else if (mode === 2) {
		body += label(place || desc);
		body += `<g transform='translate(72 64) rotate(${(w.windDir + 180) % 360})'>
<path d='M 0 -20 L 11 12 L 0 5 L -11 12 Z' fill='#ffffff'/></g>`;
		body += text(72, 108, 22, `${round(w.wind)} ${w.windUnit} ${windDirection(w.windDir)}`, { weight: 600 });
		// Яндекс (бесплатный ключ) не даёт влажность — вместо неё порывы ветра.
		const bottom = w.humidity !== null && w.humidity !== undefined
			? `влажн. ${round(w.humidity)}%`
			: w.gust !== null && w.gust !== undefined ? `порывы ${round(w.gust)}` : "";
		body += text(72, 132, 18, bottom, { weight: 500, color: "#cfe3ff" });
	} else {
		body += label(place || desc);
		body += `<g transform='translate(42 30) scale(0.6)'>${weatherIcon(icon, w.isDay)}</g>`;
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
