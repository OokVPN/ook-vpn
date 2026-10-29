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

function fingerprintOf(outbound) {
  const { tag, ...rest } = outbound || {};
  return crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 24);
}

async function resolveIp(host) {
  if (!host) return null;
  if (net.isIP(host)) return host;
  try { return (await dns.lookup(host, { family: 4 })).address; }
  catch {
    try { return (await dns.lookup(host)).address; } catch { return null; }
  }
}

function findXray() {
  if (process.env.GEO_XRAY === "off") return null;
  const candidate = process.env.XRAY_BIN || "xray";
  const probe = spawnSync(candidate, ["version"], { stdio: "ignore", timeout: 5000 });
  return probe.error || probe.status !== 0 ? null : candidate;
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
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => finish(null, { status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", finish);
    };
    if (url.protocol === "http:") {
      const req = http.request({ host: "127.0.0.1", port: proxyPort, method: "GET", path: urlString, headers: { Host: url.host, "User-Agent": "OokVPN-geo/1.0", Accept: "application/json" } }, collect);
      req.on("error", finish); req.end(); return;
    }
    const connect = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: `${url.hostname}:${url.port || 443}` });
    connect.on("error", finish);
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); finish(new Error(`CONNECT ${res.statusCode}`)); return; }
      const secure = tls.connect({ socket, servername: url.hostname, ...tlsOptions });
      secure.on("error", finish);
      const req = http.request({ createConnection: () => secure, host: url.hostname, method: "GET", path: `${url.pathname}${url.search}`, headers: { Host: url.host, "User-Agent": "OokVPN-geo/1.0", Accept: "application/json", Connection: "close" } }, (r) => { collect(r); });
      req.on("error", finish); req.end();
    });
    connect.end();
  });
}

export async function checkViaXray(bin, outbound, { urls, tlsOptions } = {}) {
  const exitUrls = urls || String(process.env.GEO_EXIT_URLS || "https://api.country.is/,https://ipwho.is/?fields=success,country_code,ip,https://ipinfo.io/json").split(",").map((x) => x.trim()).filter(Boolean);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ook-geo-"));
  let child = null;
  try {
    const port = await freePort();
    const config = {
      log: { loglevel: "none" },
      inbounds: [{ tag: "in", listen: "127.0.0.1", port, protocol: "http", settings: {} }],
      outbounds: [{ ...structuredClone(outbound), tag: "proxy" }, { tag: "direct", protocol: "freedom" }],
      routing: { rules: [{ type: "field", inboundTag: ["in"], outboundTag: "proxy" }] }
    };
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    child = spawn(bin, ["run", "-c", file], { stdio: "ignore" });
    let exited = false; child.on("exit", () => { exited = true; });
    if (!(await waitForPort(port, 6000)) || exited) return { ok: false, code: null, reason: "xray не стартовал" };
    let reached = false;
    for (const url of exitUrls) {
      try {
        const res = await getViaHttpProxy(port, url, { timeoutMs: 10000, tlsOptions });
        if (res.status < 200 || res.status >= 300) continue;
        reached = true;
        let data = null; try { data = JSON.parse(res.body); } catch {}
        const code = extractCountryCode(data);
        if (code) return { ok: true, code };
      } catch {}
    }
    return { ok: reached, code: null, reason: reached ? "страна не определена" : "нет ответа через узел" };
  } finally {
    if (child) { try { child.kill("SIGKILL"); } catch {} }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), headers: { "User-Agent": "OokVPN-geo/1.0", Accept: "application/json", ...(init.headers || {}) } });
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

export async function resolveGeo(nodes, { cacheFile, overridesFile, tlsOptions } = {}) {
  const now = Date.now();
  const cache = readJsonSafe(cacheFile, {});
  const overrides = readJsonSafe(overridesFile, {});
  const fresh = (entry, ttl) => entry && normalizeCode(entry.code) && now - Number(entry.at || 0) < ttl;
  const results = nodes.map(() => ({ code: null, source: null, ip: null, host: null, reachable: null }));
  const stats = { override: 0, exit: 0, ip: 0, none: 0, xrayUsed: false, xrayOk: 0, xrayFail: 0 };

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

  const bin = findXray();
  stats.xrayUsed = Boolean(bin);
  if (bin) {
    const queue = [];
    nodes.forEach((node, i) => {
      if (results[i].code) return;
      const key = `node:${fingerprintOf(node.outbound)}`;
      if (fresh(cache[key], NODE_TTL)) { results[i].code = cache[key].code; results[i].source = "exit"; results[i].reachable = true; stats.exit++; stats.xrayOk++; return; }
      queue.push(i);
    });
    const xrayDeadline = Date.now() + Number(process.env.GEO_XRAY_BUDGET_MS || 150000);
    await mapLimit(queue, 4, async (i) => {
      const r = results[i];
      if (Date.now() > xrayDeadline) return;
      let check;
      try { check = await checkViaXray(bin, nodes[i].outbound, { tlsOptions }); }
      catch (error) { check = { ok: false, code: null, reason: error.message }; }
      r.reachable = check.ok;
      if (check.ok) stats.xrayOk++; else stats.xrayFail++;
      if (check.code) {
        r.code = check.code; r.source = "exit"; stats.exit++;
        cache[`node:${fingerprintOf(nodes[i].outbound)}`] = { code: check.code, at: Date.now() };
      }
    });
  }

  const needIp = [];
  nodes.forEach((node, i) => {
    const r = results[i];
    if (r.code || !r.ip) return;
    const entry = cache[`ip:${r.ip}`];
    if (fresh(entry, IP_TTL)) { r.code = entry.code; r.source = "ip"; stats.ip++; return; }
    needIp.push(i);
  });
  if (needIp.length) {
    const found = await lookupIps(needIp.map((i) => results[i].ip));
    for (const i of needIp) {
      const code = found.get(results[i].ip);
      if (code) { results[i].code = code; results[i].source = "ip"; stats.ip++; cache[`ip:${results[i].ip}`] = { code, at: Date.now() }; }
    }
  }

  stats.none = results.filter((r) => !r.code).length;
  for (const key of Object.keys(cache)) if (now - Number(cache[key]?.at || 0) > CACHE_KEEP) delete cache[key];
  writeJsonSafe(cacheFile, cache);
  return { results, stats };
    }
