// Генерирует PNG-иконки плагина из SVG через headless Edge/Chrome.
// Запуск: node scripts/gen-icons.mjs [папка-для-превью]
// Если указана папка, дополнительно рисует превью всех видов кнопки.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderWeather, weatherIcon } from "../com.silence02.openmeteo.sdPlugin/bin/render.js";
import { describeCode } from "../com.silence02.openmeteo.sdPlugin/bin/weather.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "com.silence02.openmeteo.sdPlugin");
const tmp = mkdtempSync(join(tmpdir(), "sd-icons-"));

const BROWSERS = [
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error("Не найден Edge или Chrome");

function png(svgBody, viewBox, size, out) {
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='${viewBox}'>${svgBody}</svg>`;
	const src = join(tmp, `i${Math.random().toString(36).slice(2)}.svg`);
	writeFileSync(src, svg);
	mkdirSync(dirname(out), { recursive: true });
	execFileSync(browser, [
		"--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
		`--window-size=${size},${size}`, `--screenshot=${out}`, pathToFileURL(src).href,
	], { stdio: "ignore" });
}

function dataUrlToSvg(url) {
	return decodeURIComponent(url.slice(url.indexOf(",") + 1));
}

// Монохромная иконка для списка действий: облако с солнцем, белое.
const mono = `<g fill='none' stroke='#ffffff' stroke-width='7' stroke-linecap='round' stroke-linejoin='round'>
<circle cx='36' cy='34' r='14'/><line x1='36' y1='8' x2='36' y2='12'/><line x1='10' y1='34' x2='14' y2='34'/><line x1='18' y1='16' x2='21' y2='19'/><line x1='54' y1='16' x2='51' y2='19'/>
<path d='M 30 84 H 76 A 14 14 0 0 0 74 56 A 20 20 0 0 0 38 54 A 15 15 0 0 0 30 84 Z' fill='#2d2d2d'/></g>`;

// Цветная иконка плагина.
const color = `<rect width='100' height='100' rx='20' fill='#1f63b8'/><g transform='translate(8 6) scale(0.84)'>${weatherIcon("partly", true)}</g>`;

const sample = {
	temp: 12, feels: 9, humidity: 55, isDay: true, wind: 4, windDir: 225, windUnit: "м/с",
	max: 14, min: 5, precipProb: 20, description: describeCode(2),
};

const jobs = [
	[mono, "0 0 100 100", 20, "imgs/actions/weather/icon.png"],
	[mono, "0 0 100 100", 40, "imgs/actions/weather/icon@2x.png"],
	[mono, "0 0 100 100", 28, "imgs/plugin/category.png"],
	[mono, "0 0 100 100", 56, "imgs/plugin/category@2x.png"],
	[color, "0 0 100 100", 256, "imgs/plugin/icon.png"],
	[color, "0 0 100 100", 512, "imgs/plugin/icon@2x.png"],
];
const key = dataUrlToSvg(renderWeather(sample, { city: "Погода", mode: 0, showCity: true }));
const keyBody = key.replace(/^<svg[^>]*>|<\/svg>$/g, "");
jobs.push([keyBody, "0 0 144 144", 72, "imgs/actions/weather/key.png"]);
jobs.push([keyBody, "0 0 144 144", 144, "imgs/actions/weather/key@2x.png"]);

for (const [body, vb, size, rel] of jobs) {
	png(body, vb, size, join(plugin, rel));
	console.log("✓", rel);
}

// Превью всех вариантов кнопки (для проверки отрисовки).
const previewDir = process.argv[2];
if (previewDir) {
	const codes = [0, 2, 3, 45, 53, 63, 73, 95];
	for (const code of codes) {
		for (const isDay of [true, false]) {
			const w = { ...sample, isDay, temp: -3.4, description: describeCode(code) };
			const body = dataUrlToSvg(renderWeather(w, { city: "Санкт-Петербург", mode: 0, showCity: code % 2 === 0 })).replace(/^<svg[^>]*>|<\/svg>$/g, "");
			png(body, "0 0 144 144", 144, join(previewDir, `code${code}-${isDay ? "day" : "night"}.png`));
		}
	}
	for (const mode of [1, 2]) {
		const body = dataUrlToSvg(renderWeather(sample, { city: "Москва", mode, showCity: true })).replace(/^<svg[^>]*>|<\/svg>$/g, "");
		png(body, "0 0 144 144", 144, join(previewDir, `mode${mode}.png`));
	}
	console.log("Превью:", previewDir);
}
