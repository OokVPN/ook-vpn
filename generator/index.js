import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { endpointOf, isPlaceholderOutbound, resolveGeo, prepareChecks, verifyNodes } from "./geo.js";

const ROOT = process.cwd();
const CONFIG = readJson(path.join(ROOT, "config.json"));
const FREE_DIR = path.join(ROOT, CONFIG.servers?.freePath || "servers/free");
const PREMIUM_DIR = path.join(ROOT, CONFIG.servers?.premiumPath || "servers/premium");
const OUTPUT_DIR = path.join(ROOT, "output");
const AUTO_META_PATH = path.join(FREE_DIR, "auto.meta.json");
const AUTO_PATH = path.join(FREE_DIR, "auto.json");
const AUTO_TEMPLATE_PATH = path.join(ROOT, "generator/templates/auto.json");
const MANIFEST_PATH = path.join(FREE_DIR, ".generated-servers.json");
const GEO_CACHE_PATH = path.join(FREE_DIR, ".geo-cache.json");
const GEO_OVERRIDES_PATH = path.join(ROOT, "servers/geo-overrides.json");
const EXCLUDE_PATH = path.join(ROOT, "servers/exclude.json");
const GENERATOR_VERSION = "2026-11-21.1 (проверка через российский опорный узел, keepalive, проверка ручных серверов)";
const OTHER_COUNTRY = { code:"UN", slug:"other", flag:"🌐", name:"Другой регион", matches:[] };
const SUPPORTED_URI = /^(?:vless|vmess|trojan|ss|hysteria2|hy2):\/\//i;
function normalizeSponsorText(value) {
  return String(value ?? "").toLocaleLowerCase("ru-RU").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").replace(/\s*-\s*/g, "-").trim();
}
const SPONSOR_MARKERS = (Array.isArray(CONFIG.serverFilters?.sponsorMarkers)
  ? CONFIG.serverFilters.sponsorMarkers : ["Спонсор - @aloe_vpn_bot"])
  .map(normalizeSponsorText).filter(Boolean);
const COUNTRIES = [
  { code:"EE", slug:"estonia", flag:"🇪🇪", name:"Эстония", matches:["estonia","eesti","эстония","🇪🇪"] },
  { code:"PL", slug:"poland", flag:"🇵🇱", name:"Польша", matches:["poland","polska","польша","🇵🇱"] },
  { code:"DE", slug:"germany", flag:"🇩🇪", name:"Германия", matches:["germany","deutschland","германия","🇩🇪"] },
  { code:"NL", slug:"netherlands", flag:"🇳🇱", name:"Нидерланды", matches:["netherlands","holland","нидерланды","🇳🇱"] },
  { code:"FI", slug:"finland", flag:"🇫🇮", name:"Финляндия", matches:["finland","suomi","финляндия","🇫🇮"] },
  { code:"SE", slug:"sweden", flag:"🇸🇪", name:"Швеция", matches:["sweden","швеция","🇸🇪"] },
  { code:"CZ", slug:"czechia", flag:"🇨🇿", name:"Чехия", matches:["czech","чехия","🇨🇿"] },
  { code:"BE", slug:"belgium", flag:"🇧🇪", name:"Бельгия", matches:["belgium","бельгия","🇧🇪"] },
  { code:"FR", slug:"france", flag:"🇫🇷", name:"Франция", matches:["france","франция","🇫🇷"] },
  { code:"US", slug:"usa", flag:"🇺🇸", name:"США", matches:["united states","usa","сша","🇺🇸"] },
  { code:"GB", slug:"uk", flag:"🇬🇧", name:"Великобритания", matches:["united kingdom","great britain","uk","британия","🇬🇧"] },
  { code:"TR", slug:"turkey", flag:"🇹🇷", name:"Турция", matches:["turkey","türkiye","турция","🇹🇷"] },
  { code:"CH", slug:"switzerland", flag:"🇨🇭", name:"Швейцария", matches:["switzerland","швейцария","🇨🇭"] },
  { code:"AT", slug:"austria", flag:"🇦🇹", name:"Австрия", matches:["austria","австрия","🇦🇹"] },
  { code:"IT", slug:"italy", flag:"🇮🇹", name:"Италия", matches:["italy","италия","🇮🇹"] },
  { code:"ES", slug:"spain", flag:"🇪🇸", name:"Испания", matches:["spain","испания","🇪🇸"] },
  { code:"CA", slug:"canada", flag:"🇨🇦", name:"Канада", matches:["canada","канада","🇨🇦"] },
  { code:"JP", slug:"japan", flag:"🇯🇵", name:"Япония", matches:["japan","япония","🇯🇵"] },
  { code:"SG", slug:"singapore", flag:"🇸🇬", name:"Сингапур", matches:["singapore","сингапур","🇸🇬"] },
];

const STATS = { placeholderDropped: 0, tgDropped: 0, sponsorDropped: 0, duplicateDropped: 0, uriBad: 0, uriSponsor: 0, uriSeen: 0 };
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}
function sponsor(value) {
  let text;
  try { text = typeof value === "string" ? value : JSON.stringify(value ?? ""); }
  catch { text = String(value ?? ""); }
  text = normalizeSponsorText(text);
  return SPONSOR_MARKERS.some((m) => text.includes(m));
}
// "только для TG" (also тг / telegram): such servers never go into the subscription.
const TG_ONLY_RE = /только\s+для\s+(?:tg|тг|telegram|телеграм\w*)/i;
function isTgOnly(value) {
  return TG_ONLY_RE.test(String(value ?? "").toLowerCase().replace(/ё/g, "е"));
}
function decodeBase64(value) {
  const input = String(value).trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!input || !/^[A-Za-z0-9+/=\s]+$/.test(input)) return "";
  try { return Buffer.from(input, "base64").toString("utf8").replace(/^\uFEFF/, "").trim(); }
  catch { return ""; }
}
function looksReadable(text) {
  const s = String(text).trim();
  return s.startsWith("{") || s.startsWith("[") || SUPPORTED_URI.test(s) || /(?:^|\n)\s*(?:vless|vmess|trojan|ss|hysteria2|hy2):\/\//im.test(s);
}
function decodeSubscription(raw) {
  let current = String(raw ?? "").replace(/^\uFEFF/, "").trim();
  // Accept JSON/URI text directly; otherwise try base64 at each layer.
  for (let i = 0; i < 6; i++) {
    if (looksReadable(current)) return current;
    const decoded = decodeBase64(current);
    if (!decoded || decoded === current) break;
    current = decoded;
  }
  // Some subscription wrappers return JSON strings or an object containing a base64 payload.
  try {
    const value = JSON.parse(current);
    const candidates = collectTextPayloads(value);
    for (const candidate of candidates) {
      if (looksReadable(candidate)) return candidate;
      const decoded = decodeBase64(candidate);
      if (looksReadable(decoded)) return decoded;
    }
  } catch {}
  return current;
}
function collectTextPayloads(root) {
  const out = []; const seen = new Set();
  function walk(value, depth = 0) {
    if (depth > 12 || value == null) return;
    if (typeof value === "string") {
      if (!seen.has(value)) { seen.add(value); out.push(value); }
      return;
    }
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    if (typeof value === "object") for (const [key, item] of Object.entries(value)) {
      if (/^(?:remarks|name|tag|protocol|type)$/i.test(key)) continue;
      walk(item, depth + 1);
    }
  }
  walk(root); return out;
}
function decodeEntities(str) {
  const named = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " ", sol: "/", colon: ":" };
  return String(str).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === "#") {
      const code = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return Object.hasOwn(named, g.toLowerCase()) ? named[g.toLowerCase()] : m;
  });
}
function unescapeJs(str) {
  return String(str)
    .replace(/\\u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}
function isHtmlText(text) { return /^\s*<(?:!doctype|html|head|body)/i.test(String(text)); }
function findJsonBlocks(text, limit = 200) {
  const blocks = []; let i = 0; let attempts = 0;
  while (i < text.length && attempts < 4000 && blocks.length < limit) {
    const ch = text[i];
    if ((ch === "[" || ch === "{") && /[\s\[{"]/.test(text[i + 1] || "")) {
      attempts++;
      let depth = 0; let inStr = false; let esc = false; let end = -1;
      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === "[" || c === "{") depth++;
        else if (c === "]" || c === "}") { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end > i) {
        const chunk = text.slice(i, end + 1);
        if (/outbounds|"vnext"|"protocol"|vless|vmess|trojan/i.test(chunk)) {
          try { blocks.push(JSON.parse(chunk)); i = end + 1; continue; } catch {}
        }
      }
    }
    i++;
  }
  return blocks;
}
function htmlChunks(html) {
  const chunks = []; const push = (t) => { const v = String(t || "").trim(); if (v.length > 20) chunks.push(v); };
  for (const m of html.matchAll(/<(textarea|pre|code|script|template|noscript)\b[^>]*>([\s\S]*?)<\/\1>/gi)) push(m[2]);
  for (const m of html.matchAll(/\s[\w:-]+\s*=\s*"([^"]{40,})"/g)) push(m[1]);
  for (const m of html.matchAll(/\s[\w:-]+\s*=\s*'([^']{40,})'/g)) push(m[1]);
  push(html);
  return chunks;
}
function extractFromHtml(html) {
  const out = []; const seen = new Set();
  const consider = (text) => {
    const variants = new Set([text, decodeEntities(text), unescapeJs(text), unescapeJs(decodeEntities(text))]);
    for (const v of variants) {
      if (seen.has(v)) continue; seen.add(v);
      for (const block of findJsonBlocks(v)) out.push(block);
      if (/(?:^|[\s"'>])(?:vless|vmess|trojan|ss|hysteria2|hy2):\/\//i.test(v)) out.push(v);
      for (const m of v.matchAll(/[A-Za-z0-9+/_=-]{200,}/g)) { const d = decodeBase64(m[0]); if (d && looksReadable(d)) out.push(d); }
    }
  };
  for (const chunk of htmlChunks(html)) consider(chunk);
  return out;
}
function htmlHints(html) {
  const count = (re) => (html.match(re) || []).length;
  const escaped = decodeEntities(html);
  const maskPath = (p) => p.split("?")[0].split("/").map((seg) => (seg.length > 12 && /[0-9a-f-]{12,}/i.test(seg) ? "***" : seg)).join("/");
  const apis = [...new Set([...html.matchAll(/(?:fetch|axios\.(?:get|post)|XMLHttpRequest[^;]*open)\s*\(\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => maskPath(m[1])))].slice(0, 5);
  return `script=${count(/<script\b/gi)}, textarea=${count(/<textarea\b/gi)}, outbounds(raw)=${count(/"outbounds"/g)}, outbounds(entity)=${count(/&quot;outbounds&quot;/g)}, outbounds(js-escaped)=${count(/\\"outbounds\\"/g)}, outbounds(после декодирования)=${count(/"outbounds"/g) + (escaped.match(/"outbounds"/g) || []).length}, fetch/api: ${apis.join(" | ") || "-"}`;
}
function describePayload(raw) {
  const text = String(raw ?? "").replace(/^\uFEFF/, "").trim();
  const decoded = decodeSubscription(text);
  const schemes = {};
  for (const m of decoded.matchAll(/(?:^|\n)\s*(vless|vmess|trojan|ss|hysteria2|hy2):\/\//gim)) schemes[m[1].toLowerCase()] = (schemes[m[1].toLowerCase()] || 0) + 1;
  let kind = "text";
  if (!text) kind = "empty";
  else if (/^<(?:!doctype|html)/i.test(text)) kind = "html";
  else if (text.startsWith("{") || text.startsWith("[")) kind = "json";
  else if (decoded !== text) kind = "base64";
  let jsonInfo = "";
  try {
    const v = JSON.parse(decoded);
    if (Array.isArray(v)) jsonInfo = `array(${v.length})`;
    else if (v && typeof v === "object") jsonInfo = `object(keys: ${Object.keys(v).slice(0, 12).join(",")})`;
  } catch {}
  let htmlInfo = "";
  if (kind === "html") {
    const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    const lower = text.toLowerCase();
    const flags = [];
    if (/just a moment|cf-chl|challenge-platform|cf-browser-verification/.test(lower)) flags.push("cloudflare-challenge");
    if (/captcha|recaptcha|hcaptcha/.test(lower)) flags.push("captcha");
    if (/access denied|forbidden|blocked/.test(lower)) flags.push("denied-words");
    if (/<script[^>]+src=/.test(lower) && /<div id="root"|<div id="app"|__next|id="__nuxt"/.test(lower)) flags.push("spa-page");
    if (/vless(?:%3a|:)(?:%2f|\\?\/){2}/i.test(text)) flags.push("contains-vless-link");
    htmlInfo = `title=${JSON.stringify((title || "").replace(/\s+/g, " ").trim().slice(0, 120))}; признаки: ${flags.join(",") || "-"}`;
  }
  return { kind, rawLength: text.length, decodedLength: decoded.length, schemes, jsonInfo, htmlInfo, decoded };
}
function logPayload(raw, nodesFound, label = "") {
  const d = describePayload(raw);
  const log = (msg) => console.log(label ? `[${label}] ${msg}` : msg);
  log(`После декодирования: длина ${d.decodedLength}`);
  log(`URI по схемам: ${JSON.stringify(d.schemes)}${d.jsonInfo ? `; JSON: ${d.jsonInfo}` : ""}`);
  log(`Отброшено: спонсор=${STATS.sponsorDropped + STATS.uriSponsor}, дубли=${STATS.duplicateDropped}, битые URI=${STATS.uriBad}`);
  if (!nodesFound && d.kind === "html") log("Источник вернул веб-страницу вместо подписки: сервер, вероятно, определяет клиента по User-Agent или блокирует адреса GitHub Actions.");
  if (!nodesFound && d.decodedLength > 0 && d.decodedLength <= 600 && !/(?:vless|vmess|trojan|ss|hysteria2|hy2):\/\//i.test(d.decoded)) {
    log(`Короткий ответ без узлов (вероятная заглушка): ${JSON.stringify(d.decoded)}`);
  }
}
function upstreamUrls() {
  const file = path.join(ROOT, "sources.json");
  if (!fs.existsSync(file)) throw new Error("Не найден sources.json в корне проекта.");
  const data = readJson(file);
  const list = Array.isArray(data) ? data : data?.free;
  const items = Array.isArray(list) ? list : typeof list === "string" ? [list] : [];
  return [...new Set(items.map((x) => String(x).trim()).filter((x) => /^https?:\/\//i.test(x)))];
}
function resetStats() { for (const k of Object.keys(STATS)) STATS[k] = 0; }
async function fetchSource(url, label = "") {
  const tag = label ? `[${label}] ` : "";
  const ua = "ClearanceVPN-Subscription-Generator/1.1";
  const started = Date.now();
  let response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch(url, { headers: { "user-agent": ua }, signal: AbortSignal.timeout(60000) });
      if (response.status < 500) break;
      console.warn(`${tag}Попытка ${attempt}: HTTP ${response.status}`);
    } catch (error) {
      console.warn(`${tag}Попытка ${attempt}: ${error.name === "TimeoutError" ? "таймаут 60 с" : error.message}`);
      if (attempt === 3) throw error;
    }
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  const body = await response.text();
  const h = (name) => response.headers.get(name) || "-";
  console.log(`${tag}Источник: HTTP ${response.status}, ${Date.now() - started} мс, content-type=${h("content-type")}, redirected=${response.redirected}, subscription-userinfo=${response.headers.has("subscription-userinfo")}, profile-title=${response.headers.has("profile-title")}`);
  if (!response.ok) throw new Error(`источник вернул HTTP ${response.status}`);
  const first = describePayload(body);
  console.log(`${tag}Формат ответа: ${first.kind}, длина ${first.rawLength}`);
  if (first.htmlInfo) { console.log(`${tag}HTML: ${first.htmlInfo}`); console.log(`${tag}HTML-структура: ${htmlHints(body)}`); }
  return decodeSubscription(body);
}
function safeDecode(value) { try { return decodeURIComponent(value || ""); } catch { return value || ""; } }
function isProxyOutbound(o) {
  if (!o || typeof o !== "object" || typeof o.protocol !== "string") return false;
  const st = o.settings;
  if (!st || typeof st !== "object") return false;
  return Array.isArray(st.vnext) || Array.isArray(st.servers) || Array.isArray(st.peers) || (typeof st.address === "string" && st.port != null);
}
function nodeFingerprint(outbound, deps = []) {
  const { tag, ...rest } = outbound || {};
  const chain = Array.isArray(deps) && deps.length ? deps : undefined;
  return crypto.createHash("sha256").update(JSON.stringify(chain ? [rest, chain] : rest)).digest("hex");
}
function dependencyTags(o) {
  const tags = [];
  const a = o?.proxySettings?.tag; if (typeof a === "string" && a) tags.push(a);
  const b = o?.streamSettings?.sockopt?.dialerProxy; if (typeof b === "string" && b) tags.push(b);
  return tags;
}
function collectDeps(outbound, outbounds) {
  const byTag = new Map((outbounds || []).filter((o) => typeof o?.tag === "string").map((o) => [o.tag, o]));
  const out = []; const seen = new Set([outbound?.tag]);
  const visit = (o) => { for (const t of dependencyTags(o)) { if (seen.has(t)) continue; seen.add(t); const d = byTag.get(t); if (d && !isService(d)) { out.push(structuredClone(d)); visit(d); } } };
  visit(outbound); return out;
}
function renameDependencyRefs(o, map) {
  if (o?.proxySettings?.tag && map.has(o.proxySettings.tag)) o.proxySettings.tag = map.get(o.proxySettings.tag);
  if (o?.streamSettings?.sockopt?.dialerProxy && map.has(o.streamSettings.sockopt.dialerProxy)) o.streamSettings.sockopt.dialerProxy = map.get(o.streamSettings.sockopt.dialerProxy);
}
function isService(outbound) {
  const tag = String(outbound?.tag || "").toLowerCase(); const p = String(outbound?.protocol || "").toLowerCase();
  return ["direct","block","dns","freedom","blackhole"].includes(tag) || ["freedom","blackhole","dns"].includes(p);
}
function extractOutboundNodes(config, parentName = "") {
  const outbounds = Array.isArray(config?.outbounds) ? config.outbounds : [];
  const balancers = Array.isArray(config?.routing?.balancers) ? config.routing.balancers : [];
  const selected = new Set();
  for (const balancer of balancers) {
    const selectors = Array.isArray(balancer.selector) ? balancer.selector.filter((x) => typeof x === "string" && x) : [];
    for (const outbound of outbounds) if (!isService(outbound) && typeof outbound?.tag === "string" && selectors.some((prefix) => outbound.tag.startsWith(prefix))) selected.add(outbound.tag);
    if (!selected.size && balancer.fallbackTag && outbounds.some((o) => o?.tag === balancer.fallbackTag && !isService(o))) selected.add(balancer.fallbackTag);
  }
  // If selectors are stale/mismatched, don't incorrectly conclude the source is empty.
  let candidates = selected.size ? outbounds.filter((o) => selected.has(o?.tag)) : [];
  if (!candidates.length) candidates = outbounds.filter((o) => o && !isService(o) && isProxyOutbound(o));
  return candidates.filter((o) => o && !isService(o) && isProxyOutbound(o)).map((outbound) => ({
    outbound: structuredClone(outbound), deps: collectDeps(outbound, outbounds), name: String(outbound.remarks || parentName || outbound.tag || outbound.protocol || "server"), sourceTag: String(outbound.tag || "")
  }));
}
function parseSource(raw) {
  const text = String(raw ?? "").trim(); if (!text) return [];
  const result = []; const fingerprints = new Set(); const visited = new Set();
  const add = (node) => {
    if (!node?.outbound || isService(node.outbound)) return;
    if (isPlaceholderOutbound(node.outbound)) { STATS.placeholderDropped++; return; }
    if (isTgOnly(node.name) || isTgOnly(node.sourceTag)) { STATS.tgDropped++; return; }
    if (sponsor(node.name) || sponsor(node.outbound)) { STATS.sponsorDropped++; return; }
    const hash = nodeFingerprint(node.outbound, node.deps);
    if (fingerprints.has(hash)) { STATS.duplicateDropped++; return; } fingerprints.add(hash); result.push({ ...node, sourceTag: String(node.sourceTag || "") });
  };
  const addUriText = (str) => {
    for (const line0 of String(str).split(/\r?\n/u)) {
      const line = line0.trim(); if (!SUPPORTED_URI.test(line)) continue;
      STATS.uriSeen++;
      if (isTgOnly(safeDecode(line))) { STATS.tgDropped++; continue; }
      if (sponsor(line) || sponsor(safeDecode(line))) { STATS.uriSponsor++; continue; }
      try { add({ ...parseUri(line), sourceTag: "" }); }
      catch (error) { STATS.uriBad++; console.warn(`Пропуск URI: ${error.message}`); }
    }
  };
  function walk(value, parentName = "", depth = 0) {
    if (depth > 14 || value == null) return;
    if (typeof value === "string") {
      const s = value.trim();
      if (looksReadable(s)) {
        if (s.startsWith("{") || s.startsWith("[")) { try { walk(JSON.parse(s), parentName, depth + 1); } catch { addUriText(s); } }
        else addUriText(s);
      } else {
        const decoded = decodeBase64(s);
        if (decoded && decoded !== s && looksReadable(decoded)) walk(decoded, parentName, depth + 1);
      }
      return;
    }
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, parentName, depth + 1);
      return;
    }
    const name = String(value.remarks || value.name || value.title || parentName || "");
    if (Array.isArray(value.outbounds)) for (const node of extractOutboundNodes(value, name)) add(node);
    if (isProxyOutbound(value) && !isService(value)) add({ outbound: structuredClone(value), name: String(value.remarks || value.name || value.tag || value.protocol), sourceTag: String(value.tag || "") });
    for (const [key, child] of Object.entries(value)) {
      if (["outbounds"].includes(key) && Array.isArray(child)) {
        // Already handled above; recursively inspect only nested profile-shaped entries.
        for (const item of child) if (item && typeof item === "object" && Array.isArray(item.outbounds)) walk(item, name, depth + 1);
        continue;
      }
      if (/^(?:remarks|name|title|tag|protocol|inbounds|routing|dns|observatory|burstObservatory|log|policy|stats|api)$/i.test(key)) continue;
      if (["nodes", "proxies", "servers", "configs", "data", "result", "subscription", "content", "config", "payload", "profiles"].includes(key) || typeof child === "string" || Array.isArray(child) || (child && typeof child === "object")) walk(child, name, depth + 1);
    }
  }
  const s = text;
  if (isHtmlText(s)) { for (const piece of extractFromHtml(s)) walk(piece); }
  else if (s.startsWith("{") || s.startsWith("[")) { try { walk(JSON.parse(s)); } catch { addUriText(s); } }
  else addUriText(s);
  return result;
}
function parseUri(line) {
  const scheme = line.slice(0, line.indexOf("://")).toLowerCase();
  if (scheme === "vmess") {
    const encoded = line.split("#")[0].slice(8); const data = JSON.parse(decodeBase64(encoded));
    if (!data.add || !data.port || !data.id) throw new Error("Некорректный VMess URI");
    const net = data.net || "tcp"; const tls = data.tls === "tls";
    const stream = makeStream(net, tls ? "tls" : "none", { sni:data.sni || data.host, host:data.host, path:data.path, fp:data.fp, serviceName:data.path, alpn:data.alpn, headerType:data.type, allowInsecure:data.allowInsecure }, data.add);
    return { name:safeDecode(line.split("#").slice(1).join("#")) || data.ps || data.add, outbound:{ protocol:"vmess", settings:{ vnext:[{ address:data.add, port:Number(data.port), users:[{ id:data.id, alterId:Number(data.aid || 0), security:data.scy || "auto" }] }] }, streamSettings:stream } };
  }
  if (scheme === "ss") {
    const [beforeHash, ...hash] = line.split("#"); let body = beforeHash.slice(5); let parsedBody = body;
    if (!parsedBody.includes("@")) { const d = decodeBase64(parsedBody.split("?")[0]); if (d.includes("@")) parsedBody = d + (parsedBody.includes("?") ? `?${parsedBody.split("?").slice(1).join("?")}` : ""); }
    const url = new URL(`ss://${parsedBody}`); let user = safeDecode(url.username);
    if (!user.includes(":")) user = decodeBase64(user);
    const sep = user.indexOf(":"); if (sep <= 0) throw new Error("Некорректный Shadowsocks URI");
    return { name:safeDecode(hash.join("#")) || url.hostname, outbound:{ protocol:"shadowsocks", settings:{ servers:[{ address:url.hostname, port:Number(url.port), method:user.slice(0,sep), password:user.slice(sep+1) }] } } };
  }
  if (!["vless","trojan","hysteria2","hy2"].includes(scheme)) throw new Error(`Неподдерживаемый URI: ${scheme}`);
  const url = new URL(line); const p = url.searchParams; const host = url.hostname; const port = Number(url.port || 443);
  const network = p.get("type") || "tcp"; const security = p.get("security") || (["trojan","hysteria2","hy2"].includes(scheme) ? "tls" : "none");
  const stream = makeStream(network, security, { sni:p.get("sni"), host:p.get("host"), path:p.get("path"), fp:p.get("fp"), pbk:p.get("pbk"), sid:p.get("sid"), spx:p.get("spx"), pqv:p.get("pqv"), serviceName:p.get("serviceName"), authority:p.get("authority"), mode:p.get("mode"), extra:p.get("extra"), alpn:p.get("alpn"), headerType:p.get("headerType"), seed:p.get("seed"), allowInsecure:p.get("allowInsecure") || p.get("insecure"), pcs:p.get("pcs"), ech:p.get("ech") }, host);
  const name = safeDecode(url.hash.slice(1)) || host;
  if (scheme === "vless") { const user = { id:safeDecode(url.username), encryption:p.get("encryption") || "none" }; if (p.get("flow")) user.flow = p.get("flow"); return { name, outbound:{ protocol:"vless", settings:{ vnext:[{ address:host, port, users:[user] }] }, streamSettings:stream } }; }
  if (scheme === "trojan") return { name, outbound:{ protocol:"trojan", settings:{ servers:[{ address:host, port, password:safeDecode(url.username) }] }, streamSettings:stream } };
  return { name, outbound:{ protocol:"hysteria2", settings:{ servers:[{ address:host, port, password:safeDecode(url.username) }] }, streamSettings:stream } };
}
function truthyParam(v) { return v === true || /^(?:1|true|yes)$/i.test(String(v ?? "")); }
function parseJsonParam(v) { if (!v) return undefined; const text = String(v).trim(); for (const candidate of [text, safeDecode(text)]) { try { const value = JSON.parse(candidate); if (value && typeof value === "object") return value; } catch {} } return undefined; }
function makeStream(network, security, p, host) {
  const n = network === "h2" ? "http" : network === "splithttp" ? "xhttp" : network; const out = { network:n, security:"none" };
  if (security === "tls" || security === "reality") out.security = security;
  if (n === "ws") out.wsSettings = { path:p.path || "/", headers:{ Host:p.host || p.sni || host } };
  if (n === "grpc") { out.grpcSettings = { serviceName:p.serviceName || p.path || "" }; if (p.authority) out.grpcSettings.authority = p.authority; if (p.mode === "multi") out.grpcSettings.multiMode = true; }
  if (n === "http") { out.httpSettings = { path:p.path || "/" }; if (p.host) out.httpSettings.host = String(p.host).split(","); }
  if (n === "httpupgrade") out.httpupgradeSettings = { path:p.path || "/", host:p.host || p.sni || host };
  if (n === "xhttp") { const x = { path:p.path || "/" }; if (p.host) x.host = p.host; if (p.mode) x.mode = p.mode; const extra = parseJsonParam(p.extra); if (extra) x.extra = extra; out.xhttpSettings = x; }
  if (n === "kcp") { out.kcpSettings = { header:{ type:p.headerType || "none" } }; if (p.seed) out.kcpSettings.seed = p.seed; }
  if (n === "tcp" && p.headerType === "http") out.tcpSettings = { header:{ type:"http", request:{ path:String(p.path || "/").split(","), headers:{ Host:String(p.host || "").split(",").filter(Boolean) } } } };
  if (security === "reality") { out.realitySettings = { serverName:p.sni || host, fingerprint:p.fp || "chrome", publicKey:p.pbk || "", shortId:p.sid || "", spiderX:p.spx || "/" }; if (p.pqv) out.realitySettings.mldsa65Verify = p.pqv; }
  if (security === "tls") { out.tlsSettings = { serverName:p.sni || host, fingerprint:p.fp || "chrome", alpn:p.alpn ? String(p.alpn).split(",") : ["h2","http/1.1"] }; if (truthyParam(p.allowInsecure)) out.tlsSettings.allowInsecure = true; if (p.pcs) out.tlsSettings.pinnedPeerCertSha256 = p.pcs; if (p.ech) out.tlsSettings.echConfigList = p.ech; }
  return out;
}
const NAME_FLAGS_RE = /[\u{1F1E6}-\u{1F1FF}]/gu;
const CONNECTION_TOKENS = [
  { label:"LTE", re:/(?:^|[^a-zа-я0-9])lte(?![a-zа-я0-9])/i, slug:"lte" },
  { label:"5G", re:/(?:^|[^a-zа-я0-9])5g(?![a-zа-я0-9])/i, slug:"5g" },
  { label:"4G", re:/(?:^|[^a-zа-я0-9])4g(?![a-zа-я0-9])/i, slug:"4g" },
  { label:"3G", re:/(?:^|[^a-zа-я0-9])3g(?![a-zа-я0-9])/i, slug:"3g" },
  { label:"Wi-Fi", re:/wi-?fi|вай-?фай/i, slug:"wifi" }
];
const CATEGORY_TOKENS = [
  { label:"Обход", re:/обход|глушил/i, slug:"bypass" },
  { label:"БС", re:/белы[а-я]*\s+списк|(?:^|[^a-zа-я0-9])бс(?![a-zа-я0-9])|white\s*-?\s*list/i, slug:"wl" },
  { label:"Все операторы", re:/вс[её]\s+оператор/i, slug:"allops" }
];
const JAMMER_RE = /глушил/i;
const YOUTUBE_RE = /youtube|ютуб|ютьюб|you\s+tube/i;
function classifyName(raw) {
  const text = String(raw ?? "").replace(NAME_FLAGS_RE, " ").replace(/ё/gi, (m) => (m === "Ё" ? "Е" : "е"));
  const connections = CONNECTION_TOKENS.filter((t) => t.re.test(text));
  const categories = CATEGORY_TOKENS.filter((t) => t.re.test(text));
  const jammer = JAMMER_RE.test(text);
  if (jammer && !connections.some((t) => t.label === "LTE")) connections.unshift(CONNECTION_TOKENS.find((t) => t.label === "LTE"));
  return { connections, categories, youtube: YOUTUBE_RE.test(text), antenna: jammer || String(raw ?? "").includes("📡") };
}
// Bypass servers: "Обход", "глушил…", "БС"/белые списки, or LTE in the name.
function isBypassClass(cls) {
  return cls.categories.some((t) => t.slug === "bypass" || t.slug === "wl") || cls.connections.some((t) => t.slug === "lte");
}
function detectCountryStrict(text = "") {
  const s = String(text).toLocaleLowerCase("ru-RU");
  for (const c of COUNTRIES) if (c.matches.some((m) => s.includes(m)) || new RegExp(`(^|[-_\\s])${c.code.toLowerCase()}($|[-_\\s])`, "i").test(s)) return c;
  return null;
}
function countryByCode(code) {
  const c = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  const known = COUNTRIES.find((x) => x.code === c); if (known) return known;
  let ru; let en;
  try { ru = new Intl.DisplayNames(["ru"], { type:"region" }).of(c); en = new Intl.DisplayNames(["en"], { type:"region" }).of(c); } catch { return null; }
  if (!ru || !en || ru === c || en === c) return null;
  const flag = String.fromCodePoint(...[...c].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65));
  const shortName = ru.replace(/\s*\([^)]*\)/g, "").trim() || ru;
  const slug = en.replace(/\s*\([^)]*\)/g, "").replace(/\s+SAR(?:\s+China)?$/i, "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || c.toLowerCase();
  return { code:c, slug, flag, name:shortName, matches:[] };
}
function primaryOutbound(config) {
  const arr = Array.isArray(config?.outbounds) ? config.outbounds : [];
  return arr.find((o) => o?.tag === "proxy" && !isService(o)) || arr.find((o) => !isService(o) && !/^node-/i.test(String(o?.tag || "")) && (o?.protocol || o?.settings));
}
function isTemplateNode(o) { return typeof o?.tag === "string" && /^node-/i.test(o.tag) && !isService(o); }
function placeholderTagSet(template) {
  return new Set((template?.outbounds || []).filter((o) => o?.tag && !isService(o) && isProxyOutbound(o) && isPlaceholderOutbound(o)).map((o) => o.tag));
}
function makeIndividualConfig(template, outbound, templateTags, deps = []) {
  const result = structuredClone(template); const selected = structuredClone(outbound); selected.tag = "proxy";
  const hops = (deps || []).map((d) => structuredClone(d)); const hopTags = new Set(hops.map((d) => d.tag));
  result.outbounds = [selected, ...hops, ...(result.outbounds || []).filter((o) => !isTemplateNode(o) && !templateTags.has(o?.tag) && o?.tag !== "proxy" && !hopTags.has(o?.tag))];
  if (result.routing) {
    delete result.routing.balancers;
    const deadTags = placeholderTagSet(template);
    if (Array.isArray(result.routing.rules)) result.routing.rules = result.routing.rules.map((r0) => { const r = structuredClone(r0); if (deadTags.has(r.outboundTag)) r.outboundTag = "block"; else if (Object.hasOwn(r,"balancerTag")) { delete r.balancerTag; r.outboundTag = "proxy"; } else if (templateTags.has(r.outboundTag) || String(r.outboundTag || "").startsWith("node-")) r.outboundTag = "proxy"; return r; });
  }
  delete result.observatory; delete result.burstObservatory;
  return result;
}
function cleanTemplateForAuto(template, profiles) {
  const auto = structuredClone(template); const support = (auto.outbounds || []).filter((o) => !isTemplateNode(o) && !(!isService(o) && (o.protocol || o.settings) && o.tag !== "direct" && o.tag !== "block" && o.tag !== "dns"));
  const selected = []; const tags = []; const hopOutbounds = [];
  for (const p of profiles) {
    if (!p.meta || p.meta.enabled === false || p.meta.auto === false || sponsor(p.meta.name)) continue;
    const original = primaryOutbound(p.config); if (!original || isPlaceholderOutbound(original)) continue;
    const tag = `node-${p.id}`; const out = structuredClone(original); out.tag = tag;
    const hops = collectDeps(original, p.config.outbounds); const rename = new Map(hops.map((h, i) => [h.tag, `hop-${p.id}-${i + 1}`]));
    renameDependencyRefs(out, rename);
    for (const h of hops) { const copy = structuredClone(h); renameDependencyRefs(copy, rename); copy.tag = rename.get(h.tag); hopOutbounds.push(copy); }
    selected.push(out); tags.push(tag);
  }
  if (!tags.length) throw new Error("Не осталось активных узлов с meta.auto=true для AUTO. auto.json не обновлён.");
  auto.outbounds = [...selected, ...hopOutbounds, ...support];
  if (!auto.routing) throw new Error("В generator/templates/auto.json отсутствует routing.");
  const balancers = Array.isArray(auto.routing.balancers) ? auto.routing.balancers : [];
  // Keep the original balancer tag because routing.rules refer to PROXY in the template.
  let balancer = balancers.find((b) => b.tag === "PROXY") || balancers.find((b) => b.tag === "auto") || balancers[0];
  if (!balancer) { balancer = { tag:"PROXY", selector:[], strategy:{ type:"leastLoad" } }; auto.routing.balancers = [balancer]; }
  balancer.selector = tags; balancer.fallbackTag = tags[0];
  auto.routing.balancers = [balancer];
  const deadTags = placeholderTagSet(template);
  if (Array.isArray(auto.routing.rules)) for (const r of auto.routing.rules) if (deadTags.has(r.outboundTag)) r.outboundTag = "block";
  if (auto.observatory) auto.observatory.subjectSelector = tags;
  if (auto.burstObservatory) auto.burstObservatory.subjectSelector = tags;
  return { config:auto, tags };
}
// Non-connectable list headers ("⬇️ АВТО ВЫБОР ⬇️" etc.) live in stubs/ next to
// the other stubs: stubs/separator-auto.json, separator-fast.json, separator-bypass.json.
// The name is the "remarks" field of the file. A missing file just means no header.
function loadSeparator(key) {
  const file = path.join(ROOT, "stubs", `separator-${key}.json`);
  try {
    const config = readJson(file);
    if (!config.remarks) throw new Error("в файле нет remarks");
    return { id: `separator-${key}`, separator: true, meta: { id: `separator-${key}`, name: config.remarks }, config };
  } catch (error) {
    console.warn(`Заголовок «${key}» пропущен: stubs/separator-${key}.json — ${error.message}`);
    return null;
  }
}
function loadPremium() {
  if (!fs.existsSync(PREMIUM_DIR)) return [];
  return fs.readdirSync(PREMIUM_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json")).flatMap((file) => {
    const id = file.slice(0,-5); const metaPath = path.join(PREMIUM_DIR,`${id}.meta.json`); if (!fs.existsSync(metaPath)) return [];
    try { const meta = readJson(metaPath); if (meta.enabled === false || sponsor(meta.name)) return []; const config = readJson(path.join(PREMIUM_DIR,file)); config.remarks = meta.name || config.remarks || id; return [{id,config,meta}]; } catch (e) { console.warn(`Premium ${file}: ${e.message}`); return []; }
  });
}
function sortProfiles(items, order = []) { const p = new Map(order.map((id,i) => [id,i])); return items.sort((a,b) => (p.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (p.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)); }
// Russian vantage point: a known-good server in Russia. Taken from the RU_HOP_CONFIG secret
// (preferred, keeps the keys out of the repository) or from health.tunnel.configFile.
// Either a full Xray config or a vless:// link.
function loadHop() {
  const tcfg = CONFIG.health?.tunnel || {};
  if (tcfg.enabled === false || process.env.HEALTH_TUNNEL === "0") return null;
  let raw = String(process.env.RU_HOP_CONFIG || "").trim(); let from = "секрет RU_HOP_CONFIG";
  if (!raw) {
    const file = path.join(ROOT, tcfg.configFile || "generator/tunnel.json");
    if (fs.existsSync(file)) { raw = fs.readFileSync(file, "utf8"); from = path.relative(ROOT, file); }
  }
  if (!raw) return null;
  resetStats();
  const nodes = parseSource(raw);
  resetStats();
  if (!nodes.length) { console.warn(`Опорный российский сервер (${from}): не найдено ни одного прокси-узла в конфиге.`); return null; }
  return { outbound: nodes[0].outbound, deps: nodes[0].deps || [], name: nodes[0].name, from };
}

// Ready-made servers (manual and premium files) used to go straight into the subscription
// without any check. They are verified the same way as the generated ones; a dead one is
// left out of the output (its file on disk is not touched).
async function dropDeadProfiles(profiles, label, ctx) {
  const skip = (p) => ["auto", "tech"].includes(p.id) || String(p.id).startsWith("separator-");
  const items = [];
  for (const p of profiles) {
    if (skip(p)) continue;
    const outbound = primaryOutbound(p.config);
    if (!outbound || isPlaceholderOutbound(outbound)) continue;
    items.push({ profile: p, node: { outbound: structuredClone(outbound), deps: collectDeps(outbound, p.config.outbounds || []) } });
  }
  if (!items.length) return profiles;
  const checked = await verifyNodes(items.map((x) => x.node), { ctx, health: CONFIG.health || {} });
  const dead = new Set();
  items.forEach((x, i) => {
    if (checked[i].ok) return;
    dead.add(x.profile.id);
    console.log(`  ✗ [${label}] ${x.profile.id} (${String(x.profile.meta?.name || x.profile.config?.remarks || "").slice(0, 40)}) — ${checked[i].reason} [не попадёт в подписку]`);
  });
  if (dead.size) console.log(`Проверка серверов «${label}»: проверено ${items.length}, не прошли ${dead.size}`);
  return profiles.filter((p) => !dead.has(p.id));
}
function loadExclude() {
  try {
    if (!fs.existsSync(EXCLUDE_PATH)) return { hosts: new Set(), names: [] };
    const raw = readJson(EXCLUDE_PATH);
    const list = Array.isArray(raw) ? raw : [...(raw.hosts || []), ...(raw.names || []).map((n) => `name:${n}`)];
    const hosts = new Set(); const names = [];
    for (const item of list) { const v = String(item || "").trim().toLowerCase(); if (!v) continue; if (v.startsWith("name:")) names.push(normalizeSponsorText(v.slice(5))); else hosts.add(v); }
    return { hosts, names };
  } catch (error) { console.warn(`servers/exclude.json: ${error.message}`); return { hosts: new Set(), names: [] }; }
}
function isExcluded(node, exclude) {
  const ep = endpointOf(node.outbound); const host = String(ep?.address || "").toLowerCase();
  if (host && (exclude.hosts.has(host) || exclude.hosts.has(`${host}:${ep.port}`))) return true;
  const name = normalizeSponsorText(node.name || ""); return Boolean(name) && exclude.names.some((n) => name.includes(n));
}
async function run() {
  console.log(`Генератор: ${GENERATOR_VERSION}`);
  fs.mkdirSync(FREE_DIR,{recursive:true}); fs.mkdirSync(PREMIUM_DIR,{recursive:true}); fs.mkdirSync(OUTPUT_DIR,{recursive:true});
  if (!fs.existsSync(AUTO_TEMPLATE_PATH)) throw new Error("Не найден generator/templates/auto.json.");
  if (!fs.existsSync(AUTO_META_PATH)) throw new Error("Не найден servers/free/auto.meta.json.");
  const template = readJson(AUTO_TEMPLATE_PATH); const autoMeta = readJson(AUTO_META_PATH);
  if (autoMeta.enabled === false) throw new Error("AUTO отключён в servers/free/auto.meta.json.");
  const urls = upstreamUrls();
  if (!urls.length) throw new Error("В sources.json нет ссылок. Добавь их в массив \"free\".");
  const sourceNodes = []; const mergedHashes = new Set(); let failedSources = 0; const failedIndexes = new Set(); let crossDuplicates = 0; const totalStats = { placeholder:0, sponsor:0, tg:0 };
  for (let k = 0; k < urls.length; k++) {
    const label = urls.length > 1 ? `Источник ${k + 1}/${urls.length}` : "";
    resetStats(); let nodes = [];
    try {
      const raw = await fetchSource(urls[k], label); nodes = parseSource(raw); logPayload(raw, nodes.length, label);
      if (!nodes.length) throw new Error(`${label ? `${label}: ` : ""}не найдено прокси-узлов`);
    } catch (error) { failedSources++; failedIndexes.add(k + 1); console.warn(`${label ? `${label}: ` : ""}пропущен: ${error.message}`); continue; }
    totalStats.placeholder += STATS.placeholderDropped; totalStats.tg += STATS.tgDropped; totalStats.sponsor += STATS.sponsorDropped + STATS.uriSponsor;
    let added = 0;
    for (const node of nodes) { const h = nodeFingerprint(node.outbound, node.deps); if (mergedHashes.has(h)) { crossDuplicates++; continue; } mergedHashes.add(h); sourceNodes.push({ ...node, sourceIndex:k + 1 }); added++; }
    if (urls.length > 1) console.log(`${label}: узлов ${nodes.length}, добавлено ${added}`);
  }
  STATS.placeholderDropped = totalStats.placeholder;
  if (totalStats.tg) console.log(`Исключено «только для TG»: ${totalStats.tg}`);
  if (urls.length > 1) console.log(`Источников: ${urls.length}, не сработало: ${failedSources}, общих узлов между источниками: ${crossDuplicates}`);
  if (!sourceNodes.length) throw new Error("Ни один источник не дал прокси-узлов. Старые файлы не очищены.");
  const exclude = loadExclude(); let excludedCount = 0;
  for (let i = sourceNodes.length - 1; i >= 0; i--) if (isExcluded(sourceNodes[i], exclude)) { sourceNodes.splice(i, 1); excludedCount++; }
  if (excludedCount) console.log(`Исключено по servers/exclude.json: ${excludedCount}`);
  if (!sourceNodes.length) throw new Error("После exclude.json не осталось узлов. Старые файлы не очищены.");
  if (failedSources && process.env.UPSTREAM_REQUIRE_ALL === "1") throw new Error(`Не сработало источников: ${failedSources}. Старые файлы не очищены (UPSTREAM_REQUIRE_ALL=1).`);
  const oldManifest = fs.existsSync(MANIFEST_PATH) ? readJson(MANIFEST_PATH) : { generated:[] };
  const oldIds = Array.isArray(oldManifest.generated) ? oldManifest.generated : [];
  const templateTags = new Set((template.outbounds || []).filter((o) => !isService(o) && (o.protocol || o.settings)).map((o) => o.tag).filter(Boolean));
  for (const n of sourceNodes) n.bypass = isBypassClass(classifyName(n.name || ""));
  const hop = loadHop();
  if (!hop && CONFIG.health?.tunnel?.enabled !== false) console.warn("ВНИМАНИЕ: опорный российский сервер не задан (секрет RU_HOP_CONFIG или generator/tunnel.json): серверы проверяются напрямую из GitHub и могут оказаться недоступными из России.");
  const checks = await prepareChecks({ health:CONFIG.health || {}, hop });
  if (checks.hopInfo) console.log(`Опорный российский сервер: ${String(hop.name || "").slice(0, 40)} (${hop.from}) — работает, выход ${checks.hopInfo.exitIp || "?"}, ${checks.hopInfo.latency || "?"} мс. Режим: ${CONFIG.health?.tunnel?.mode || "only"} (все серверы проверяются через него).`);
  const { results: geo, stats: geoStats } = await resolveGeo(sourceNodes, { cacheFile:GEO_CACHE_PATH, overridesFile:GEO_OVERRIDES_PATH, health:CONFIG.health || {}, ctx:checks });
  console.log(`Страны: xray=${geoStats.xrayUsed ? "да" : "нет"}, по выходу=${geoStats.exit}, по IP сервера=${geoStats.ip}, из кэша=${geoStats.cache}, ручные=${geoStats.override}, не определено=${geoStats.none}`);
  if (!geoStats.xrayUsed) {
    if (process.env.HEALTH_REQUIRE_XRAY === "1") throw new Error("Xray не найден: проверка серверов на работоспособность невозможна. Старые файлы не очищены (HEALTH_REQUIRE_XRAY=1).");
    console.warn("ВНИМАНИЕ: Xray не найден, серверы НЕ проверяются на работоспособность.");
  } else {
    console.log(`Проверка через xray: ответили=${geoStats.xrayOk}, не ответили=${geoStats.xrayFail}, не проверено (лимит времени)=${geoStats.unchecked}, DNS-отказ=${geoStats.dnsBad}, из РФ: подтверждено=${geoStats.ruOk} (кэш ${geoStats.ruCached}), заблокировано=${geoStats.ruBlocked}, без ответа API=${geoStats.ruUnknown}`);
    if (geoStats.directIp === null) console.warn("IP раннера не определён: проверка «трафик действительно проксируется» пропущена.");
    const failedNodes = geo.map((g, i) => ({ g, node: sourceNodes[i] })).filter((x) => x.g.reachable === false);
    for (const { g, node } of failedNodes.slice(0, 40)) console.log(`  ✗ ${String(node.name || g.host).slice(0, 50)} — ${g.checkError}${g.drop ? " [убран]" : " [оставлен: был рабочим]"}`);
    if (failedNodes.length > 40) console.log(`  … и ещё ${failedNodes.length - 40}`);
  }
  const requireCountry = process.env.GEO_REQUIRE_COUNTRY !== "0";
  // Dead / unconfirmed servers are always removed; "country unknown" only when GEO_REQUIRE_COUNTRY is on.
  const mustDrop = (g) => g.drop && (requireCountry || g.reason === "dead" || g.reason === "unchecked");
  const toDrop = geo.filter(mustDrop).length;
  const maxRatio = Number(process.env.GEO_MAX_DROP_RATIO ?? CONFIG.health?.maxDropRatio ?? 0.5);
  if (toDrop && sourceNodes.length >= 2 && toDrop / sourceNodes.length > maxRatio) throw new Error(`Страну не удалось определить у ${toDrop} из ${sourceNodes.length} узлов (порог ${Math.round(maxRatio * 100)}%): похоже на сбой GeoIP/сети, а не на мёртвые серверы. Старые файлы не очищены.`);
  if (toDrop) console.log(`Отброшено как нерабочие: ${toDrop} (не отвечают: ${geoStats.dead}, не подтверждены: ${geoStats.unverified}, страна не определена: ${geoStats.unknown})`);
  const seen = new Set(); const entries = [];
  for (let i = 0; i < sourceNodes.length; i++) {
    const node = sourceNodes[i]; const g = geo[i];
    if (mustDrop(g)) continue;
    const hash = nodeFingerprint(node.outbound, node.deps); if (seen.has(hash)) continue; seen.add(hash);
    const named = detectCountryStrict(`${node.name || ""} ${node.sourceTag || ""}`); const byGeo = g.code ? countryByCode(g.code) : null;
    let c = OTHER_COUNTRY; let geoSource = "none";
    if (byGeo) { c = byGeo; geoSource = g.source; }
    else if (named) { c = named; geoSource = "name"; }
    const cls = classifyName(node.name || ""); const bypass = isBypassClass(cls);
    const kind = bypass ? "bypass" : cls.youtube ? "youtube" : "standard";
    const nameBase = bypass ? `${c.flag} ${c.name} | Обход` : cls.youtube ? `${c.flag} ${c.name} | [YouTube]` : `${c.flag} ${c.name}`;
    const kindSlug = bypass ? "bypass" : cls.youtube ? "yt" : "";
    entries.push({ node, g, hash, c, geoSource, cls, kind, nameBase: `${c.code}|${nameBase}`, nameText: nameBase, idBase: kindSlug ? `${c.slug}-${kindSlug}` : c.slug });
  }
  const nameTotals = new Map(); for (const e of entries) nameTotals.set(e.nameBase, (nameTotals.get(e.nameBase) || 0) + 1);
  const nameCounts = new Map(); const idCounts = new Map(); const generated = []; let bypassNumber = 0;
  for (const e of entries) {
    const { node, g, hash, c, geoSource, cls, kind } = e;
    const n = (nameCounts.get(e.nameBase) || 0) + 1; nameCounts.set(e.nameBase, n);
    const k = (idCounts.get(e.idBase) || 0) + 1; idCounts.set(e.idBase, k);
    const id = `${e.idBase}-${String(k).padStart(2,"0")}`; const existingMetaPath = path.join(FREE_DIR,`${id}.meta.json`); let existing = null; try { if (fs.existsSync(existingMetaPath)) existing = readJson(existingMetaPath); } catch {}
    const showNumber = kind === "standard" || nameTotals.get(e.nameBase) > 1;
    const name = kind === "bypass" ? `${e.nameText} №${++bypassNumber}` : `${e.nameText}${showNumber ? ` №${n}` : ""}`;
    const meta = { id, name, country:c.code, tier:"free", kind, enabled:existing?.enabled !== false, auto:existing?.auto !== false, generatedBy:"upstream", geoSource, sourceHash:hash };
    if (g.latency) meta.latency = g.latency;
    if (g.reachable !== null) meta.reachable = g.reachable;
    if (kind === "bypass") meta.bypassNumber = bypassNumber;
    if (node.sourceIndex) meta.source = node.sourceIndex;
    const config = makeIndividualConfig(template,node.outbound,templateTags,node.deps); config.remarks = name;
    writeJson(path.join(FREE_DIR,`${id}.json`),config); writeJson(existingMetaPath,meta); generated.push({id,config,meta});
  }
  if (!generated.length) throw new Error("Все узлы отфильтрованы; старые файлы сохранены.");
  const newIds = generated.map((x) => x.id); const keep = new Set(newIds); const removed = [];
  const isGeneratedMeta = (id, meta) => { if (!meta || meta.manual === true) return false; if (meta.generatedBy === "upstream") return true; if (meta.generatedBy) return false; return /-\d{2}$/.test(id) && /№\s*\d+\s*(?:📡)?\s*$/u.test(String(meta.name || "")); };
  const staleIds = new Set(oldIds.filter((id) => id !== "auto"));
  for (const f of fs.readdirSync(FREE_DIR)) {
    if (f.startsWith(".") || !f.endsWith(".meta.json")) continue;
    const id = f.slice(0, -10); if (id === "auto" || id === "tech") continue;
    let meta = null; try { meta = readJson(path.join(FREE_DIR, f)); } catch {}
    if (isGeneratedMeta(id, meta)) staleIds.add(id);
  }
  if (failedSources) {
    for (const id of [...staleIds]) { let m = null; try { m = readJson(path.join(FREE_DIR, `${id}.meta.json`)); } catch {} if (!m || !m.source || failedIndexes.has(m.source)) staleIds.delete(id); }
    console.log(`Часть источников не сработала (${[...failedIndexes].join(", ")}): серверы этих источников и серверы без пометки источника не удаляются.`);
  }
  for (const id of staleIds) if (!keep.has(id)) for (const ext of [".json",".meta.json"]) { const f = path.join(FREE_DIR,`${id}${ext}`); if (fs.existsSync(f)) { fs.unlinkSync(f); if (ext === ".json") removed.push(id); } }
  if (removed.length) console.log(`Удалены устаревшие серверы (${removed.length}): ${removed.sort().join(", ")}`);
  writeJson(MANIFEST_PATH,{generated:newIds});
  const manual = fs.readdirSync(FREE_DIR).filter((f) => !f.startsWith(".") && f.endsWith(".json") && !f.endsWith(".meta.json") && f !== "auto.json").flatMap((f) => {
    const id = f.slice(0,-5); const mp = path.join(FREE_DIR,`${id}.meta.json`); if (!fs.existsSync(mp)) return [];
    try { const config = readJson(path.join(FREE_DIR,f)); const meta = readJson(mp); if (meta.enabled === false || sponsor(meta.name)) return []; config.remarks = meta.name || config.remarks || id; return [{id,config,meta}]; } catch { return []; }
  });
  const manualVerified = CONFIG.health?.validateManual === false ? manual : await dropDeadProfiles(manual.filter((p) => !keep.has(p.id)), "ручной", checks);
  const byId = new Map(manualVerified.map((p) => [p.id,p])); for (const p of generated) byId.set(p.id,p);
  const profiles = [...byId.values()]; const autoResult = cleanTemplateForAuto(template,profiles); autoResult.config.remarks = autoMeta.name || "🇪🇺 ⚡ Авто-выбор"; writeJson(AUTO_PATH,autoResult.config);
  const sortedFree = sortProfiles([...profiles.filter((p) => p.id !== "auto"),{id:"auto",config:autoResult.config,meta:autoMeta}],CONFIG.servers?.freeOrder || []);
  const isBypassName = (name) => isBypassClass(classifyName(name || ""));
  const isBypassProfile = (p) => p.id !== "auto" && p.id !== "tech" && (p.meta?.kind === "bypass" || (p.meta?.generatedBy !== "upstream" && isBypassName(p.meta?.name)));
  const bypassRank = (p) => (p.meta?.generatedBy === "upstream" ? p.meta.bypassNumber || 0 : 1e6 + sortedFree.indexOf(p));
  // Final order: tech, ⬇️ АВТО ВЫБОР ⬇️, AUTO, ⬇️ СКОРОСТНЫЕ СЕРВЕРА ⬇️, servers, ⬇️ ОБХОДЫ ⬇️, bypasses.
  // A header is added only when there is something under it.
  const bypassList = sortedFree.filter(isBypassProfile).sort((x, y) => bypassRank(x) - bypassRank(y));
  const normalList = sortedFree.filter((p) => !isBypassProfile(p));
  const techList = normalList.filter((p) => p.id === "tech");
  const autoList = normalList.filter((p) => p.id === "auto");
  const regularList = normalList.filter((p) => p.id !== "tech" && p.id !== "auto");
  // Headers are on by default; "separators": false in config.json switches them off (Happ pings
  // every profile, so a header always shows "н/д" there).
  const header = (key, show) => (show && CONFIG.separators !== false ? [loadSeparator(key)].filter(Boolean) : []);
  const free = [
    ...techList,
    ...header("auto", autoList.length > 0), ...autoList,
    ...header("fast", regularList.length > 0), ...regularList,
    ...header("bypass", bypassList.length > 0), ...bypassList
  ];
  const premiumAll = loadPremium();
  const premiumChecked = CONFIG.health?.validateManual === false ? premiumAll : await dropDeadProfiles(premiumAll, "premium", checks);
  const premium = sortProfiles(premiumChecked,CONFIG.servers?.premiumOrder || []);
  writeJson(path.join(OUTPUT_DIR,"free.json"),free.map((x) => x.config)); writeJson(path.join(OUTPUT_DIR,"premium.json"),premium.map((x) => x.config));
  if (STATS.placeholderDropped) console.log(`Отброшено заглушек (127.0.0.1, 0000, порт 0): ${STATS.placeholderDropped}`);
  for (const x of generated) console.log(`  • ${x.id}: ${x.meta.name} [страна: ${x.meta.geoSource}${x.meta.reachable === undefined ? "" : x.meta.reachable ? ", отвечает" : ", не отвечает"}${x.meta.source ? `, источник ${x.meta.source}` : ""}]`);
  console.log(`Узлов из источника: ${generated.length}`); console.log(`Узлов в AUTO: ${autoResult.tags.length}`); console.log(`Free-профилей: ${free.filter((x) => !x.separator).length} (+ заголовков: ${free.filter((x) => x.separator).length})`); console.log(`Premium-профилей: ${premium.length}`); console.log("Генерация завершена.");
}
run().catch((error) => { console.error(`Ошибка генерации: ${error.message}`); process.exitCode = 1; });
