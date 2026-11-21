import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const DAY = 24 * 60 * 60 * 1000;
const NODE_TTL = 3 * DAY;
const IP_TTL = 14 * DAY;
const CACHE_KEEP = 30 * DAY;
const BAD_CODES = new Set(["XX", "ZZ", "T1", "A1", "A2", "AP", "EU"]);
const PLACEHOLDER_HOSTS = new Set(["", "0", "0000", "0.0.0.0", "localhost", "::", "::1", "example.com"]);

export function endpointOf(outbound) {
  const s = outbound?.settings;
  if (!s || typeof s !== "object") return null;
  const first = (Array.isArray(s.vnext) && s.vnext[0]) || (Array.isArray(s.servers) && s.servers[0]) || (Array.isArray(s.peers) && s.peers[0]) || s;
  const address = typeof first?.address === "string" ? first.address.trim().replace(/^\[|\]$/g, "") : "";
  const port = Number(first?.port);
  if (!address && !port) return null;
  return { address, port };
}

export function isPlaceholderOutbound(outbound) {
  const ep = endpointOf(outbound);
  if (!ep) return true;
  const host = ep.address.toLowerCase();
  if (PLACEHOLDER_HOSTS.has(host) || host.startsWith("127.")) return true;
  if (!Number.isInteger(ep.port) || ep.port <= 0 || ep.port > 65535) return true;
  return false;
}

function normalizeCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && !BAD_CODES.has(code) ? code : null;
}

export function extractCountryCode(data) {
  if (!data || typeof data !== "object") return null;
  if (data.success === false || data.status === "fail" || data.status === "error") return null;
  for (const key of ["countryCode", "country_code", "country"]) {
    const code = normalizeCode(data[key]);
    if (code) return code;
  }
  return null;
}

function readJsonSafe(file, fallback) {
  try { return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback; }
  catch { return fallback; }
}

function writeJsonSafe(file, value) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(`${file}.tmp`, file);
  } catch (error) { console.warn(`Geo: не удалось сохранить кэш: ${error.message}`); }
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

function fingerprintOf(outbound, deps = []) {
  const { tag, ...rest } = outbound || {};
  const chain = Array.isArray(deps) && deps.length ? deps : undefined;
  return crypto.createHash("sha256").update(JSON.stringify(chain ? [rest, chain] : rest)).digest("hex").slice(0, 24);
}

async function resolveIp(host) {
  if (!host) return null;
  if (net.isIP(host)) return host;
  try { return (await dns.lookup(host, { family: 4 })).address; }
  catch {
    try { return (await dns.lookup(host)).address; } catch { return null; }
  }
}

export function findXray() {
  if (process.env.GEO_XRAY === "off") return null;
  const candidates = [
    process.env.XRAY_BIN,
    "xray",
    "C:\\Program Files\\FlyFrogLLC\\Happ\\core\\xray.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Xray", "xray.exe")
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["version"], { stdio: "ignore", timeout: 5000 });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

export function getViaHttpProxy(proxyPort, urlString, { timeoutMs = 10000, tlsOptions = {} } = {}) {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error("таймаут")), timeoutMs);
    const collect = (res) => {
      const chunks = []; let bytes = 0;
      res.on("data", (c) => { chunks.push(c); bytes += c.length; });
      res.on("end", () => finish(null, { status: res.statusCode, body: Buffer.concat(chunks).toString("utf8"), bytes }));
      res.on("error", finish);
    };
    if (url.protocol === "http:") {
      const req = http.request({ host: "127.0.0.1", port: proxyPort, method: "GET", path: urlString, headers: { Host: url.host, "User-Agent": "ClearanceVPN-geo/1.0", Accept: "application/json" } }, collect);
      req.on("error", finish); req.end(); return;
    }
    const connect = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: `${url.hostname}:${url.port || 443}` });
    connect.on("error", finish);
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); finish(new Error(`CONNECT ${res.statusCode}`)); return; }
      const secure = tls.connect({ socket, servername: url.hostname, ...tlsOptions });
      secure.on("error", finish);
      const req = http.request({ createConnection: () => secure, host: url.hostname, method: "GET", path: `${url.pathname}${url.search}`, headers: { Host: url.host, "User-Agent": "ClearanceVPN-geo/1.0", Accept: "application/json", Connection: "close" } }, (r) => { collect(r); });
      req.on("error", finish); req.end();
    });
    connect.end();
  });
}

const DEFAULT_HEALTH_TESTS = [
  { url: "https://www.cloudflare.com/cdn-cgi/trace", status: 200, kind: "trace" },
  { url: "https://cp.cloudflare.com/generate_204", status: 204 },
  { url: "https://www.gstatic.com/generate_204", status: 204 }
];

// strict = true: a node must pass `minTestsPassed` of the test URLs in every one of
// `rounds` rounds, really carry data (transfer), not leak the runner's own IP and
// not be slower than maxLatencyMs. Anything not positively confirmed is dropped.
const HEALTH_DEFAULTS = {
  strict: true,
  // "keepalive": like Happ "Via Proxy GET + keepalive" - several requests over ONE connection.
  pingMode: "keepalive",
  keepAlive: { enabled: true, requests: 4, intervalMs: 1000, timeoutMs: 8000, host: "cp.cloudflare.com", path: "/generate_204" },
  // Russian vantage point: a known-good Russian server that every candidate is dialed through
  // (Xray dialerProxy). mode "only" = must work through it; "both" = directly AND through it.
  tunnel: { enabled: true, required: true, mode: "only", configFile: "generator/tunnel.json" },
  tcpTimeoutMs: 6000, requestTimeoutMs: 10000, attemptsPerTest: 2, retryDelayMs: 300,
  timeoutsBeforeGiveUp: 2, startTimeoutMs: 8000,
  minTestsPassed: 2, rounds: 1, roundDelayMs: 1500, maxLatencyMs: 1500,
  transfer: { enabled: true, urls: ["https://speed.cloudflare.com/__down?bytes=200000"], minBytes: 150000, timeoutMs: 15000 },
  directIpUrl: "https://www.cloudflare.com/cdn-cgi/trace",
  dns: { enabled: true, globalServers: ["1.1.1.1", "8.8.8.8"], ruServers: ["77.88.8.8", "77.88.8.1"], timeoutMs: 3000 },
  ruProbe: { enabled: true, required: false, maxNodes: 3, minOk: 1, concurrency: 2, pollMs: 2000, waitMs: 30000, budgetMs: 240000, ttlMs: 2 * 60 * 60 * 1000 },
  bypassPolicy: "strict",
  tests: DEFAULT_HEALTH_TESTS
};

export function healthConfig(h = {}) {
  return {
    ...HEALTH_DEFAULTS, ...h,
    keepAlive: { ...HEALTH_DEFAULTS.keepAlive, ...(h.keepAlive || {}) },
    tunnel: { ...HEALTH_DEFAULTS.tunnel, ...(h.tunnel || {}) },
    transfer: { ...HEALTH_DEFAULTS.transfer, ...(h.transfer || {}) },
    dns: { ...HEALTH_DEFAULTS.dns, ...(h.dns || {}) },
    ruProbe: { ...HEALTH_DEFAULTS.ruProbe, ...(h.ruProbe || {}) }
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function parseTrace(body) {
  const info = {};
  for (const line of String(body).split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) info[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return info;
}

export function isTcpBased(outbound) {
  const protocol = String(outbound?.protocol || "").toLowerCase();
  const network = String(outbound?.streamSettings?.network || "").toLowerCase();
  return !["hysteria", "hysteria2"].includes(protocol) && !["kcp", "quic", "hysteria"].includes(network);
}

export function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (ok, error) => { if (done) return; done = true; socket.destroy(); resolve({ ok, error }); };
    socket.setTimeout(timeoutMs, () => finish(false, "таймаут"));
    socket.once("connect", () => finish(true));
    socket.once("error", (e) => finish(false, e.code || e.message));
  });
}

// One request through the local proxy. Strict, like a real client would see it:
// the expected status, an empty body for 204, and "ip=" in Cloudflare's trace.
async function probeOnce(port, test, { timeoutMs, tlsOptions }) {
  const started = Date.now();
  let res;
  try { res = await getViaHttpProxy(port, test.url, { timeoutMs, tlsOptions }); }
  catch (error) { return { ok: false, timedOut: /таймаут/.test(error.message), error: error.message }; }
  const latency = Math.max(1, Date.now() - started);
  const expected = test.status || 204;
  if (res.status !== expected) return { ok: false, error: `HTTP ${res.status}, ожидался ${expected}` };
  if (test.kind === "trace") {
    const info = parseTrace(res.body);
    if (!info.ip) return { ok: false, error: "в ответе нет ip=" };
    return { ok: true, latency, exitIp: info.ip, code: normalizeCode(info.loc) };
  }
  if (expected === 204 && String(res.body).trim() !== "") return { ok: false, error: "204 с непустым телом" };
  return { ok: true, latency };
}

// Handshakes can succeed on a dead tunnel; real data must actually flow.
async function transferCheck(port, cfg, { tlsOptions }) {
  let lastError = "нет адресов для теста";
  for (const url of cfg.urls || []) {
    try {
      const res = await getViaHttpProxy(port, url, { timeoutMs: cfg.timeoutMs, tlsOptions });
      if (res.status === 200 && res.bytes >= cfg.minBytes) return { ok: true, bytes: res.bytes };
      lastError = `${new URL(url).host}: HTTP ${res.status}, получено ${res.bytes} из ${cfg.minBytes} байт`;
    } catch (error) { lastError = `${new URL(url).host}: ${error.message}`; }
  }
  return { ok: false, error: lastError };
}

// The runner's own public IP, to catch "working" nodes that do not proxy at all.
export async function fetchDirectIp(url, timeoutMs = 8000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "ClearanceVPN-health/1.0" } });
    if (!res.ok) return null;
    return parseTrace(await res.text()).ip || null;
  } catch { return null; }
}

const HOP_TAG = "ru-hop";
const hasDialer = (o) => Boolean(o?.proxySettings?.tag || o?.streamSettings?.sockopt?.dialerProxy);

// Several requests over ONE persistent connection (what Happ's "Via Proxy GET + keepalive"
// does). Many servers pass a fresh handshake and then freeze on an already open connection.
export function keepAliveProbe(proxyPort, { host = "cp.cloudflare.com", path: reqPath = "/generate_204", requests = 4, intervalMs = 1000, timeoutMs = 8000, tlsOptions } = {}) {
  return new Promise((resolve) => {
    let settled = false; let timer = null; let secure = null; let raw = null;
    let sent = 0; let got = 0; let buffer = ""; let sentAt = 0; const latencies = [];
    const done = (ok, error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      try { secure?.destroy(); } catch {} try { raw?.destroy(); } catch {}
      resolve({ ok, error, latencies });
    };
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => done(false, `запрос ${sent} из ${requests}: нет ответа за ${timeoutMs} мс (соединение «замерзло»)`), timeoutMs); };
    const sendNext = () => {
      sent++; sentAt = Date.now(); arm();
      secure.write(`GET ${reqPath} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ClearanceVPN-health/1.0\r\nConnection: keep-alive\r\nAccept: */*\r\n\r\n`);
    };
    arm();
    const req = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: `${host}:443` });
    req.on("error", (e) => done(false, `CONNECT: ${e.message}`));
    req.on("connect", (res, socket) => {
      raw = socket;
      if (res.statusCode !== 200) return done(false, `CONNECT ${res.statusCode}`);
      secure = tls.connect({ socket, servername: host, ...(tlsOptions || {}) });
      secure.on("error", (e) => done(false, `TLS: ${e.message}`));
      secure.on("close", () => { if (!settled) done(false, `соединение закрыто сервером после ${got} из ${requests} запросов`); });
      secure.once("secureConnect", sendNext);
      secure.on("data", (chunk) => {
        buffer += chunk.toString("latin1");
        let end;
        while ((end = buffer.indexOf("\r\n\r\n")) >= 0) {
          const head = buffer.slice(0, end); buffer = buffer.slice(end + 4);
          const status = /^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1];
          if (status !== "204") return done(false, `запрос ${got + 1}: HTTP ${status || "?"}, ожидался 204`);
          got++; latencies.push(Math.max(1, Date.now() - sentAt)); clearTimeout(timer);
          if (got >= requests) return done(true);
          setTimeout(() => { if (!settled) sendNext(); }, intervalMs);
        }
      });
    });
    req.end();
  });
}

// Health check of ONE node: TCP pre-check (direct only), Xray with the node as the only
// outbound, quorum of test URLs, keepalive over one connection, real data transfer.
// With `hop`, every connection of the node is dialed through the Russian hop server.
async function probeNode(bin, outbound, { urls, tlsOptions, deps = [], health = {}, directIp = null, hop = null, hopExitIp = null } = {}) {
  const cfg = healthConfig(health);
  const strict = cfg.strict !== false;
  const viaHop = Boolean(hop);
  const tests = Array.isArray(cfg.tests) && cfg.tests.length ? cfg.tests : DEFAULT_HEALTH_TESTS;
  const rounds = strict ? Math.max(1, cfg.rounds) : 1;
  const need = strict ? Math.min(tests.length, Math.max(1, cfg.minTestsPassed)) : 1;
  const giveUp = viaHop ? 1 : cfg.timeoutsBeforeGiveUp;
  const fail = (reason) => ({ ok: false, code: null, reason });

  if (!viaHop) {
    const ep = endpointOf(outbound);
    if (ep && ep.address && ep.port && isTcpBased(outbound) && !deps.length) {
      const tcp = await tcpProbe(ep.address, ep.port, cfg.tcpTimeoutMs);
      if (!tcp.ok) return fail(`TCP ${ep.address}:${ep.port} — ${tcp.error}`);
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clearance-geo-"));
  let child = null;
  try {
    const port = await freePort();
    const main = { ...structuredClone(outbound), tag: "proxy" };
    const chain = structuredClone(deps);
    const extra = [];
    if (viaHop) {
      // Only the outermost link of a chain is dialed through the hop.
      for (const o of [main, ...chain]) {
        if (hasDialer(o)) continue;
        o.streamSettings = o.streamSettings || {};
        o.streamSettings.sockopt = { ...(o.streamSettings.sockopt || {}), dialerProxy: HOP_TAG };
      }
      extra.push({ ...structuredClone(hop.outbound), tag: HOP_TAG }, ...structuredClone(hop.deps || []));
    }
    const config = {
      log: { loglevel: "none" },
      inbounds: [{ tag: "in", listen: "127.0.0.1", port, protocol: "http", settings: {} }],
      outbounds: [main, ...chain, ...extra, { tag: "direct", protocol: "freedom" }],
      routing: { rules: [{ type: "field", inboundTag: ["in"], outboundTag: "proxy" }] }
    };
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    child = spawn(bin, ["run", "-c", file], { stdio: "ignore" });
    let exited = false; child.on("exit", () => { exited = true; });
    if (!(await waitForPort(port, cfg.startTimeoutMs)) || exited) return fail("xray не стартовал (конфиг узла не принят)");

    const opts = { timeoutMs: cfg.requestTimeoutMs, tlsOptions };
    const latencies = []; let code = null; let exitIp = null; let lastError = "нет тестов";
    for (let round = 1; round <= rounds; round++) {
      let passed = 0; let timeouts = 0;
      for (let t = 0; t < tests.length; t++) {
        const test = tests[t]; let ok = false;
        for (let attempt = 1; attempt <= cfg.attemptsPerTest; attempt++) {
          if (exited) return fail("процесс xray завершился");
          const r = await probeOnce(port, test, opts);
          if (r.ok) { ok = true; latencies.push(r.latency); code = r.code || code; exitIp = r.exitIp || exitIp; break; }
          lastError = `${new URL(test.url).host}: ${r.error}`;
          if (r.timedOut) { timeouts++; break; }
          await delay(cfg.retryDelayMs);
        }
        if (ok) passed++;
        else if (timeouts >= giveUp) break;
        if (passed + (tests.length - t - 1) < need) break; // quorum can no longer be reached
      }
      if (passed < need) return fail(`раунд ${round}/${rounds}: прошло ${passed} из ${tests.length} тестов (нужно ${need}); ${lastError}`);
      if (round < rounds) await delay(cfg.roundDelayMs);
    }

    let keepLatency = null;
    if (strict && cfg.pingMode === "keepalive" && cfg.keepAlive?.enabled !== false) {
      const ka = await keepAliveProbe(port, { ...cfg.keepAlive, tlsOptions });
      if (!ka.ok) return fail(`keepalive: ${ka.error}`);
      // the first request includes the TLS handshake; the rest is the pure round trip
      keepLatency = median(ka.latencies.slice(1)) ?? median(ka.latencies);
    }
    if (strict && cfg.transfer?.enabled !== false) {
      const t = await transferCheck(port, cfg.transfer, opts);
      if (!t.ok) return fail(`нет передачи данных: ${t.error}`);
    }
    if (exited) return fail("процесс xray завершился во время проверки");
    if (strict && exitIp) {
      if (!viaHop && directIp && exitIp === directIp) return fail("выходной IP совпадает с IP раннера: трафик не проксируется");
      if (viaHop && hopExitIp && exitIp === hopExitIp) return fail("выходной IP совпадает с IP опорного российского сервера: трафик не проксируется");
    }
    const latency = keepLatency ?? median(latencies);
    if (strict && latency > cfg.maxLatencyMs) return fail(`слишком медленный: ${latency} мс (предел ${cfg.maxLatencyMs})`);
    if (!code) code = await exitCountryFallback(port, urls, tlsOptions);
    return { ok: true, code, latency, exitIp };
  } finally {
    if (child) { try { child.kill("SIGKILL"); } catch {} }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

export async function checkViaXray(bin, outbound, opts = {}) {
  const { hop = null, hopMode = "only" } = opts;
  // UDP-based protocols (hysteria) cannot be dialed through a TCP hop: checked directly.
  if (!hop || !isTcpBased(outbound)) return probeNode(bin, outbound, { ...opts, hop: null });
  if (hopMode === "both") {
    const direct = await probeNode(bin, outbound, { ...opts, hop: null });
    if (!direct.ok) return { ...direct, reason: `напрямую: ${direct.reason}` };
  }
  const viaRu = await probeNode(bin, outbound, opts);
  return viaRu.ok ? viaRu : { ...viaRu, reason: `через РФ: ${viaRu.reason}` };
}

// One-time preparation shared by every check of a run: finds Xray, learns the runner's own IP
// and proves that the Russian hop server itself works. If the hop is configured but dead the
// run stops (old files stay) instead of dropping every server because of a broken hop.
export async function prepareChecks({ health = {}, hop = null, tlsOptions } = {}) {
  const hc = healthConfig(health);
  const strict = hc.strict !== false;
  const bin = findXray();
  if (strict && !bin && process.env.HEALTH_ALLOW_NO_XRAY !== "1") {
    throw new Error("Xray не найден: в строгом режиме серверы без проверки не пропускаются (HEALTH_ALLOW_NO_XRAY=1 отключает это).");
  }
  const ctx = { bin, hc, strict, tlsOptions, hop: null, hopInfo: null, directIp: null, hopConfigured: Boolean(hop) };
  if (bin && strict) ctx.directIp = await fetchDirectIp(hc.directIpUrl);
  if (bin && hop && hc.tunnel.enabled !== false && process.env.HEALTH_TUNNEL !== "0") {
    let last = "нет ответа";
    for (let attempt = 1; attempt <= 3 && !ctx.hopInfo; attempt++) {
      const c = await probeNode(bin, hop.outbound, { tlsOptions, deps: hop.deps, health: { ...health, strict: false }, hop: null });
      if (c.ok) ctx.hopInfo = { exitIp: c.exitIp, latency: c.latency, code: c.code, name: hop.name };
      else { last = c.reason; await delay(1500); }
    }
    if (ctx.hopInfo) ctx.hop = hop;
    else if (hc.tunnel.required !== false) throw new Error(`Опорный российский сервер не проходит проверку (${last}). Генерация остановлена, старые файлы сохранены.`);
    else console.warn(`Опорный российский сервер не проходит проверку (${last}): серверы проверяются напрямую, без взгляда из РФ.`);
  }
  return ctx;
}

// Pass/fail check of ready-made servers (manual and premium profiles) without country logic.
export async function verifyNodes(nodes, { ctx, health = {}, tlsOptions } = {}) {
  const c = ctx || await prepareChecks({ health, tlsOptions });
  const out = nodes.map(() => ({ ok: false, reason: "не проверен", latency: null }));
  if (!c.bin) return out.map(() => ({ ok: true, reason: null, latency: null })); // no Xray allowed: nothing can be proven, nothing is dropped
  const deadline = Date.now() + Number(process.env.GEO_XRAY_BUDGET_MS || health.budgetMs || 900000);
  const concurrency = Math.max(1, Number(process.env.GEO_XRAY_CONCURRENCY || health.concurrency || 6));
  await mapLimit(nodes.map((_, i) => i), concurrency, async (i) => {
    const node = nodes[i]; const ep = endpointOf(node.outbound);
    if (c.strict && c.hc.dns.enabled && ep?.address) {
      const d = await checkDnsConsistency(ep.address, c.hc.dns);
      if (!d.ok) { out[i] = { ok: false, reason: `DNS: ${d.reason}`, latency: null }; return; }
    }
    if (Date.now() > deadline) { out[i].reason = "не хватило времени на проверку"; return; }
    let check;
    try { check = await checkViaXray(c.bin, node.outbound, { tlsOptions: c.tlsOptions, deps: node.deps, health, directIp: c.directIp, hop: c.hop, hopMode: c.hc.tunnel.mode, hopExitIp: c.hopInfo?.exitIp }); }
    catch (error) { check = { ok: false, reason: error.message }; }
    out[i] = { ok: check.ok, reason: check.ok ? null : (check.reason || "нет ответа"), latency: check.latency || null };
  });
  return out;
}

// The node already passed the health check; this only tries to learn its exit country.
async function exitCountryFallback(port, urls, tlsOptions) {
  const exitUrls = urls || String(process.env.GEO_EXIT_URLS || "https://api.country.is/,https://ipwho.is/?fields=success,country_code,ip,https://ipinfo.io/json").split(",").map((x) => x.trim()).filter(Boolean);
  for (const url of exitUrls) {
    try {
      const res = await getViaHttpProxy(port, url, { timeoutMs: 8000, tlsOptions });
      if (res.status < 200 || res.status >= 300) continue;
      let data = null; try { data = JSON.parse(res.body); } catch {}
      const code = extractCountryCode(data);
      if (code) return code;
    } catch {}
  }
  return null;
}

function isBogonIp(ip) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip || "");
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function resolveVia(server, host, timeoutMs, type = "resolve4") {
  const resolver = new dns.Resolver({ timeout: timeoutMs, tries: 1 });
  resolver.setServers([server]);
  try { return { ok: true, ips: await resolver[type](host) }; }
  catch (error) { return { ok: false, code: error.code || "ERR" }; }
}

// DNS cross-check for hostname servers. Plain DNS is only the first and simplest layer of
// blocking in Russia, so this catches only domains that are poisoned or do not resolve there.
// Resolver timeouts prove nothing and are ignored.
export async function checkDnsConsistency(host, dnsCfg = {}) {
  const cfg = { ...HEALTH_DEFAULTS.dns, ...dnsCfg };
  if (!host || net.isIP(host)) return { ok: true, skipped: true };
  const noAnswer = (r) => !r.ok && (r.code === "ENOTFOUND" || r.code === "ENODATA");
  const global = [];
  for (const server of cfg.globalServers) global.push(await resolveVia(server, host, cfg.timeoutMs));
  const answered = global.find((r) => r.ok && r.ips.length);
  if (!answered) {
    if (!global.some(noAnswer)) return { ok: true, unknown: true };
    const v6 = await resolveVia(cfg.globalServers[0], host, cfg.timeoutMs, "resolve6");
    if (v6.ok && v6.ips.length) return { ok: true, unknown: true };
    return { ok: false, reason: `домен ${host} не резолвится` };
  }
  for (const server of cfg.ruServers) {
    const r = await resolveVia(server, host, cfg.timeoutMs);
    if (r.ok && r.ips.length && r.ips.every(isBogonIp)) return { ok: false, reason: `российский DNS ${server} подменяет ответ для ${host}: ${r.ips.join(",")}` };
    if (noAnswer(r)) return { ok: false, reason: `российский DNS ${server} не резолвит ${host}, хотя глобальные резолвят` };
  }
  return { ok: true };
}

// TCP reachability from Russian vantage points (check-host.net nodes located in RU).
// Returns Map(key -> { status: "ok" | "blocked" | "unknown", detail }). An API failure
// or a rate limit yields "unknown", never "blocked".
export async function ruTcpCheck(targets, rawCfg = {}) {
  const cfg = { ...HEALTH_DEFAULTS.ruProbe, ...rawCfg };
  const base = process.env.CHECKHOST_API_URL || "https://check-host.net";
  const out = new Map();
  const unknown = (detail) => { for (const t of targets) if (!out.has(t.key)) out.set(t.key, { status: "unknown", detail }); return out; };
  const api = async (pathname) => {
    const res = await fetch(`${base}${pathname}`, { headers: { Accept: "application/json", "User-Agent": "ClearanceVPN-health/1.0" }, signal: AbortSignal.timeout(15000) });
    if (res.status === 429) { const e = new Error("лимит запросов (429)"); e.rateLimited = true; throw e; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  if (!targets.length) return out;

  let nodes = cfg.nodes;
  if (!nodes || !nodes.length) {
    try {
      const list = await api("/nodes/hosts");
      nodes = Object.entries(list?.nodes || {}).filter(([, v]) => v?.location?.[0] === "ru").map(([k]) => k).slice(0, cfg.maxNodes);
    } catch (error) { return unknown(`список узлов: ${error.message}`); }
  }
  if (!nodes.length) return unknown("у check-host нет российских узлов");

  const deadline = Date.now() + cfg.budgetMs;
  let stop = null;
  await mapLimit(targets, cfg.concurrency, async (t) => {
    if (stop || Date.now() > deadline) { out.set(t.key, { status: "unknown", detail: stop || "бюджет времени" }); return; }
    try {
      const qs = new URLSearchParams(); qs.append("host", `${t.host}:${t.port}`); for (const n of nodes) qs.append("node", n);
      const started = await api(`/check-tcp?${qs}`);
      if (!started?.request_id) throw new Error("нет request_id");
      const until = Date.now() + cfg.waitMs;
      let verdict = null;
      for (;;) {
        await delay(cfg.pollMs);
        const result = await api(`/check-result/${started.request_id}`);
        let okNodes = 0; let failed = 0; let pending = 0;
        for (const node of nodes) {
          const v = result?.[node];
          const item = Array.isArray(v) ? v[0] : null;
          if (v == null || (Array.isArray(v) && item == null)) pending++;
          else if (item && typeof item.time === "number" && !item.error) okNodes++;
          else failed++;
        }
        if (okNodes >= cfg.minOk) { verdict = { status: "ok", detail: `${okNodes}/${nodes.length} узлов РФ` }; break; }
        if (!pending) { verdict = { status: "blocked", detail: `ни один из узлов РФ (${nodes.length}) не подключился` }; break; }
        if (Date.now() > until) { verdict = { status: "unknown", detail: "узлы РФ не ответили вовремя" }; break; }
      }
      out.set(t.key, verdict);
    } catch (error) {
      if (error.rateLimited) stop = error.message;
      out.set(t.key, { status: "unknown", detail: error.message });
    }
  });
  return out;
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), headers: { "User-Agent": "ClearanceVPN-geo/1.0", Accept: "application/json", ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function lookupIps(ips, budgetMs = 45000) {
  const result = new Map();
  const deadline = Date.now() + budgetMs;
  const unique = [...new Set(ips)];
  const batchUrl = process.env.GEO_BATCH_URL || "http://ip-api.com/batch?fields=status,countryCode,query";
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    if (Date.now() > deadline) break;
    try {
      const rows = await fetchJson(batchUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(chunk) });
      if (Array.isArray(rows)) for (const row of rows) { const code = extractCountryCode(row); if (code && row.query) result.set(row.query, code); }
    } catch (error) { console.warn(`Geo: пакетный запрос не удался: ${error.message}`); }
  }
  const templates = String(process.env.GEO_IP_URLS || "https://api.country.is/{ip},https://ipwho.is/{ip}?fields=success,country_code,ip,https://ipinfo.io/{ip}/json").split(",").map((x) => x.trim()).filter(Boolean);
  await mapLimit(unique.filter((ip) => !result.has(ip)), 4, async (ip) => {
    for (const template of templates) {
      if (Date.now() > deadline) return;
      try {
        const code = extractCountryCode(await fetchJson(template.replace("{ip}", encodeURIComponent(ip))));
        if (code) { result.set(ip, code); return; }
      } catch {}
    }
  });
  return result;
}

export async function resolveGeo(nodes, { cacheFile, overridesFile, tlsOptions, health = {}, ctx = null } = {}) {
  const now = Date.now();
  const cache = readJsonSafe(cacheFile, {});
  const overrides = readJsonSafe(overridesFile, {});
  const hc = healthConfig(health);
  const strict = hc.strict !== false;
  const deadAfter = Math.max(1, Number(process.env.GEO_DEAD_AFTER || health.deadAfter || 2));
  const fresh = (entry, ttl) => entry && normalizeCode(entry.code) && now - Number(entry.at || 0) < ttl;
  const results = nodes.map(() => ({ code: null, source: null, ip: null, host: null, reachable: null, failCount: 0, dead: false, drop: false, reason: null, latency: null, checkError: null, dnsFailed: false, skipXray: false }));
  const stats = { override: 0, exit: 0, ip: 0, cache: 0, none: 0, xrayUsed: false, xrayOk: 0, xrayFail: 0, unchecked: 0, unverified: 0, grace: 0, dead: 0, unknown: 0, dnsBad: 0, ruOk: 0, ruBlocked: 0, ruUnknown: 0, ruCached: 0, directIp: null };
  const nodeKey = (i) => `node:${fingerprintOf(nodes[i].outbound, nodes[i].deps)}`;
  const failKey = (i) => `fail:${fingerprintOf(nodes[i].outbound, nodes[i].deps)}`;

  await mapLimit(nodes, 8, async (node, i) => {
    const ep = endpointOf(node.outbound);
    if (!ep) return;
    results[i].host = ep.address;
    results[i].ip = await resolveIp(ep.address);
  });

  nodes.forEach((node, i) => {
    const r = results[i];
    const code = normalizeCode(overrides[r.ip] ?? overrides[r.host] ?? "");
    if (code) { r.code = code; r.source = "override"; stats.override++; }
  });

  const checks = ctx || await prepareChecks({ health, tlsOptions });
  const bin = checks.bin;
  stats.xrayUsed = Boolean(bin);
  stats.hop = checks.hopInfo;

  // DNS cross-check (hostname servers only): domains that do not resolve or are poisoned by Russian resolvers.
  if (strict && hc.dns.enabled) {
    await mapLimit(nodes.map((_, i) => i), 8, async (i) => {
      const r = results[i];
      if (!r.host) return;
      const d = await checkDnsConsistency(r.host, hc.dns);
      if (!d.ok) { r.reachable = false; r.dnsFailed = true; r.checkError = `DNS: ${d.reason}`; stats.dnsBad++; }
    });
  }

  if (bin) {
    const xrayDeadline = Date.now() + Number(process.env.GEO_XRAY_BUDGET_MS || health.budgetMs || 900000);
    const concurrency = Math.max(1, Number(process.env.GEO_XRAY_CONCURRENCY || health.concurrency || 6));
    const directIp = checks.directIp;
    stats.directIp = directIp;
    await mapLimit(nodes.map((_, i) => i), concurrency, async (i) => {
      const r = results[i];
      if (r.dnsFailed) return;
      // bypassPolicy "ru": servers meant for Russian whitelists cannot be proven from abroad;
      // they are confirmed only from Russian vantage points (see ruProbe below).
      if (strict && hc.bypassPolicy === "ru" && nodes[i].bypass) { r.skipXray = true; return; }
      if (Date.now() > xrayDeadline) { stats.unchecked++; return; }
      let check;
      try { check = await checkViaXray(bin, nodes[i].outbound, { tlsOptions, deps: nodes[i].deps, health, directIp, hop: checks.hop, hopMode: hc.tunnel.mode, hopExitIp: checks.hopInfo?.exitIp }); }
      catch (error) { check = { ok: false, code: null, reason: error.message }; }
      r.reachable = check.ok;
      r.latency = check.latency || null;
      r.checkError = check.ok ? null : (check.reason || "нет ответа");
      if (check.ok) {
        stats.xrayOk++; delete cache[failKey(i)];
        if (check.code) {
          cache[nodeKey(i)] = { code: check.code, at: Date.now() };
          if (!r.code) { r.code = check.code; r.source = "exit"; stats.exit++; }
        }
      } else {
        stats.xrayFail++;
        const n = Number(cache[failKey(i)]?.n || 0) + 1;
        cache[failKey(i)] = { n, at: Date.now() };
        r.failCount = n;
      }
    });
  }

  // TCP reachability from Russian vantage points (check-host.net nodes in RU).
  if (strict && hc.ruProbe.enabled && !checks.hop && process.env.HEALTH_RU_PROBE !== "0") {
    const keyOf = new Map(); const targets = []; const verdicts = new Map();
    nodes.forEach((node, i) => {
      const r = results[i];
      if (r.dnsFailed || !(r.reachable === true || r.skipXray)) return;
      const ep = endpointOf(node.outbound);
      if (!ep || !ep.address || !ep.port || !isTcpBased(node.outbound) || (node.deps || []).length) return;
      const key = `${ep.address}:${ep.port}`;
      keyOf.set(i, key);
      if (verdicts.has(key) || targets.some((t) => t.key === key)) return;
      const cached = cache[`ru:${key}`];
      if (cached?.ok && now - Number(cached.at || 0) < hc.ruProbe.ttlMs) { verdicts.set(key, { status: "ok", detail: "из кэша" }); stats.ruCached++; return; }
      targets.push({ key, host: ep.address, port: ep.port });
    });
    for (const [key, v] of await ruTcpCheck(targets, hc.ruProbe)) verdicts.set(key, v);
    for (const [i, key] of keyOf) {
      const r = results[i]; const v = verdicts.get(key) || { status: "unknown", detail: "нет результата" };
      if (v.status === "ok") {
        stats.ruOk++; cache[`ru:${key}`] = { ok: true, at: now };
        if (r.skipXray) r.reachable = true;
      } else if (v.status === "blocked") {
        stats.ruBlocked++; delete cache[`ru:${key}`];
        r.reachable = false; r.checkError = `РФ: ${v.detail}`;
      } else {
        stats.ruUnknown++;
        if (hc.ruProbe.required || r.skipXray) { r.reachable = false; r.checkError = `РФ: нет подтверждения (${v.detail})`; }
      }
    }
  }

  const needIp = [];
  nodes.forEach((node, i) => {
    const r = results[i];
    if (r.code) return;
    const known = normalizeCode(cache[nodeKey(i)]?.code) ? cache[nodeKey(i)] : (r.ip && normalizeCode(cache[`ip:${r.ip}`]?.code) ? cache[`ip:${r.ip}`] : null);
    if (r.reachable === false) {
      if (!strict && known && r.failCount < deadAfter) { r.code = known.code; r.source = "cache"; stats.cache++; stats.grace++; }
      else r.dead = true;
      return;
    }
    if (fresh(cache[nodeKey(i)], IP_TTL)) { r.code = cache[nodeKey(i)].code; r.source = "cache"; stats.cache++; return; }
    if (!r.ip) return;
    if (fresh(cache[`ip:${r.ip}`], IP_TTL)) { r.code = cache[`ip:${r.ip}`].code; r.source = "ip"; stats.ip++; return; }
    needIp.push(i);
  });
  if (needIp.length) {
    const found = await lookupIps(needIp.map((i) => results[i].ip));
    for (const i of needIp) {
      const code = found.get(results[i].ip);
      if (code) { results[i].code = code; results[i].source = "ip"; stats.ip++; cache[`ip:${results[i].ip}`] = { code, at: Date.now() }; }
    }
  }

  for (const r of results) {
    if (strict) {
      // Strict: only a positively confirmed node passes. A country code from an override or
      // the cache, or "not checked", is never a reason to keep a server.
      if (r.reachable === true) continue;
      r.drop = true;
      r.reason = r.reachable === false ? "dead" : "unchecked";
      if (r.reachable === false) stats.dead++; else stats.unverified++;
      continue;
    }
    if (r.code || r.reachable === true) continue;
    r.drop = true;
    r.reason = r.dead ? "dead" : "unknown";
    if (r.dead) stats.dead++; else stats.unknown++;
  }
  stats.none = results.filter((r) => !r.code).length;
  for (const key of Object.keys(cache)) if (now - Number(cache[key]?.at || 0) > CACHE_KEEP) delete cache[key];
  writeJsonSafe(cacheFile, cache);
  return { results, stats };
                     }
