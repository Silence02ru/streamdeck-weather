# CONTEXT — плагин Stream Deck «Погода Open-Meteo»

Плагин для Elgato Stream Deck (SDK v2, Node.js-рантайм, пакет `@elgato/streamdeck` 3.x), показывающий
актуальную погоду с [open-meteo.com](https://open-meteo.com) на кнопке. Без API-ключа.

## Структура

| Путь | Назначение |
|---|---|
| `com.silence02.openmeteo.sdPlugin/manifest.json` | Манифест: UUID `com.silence02.openmeteo`, действие `com.silence02.openmeteo.weather` (только Keypad), Node 20, Stream Deck ≥ 7.1 (требование SDK 3.x). |
| `…sdPlugin/package.json` | ESM (`"type": "module"`), единственная зависимость `@elgato/streamdeck`. `node_modules` ставится прямо в папку плагина — сборщика нет, код запускается как есть. |
| `…sdPlugin/bin/plugin.js` | Точка входа. Класс `WeatherAction` (SingletonAction без декораторов, `manifestId` задан полем). Хранит состояние каждой кнопки в `keys` (Map по `action.id`): таймер, данные, время нажатия. Короткое нажатие — следующий вид (`mode` 0→1→2, сохраняется в настройках), долгое (≥600 мс) — немедленное обновление. При ошибке сети повтор через 1 мин, старые данные остаются + `showAlert`. |
| `…sdPlugin/bin/weather.js` | Запрос `api.open-meteo.com/v1/forecast` (current + daily на 1 день, `timezone=auto`), таблица WMO-кодов → русское описание и тип иконки, кэш одинаковых запросов на 60 с. |
| `…sdPlugin/bin/http.js` | HTTPS GET JSON с поддержкой HTTP-прокси через CONNECT-туннель (без зависимостей). `resolveProxy()`: настройка кнопки → `HTTPS_PROXY`/`HTTP_PROXY` → системный прокси Windows из реестра (`HKCU\…\Internet Settings`, кэш 5 мин). Нужно потому, что Node.js Stream Deck не использует системный прокси, а у пользователя api.open-meteo.com напрямую недоступен. |
| `…sdPlugin/bin/render.js` | Отрисовка кнопки как SVG 144×144 (data URL для `setImage`). Иконки погоды нарисованы фигурами (без эмодзи — рендер Stream Deck их не гарантирует). Виды: 0 — сейчас (иконка, температура, ощущается), 1 — сегодня (макс/мин, вероятность осадков), 2 — ветер (стрелка, скорость, направление) и влажность. `renderMessage` — заглушка «Укажите город» / «Нет связи». |
| `…sdPlugin/ui/weather.html` | Property Inspector на «голом» WebSocket-протоколе (`connectElgatoStreamDeckSocket`), без внешних библиотек. Поиск города через `geocoding-api.open-meteo.com` прямо из окна, ручной ввод координат, единицы, вид, интервал, подпись, прокси. |
| `…sdPlugin/imgs/` | PNG-иконки (генерируются скриптом, см. ниже). |
| `scripts/gen-icons.mjs` | Генерирует PNG-иконки из SVG через headless Edge/Chrome. С аргументом-папкой дополнительно рисует превью всех вариантов кнопки. |
| `scripts/install.ps1` | `npm install` → закрыть Stream Deck → скопировать папку плагина (robocopy /MIR) в `%APPDATA%\Elgato\StreamDeck\Plugins` → запустить Stream Deck. Junction не используется: Stream Deck не разрешает ссылку на диск S: («reparse point buffer is invalid»). |

## Настройки кнопки (settings)

`cityName`, `cityLabel`, `latitude`, `longitude`, `units` (`celsius`/`fahrenheit`), `windUnit` (`ms`/`kmh`),
`mode` (0/1/2), `interval` (мин, по умолчанию 10), `showCity` (bool), `proxy` (`""` — авто, `"none"`, `host:port`).

## Отладка

- Лог плагина: `%APPDATA%\Elgato\StreamDeck\Plugins\com.silence02.openmeteo.sdPlugin\logs\`.
- Лог Stream Deck: `%APPDATA%\Elgato\StreamDeck\logs\StreamDeck.log` (искать `openmeteo`).
- Проверить запрос вне Stream Deck: `node --input-type=module -e "import {fetchWeather} from './bin/weather.js'; console.log(await fetchWeather({latitude:55.75,longitude:37.62}))"` в папке плагина.
