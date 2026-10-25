# CONTEXT — плагин Stream Deck «Погода Open-Meteo»

Плагин для Elgato Stream Deck (SDK v2, Node.js-рантайм, пакет `@elgato/streamdeck` 3.x), показывающий
актуальную погоду на кнопке. Два источника (выбор на каждой кнопке):
- [Open-Meteo](https://open-meteo.com) — по умолчанию, без ключа;
- [Яндекс Погода](https://yandex.ru/pogoda/b2b/smarthome) — GraphQL API `api.weather.yandex.ru/graphql/query`,
  заголовок `X-Yandex-Weather-Key`, бесплатный ключ для умного дома (так же, как в
  [yandex/pogoda-home-assistant](https://github.com/yandex/pogoda-home-assistant)). Неверный ключ — HTTP 403/404.

## Структура

| Путь | Назначение |
|---|---|
| `com.silence02.openmeteo.sdPlugin/manifest.json` | Манифест: UUID `com.silence02.openmeteo`, действие `com.silence02.openmeteo.weather` (только Keypad), Node 20, Stream Deck ≥ 7.1 (требование SDK 3.x). |
| `…sdPlugin/package.json` | ESM (`"type": "module"`), единственная зависимость `@elgato/streamdeck`. `node_modules` ставится прямо в папку плагина — сборщика нет, код запускается как есть. |
| `…sdPlugin/bin/plugin.js` | Точка входа. Класс `WeatherAction` (SingletonAction без декораторов, `manifestId` задан полем). Хранит состояние каждой кнопки в `keys` (Map по `action.id`): таймер, данные, время нажатия. Короткое нажатие — следующий вид (`mode` 0→1→2, сохраняется в настройках), долгое (≥600 мс) — немедленное обновление. При ошибке сети повтор через 1 мин (Яндекс — 5 мин), старые данные остаются + `showAlert`. Ошибка ключа (`err.kind === "key"`) — картинка «Проверьте ключ Яндекса», без ускоренного повтора. Для Яндекса интервал обновления не меньше 30 мин (`YANDEX_MIN_INTERVAL_MIN`, лимит ключа). |
| `…sdPlugin/bin/weather.js` | `fetchWeather()` выбирает источник по `source` и приводит данные к общему формату (`temp, feels, humidity, description{text,icon}, isDay, wind, windDir, max, min, precipProb, windUnit`). Open-Meteo: `api.open-meteo.com/v1/forecast` (current + daily на 1 день), WMO-коды → описание. Яндекс: GraphQL-запрос (`now` + `forecast.days[0].summary.night/day`), координаты подставляются в текст запроса; значения приходят в °C и м/с, перевод в °F и км/ч делается в коде; `precProbability` 0..1 → %. Разбор вынесен в `parseYandex()` (устойчив к отсутствующим полям). Кэш одинаковых запросов на 60 с. |
| `…sdPlugin/bin/http.js` | HTTPS-запрос JSON (GET, либо POST при `body`) с поддержкой HTTP-прокси через CONNECT-туннель (без зависимостей). `resolveProxy()`: настройка кнопки → `HTTPS_PROXY`/`HTTP_PROXY` → системный прокси Windows из реестра (`HKCU\…\Internet Settings`, кэш 5 мин). Нужно потому, что Node.js Stream Deck не использует системный прокси, а у пользователя api.open-meteo.com напрямую недоступен. |
| `…sdPlugin/bin/render.js` | Отрисовка кнопки как SVG 144×144 (data URL для `setImage`). Иконки погоды нарисованы фигурами (без эмодзи — рендер Stream Deck их не гарантирует). Виды: 0 — сейчас (иконка, температура, ощущается), 1 — сегодня (макс/мин, вероятность осадков), 2 — ветер (стрелка, скорость, направление) и влажность. `renderMessage` — заглушка «Укажите город» / «Нет связи». |
| `…sdPlugin/ui/weather.html` | Property Inspector на «голом» WebSocket-протоколе (`connectElgatoStreamDeckSocket`), без внешних библиотек. Выбор источника и ключ Яндекса (поле видно только для Яндекса, ссылка на получение ключа открывается через событие `openUrl`). Поиск города через `geocoding-api.open-meteo.com` прямо из окна (для обоих источников), ручной ввод координат, единицы, вид, интервал, подпись, прокси. |
| `…sdPlugin/imgs/` | PNG-иконки (генерируются скриптом, см. ниже). |
| `scripts/gen-icons.mjs` | Генерирует PNG-иконки из SVG через headless Edge/Chrome. С аргументом-папкой дополнительно рисует превью всех вариантов кнопки. |
| `scripts/install.ps1` | `npm install` → закрыть Stream Deck → скопировать папку плагина (robocopy /MIR) в `%APPDATA%\Elgato\StreamDeck\Plugins` → запустить Stream Deck. Junction не используется: Stream Deck не разрешает ссылку на диск S: («reparse point buffer is invalid»). |

## Настройки кнопки (settings)

`source` (`openmeteo`/`yandex`), `yandexKey`, `cityName`, `cityLabel`, `latitude`, `longitude`, `units` (`celsius`/`fahrenheit`), `windUnit` (`ms`/`kmh`),
`mode` (0/1/2), `interval` (мин, по умолчанию 10), `showCity` (bool), `proxy` (`""` — авто, `"none"`, `host:port`).

## Отладка

- Лог плагина: `%APPDATA%\Elgato\StreamDeck\Plugins\com.silence02.openmeteo.sdPlugin\logs\`.
- Лог Stream Deck: `%APPDATA%\Elgato\StreamDeck\logs\StreamDeck.log` (искать `openmeteo`).
- Проверить запрос вне Stream Deck: `node --input-type=module -e "import {fetchWeather} from './bin/weather.js'; console.log(await fetchWeather({latitude:55.75,longitude:37.62}))"` в папке плагина.
