import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const CONFIG = readJson(path.join(ROOT, "config.json"));
const FREE_DIR = path.join(ROOT, CONFIG.servers?.freePath || "servers/free");
const PREMIUM_DIR = path.join(ROOT, CONFIG.servers?.premiumPath || "servers/premium");
const OUTPUT_DIR = path.join(ROOT, "output");
const AUTO_META_PATH = path.join(FREE_DIR, "auto.meta.json");
const AUTO_PATH = path.join(FREE_DIR, "auto.json");
const AUTO_TEMPLATE_PATH = path.join(ROOT, "generator/templates/auto.json");
const MANIFEST_PATH = path.join(FREE_DIR, ".generated-servers.json");
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

const STATS = { sponsorDropped: 0, duplicateDropped: 0, uriBad: 0, uriSponsor: 0, uriSeen: 0 };
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
  return { kind, rawLength: text.length, decodedLength: decoded.length, schemes, jsonInfo, decoded };
}
function logPayload(raw, nodesFound) {
  const d = describePayload(raw);
  console.log(`После декодирования: длина ${d.decodedLength}`);
  console.log(`URI по схемам: ${JSON.stringify(d.schemes)}${d.jsonInfo ? `; JSON: ${d.jsonInfo}` : ""}`);
  console.log(`Отброшено: спонсор=${STATS.sponsorDropped + STATS.uriSponsor}, дубли=${STATS.duplicateDropped}, битые URI=${STATS.uriBad}`);
  if (!nodesFound && d.decodedLength > 0 && d.decodedLength <= 600 && !/(?:vless|vmess|trojan|ss|hysteria2|hy2):\/\//i.test(d.decoded)) {
    console.log(`Короткий ответ без узлов (вероятная заглушка): ${JSON.stringify(d.decoded)}`);
  }
}
async function fetchSource() {
  const url = process.env.FREE_UPSTREAM_URL;
  if (!url) throw new Error("Не задан FREE_UPSTREAM_URL. Добавь ссылку в GitHub Secrets → Actions.");
  const ua = process.env.FREE_UPSTREAM_UA || "OokVPN-Subscription-Generator/1.1";
  const started = Date.now();
  const response = await fetch(url, { headers: { "user-agent": ua }, signal: AbortSignal.timeout(30000) });
  const body = await response.text();
  const h = (name) => response.headers.get(name) || "-";
  console.log(`Источник: HTTP ${response.status}, ${Date.now() - started} мс, content-type=${h("content-type")}, redirected=${response.redirected}, subscription-userinfo=${response.headers.has("subscription-userinfo")}, profile-title=${response.headers.has("profile-title")}`);
  if (!response.ok) throw new Error(`Источник вернул HTTP ${response.status}`);
  const first = describePayload(body);
  console.log(`Формат ответа: ${first.kind}, длина ${first.rawLength}`);
  return decodeSubscription(body);
}
function safeDecode(value) { try { return decodeURIComponent(value || ""); } catch { return value || ""; } }
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
    if (balancer.fallbackTag && outbounds.some((o) => o?.tag === balancer.fallbackTag && !isService(o))) selected.add(balancer.fallbackTag);
  }
  // If selectors are stale/mismatched, don't incorrectly conclude the source is empty.
  let candidates = selected.size ? outbounds.filter((o) => selected.has(o?.tag)) : [];
  if (!candidates.length) candidates = outbounds.filter((o) => o && !isService(o) && (o.protocol || o.settings));
  return candidates.filter((o) => o && !isService(o) && (o.protocol || o.settings)).map((outbound) => ({
    outbound: structuredClone(outbound), name: String(outbound.remarks || parentName || outbound.tag || outbound.protocol || "server"), sourceTag: String(outbound.tag || "")
  }));
}
function parseSource(raw) {
  const text = String(raw ?? "").trim(); if (!text) return [];
  const result = []; const fingerprints = new Set(); const visited = new Set();
  const add = (node) => {
    if (!node?.outbound || isService(node.outbound)) return;
    if (sponsor(node.name) || sponsor(node.outbound)) { STATS.sponsorDropped++; return; }
    const hash = crypto.createHash("sha256").update(JSON.stringify(node.outbound)).digest("hex");
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
    if (value.protocol && !isService(value)) add({ outbound: structuredClone(value), name: String(value.remarks || value.name || value.tag || value.protocol), sourceTag: String(value.tag || "") });
    for (const [key, child] of Object.entries(value)) {
      if (["outbounds"].includes(key) && Array.isArray(child)) {
        // Already handled above; recursively inspect only nested profile-shaped entries.
        for (const item of child) if (item && typeof item === "object" && Array.isArray(item.outbounds)) walk(item, name, depth + 1);
        continue;
      }
      if (/^(?:remarks|name|title|tag|protocol)$/i.test(key)) continue;
      if (["nodes", "proxies", "servers", "configs", "data", "result", "subscription", "content", "config", "payload", "profiles"].includes(key) || typeof child === "string" || Array.isArray(child) || (child && typeof child === "object")) walk(child, name, depth + 1);
    }
  }
  const s = text;
  if (s.startsWith("{") || s.startsWith("[")) { try { walk(JSON.parse(s)); } catch { addUriText(s); } }
  else addUriText(s);
  return result;
}
function parseUri(line) {
  const scheme = line.slice(0, line.indexOf("://")).toLowerCase();
  if (scheme === "vmess") {
    const encoded = line.split("#")[0].slice(8); const data = JSON.parse(decodeBase64(encoded));
    if (!data.add || !data.port || !data.id) throw new Error("Некорректный VMess URI");
    const net = data.net || "tcp"; const tls = data.tls === "tls";
    const stream = makeStream(net, tls ? "tls" : "none", { sni:data.sni || data.host, host:data.host, path:data.path, fp:data.fp, serviceName:data.path, alpn:data.alpn }, data.add);
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
  const stream = makeStream(network, security, { sni:p.get("sni"), host:p.get("host"), path:p.get("path"), fp:p.get("fp"), pbk:p.get("pbk"), sid:p.get("sid"), spx:p.get("spx"), serviceName:p.get("serviceName"), alpn:p.get("alpn") }, host);
  const name = safeDecode(url.hash.slice(1)) || host;
  if (scheme === "vless") { const user = { id:safeDecode(url.username), encryption:p.get("encryption") || "none" }; if (p.get("flow")) user.flow = p.get("flow"); return { name, outbound:{ protocol:"vless", settings:{ vnext:[{ address:host, port, users:[user] }] }, streamSettings:stream } }; }
  if (scheme === "trojan") return { name, outbound:{ protocol:"trojan", settings:{ servers:[{ address:host, port, password:safeDecode(url.username) }] }, streamSettings:stream } };
  return { name, outbound:{ protocol:"hysteria2", settings:{ servers:[{ address:host, port, password:safeDecode(url.username) }] }, streamSettings:stream } };
}
function makeStream(network, security, p, host) {
  const n = network === "h2" ? "http" : network; const out = { network:n, security:"none" };
  if (security === "tls" || security === "reality") out.security = security;
  if (n === "ws") out.wsSettings = { path:p.path || "/", headers:{ Host:p.host || p.sni || host } };
  if (n === "grpc") out.grpcSettings = { serviceName:p.serviceName || p.path || "" };
  if (n === "http") out.httpSettings = { path:p.path || "/" };
  if (security === "reality") out.realitySettings = { serverName:p.sni || host, fingerprint:p.fp || "chrome", publicKey:p.pbk || "", shortId:p.sid || "", spiderX:p.spx || "/" };
  if (security === "tls") out.tlsSettings = { serverName:p.sni || host, fingerprint:p.fp || "chrome", alpn:p.alpn ? String(p.alpn).split(",") : ["h2","http/1.1"] };
  return out;
}
function detectCountry(text = "") {
  const s = String(text).toLocaleLowerCase("ru-RU");
  for (const c of COUNTRIES) if (c.matches.some((m) => s.includes(m)) || new RegExp(`(^|[-_\\s])${c.code.toLowerCase()}($|[-_\\s])`, "i").test(s)) return c;
  return { code:"UN", slug:"other", flag:"🌐", name:"Другой регион", matches:[] };
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
    const original = primaryOutbound(p.config); if (!original) continue;
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
  const raw = await fetchSource(); const sourceNodes = parseSource(raw);
  logPayload(raw, sourceNodes.length);
  if (!sourceNodes.length) throw new Error("В источнике не найдено прокси-узлов. Старые файлы не очищены.");
  const oldManifest = fs.existsSync(MANIFEST_PATH) ? readJson(MANIFEST_PATH) : { generated:[] };
  const oldIds = Array.isArray(oldManifest.generated) ? oldManifest.generated : [];
  const templateTags = new Set((template.outbounds || []).filter((o) => !isService(o) && (o.protocol || o.settings)).map((o) => o.tag).filter(Boolean));
  const counts = new Map(); const seen = new Set(); const generated = [];
  for (const node of sourceNodes) {
    const c = detectCountry(`${node.name || ""} ${node.sourceTag || ""}`); const n = (counts.get(c.code) || 0) + 1;
    const hash = crypto.createHash("sha256").update(JSON.stringify(node.outbound)).digest("hex"); if (seen.has(hash)) continue; seen.add(hash); counts.set(c.code,n);
    const id = `${c.slug}-${String(n).padStart(2,"0")}`; const existingMetaPath = path.join(FREE_DIR,`${id}.meta.json`); let existing = null; try { if (fs.existsSync(existingMetaPath)) existing = readJson(existingMetaPath); } catch {}
    const name = `${c.flag} ${c.name} №${n}`; const meta = { id, name, country:c.code, tier:"free", enabled:existing?.enabled !== false, auto:existing?.auto !== false, generatedBy:"upstream", sourceHash:hash };
    const config = makeIndividualConfig(template,node.outbound,templateTags); config.remarks = name;
    writeJson(path.join(FREE_DIR,`${id}.json`),config); writeJson(existingMetaPath,meta); generated.push({id,config,meta});
  }
  if (!generated.length) throw new Error("Все узлы отфильтрованы; старые файлы сохранены.");
  // Only remove files explicitly listed in the previous manifest; never bulk-clear the Free directory.
  const newIds = generated.map((x) => x.id); const keep = new Set(newIds);
  for (const id of oldIds) if (!keep.has(id) && id !== "auto") for (const ext of [".json",".meta.json"]) { const f = path.join(FREE_DIR,`${id}${ext}`); if (fs.existsSync(f)) fs.unlinkSync(f); }
  writeJson(MANIFEST_PATH,{generated:newIds});
  const manual = fs.readdirSync(FREE_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json") && f !== "auto.json" && f !== ".generated-servers.json").flatMap((f) => {
    const id = f.slice(0,-5); const mp = path.join(FREE_DIR,`${id}.meta.json`); if (!fs.existsSync(mp)) return [];
    try { const config = readJson(path.join(FREE_DIR,f)); const meta = readJson(mp); if (meta.enabled === false || sponsor(meta.name)) return []; config.remarks = meta.name || config.remarks || id; return [{id,config,meta}]; } catch { return []; }
  });
  const byId = new Map(manual.map((p) => [p.id,p])); for (const p of generated) byId.set(p.id,p);
  const profiles = [...byId.values()]; const autoResult = cleanTemplateForAuto(template,profiles); autoResult.config.remarks = autoMeta.name || "🇪🇺 ⚡ Авто-выбор"; writeJson(AUTO_PATH,autoResult.config);
  const free = sortProfiles([...profiles.filter((p) => p.id !== "auto"),{id:"auto",config:autoResult.config,meta:autoMeta}],CONFIG.servers?.freeOrder || []);
  const premium = sortProfiles(loadPremium(),CONFIG.servers?.premiumOrder || []);
  writeJson(path.join(OUTPUT_DIR,"free.json"),free.map((x) => x.config)); writeJson(path.join(OUTPUT_DIR,"premium.json"),premium.map((x) => x.config));
  console.log(`Узлов из источника: ${generated.length}`); console.log(`Узлов в AUTO: ${autoResult.tags.length}`); console.log(`Free-профилей: ${free.length}`); console.log(`Premium-профилей: ${premium.length}`); console.log("Генерация завершена.");
}
run().catch((error) => { console.error(`Ошибка генерации: ${error.message}`); process.exitCode = 1; });
