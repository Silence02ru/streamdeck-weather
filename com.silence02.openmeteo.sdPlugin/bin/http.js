// HTTPS-запросы через прокси: HTTP (CONNECT-туннель), SOCKS5/socks5h, SOCKS4/4a. Без зависимостей.
// Встроенный в Stream Deck Node.js не использует системный прокси сам,
// поэтому прокси берётся из настроек кнопки, переменных окружения или реестра Windows.
import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
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
				// Формат может быть "host:port" или "http=host:port;https=host:port;socks=host:port".
				if (!server.includes("=")) return resolve(server);
				const parts = Object.fromEntries(server.split(";").map((p) => p.split("=")));
				// SOCKS — только если HTTP-прокси не задан; DNS тоже через прокси (socks5h).
				resolve(parts.https ?? parts.http ?? (parts.socks ? `socks5h://${parts.socks}` : null));
			},
		);
	});
}

/**
 * Возвращает адрес прокси или null.
 * setting: "" — автоматически, "none" — без прокси, иначе адрес: "host:port", "http://host:port",
 * "socks5://host:port", "socks5h://user:pass@host:port" и т.п. (см. parseProxy).
 */
export async function resolveProxy(setting) {
	const value = (setting ?? "").trim();
	if (value.toLowerCase() === "none") return null;
	if (value) return value;
	const e = process.env;
	const env = e.HTTPS_PROXY || e.https_proxy || e.HTTP_PROXY || e.http_proxy || e.ALL_PROXY || e.all_proxy;
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
			const headers = {
				// Явно: через туннель (createConnection без agent) Node подставил бы порт 80 —
				// "Host: api.weather.yandex.ru:80", и балансировщик Яндекса отвечает 404.
				Host: target.host,
				Accept: "application/json",
				"User-Agent": "streamdeck-openmeteo/1.0",
				...extraHeaders,
			};
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

		const host = target.hostname;
		const port = Number(target.port) || 443;
		openTunnel(proxy, host, port)
			.then((socket) => send(() => tls.connect({ socket, servername: host })))
			.catch(reject);
	});
}

/**
 * Проверка связи для кнопки «Проверить» в настройках: через прокси (или напрямую)
 * открывает TLS-соединение с host:443 и сразу закрывает его. Запрос к API не отправляется,
 * поэтому лимит ключа Яндекса не тратится.
 * Возвращает { proxy — фактически использованный адрес или null, ms }; при ошибке бросает исключение.
 */
export async function testConnection(setting, host) {
	const proxy = await resolveProxy(setting);
	const started = Date.now();
	const socket = proxy ? await openTunnel(proxy, host, 443) : null;
	await new Promise((resolve, reject) => {
		const conn = socket
			? tls.connect({ socket, servername: host })
			: tls.connect({ host, port: 443, servername: host });
		conn.setTimeout(TIMEOUT_MS, () => conn.destroy(new Error(`нет ответа за ${TIMEOUT_MS / 1000} с`)));
		conn.once("secureConnect", () => {
			conn.destroy();
			resolve();
		});
		conn.once("error", (err) => reject(new Error(proxy ? `TLS через прокси: ${err.message}` : `напрямую: ${err.message}`)));
	});
	return { proxy, ms: Date.now() - started };
}

/** Адрес прокси для лога и окна настроек: пароль заменён на ***. */
export function maskProxy(proxy) {
	if (!proxy) return proxy;
	return proxy.replace(/^((?:[a-z0-9]+:\/\/)?[^:@/]+:)[^@/]*@/i, "$1***@");
}

/**
 * Разбирает адрес прокси. Схемы: http:// (по умолчанию, если схемы нет),
 * socks5:// (адрес сервера определяется локально), socks5h:// и socks:// (адрес определяет прокси),
 * socks4://, socks4a://.
 */
export function parseProxy(proxy) {
	const p = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
	const scheme = p.protocol.replace(":", "").toLowerCase();
	const type = { http: "http", https: "http", socks: "socks5h", socks5: "socks5", socks5h: "socks5h", socks4: "socks4", socks4a: "socks4a" }[scheme];
	if (!type) throw new Error(`неизвестный тип прокси «${scheme}»`);
	return {
		type,
		host: p.hostname.replace(/^\[|\]$/g, ""),
		port: Number(p.port) || (type === "http" ? 80 : 1080),
		username: decodeURIComponent(p.username),
		password: decodeURIComponent(p.password),
		label: `${type}://${p.host}`,
	};
}

/** Открывает TCP-туннель до host:port через прокси. Возвращает сокет, поверх которого идёт TLS. */
async function openTunnel(proxy, host, port) {
	const p = parseProxy(proxy);
	try {
		return p.type === "http" ? await httpTunnel(p, host, port) : await socksTunnel(p, host, port);
	} catch (err) {
		throw new Error(`прокси ${p.label}: ${err.message}`);
	}
}

function httpTunnel(p, host, port) {
	return new Promise((resolve, reject) => {
		const authority = `${host}:${port}`;
		const headers = { Host: authority };
		if (p.username) {
			headers["Proxy-Authorization"] = `Basic ${Buffer.from(`${p.username}:${p.password}`).toString("base64")}`;
		}
		const connect = http.request({ host: p.host, port: p.port, method: "CONNECT", path: authority, headers, timeout: TIMEOUT_MS });
		connect.on("connect", (res, socket) => {
			if (res.statusCode !== 200) {
				socket.destroy();
				return reject(new Error(`ответил ${res.statusCode}`));
			}
			resolve(socket);
		});
		connect.on("timeout", () => connect.destroy(new Error("таймаут")));
		connect.on("error", reject);
		connect.end();
	});
}

const SOCKS5_ERRORS = {
	1: "общая ошибка сервера",
	2: "соединение запрещено правилами",
	3: "сеть недоступна",
	4: "узел недоступен",
	5: "в соединении отказано",
	6: "истёк TTL",
	7: "команда не поддерживается",
	8: "тип адреса не поддерживается",
};

async function socksTunnel(p, host, port) {
	// socks5 и socks4 требуют IP: адрес определяем сами. socks5h и socks4a передают имя прокси.
	const remoteDns = p.type === "socks5h" || p.type === "socks4a";
	const address = remoteDns || net.isIP(host) ? host : (await dns.lookup(host, { family: p.type === "socks4" ? 4 : 0 })).address;

	const socket = net.connect({ host: p.host, port: p.port });
	socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("таймаут")));
	const reader = createReader(socket);
	try {
		await new Promise((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		if (p.type.startsWith("socks5")) await socks5Handshake(socket, reader, p, address, port);
		else await socks4Handshake(socket, reader, p, address, port);
	} catch (err) {
		socket.destroy();
		throw err;
	}
	reader.release();
	socket.setTimeout(0);
	return socket;
}

async function socks5Handshake(socket, reader, p, address, port) {
	// Приветствие: без аутентификации, либо ещё логин/пароль (RFC 1929).
	socket.write(Buffer.from(p.username ? [5, 2, 0, 2] : [5, 1, 0]));
	const [ver, method] = await reader.read(2);
	if (ver !== 5) throw new Error("это не SOCKS5-прокси");
	if (method === 2) {
		const user = Buffer.from(p.username);
		const pass = Buffer.from(p.password);
		socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
		const [, status] = await reader.read(2);
		if (status !== 0) throw new Error("неверный логин или пароль");
	} else if (method !== 0) {
		throw new Error(p.username ? "способ аутентификации не поддерживается" : "требуется логин и пароль");
	}

	// Запрос CONNECT: IPv4 (1), имя (3) или IPv6 (4).
	let addr;
	if (net.isIPv4(address)) addr = Buffer.from([1, ...address.split(".").map(Number)]);
	else if (net.isIPv6(address)) addr = Buffer.concat([Buffer.from([4]), ipv6Bytes(address)]);
	else addr = Buffer.concat([Buffer.from([3, Buffer.byteLength(address)]), Buffer.from(address)]);
	socket.write(Buffer.concat([Buffer.from([5, 1, 0]), addr, Buffer.from([port >> 8, port & 0xff])]));

	const [, rep, , atyp] = await reader.read(4);
	if (rep !== 0) throw new Error(SOCKS5_ERRORS[rep] ?? `ошибка ${rep}`);
	// Пропускаем адрес и порт, которые вернул прокси.
	const len = atyp === 1 ? 4 : atyp === 4 ? 16 : (await reader.read(1))[0];
	await reader.read(len + 2);
}

async function socks4Handshake(socket, reader, p, address, port) {
	// SOCKS4a: вместо IP передаётся 0.0.0.1, а имя — после user id.
	const ip = net.isIPv4(address) ? address.split(".").map(Number) : [0, 0, 0, 1];
	const parts = [Buffer.from([4, 1, port >> 8, port & 0xff, ...ip]), Buffer.from(p.username), Buffer.from([0])];
	if (!net.isIPv4(address)) parts.push(Buffer.from(address), Buffer.from([0]));
	socket.write(Buffer.concat(parts));
	const [, status] = await reader.read(8);
	if (status !== 0x5a) throw new Error(`отказ SOCKS4 (код ${status})`);
}

function ipv6Bytes(address) {
	const [head, tail = ""] = address.split("::");
	const h = head ? head.split(":") : [];
	const t = tail ? tail.split(":") : [];
	const groups = address.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
	return Buffer.from(groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]));
}

/** Читает из сокета ровно n байт за раз; release() возвращает непрочитанное обратно в сокет. */
function createReader(socket) {
	let buf = Buffer.alloc(0);
	let waiting = null;
	let failure = null;
	const pump = () => {
		if (waiting && buf.length >= waiting.n) {
			const out = buf.subarray(0, waiting.n);
			buf = buf.subarray(waiting.n);
			const w = waiting;
			waiting = null;
			w.resolve(out);
		}
	};
	const fail = (err) => {
		failure ??= err;
		if (waiting) {
			const w = waiting;
			waiting = null;
			w.reject(failure);
		}
	};
	const onData = (chunk) => {
		buf = Buffer.concat([buf, chunk]);
		pump();
	};
	const onEnd = () => fail(new Error("прокси закрыл соединение"));
	socket.on("data", onData);
	socket.on("end", onEnd);
	socket.on("close", onEnd);
	socket.on("error", fail);
	return {
		read(n) {
			if (failure) return Promise.reject(failure);
			return new Promise((resolve, reject) => {
				waiting = { n, resolve, reject };
				pump();
			});
		},
		release() {
			socket.off("data", onData);
			socket.off("end", onEnd);
			socket.off("close", onEnd);
			socket.off("error", fail);
			if (buf.length) socket.unshift(buf);
		},
	};
}
