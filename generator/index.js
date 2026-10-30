import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { endpointOf, isPlaceholderOutbound, resolveGeo } from "./geo.js";

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
const OTHER_COUNTRY = { code:"UN", slug:"other", flag:"🌐", name:"Другой регион", matches:[] };
const SUPPORTED_URI = /^(?:vless|vmess|trojan|ss|hysteria2|hy2):\/\//i;
const SPONSOR_MARKERS = (Array.isArray(CONFIG.serverFilters?.sponsorMarkers)
  ? CONFIG.serverFilters.sponsorMarkers : ["Спонсор - @aloe_vpn_bot"])
  .map((x) => String(x).toLocaleLowerCase("ru-RU").trim()).filter(Boolean);
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

const STATS = { placeholderDropped: 0, sponsorDropped: 0, duplicateDropped: 0, uriBad: 0, uriSponsor: 0, uriSeen: 0 };
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}
function sponsor(value) {
  let text;
  try { text = (typeof value === "string" ? value : JSON.stringify(value ?? "")).toLocaleLowerCase("ru-RU"); }
  catch { text = String(value ?? "").toLocaleLowerCase("ru-RU"); }
  return SPONSOR_MARKERS.some((m) => text.includes(m));
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
  const keys = Object.keys(process.env).filter((k) => /^FREE_UPSTREAM_URL_\d+$/.test(k)).sort((a, b) => Number(a.split("_").pop()) - Number(b.split("_").pop()));
  const text = [process.env.FREE_UPSTREAM_URL, ...keys.map((k) => process.env[k])].filter(Boolean).join("\n");
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x)))];
}
function resetStats() { for (const k of Object.keys(STATS)) STATS[k] = 0; }
async function fetchSource(url, label = "") {
  const tag = label ? `[${label}] ` : "";
  const ua = "OokVPN-Subscription-Generator/1.1";
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
function nodeFingerprint(outbound) {
  const { tag, ...rest } = outbound || {};
  return crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex");
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
    outbound: structuredClone(outbound), name: String(outbound.remarks || parentName || outbound.tag || outbound.protocol || "server"), sourceTag: String(outbound.tag || "")
  }));
}
function parseSource(raw) {
  const text = String(raw ?? "").trim(); if (!text) return [];
  const result = []; const fingerprints = new Set(); const visited = new Set();
  const add = (node) => {
    if (!node?.outbound || isService(node.outbound)) return;
    if (isPlaceholderOutbound(node.outbound)) { STATS.placeholderDropped++; return; }
    if (sponsor(node.name) || sponsor(node.outbound)) { STATS.sponsorDropped++; return; }
    const hash = nodeFingerprint(node.outbound);
    if (fingerprints.has(hash)) { STATS.duplicateDropped++; return; } fingerprints.add(hash); result.push({ ...node, sourceTag: String(node.sourceTag || "") });
  };
  const addUriText = (str) => {
    for (const line0 of String(str).split(/\r?\n/u)) {
      const line = line0.trim(); if (!SUPPORTED_URI.test(line)) continue;
      STATS.uriSeen++;
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
  const slug = en.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || c.toLowerCase();
  return { code:c, slug, flag, name:ru, matches:[] };
}
function primaryOutbound(config) {
  const arr = Array.isArray(config?.outbounds) ? config.outbounds : [];
  return arr.find((o) => o?.tag === "proxy" && !isService(o)) || arr.find((o) => !isService(o) && !/^node-/i.test(String(o?.tag || "")) && (o?.protocol || o?.settings));
}
function isTemplateNode(o) { return typeof o?.tag === "string" && /^node-/i.test(o.tag) && !isService(o); }
function makeIndividualConfig(template, outbound, templateTags) {
  const result = structuredClone(template); const selected = structuredClone(outbound); selected.tag = "proxy";
  result.outbounds = [selected, ...(result.outbounds || []).filter((o) => !isTemplateNode(o) && !templateTags.has(o?.tag) && o?.tag !== "proxy")];
  if (result.routing) {
    delete result.routing.balancers;
    if (Array.isArray(result.routing.rules)) result.routing.rules = result.routing.rules.map((r0) => { const r = structuredClone(r0); if (Object.hasOwn(r,"balancerTag")) { delete r.balancerTag; r.outboundTag = "proxy"; } else if (templateTags.has(r.outboundTag) || String(r.outboundTag || "").startsWith("node-")) r.outboundTag = "proxy"; return r; });
  }
  if (result.observatory) result.observatory.subjectSelector = ["proxy"];
  if (result.burstObservatory) result.burstObservatory.subjectSelector = ["proxy"];
  return result;
}
function cleanTemplateForAuto(template, profiles) {
  const auto = structuredClone(template); const support = (auto.outbounds || []).filter((o) => !isTemplateNode(o) && !(!isService(o) && (o.protocol || o.settings) && o.tag !== "direct" && o.tag !== "block" && o.tag !== "dns"));
  const selected = []; const tags = [];
  for (const p of profiles) {
    if (!p.meta || p.meta.enabled === false || p.meta.auto === false || sponsor(p.meta.name)) continue;
    const original = primaryOutbound(p.config); if (!original || isPlaceholderOutbound(original)) continue;
    const tag = `node-${p.id}`; const out = structuredClone(original); out.tag = tag; selected.push(out); tags.push(tag);
  }
  if (!tags.length) throw new Error("Не осталось активных узлов с meta.auto=true для AUTO. auto.json не обновлён.");
  auto.outbounds = [...selected, ...support];
  if (!auto.routing) throw new Error("В generator/templates/auto.json отсутствует routing.");
  const balancers = Array.isArray(auto.routing.balancers) ? auto.routing.balancers : [];
  // Keep the original balancer tag because routing.rules refer to PROXY in the template.
  let balancer = balancers.find((b) => b.tag === "PROXY") || balancers.find((b) => b.tag === "auto") || balancers[0];
  if (!balancer) { balancer = { tag:"PROXY", selector:[], strategy:{ type:"leastLoad" } }; auto.routing.balancers = [balancer]; }
  balancer.selector = tags; balancer.fallbackTag = tags[0];
  auto.routing.balancers = [balancer];
  if (auto.observatory) auto.observatory.subjectSelector = tags;
  if (auto.burstObservatory) auto.burstObservatory.subjectSelector = tags;
  return { config:auto, tags };
}
function loadPremium() {
  if (!fs.existsSync(PREMIUM_DIR)) return [];
  return fs.readdirSync(PREMIUM_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json")).flatMap((file) => {
    const id = file.slice(0,-5); const metaPath = path.join(PREMIUM_DIR,`${id}.meta.json`); if (!fs.existsSync(metaPath)) return [];
    try { const meta = readJson(metaPath); if (meta.enabled === false || sponsor(meta.name)) return []; const config = readJson(path.join(PREMIUM_DIR,file)); config.remarks = meta.name || config.remarks || id; return [{id,config,meta}]; } catch (e) { console.warn(`Premium ${file}: ${e.message}`); return []; }
  });
}
function sortProfiles(items, order = []) { const p = new Map(order.map((id,i) => [id,i])); return items.sort((a,b) => (p.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (p.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)); }
async function run() {
  fs.mkdirSync(FREE_DIR,{recursive:true}); fs.mkdirSync(PREMIUM_DIR,{recursive:true}); fs.mkdirSync(OUTPUT_DIR,{recursive:true});
  if (!fs.existsSync(AUTO_TEMPLATE_PATH)) throw new Error("Не найден generator/templates/auto.json.");
  if (!fs.existsSync(AUTO_META_PATH)) throw new Error("Не найден servers/free/auto.meta.json.");
  const template = readJson(AUTO_TEMPLATE_PATH); const autoMeta = readJson(AUTO_META_PATH);
  if (autoMeta.enabled === false) throw new Error("AUTO отключён в servers/free/auto.meta.json.");
  const urls = upstreamUrls();
  if (!urls.length) throw new Error("Не задан FREE_UPSTREAM_URL. Добавь ссылку (или несколько, по одной в строке) в GitHub Secrets → Actions.");
  const sourceNodes = []; const mergedHashes = new Set(); let failedSources = 0; let crossDuplicates = 0; const totalStats = { placeholder:0, sponsor:0 };
  for (let k = 0; k < urls.length; k++) {
    const label = urls.length > 1 ? `Источник ${k + 1}/${urls.length}` : "";
    resetStats(); let nodes = [];
    try {
      const raw = await fetchSource(urls[k], label); nodes = parseSource(raw); logPayload(raw, nodes.length, label);
      if (!nodes.length) throw new Error(`${label ? `${label}: ` : ""}не найдено прокси-узлов`);
    } catch (error) { failedSources++; console.warn(`${label ? `${label}: ` : ""}пропущен: ${error.message}`); continue; }
    totalStats.placeholder += STATS.placeholderDropped; totalStats.sponsor += STATS.sponsorDropped + STATS.uriSponsor;
    let added = 0;
    for (const node of nodes) { const h = nodeFingerprint(node.outbound); if (mergedHashes.has(h)) { crossDuplicates++; continue; } mergedHashes.add(h); sourceNodes.push({ ...node, sourceIndex:k + 1 }); added++; }
    if (urls.length > 1) console.log(`${label}: узлов ${nodes.length}, добавлено ${added}`);
  }
  STATS.placeholderDropped = totalStats.placeholder;
  if (urls.length > 1) console.log(`Источников: ${urls.length}, не сработало: ${failedSources}, общих узлов между источниками: ${crossDuplicates}`);
  if (!sourceNodes.length) throw new Error("Ни один источник не дал прокси-узлов. Старые файлы не очищены.");
  if (failedSources && process.env.UPSTREAM_REQUIRE_ALL === "1") throw new Error(`Не сработало источников: ${failedSources}. Старые файлы не очищены (UPSTREAM_REQUIRE_ALL=1).`);
  const oldManifest = fs.existsSync(MANIFEST_PATH) ? readJson(MANIFEST_PATH) : { generated:[] };
  const oldIds = Array.isArray(oldManifest.generated) ? oldManifest.generated : [];
  const templateTags = new Set((template.outbounds || []).filter((o) => !isService(o) && (o.protocol || o.settings)).map((o) => o.tag).filter(Boolean));
  const { results: geo, stats: geoStats } = await resolveGeo(sourceNodes, { cacheFile:GEO_CACHE_PATH, overridesFile:GEO_OVERRIDES_PATH });
  console.log(`Страны: xray=${geoStats.xrayUsed ? "да" : "нет"}, по выходу=${geoStats.exit}, по IP сервера=${geoStats.ip}, ручные=${geoStats.override}, не определено=${geoStats.none}`);
  if (geoStats.xrayUsed) console.log(`Проверка через xray: ответили=${geoStats.xrayOk}, не ответили=${geoStats.xrayFail}`);
  const counts = new Map(); const seen = new Set(); const generated = []; let unreachableDropped = 0;
  for (let i = 0; i < sourceNodes.length; i++) {
    const node = sourceNodes[i]; const g = geo[i];
    if (g.reachable === false && process.env.GEO_DROP_UNREACHABLE === "1") { unreachableDropped++; continue; }
    const hash = nodeFingerprint(node.outbound); if (seen.has(hash)) continue; seen.add(hash);
    const named = detectCountryStrict(`${node.name || ""} ${node.sourceTag || ""}`); const byGeo = g.code ? countryByCode(g.code) : null;
    let c = OTHER_COUNTRY; let geoSource = "none";
    if (byGeo && (g.source === "override" || g.source === "exit")) { c = byGeo; geoSource = g.source; }
    else if (named) { c = named; geoSource = "name"; }
    else if (byGeo) { c = byGeo; geoSource = g.source; }
    const n = (counts.get(c.code) || 0) + 1; counts.set(c.code, n);
    const id = `${c.slug}-${String(n).padStart(2,"0")}`; const existingMetaPath = path.join(FREE_DIR,`${id}.meta.json`); let existing = null; try { if (fs.existsSync(existingMetaPath)) existing = readJson(existingMetaPath); } catch {}
    const name = `${c.flag} ${c.name} №${n}`; const meta = { id, name, country:c.code, tier:"free", enabled:existing?.enabled !== false, auto:existing?.auto !== false, generatedBy:"upstream", geoSource, sourceHash:hash };
    if (g.reachable !== null) meta.reachable = g.reachable;
    if (node.sourceIndex && urls.length > 1) meta.source = node.sourceIndex;
    const config = makeIndividualConfig(template,node.outbound,templateTags); config.remarks = name;
    writeJson(path.join(FREE_DIR,`${id}.json`),config); writeJson(existingMetaPath,meta); generated.push({id,config,meta});
  }
  if (unreachableDropped) console.log(`Отброшено недоступных через xray: ${unreachableDropped}`);
  if (!generated.length) throw new Error("Все узлы отфильтрованы; старые файлы сохранены.");
  const newIds = generated.map((x) => x.id); const keep = new Set(newIds); const removed = [];
  const isGeneratedMeta = (id, meta) => { if (!meta || meta.manual === true) return false; if (meta.generatedBy === "upstream") return true; if (meta.generatedBy) return false; return /-\d{2}$/.test(id) && /№\s*\d+\s*$/.test(String(meta.name || "")); };
  const staleIds = new Set(oldIds.filter((id) => id !== "auto"));
  for (const f of fs.readdirSync(FREE_DIR)) {
    if (f.startsWith(".") || !f.endsWith(".meta.json")) continue;
    const id = f.slice(0, -10); if (id === "auto" || id === "tech") continue;
    let meta = null; try { meta = readJson(path.join(FREE_DIR, f)); } catch {}
    if (isGeneratedMeta(id, meta)) staleIds.add(id);
  }
  if (failedSources) { console.log("Часть источников не сработала: устаревшие серверы не удаляются в этом запуске."); staleIds.clear(); }
  for (const id of staleIds) if (!keep.has(id)) for (const ext of [".json",".meta.json"]) { const f = path.join(FREE_DIR,`${id}${ext}`); if (fs.existsSync(f)) { fs.unlinkSync(f); if (ext === ".json") removed.push(id); } }
  if (removed.length) console.log(`Удалены устаревшие серверы (${removed.length}): ${removed.sort().join(", ")}`);
  writeJson(MANIFEST_PATH,{generated:newIds});
  const manual = fs.readdirSync(FREE_DIR).filter((f) => !f.startsWith(".") && f.endsWith(".json") && !f.endsWith(".meta.json") && f !== "auto.json").flatMap((f) => {
    const id = f.slice(0,-5); const mp = path.join(FREE_DIR,`${id}.meta.json`); if (!fs.existsSync(mp)) return [];
    try { const config = readJson(path.join(FREE_DIR,f)); const meta = readJson(mp); if (meta.enabled === false || sponsor(meta.name)) return []; config.remarks = meta.name || config.remarks || id; return [{id,config,meta}]; } catch { return []; }
  });
  const byId = new Map(manual.map((p) => [p.id,p])); for (const p of generated) byId.set(p.id,p);
  const profiles = [...byId.values()]; const autoResult = cleanTemplateForAuto(template,profiles); autoResult.config.remarks = autoMeta.name || "🇪🇺 ⚡ Авто-выбор"; writeJson(AUTO_PATH,autoResult.config);
  const free = sortProfiles([...profiles.filter((p) => p.id !== "auto"),{id:"auto",config:autoResult.config,meta:autoMeta}],CONFIG.servers?.freeOrder || []);
  const premium = sortProfiles(loadPremium(),CONFIG.servers?.premiumOrder || []);
  writeJson(path.join(OUTPUT_DIR,"free.json"),free.map((x) => x.config)); writeJson(path.join(OUTPUT_DIR,"premium.json"),premium.map((x) => x.config));
  if (STATS.placeholderDropped) console.log(`Отброшено заглушек (127.0.0.1, 0000, порт 0): ${STATS.placeholderDropped}`);
  console.log(`Узлов из источника: ${generated.length}`); console.log(`Узлов в AUTO: ${autoResult.tags.length}`); console.log(`Free-профилей: ${free.length}`); console.log(`Premium-профилей: ${premium.length}`); console.log("Генерация завершена.");
}
run().catch((error) => { console.error(`Ошибка генерации: ${error.message}`); process.exitCode = 1; });
