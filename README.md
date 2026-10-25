# Погода для Stream Deck

Плагин для [Elgato Stream Deck](https://www.elgato.com/stream-deck), который показывает **текущую погоду прямо на кнопке**.
Одна кнопка — один город: поставьте рядом несколько кнопок и видите погоду в нескольких городах сразу.

![Кнопки плагина: Уфа, Санкт-Петербург, Минск в трёх видах](docs/preview.png)

*English summary is [below](#english).*

## Возможности

- **Три вида кнопки**, переключаются коротким нажатием:
  - **Сейчас** — значок погоды, температура, «ощущается как»;
  - **Сегодня** — максимум и минимум за день, вероятность осадков (или погода днём);
  - **Ветер** — стрелка направления, скорость, влажность (или порывы).
- **Два источника погоды** на выбор для каждой кнопки:
  - [Open-Meteo](https://open-meteo.com) — бесплатно, без регистрации и ключа;
  - [Яндекс Погода](https://yandex.ru/pogoda/b2b/smarthome) — нужен бесплатный ключ.
- **Поиск города по названию** прямо в настройках кнопки (или ввод координат).
- °C / °F, м/с / км/ч, частота обновления.
- Подпись города подстраивается под ширину кнопки; её можно заменить своей через **Title** (например, «Питер»).
- Работает через прокси HTTP, SOCKS5 (в том числе socks5h) и SOCKS4; системный прокси Windows подхватывается автоматически.

## Установка

**Требования:** Stream Deck 7.1 или новее, Windows 10+ или macOS 12+.

### Готовый плагин

1. Скачайте файл `com.silence02.openmeteo.streamDeckPlugin` со страницы [Releases](../../releases).
2. Дважды щёлкните по нему — Stream Deck установит плагин.

### Из исходников (Windows)

Нужен [Node.js](https://nodejs.org) (для `npm`).

```powershell
git clone https://github.com/Silence02ru/streamdeck-weather.git
cd streamdeck-weather
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

Скрипт поставит зависимости, скопирует плагин в папку Stream Deck и перезапустит приложение.

## Настройка

1. Найдите в списке действий категорию **«Погода»** и перетащите действие **«Погода»** на кнопку.
2. В настройках кнопки введите город и нажмите **«Найти»**, выберите нужный из списка.
3. Готово. Для нескольких городов — повторите на соседних кнопках.

**Управление кнопкой:** короткое нажатие — следующий вид, долгое (больше полсекунды) — обновить сейчас.

### Яндекс Погода

1. Получите бесплатный ключ на [yandex.ru/pogoda/b2b/smarthome](https://yandex.ru/pogoda/b2b/smarthome)
   (активируется до 5 минут).
2. В настройках кнопки выберите **Источник → Яндекс Погода** и вставьте ключ.
   Ключ общий: достаточно ввести его один раз на любой кнопке.

У бесплатного ключа лимит — **30 запросов в сутки и 1000 в месяц**. Поэтому плагин:
- запрашивает **все города одним запросом** (3 кнопки = 1 запрос);
- обновляет погоду Яндекса **раз в час** (24 запроса в сутки);
- по долгому нажатию обновляет не чаще раза в 15 минут.

Бесплатный ключ не отдаёт влажность и вероятность осадков — вместо них кнопка показывает порывы ветра и погоду днём.

### Подпись города

- По умолчанию — жирный шрифт, длинные названия уменьшаются, чтобы влезть.
- Текст в поле **Title** кнопки (значок «T») заменяет название города.
- **Шрифт подписи → Из настроек Title** — шрифт, размер и цвет берутся из меню Title.

### Прокси

Поле **Прокси (общий)** в настройках любой кнопки — прокси один на все кнопки:

| Значение | Что значит |
|---|---|
| *пусто* | системный прокси Windows (и переменные `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`) |
| `none` | напрямую, без прокси |
| `127.0.0.1:10809` или `http://127.0.0.1:10809` | HTTP-прокси |
| `socks5h://127.0.0.1:10808` | SOCKS5, адреса серверов определяет прокси — DNS тоже идёт через него (`socks://` — то же самое) |
| `socks5://127.0.0.1:10808` | SOCKS5, адреса определяются на компьютере |
| `socks4a://…`, `socks4://…` | SOCKS4a / SOCKS4 |
| `socks5h://логин:пароль@host:port` | с авторизацией (так же для `http://`) |

Кнопка **«Проверить»** рядом с полем (и любое изменение поля) проверяет, что через этот прокси есть связь
с сервером погоды: показывает «✓ Работает через …» со временем отклика или причину ошибки.
Запрос погоды при этом не отправляется, лимит Яндекса не тратится.

Если в системных настройках Windows указан только SOCKS-прокси, плагин использует его как `socks5h`.
Для v2rayN / xray / Clash обычно подходит `socks5h://127.0.0.1:10808` или HTTP `127.0.0.1:10809`.

## Вопросы

- **«Проверьте ключ Яндекса»** — ключ не введён или Яндекс его отклонил. Новый ключ начинает работать через несколько минут.
- **«Нет связи»** — нет доступа к серверу погоды. Если интернет идёт через прокси, проверьте поле «Прокси».
- **Логи плагина:** `%APPDATA%\Elgato\StreamDeck\Plugins\com.silence02.openmeteo.sdPlugin\logs\`.

## Разработка

```
com.silence02.openmeteo.sdPlugin/   сам плагин (manifest, код, окно настроек, иконки)
  bin/plugin.js     точка входа: логика кнопок
  bin/weather.js    Open-Meteo и общий формат данных
  bin/yandex.js     Яндекс Погода: один запрос на все города
  bin/http.js       HTTPS-запросы через прокси
  bin/render.js     отрисовка кнопки (SVG)
  ui/weather.html   окно настроек кнопки
scripts/            установка, сборка релиза, генерация иконок и превью
```

- Код запускается как есть, без сборщика; единственная зависимость — `@elgato/streamdeck`.
- После правок: `scripts\install.ps1`.
- Выпустить релиз: поднять `Version` в `manifest.json`, закоммитить и отправить тег —
  `git tag v1.4.0` и `git push origin v1.4.0`. GitHub Actions сам соберёт `.streamDeckPlugin` и опубликует релиз.
  Локальная сборка того же файла: `scripts\pack.ps1` → `dist\`.
- Иконки: `node scripts/gen-icons.mjs`, картинка для README: `node scripts/gen-preview.mjs`.
- Подробное устройство — в [CONTEXT.md](CONTEXT.md), история изменений — в [CHANGELOG.md](CHANGELOG.md).

Данные о погоде: [Open-Meteo](https://open-meteo.com) (CC BY 4.0) и [Яндекс Погода](https://yandex.ru/pogoda).

## Лицензия

[MIT](LICENSE)

---

## English

**Weather for Stream Deck** — a Stream Deck plugin that shows the current weather on a key.
One key per city; place several keys to watch several cities at once.

- Three views (tap to switch): **now** (icon, temperature, feels like), **today** (high/low, precipitation),
  **wind** (direction, speed, humidity or gusts). Long press refreshes.
- Sources: [Open-Meteo](https://open-meteo.com) (free, no key) or Yandex Weather (free key from
  [yandex.ru/pogoda/b2b/smarthome](https://yandex.ru/pogoda/b2b/smarthome)). All Yandex cities are fetched in
  a single request, once an hour, to fit the free quota (30 requests/day).
- City search by name, °C/°F, m/s / km/h, proxy support: HTTP, SOCKS5/socks5h, SOCKS4/4a (Windows system proxy is detected automatically).
- The UI is in Russian.

**Install:** download `com.silence02.openmeteo.streamDeckPlugin` from [Releases](../../releases) and double-click it
(Stream Deck 7.1+). From source on Windows: `scripts\install.ps1` (requires Node.js).
