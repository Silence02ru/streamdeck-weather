// Точка входа плагина. Stream Deck запускает этот файл через встроенный Node.js.
import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { maskProxy, testConnection } from "./http.js";
import { fetchWeather } from "./weather.js";
import { forgetYandexButton, yandexEvents } from "./yandex.js";
import { renderMessage, renderWeather } from "./render.js";

const MODES = 3;
const LONG_PRESS_MS = 600;
const DEFAULT_INTERVAL_MIN = 10;
// Ключ Яндекс Погоды: 30 запросов в сутки / 1000 в месяц. Все кнопки идут одним
// запросом (yandex.js), раз в час это 24 в сутки — не опрашиваем чаще.
const YANDEX_MIN_INTERVAL_MIN = 60;

// Глобальные настройки плагина (общие для всех кнопок): ключ Яндекс Погоды.
let globalSettings = {};
let resolveGlobalReady;
const globalReady = new Promise((resolve) => (resolveGlobalReady = resolve));

class WeatherAction extends SingletonAction {
	manifestId = "com.silence02.openmeteo.weather";

	/** Состояние каждой кнопки: таймер обновления, последние данные, время нажатия. */
	keys = new Map();

	constructor() {
		super();
		// Пакетный запрос Яндекса обновил и эти кнопки: перерисовать из кэша и
		// перезапустить их таймеры, чтобы все кнопки дальше обновлялись вместе.
		yandexEvents.on("updated", (ids) => ids.forEach((id) => this.refresh(id)));
		yandexEvents.on("request", (count) => streamDeck.logger.info(`Яндекс: запрос погоды, городов в запросе: ${count}`));
	}

	/**
	 * Title кнопки из Stream Deck (id → { title, params }). Хранится отдельно от keys:
	 * событие может прийти раньше willAppear.
	 */
	titles = new Map();

	async onTitleParametersDidChange(ev) {
		this.titles.set(ev.action.id, { title: ev.payload.title ?? "", params: ev.payload.titleParameters ?? {} });
		const state = this.keys.get(ev.action.id);
		if (state?.data) await this.draw(state);
	}

	/**
	 * Сообщения из окна настроек. { type: "testProxy", id, proxy, source } — проверить связь
	 * с сервером погоды через указанный прокси; ответ { type: "testProxyResult", id, ok, ... }.
	 */
	async onSendToPlugin(ev) {
		const msg = ev.payload ?? {};
		if (msg.type !== "testProxy") return;
		const host = msg.source === "yandex" ? "api.weather.yandex.ru" : "api.open-meteo.com";
		let reply;
		try {
			const { proxy, ms } = await testConnection(msg.proxy, host);
			// Пароль прокси не показываем ни в окне настроек, ни в логе.
			reply = { ok: true, proxy: maskProxy(proxy), ms, host };
		} catch (err) {
			reply = { ok: false, error: err?.message ?? String(err), host };
		}
		streamDeck.logger.info(`Проверка прокси «${maskProxy(msg.proxy) || "авто"}» → ${host}: ${reply.ok ? `ок, ${reply.ms} мс` : reply.error}`);
		await streamDeck.ui.sendToPropertyInspector({ type: "testProxyResult", id: msg.id, ...reply });
	}

	async onWillAppear(ev) {
		this.keys.set(ev.action.id, { action: ev.action, settings: ev.payload.settings, timer: null, data: null, pressedAt: 0 });
		await this.refresh(ev.action.id);
	}

	onWillDisappear(ev) {
		const state = this.keys.get(ev.action.id);
		if (state?.timer) clearTimeout(state.timer);
		this.keys.delete(ev.action.id);
		forgetYandexButton(ev.action.id);
	}

	async onDidReceiveSettings(ev) {
		const state = this.keys.get(ev.action.id);
		if (!state) return;
		const prev = state.settings;
		state.settings = ev.payload.settings;
		// Смена только режима отображения не требует нового запроса.
		const onlyMode = ["latitude", "longitude", "units", "windUnit", "interval", "proxy", "source", "yandexKey"].every((k) => prev[k] === state.settings[k]);
		if (onlyMode && state.data) await this.draw(state);
		else await this.refresh(ev.action.id);
	}

	onKeyDown(ev) {
		const state = this.keys.get(ev.action.id);
		if (state) state.pressedAt = Date.now();
	}

	async onKeyUp(ev) {
		const state = this.keys.get(ev.action.id);
		if (!state) return;
		if (Date.now() - state.pressedAt >= LONG_PRESS_MS) {
			// Долгое нажатие — обновить немедленно.
			await this.refresh(ev.action.id, true);
			return;
		}
		// Короткое — следующий режим отображения.
		state.settings = { ...state.settings, mode: ((Number(state.settings.mode) || 0) + 1) % MODES };
		await ev.action.setSettings(state.settings);
		await this.draw(state);
	}

	async refresh(id, manual = false) {
		await globalReady;
		const state = this.keys.get(id);
		if (!state) return;
		if (state.timer) clearTimeout(state.timer);

		const s = state.settings;
		const isYandex = s.source === "yandex";
		if (!isYandex) forgetYandexButton(id);
		const intervalMin = Math.max(isYandex ? YANDEX_MIN_INTERVAL_MIN : 1, Number(s.interval) || DEFAULT_INTERVAL_MIN);
		state.timer = setTimeout(() => this.refresh(id), intervalMin * 60 * 1000);

		if (s.latitude === undefined || s.longitude === undefined || s.latitude === "" || s.longitude === "") {
			forgetYandexButton(id);
			await state.action.setImage(renderMessage("Укажите", "город"));
			return;
		}

		try {
			state.data = await fetchWeather({
				latitude: Number(s.latitude),
				longitude: Number(s.longitude),
				units: s.units,
				windUnit: s.windUnit,
				proxy: this.proxyFor(s),
				source: s.source,
				// Общий ключ; ключ в настройках кнопки — для старых кнопок.
				yandexKey: globalSettings.yandexKey || s.yandexKey,
			}, { id, force: manual });
			await this.draw(state);
			if (manual) await state.action.showOk();
		} catch (err) {
			streamDeck.logger.error(`Ошибка загрузки погоды: ${err?.message ?? err}`);
			if (err?.kind === "key") {
				// Ключ сам не починится — повтор по обычному интервалу или после смены настроек.
				await state.action.setImage(renderMessage("Проверьте", "ключ Яндекса", true));
				return;
			}
			if (state.data) {
				// Оставляем последние данные, только показываем предупреждение.
				await state.action.showAlert();
			} else {
				await state.action.setImage(renderMessage("Нет связи", "долгое нажатие", true));
			}
			// Повтор раньше полного интервала (для Яндекса реже — из-за лимита).
			clearTimeout(state.timer);
			state.timer = setTimeout(() => this.refresh(id), (isYandex ? 30 : 1) * 60 * 1000);
		}
	}

	/**
	 * Прокси общий для всех кнопок (globalSettings.proxy: "" — авто, "none", адрес).
	 * Старые кнопки хранили его в своих настройках: первый непустой такой прокси
	 * переносится в общие настройки, дальше настройка кнопки не используется.
	 */
	proxyFor(s) {
		if (!("proxy" in globalSettings) && s.proxy) {
			globalSettings = { ...globalSettings, proxy: s.proxy };
			streamDeck.settings.setGlobalSettings(globalSettings).catch((err) =>
				streamDeck.logger.error(`Не удалось сохранить общий прокси: ${err?.message ?? err}`),
			);
			streamDeck.logger.info(`Прокси кнопки перенесён в общие настройки: ${maskProxy(s.proxy)}`);
		}
		return "proxy" in globalSettings ? globalSettings.proxy : s.proxy;
	}

	async draw(state) {
		if (!state.data) return;
		const s = state.settings;
		const { title = "", params = {} } = this.titles.get(state.action.id) ?? {};
		const userTitle = title.trim();
		await state.action.setImage(
			renderWeather(state.data, {
				city: s.cityName ?? "",
				mode: Number(s.mode) || 0,
				showCity: s.showCity !== false,
				// Текст Title кнопки заменяет название города (например, «Питер»).
				title: userTitle,
				// labelStyle "title" — шрифт, размер, стиль и цвет берутся из настроек Title.
				titleStyle: s.labelStyle === "title" ? params : null,
				// Если в Title включён показ заголовка, его рисует сам Stream Deck — не дублируем.
				hideLabel: Boolean(userTitle && params.showTitle),
			}),
		);
	}
}

streamDeck.logger.setLevel("info");
const weatherAction = new WeatherAction();
streamDeck.actions.registerAction(weatherAction);

// Общие настройки сменили в окне настроек: новый ключ — обновить кнопки Яндекса,
// новый прокси — все кнопки (у Яндекса свежий кэш, лишнего запроса не будет).
streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
	const prev = globalSettings;
	globalSettings = ev.settings ?? {};
	const keyChanged = globalSettings.yandexKey !== prev.yandexKey;
	const proxyChanged = globalSettings.proxy !== prev.proxy;
	for (const [id, state] of weatherAction.keys) {
		if (proxyChanged || (keyChanged && state.settings.source === "yandex")) weatherAction.refresh(id);
	}
});

await streamDeck.connect();
try {
	globalSettings = (await streamDeck.settings.getGlobalSettings()) ?? {};
} catch (err) {
	streamDeck.logger.error(`Не удалось прочитать глобальные настройки: ${err?.message ?? err}`);
}
resolveGlobalReady();
