// Рисует docs/preview.png для README: несколько кнопок, отрисованных кодом плагина.
// Запуск: node scripts/gen-preview.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderWeather } from "../com.silence02.openmeteo.sdPlugin/bin/render.js";
import { describeCode } from "../com.silence02.openmeteo.sdPlugin/bin/weather.js";
import { describeYandexCondition } from "../com.silence02.openmeteo.sdPlugin/bin/yandex.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "preview.png");

const BROWSERS = [
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error("Не найден Edge или Chrome");

// Примерные данные — только для картинки.
const base = { windUnit: "м/с", precipProb: null };
const rows = [
	[{ ...base, temp: -4, feels: -9, isDay: true, wind: 5, windDir: 210, gust: 11, max: -2, min: -8, description: describeYandexCondition("LIGHT_SNOW"), dayDescription: describeYandexCondition("SNOW") }, "Уфа"],
	[{ ...base, temp: 3, feels: -1, isDay: true, wind: 7, windDir: 250, gust: 14, max: 4, min: 1, description: describeYandexCondition("OVERCAST"), dayDescription: describeYandexCondition("LIGHT_RAIN") }, "Санкт-Петербург"],
	[{ ...base, temp: 1, feels: -2, isDay: false, wind: 3, windDir: 120, humidity: 82, max: 5, min: -1, precipProb: 20, description: describeCode(0) }, "Минск"],
];

const cells = rows.flatMap(([w, city]) => [0, 1, 2].map((mode) => renderWeather(w, { city, mode, showCity: true })));
const KEY = 144, GAP = 16, PAD = 16;
const width = PAD * 2 + KEY * 3 + GAP * 2;
const height = PAD * 2 + KEY * 3 + GAP * 2;
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1b1b1f">
<div style="display:grid;grid-template-columns:repeat(3,${KEY}px);gap:${GAP}px;padding:${PAD}px">
${cells.map((src) => `<img width="${KEY}" height="${KEY}" style="border-radius:18px" src="${src}">`).join("\n")}
</div></body>`;

const tmp = mkdtempSync(join(tmpdir(), "sd-preview-"));
const page = join(tmp, "preview.html");
writeFileSync(page, html);
mkdirSync(dirname(out), { recursive: true });
execFileSync(browser, [
	"--headless=new", "--disable-gpu", "--hide-scrollbars",
	`--window-size=${width},${height}`, `--screenshot=${out}`, pathToFileURL(page).href,
], { stdio: "ignore" });
console.log("✓", out);
