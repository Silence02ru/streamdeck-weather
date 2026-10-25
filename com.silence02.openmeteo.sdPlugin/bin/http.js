// HTTPS-запросы с поддержкой HTTP-прокси (CONNECT-туннель).
// Встроенный в Stream Deck Node.js не использует системный прокси сам,
// поэтому прокси берётся из настроек кнопки, переменных окружения или реестра Windows.
import { execFile } from "node:child_process";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";

const TIMEOUT_MS = 15000;
const SYSTEM_PROXY_TTL_MS = 5 * 60 * 1000;

let systemProxy = { time: 0, value: null };

/** Системный прокси Windows (Параметры → Сеть → Прокси), кэшируется на 5 минут. */
function readWindowsProxy() {
	if (process.platform !== "win32") return Promise.resolve(null);
	return new Promise((resolve) => {
		execFile(
			"reg",
			["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
			{ windowsHide: true, timeout: 5000 },
			(err, stdout) => {
				if (err) return resolve(null);
				const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(stdout);
				const server = stdout.match(/ProxyServer\s+REG_SZ\s+(\S+)/i)?.[1];
				if (!enabled || !server) return resolve(null);
				// Формат может быть "host:port" или "http=host:port;https=host:port;socks=...".
				if (!server.includes("=")) return resolve(server);
				const parts = Object.fromEntries(server.split(";").map((p) => p.split("=")));
				resolve(parts.https ?? parts.http ?? null);
			},
		);
	});
}

/**
 * Возвращает адрес прокси или null.
 * setting: "" — автоматически, "none" — без прокси, иначе "host:port" / "http://host:port".
 */
export async function resolveProxy(setting) {
	const value = (setting ?? "").trim();
	if (value.toLowerCase() === "none") return null;
	if (value) return value;
	const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
	if (env) return env;
	if (Date.now() - systemProxy.time > SYSTEM_PROXY_TTL_MS) {
		systemProxy = { time: Date.now(), value: await readWindowsProxy() };
	}
	return systemProxy.value;
}

/**
 * Запрос JSON по HTTPS, напрямую или через HTTP-прокси.
 * options: { body — объект, отправляется POST-ом как JSON; headers — доп. заголовки }.
 */
export function getJson(url, proxy, { body, headers: extraHeaders = {} } = {}) {
	const target = new URL(url);
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const send = (createConnection) => {
			const headers = { Accept: "application/json", "User-Agent": "streamdeck-openmeteo/1.0", ...extraHeaders };
			if (payload !== undefined) {
				headers["Content-Type"] = "application/json";
				headers["Content-Length"] = Buffer.byteLength(payload);
			}
			const req = https.request(
				target,
				{
					method: payload === undefined ? "GET" : "POST",
					headers,
					timeout: TIMEOUT_MS,
					createConnection,
				},
				(res) => {
					let body = "";
					res.setEncoding("utf8");
					res.on("data", (chunk) => (body += chunk));
					res.on("end", () => {
						if (res.statusCode !== 200) {
							const err = new Error(`HTTP ${res.statusCode}`);
							err.status = res.statusCode;
							return reject(err);
						}
						try {
							resolve(JSON.parse(body));
						} catch (err) {
							reject(err);
						}
					});
				},
			);
			req.on("timeout", () => req.destroy(new Error("таймаут")));
			req.on("error", reject);
			req.end(payload);
		};

		if (!proxy) return send(undefined);

		const p = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
		const authority = `${target.hostname}:${target.port || 443}`;
		const headers = { Host: authority };
		if (p.username) {
			const auth = `${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`;
			headers["Proxy-Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;
		}
		const connect = http.request({
			host: p.hostname,
			port: Number(p.port) || 80,
			method: "CONNECT",
			path: authority,
			headers,
			timeout: TIMEOUT_MS,
		});
		connect.on("connect", (res, socket) => {
			if (res.statusCode !== 200) {
				socket.destroy();
				return reject(new Error(`прокси ответил ${res.statusCode}`));
			}
			send(() => tls.connect({ socket, servername: target.hostname }));
		});
		connect.on("timeout", () => connect.destroy(new Error("таймаут прокси")));
		connect.on("error", (err) => reject(new Error(`прокси ${p.host}: ${err.message}`)));
		connect.end();
	});
}
