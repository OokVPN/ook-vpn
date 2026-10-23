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

const SPONSOR_MARKERS = (
  Array.isArray(CONFIG.serverFilters?.sponsorMarkers)
    ? CONFIG.serverFilters.sponsorMarkers
    : ["Спонсор: @AloeVPNbot"]
).map((item) => String(item).toLocaleLowerCase("ru-RU").trim()).filter(Boolean);

const COUNTRIES = [
  { code: "EE", slug: "estonia", flag: "🇪🇪", name: "Эстония", matches: ["estonia", "eesti", "эстония", "🇪🇪"] },
  { code: "PL", slug: "poland", flag: "🇵🇱", name: "Польша", matches: ["poland", "polska", "польша", "🇵🇱"] },
  { code: "DE", slug: "germany", flag: "🇩🇪", name: "Германия", matches: ["germany", "deutschland", "германия", "🇩🇪"] },
  { code: "NL", slug: "netherlands", flag: "🇳🇱", name: "Нидерланды", matches: ["netherlands", "holland", "нидерланды", "🇳🇱"] },
  { code: "FI", slug: "finland", flag: "🇫🇮", name: "Финляндия", matches: ["finland", "suomi", "финляндия", "🇫🇮"] },
  { code: "SE", slug: "sweden", flag: "🇸🇪", name: "Швеция", matches: ["sweden", "швеция", "🇸🇪"] },
  { code: "CZ", slug: "czechia", flag: "🇨🇿", name: "Чехия", matches: ["czech", "чехия", "🇨🇿"] },
  { code: "BE", slug: "belgium", flag: "🇧🇪", name: "Бельгия", matches: ["belgium", "бельгия", "🇧🇪"] },
  { code: "FR", slug: "france", flag: "🇫🇷", name: "Франция", matches: ["france", "франция", "🇫🇷"] },
  { code: "US", slug: "usa", flag: "🇺🇸", name: "США", matches: ["united states", "usa", "сша", "🇺🇸"] },
  { code: "GB", slug: "uk", flag: "🇬🇧", name: "Великобритания", matches: ["united kingdom", "great britain", "uk", "британия", "🇬🇧"] },
  { code: "TR", slug: "turkey", flag: "🇹🇷", name: "Турция", matches: ["turkey", "türkiye", "турция", "🇹🇷"] },
  { code: "CH", slug: "switzerland", flag: "🇨🇭", name: "Швейцария", matches: ["switzerland", "швейцария", "🇨🇭"] },
  { code: "AT", slug: "austria", flag: "🇦🇹", name: "Австрия", matches: ["austria", "австрия", "🇦🇹"] },
  { code: "IT", slug: "italy", flag: "🇮🇹", name: "Италия", matches: ["italy", "италия", "🇮🇹"] },
  { code: "ES", slug: "spain", flag: "🇪🇸", name: "Испания", matches: ["spain", "испания", "🇪🇸"] },
  { code: "CA", slug: "canada", flag: "🇨🇦", name: "Канада", matches: ["canada", "канада", "🇨🇦"] },
  { code: "JP", slug: "japan", flag: "🇯🇵", name: "Япония", matches: ["japan", "япония", "🇯🇵"] },
  { code: "SG", slug: "singapore", flag: "🇸🇬", name: "Сингапур", matches: ["singapore", "сингапур", "🇸🇬"] },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;

  fs.writeFileSync(
    tempPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );

  fs.renameSync(tempPath, filePath);
}

function hasSponsorMarker(value) {
  const text = (
    typeof value === "string"
      ? value
      : JSON.stringify(value ?? "")
  ).toLocaleLowerCase("ru-RU");

  return SPONSOR_MARKERS.some((marker) => text.includes(marker));
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}

function decodeBase64(value) {
  const input = value.replace(/-/g, "+").replace(/_/g, "/");

  return Buffer.from(input, "base64")
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trim();
}

function looksLikeConfigOrLinks(text) {
  const value = text.trim();

  return (
    value.startsWith("{") ||
    value.startsWith("[") ||
    /(?:vless|vmess|trojan|ss|hysteria2|hy2):\/\//i.test(value)
  );
}

function decodeSubscription(raw) {
  let current = raw.replace(/^\uFEFF/, "").trim();

  for (let i = 0; i < 4; i += 1) {
    if (looksLikeConfigOrLinks(current)) {
      return current;
    }

    const decoded = decodeBase64(current);

    if (!decoded || decoded === current) {
      break;
    }

    current = decoded;
  }

  throw new Error(
    "Источник не похож на JSON или Base64-подписку с поддерживаемыми URI."
  );
}

async function fetchSource() {
  const url = process.env.FREE_UPSTREAM_URL;

  if (!url) {
    throw new Error(
      "Не задан FREE_UPSTREAM_URL. Добавь ссылку в GitHub Secrets → Actions."
    );
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "OokVPN-Subscription-Generator/1.0",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Источник вернул HTTP ${response.status}`);
  }

  return decodeSubscription(await response.text());
}

function detectCountry(name = "") {
  const text = String(name).toLocaleLowerCase("ru-RU");

  for (const country of COUNTRIES) {
    if (country.matches.some((match) => text.includes(match))) {
      return country;
    }

    const codePattern = new RegExp(
      `(^|[-_\\s])${country.code.toLowerCase()}($|[-_\\s])`,
      "i"
    );

    if (codePattern.test(text)) {
      return country;
    }
  }

  return {
    code: "UN",
    slug: "other",
    flag: "🌐",
    name: "Другой регион",
    matches: [],
  };
}

function makeStreamSettings(
  network,
  security,
  params,
  host,
  pathValue = ""
) {
  const stream = {
    network: network === "h2" ? "http" : network,
    security: "none",
  };

  if (security === "tls" || security === "reality") {
    stream.security = security;
  }

  if (stream.network === "ws") {
    stream.wsSettings = {
      path: pathValue || params.get("path") || "/",
      headers: {
        Host: params.get("host") || params.get("sni") || host,
      },
    };
  } else if (stream.network === "grpc") {
    stream.grpcSettings = {
      serviceName: params.get("serviceName") || pathValue || "",
    };
  } else if (stream.network === "tcp") {
    stream.tcpSettings = {};
  } else if (stream.network === "http") {
    stream.httpSettings = {
      path: pathValue || params.get("path") || "/",
    };
  }

  if (security === "reality") {
    stream.realitySettings = {
      serverName: params.get("sni") || host,
      fingerprint: params.get("fp") || "chrome",
      publicKey: params.get("pbk") || "",
      shortId: params.get("sid") || "",
      spiderX: params.get("spx") || "/",
    };
  } else if (security === "tls") {
    stream.tlsSettings = {
      serverName: params.get("sni") || host,
      fingerprint: params.get("fp") || "chrome",
      alpn: params.get("alpn")
        ? params.get("alpn").split(",")
        : ["h2", "http/1.1"],
      allowInsecure: params.get("allowInsecure") === "1",
    };
  }

  return stream;
}

function parseVmess(line) {
  const withoutFragment = line.split("#")[0];
  const encoded = withoutFragment.slice("vmess://".length);
  const data = JSON.parse(decodeBase64(encoded));

  const host = data.add;
  const port = Number(data.port);

  if (!host || !port || !data.id) {
    throw new Error("Некорректный VMess URI");
  }

  const params = new URLSearchParams();

  if (data.sni || data.host) {
    params.set("sni", data.sni || data.host);
  }

  if (data.fp) params.set("fp", data.fp);
  if (data.path) params.set("path", data.path);
  if (data.host) params.set("host", data.host);

  const network = data.net || "tcp";
  const security = data.tls === "tls" ? "tls" : "none";

  return {
    name:
      safeDecode(line.split("#").slice(1).join("#")) ||
      data.ps ||
      host,

    outbound: {
      protocol: "vmess",
      settings: {
        vnext: [
          {
            address: host,
            port,
            users: [
              {
                id: data.id,
                alterId: Number(data.aid || 0),
                security: data.scy || "auto",
              },
            ],
          },
        ],
      },
      streamSettings: makeStreamSettings(
        network,
        security,
        params,
        host,
        data.path || ""
      ),
    },
  };
}

function parseShadowsocks(line) {
  const hashSplit = line.split("#");
  const name = safeDecode(hashSplit.slice(1).join("#"));

  let body = hashSplit[0].slice("ss://".length);

  if (!body.includes("@")) {
    const decoded = decodeBase64(body.split("?")[0]);

    if (!decoded.includes("@")) {
      throw new Error("Не удалось декодировать Shadowsocks URI");
    }

    body =
      decoded +
      (body.includes("?")
        ? `?${body.split("?").slice(1).join("?")}`
        : "");
  }

  const url = new URL(`ss://${body}`);

  let userInfo = safeDecode(url.username);

  if (!userInfo.includes(":")) {
    try {
      userInfo = decodeBase64(userInfo);
    } catch {
      // Ошибка будет обработана при проверке метода и пароля ниже.
    }
  }

  const separator = userInfo.indexOf(":");

  if (separator <= 0) {
    throw new Error("Некорректный метод/пароль Shadowsocks");
  }

  return {
    name: name || url.hostname,

    outbound: {
      protocol: "shadowsocks",
      settings: {
        servers: [
          {
            address: url.hostname,
            port: Number(url.port),
            method: userInfo.slice(0, separator),
            password: userInfo.slice(separator + 1),
          },
        ],
      },
    },
  };
}

function parseUri(line) {
  const value = line.trim();
  const scheme = value.slice(0, value.indexOf("://")).toLowerCase();

  if (scheme === "vmess") return parseVmess(value);
  if (scheme === "ss") return parseShadowsocks(value);

  if (!["vless", "trojan", "hysteria2", "hy2"].includes(scheme)) {
    throw new Error(`Неподдерживаемый URI: ${scheme || "unknown"}`);
  }

  const url = new URL(value);
  const params = url.searchParams;
  const host = url.hostname;
  const port = Number(url.port || 443);
  const name = safeDecode(url.hash.slice(1)) || host;
  const network = params.get("type") || "tcp";

  const security =
    params.get("security") ||
    (
      scheme === "trojan" ||
      scheme === "hysteria2" ||
      scheme === "hy2"
        ? "tls"
        : "none"
    );

  if (scheme === "vless") {
    const user = {
      id: safeDecode(url.username),
      encryption: params.get("encryption") || "none",
    };

    if (params.get("flow")) {
      user.flow = params.get("flow");
    }

    return {
      name,

      outbound: {
        protocol: "vless",
        settings: {
          vnext: [
            {
              address: host,
              port,
              users: [user],
            },
          ],
        },
        streamSettings: makeStreamSettings(
          network,
          security,
          params,
          host
        ),
      },
    };
  }

  if (scheme === "trojan") {
    return {
      name,

      outbound: {
        protocol: "trojan",
        settings: {
          servers: [
            {
              address: host,
              port,
              password: safeDecode(url.username),
            },
          ],
        },
        streamSettings: makeStreamSettings(
          network,
          security,
          params,
          host
        ),
      },
    };
  }

  return {
    name,

    outbound: {
      protocol: "hysteria",
      settings: {
        address: host,
        port,
        version: 2,
      },
      streamSettings: {
        network: "hysteria",
        hysteriaSettings: {
          version: 2,
          auth: safeDecode(url.username),
        },
        security: "tls",
        tlsSettings: {
          serverName: params.get("sni") || host,
          fingerprint: params.get("fp") || "chrome",
          alpn: params.get("alpn")
            ? params.get("alpn").split(",")
            : ["h3"],
          allowInsecure: params.get("insecure") === "1",
        },
      },
    },
  };
}

function isServiceOutbound(outbound) {
  const tag = String(outbound?.tag || "").toLowerCase();
  const protocol = String(outbound?.protocol || "").toLowerCase();

  return (
    ["direct", "block", "dns", "freedom", "blackhole"].includes(tag) ||
    ["freedom", "blackhole", "dns"].includes(protocol)
  );
}

function isTemplateNode(outbound) {
  return (
    typeof outbound?.tag === "string" &&
    /^node-/i.test(outbound.tag) &&
    !isServiceOutbound(outbound)
  );
}

function extractOutboundNodes(config, parentName = "") {
  const outbounds = Array.isArray(config?.outbounds)
    ? config.outbounds
    : [];

  const balancers = Array.isArray(config?.routing?.balancers)
    ? config.routing.balancers
    : [];

  const selectedTags = new Set();

  for (const balancer of balancers) {
    const selectors = Array.isArray(balancer.selector)
      ? balancer.selector
      : [];

    for (const outbound of outbounds) {
      if (
        !isServiceOutbound(outbound) &&
        typeof outbound?.tag === "string" &&
        selectors.some((selector) => outbound.tag.startsWith(selector))
      ) {
        selectedTags.add(outbound.tag);
      }
    }

    if (
      balancer.fallbackTag &&
      outbounds.some(
        (item) =>
          item?.tag === balancer.fallbackTag &&
          !isServiceOutbound(item)
      )
    ) {
      selectedTags.add(balancer.fallbackTag);
    }
  }

  const candidates = selectedTags.size
    ? outbounds.filter((outbound) => selectedTags.has(outbound.tag))
    : outbounds.filter(
        (outbound) =>
          outbound &&
          !isServiceOutbound(outbound) &&
          (outbound.protocol || outbound.settings)
      );

  return candidates.map((outbound) => ({
    outbound: structuredClone(outbound),
    name: String(
      outbound.remarks ||
      parentName ||
      outbound.tag ||
      outbound.protocol ||
      "server"
    ),
    sourceTag: String(outbound.tag || ""),
  }));
}

function parseSource(raw) {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      const result = [];

      for (const entry of parsed) {
        if (entry && Array.isArray(entry.outbounds)) {
          result.push(
            ...extractOutboundNodes(
              entry,
              entry.remarks || entry.name || ""
            )
          );
        } else if (
          entry &&
          entry.protocol &&
          !isServiceOutbound(entry)
        ) {
          result.push({
            outbound: structuredClone(entry),
            name: entry.remarks || entry.name || entry.tag || entry.protocol,
            sourceTag: String(entry.tag || ""),
          });
        }
      }

      return result;
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("JSON источника имеет неподдерживаемый формат");
    }

    return extractOutboundNodes(
      parsed,
      parsed.remarks || parsed.name || ""
    );
  }

  const nodes = [];

  for (const originalLine of trimmed.split(/\r?\n/u)) {
    const line = originalLine.trim();

    if (!line || hasSponsorMarker(line)) continue;

    if (
      !/^(vless|vmess|trojan|ss|hysteria2|hy2):\/\//i.test(line)
    ) {
      continue;
    }

    try {
      const parsed = parseUri(line);
      nodes.push({ ...parsed, sourceTag: "" });
    } catch (error) {
      console.warn(
        `Пропуск неподдерживаемой строки подписки: ${error.message}`
      );
    }
  }

  return nodes;
}

function primaryNodeOutbound(config) {
  const outbounds = Array.isArray(config?.outbounds)
    ? config.outbounds
    : [];

  return (
    outbounds.find(
      (outbound) =>
        outbound?.tag === "proxy" &&
        !isServiceOutbound(outbound)
    ) ||
    outbounds.find(
      (outbound) =>
        !isServiceOutbound(outbound) &&
        !isTemplateNode(outbound)
    )
  );
}

function makeIndividualConfig(template, selectedOutbound, sourceNodeTags) {
  const result = structuredClone(template);

  const keepOutbounds = (
    Array.isArray(result.outbounds) ? result.outbounds : []
  ).filter(
    (outbound) =>
      !isTemplateNode(outbound) &&
      !sourceNodeTags.has(outbound?.tag)
  );

  const selected = structuredClone(selectedOutbound);
  selected.tag = "proxy";

  result.outbounds = [
    selected,
    ...keepOutbounds.filter((outbound) => outbound.tag !== "proxy"),
  ];

  if (result.routing) {
    delete result.routing.balancers;

    if (Array.isArray(result.routing.rules)) {
      result.routing.rules = result.routing.rules.map((originalRule) => {
        const rule = structuredClone(originalRule);

        if (Object.hasOwn(rule, "balancerTag")) {
          delete rule.balancerTag;
          rule.outboundTag = "proxy";
        } else if (
          sourceNodeTags.has(rule.outboundTag) ||
          (
            typeof rule.outboundTag === "string" &&
            rule.outboundTag.startsWith("node-")
          )
        ) {
          rule.outboundTag = "proxy";
        }

        return rule;
      });
    }
  }

  if (result.observatory) {
    result.observatory.subjectSelector = ["proxy"];
  }

  if (result.burstObservatory) {
    result.burstObservatory.subjectSelector = ["proxy"];
  }

  return result;
}

function makeNodeId(country, index) {
  return `${country.slug}-${String(index).padStart(2, "0")}`;
}

function getPreviousManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { generated: [] };
  }

  try {
    const value = readJson(MANIFEST_PATH);

    return {
      generated: Array.isArray(value.generated)
        ? value.generated
        : [],
    };
  } catch {
    return { generated: [] };
  }
}

function getExistingMeta(id) {
  const file = path.join(FREE_DIR, `${id}.meta.json`);

  if (!fs.existsSync(file)) return null;

  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function clearLegacyFreeProfilesOnce() {
  // Первый запуск: старые нерабочие профили удаляются,
  // но auto.meta.json остаётся нетронутым.
  for (const file of fs.readdirSync(FREE_DIR)) {
    if (file === "auto.meta.json" || file === ".gitkeep") {
      continue;
    }

    if (file.endsWith(".json") || file.endsWith(".meta.json")) {
      const filePath = path.join(FREE_DIR, file);

      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
    }
  }
}

function removeStaleGenerated(previousIds, nextIds) {
  const keep = new Set(nextIds);

  for (const id of previousIds) {
    if (keep.has(id) || id === "auto") continue;

    for (const suffix of [".json", ".meta.json"]) {
      const file = path.join(FREE_DIR, `${id}${suffix}`);

      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  }
}

function cleanTemplateForAuto(template, nodes) {
  const auto = structuredClone(template);

  const supportOutbounds = (auto.outbounds || []).filter(
    (outbound) => !isTemplateNode(outbound)
  );

  const selectedNodes = [];
  const autoTags = [];

  for (const node of nodes) {
    if (
      !node.meta ||
      node.meta.enabled === false ||
      node.meta.auto === false ||
      hasSponsorMarker(node.meta.name)
    ) {
      continue;
    }

    const original = primaryNodeOutbound(node.config);

    if (!original) {
      console.warn(
        `Сервер ${node.id} не добавлен в AUTO: не найден proxy-outbound`
      );
      continue;
    }

    const tag = `node-${node.id}`;
    const outbound = structuredClone(original);
    outbound.tag = tag;

    selectedNodes.push(outbound);
    autoTags.push(tag);
  }

  if (autoTags.length === 0) {
    throw new Error(
      "Не осталось активных узлов с meta.auto=true для AUTO. auto.json не обновлён."
    );
  }

  auto.outbounds = [...selectedNodes, ...supportOutbounds];

  if (auto.routing) {
    const balancers = Array.isArray(auto.routing.balancers)
      ? auto.routing.balancers
      : [];

    let autoBalancer = balancers.find((item) => item.tag === "auto");

    if (!autoBalancer) {
      autoBalancer = {
        tag: "auto",
        selector: [],
        strategy: { type: "leastPing" },
      };

      auto.routing.balancers = [...balancers, autoBalancer];
    }

    autoBalancer.selector = autoTags;

    if (!autoTags.includes(autoBalancer.fallbackTag)) {
      autoBalancer.fallbackTag = autoTags[0];
    }
  } else {
    throw new Error(
      "В generator/templates/auto.json отсутствует routing; AUTO-шаблон не подходит."
    );
  }

  if (auto.observatory) {
    auto.observatory.subjectSelector = autoTags;
  }

  if (auto.burstObservatory) {
    auto.burstObservatory.subjectSelector = autoTags;
  }

  return { config: auto, autoTags };
}

function readFreeProfiles() {
  const files = fs.readdirSync(FREE_DIR).filter(
    (file) =>
      file.endsWith(".json") &&
      !file.endsWith(".meta.json") &&
      file !== "auto.json"
  );

  const profiles = [];

  for (const file of files) {
    const id = file.slice(0, -5);
    const configPath = path.join(FREE_DIR, file);
    const metaPath = path.join(FREE_DIR, `${id}.meta.json`);

    if (!fs.existsSync(metaPath)) {
      console.warn(`Пропущен ${file}: нет файла ${id}.meta.json`);
      continue;
    }

    try {
      const serverConfig = readJson(configPath);
      const meta = readJson(metaPath);

      if (
        meta.enabled === false ||
        hasSponsorMarker(meta.name)
      ) {
        continue;
      }

      serverConfig.remarks = meta.name || serverConfig.remarks || id;

      profiles.push({ id, config: serverConfig, meta });
    } catch (error) {
      console.warn(
        `Не удалось прочитать ${file}: ${error.message}`
      );
    }
  }

  return profiles;
}

function loadPremiumProfiles() {
  if (!fs.existsSync(PREMIUM_DIR)) return [];

  const files = fs.readdirSync(PREMIUM_DIR).filter(
    (file) =>
      file.endsWith(".json") &&
      !file.endsWith(".meta.json")
  );

  const profiles = [];

  for (const file of files) {
    const id = file.slice(0, -5);
    const metaPath = path.join(PREMIUM_DIR, `${id}.meta.json`);

    if (!fs.existsSync(metaPath)) continue;

    try {
      const meta = readJson(metaPath);

      if (
        meta.enabled === false ||
        hasSponsorMarker(meta.name)
      ) {
        continue;
      }

      const serverConfig = readJson(path.join(PREMIUM_DIR, file));
      serverConfig.remarks = meta.name || serverConfig.remarks || id;

      profiles.push({ id, config: serverConfig, meta });
    } catch (error) {
      console.warn(
        `Не удалось прочитать Premium ${file}: ${error.message}`
      );
    }
  }

  return profiles;
}

function sortProfiles(profiles, order = []) {
  const priorities = new Map(
    order.map((id, index) => [id, index])
  );

  return profiles.sort((a, b) => {
    const pa = priorities.has(a.id)
      ? priorities.get(a.id)
      : Number.MAX_SAFE_INTEGER;

    const pb = priorities.has(b.id)
      ? priorities.get(b.id)
      : Number.MAX_SAFE_INTEGER;

    return pa !== pb ? pa - pb : a.id.localeCompare(b.id);
  });
}

function getAutoMeta() {
  if (!fs.existsSync(AUTO_META_PATH)) {
    throw new Error(
      "Не найден servers/free/auto.meta.json. Этот файл нужно оставить в репозитории."
    );
  }

  const meta = readJson(AUTO_META_PATH);

  if (meta.enabled === false) {
    throw new Error(
      "servers/free/auto.meta.json имеет enabled=false; AUTO отключён."
    );
  }

  return meta;
}

async function main() {
  fs.mkdirSync(FREE_DIR, { recursive: true });
  fs.mkdirSync(PREMIUM_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (!fs.existsSync(AUTO_TEMPLATE_PATH)) {
    throw new Error(
      "Не найден generator/templates/auto.json. Перенеси туда текущий auto.json перед запуском."
    );
  }

  const template = readJson(AUTO_TEMPLATE_PATH);
  const autoMeta = getAutoMeta();

  const hadManifest = fs.existsSync(MANIFEST_PATH);
  const oldManifest = getPreviousManifest();

  // Сначала скачиваем и проверяем источник.
  // Если подписка недоступна или пустая, старые файлы не очищаются.
  const raw = await fetchSource();

  const sourceNodes = parseSource(raw).filter(
    (node) =>
      !hasSponsorMarker(node.name) &&
      !hasSponsorMarker(node.outbound)
  );

  if (sourceNodes.length === 0) {
    throw new Error(
      "В исходной подписке не найдено подходящих прокси-узлов. Файлы не очищены."
    );
  }

  // Однократная миграция старой папки.
  // Очищаем старые Free-конфиги, сохраняя auto.meta.json.
  // На следующих запусках удаляются только устаревшие созданные файлы.
  if (!hadManifest) {
    clearLegacyFreeProfilesOnce();
  }

  const templateTags = new Set(
    (template.outbounds || [])
      .filter(isTemplateNode)
      .map((outbound) => outbound.tag)
  );

  const countryCounts = new Map();
  const nextIds = [];
  const generated = [];
  const hashCounts = new Set();

  for (const sourceNode of sourceNodes) {
    const displaySource =
      `${sourceNode.name || ""} ${sourceNode.sourceTag || ""}`;

    const country = detectCountry(displaySource);
    const index = (countryCounts.get(country.code) || 0) + 1;

    countryCounts.set(country.code, index);

    const id = makeNodeId(country, index);
    const name = `${country.flag} ${country.name} №${index}`;

    const sourceHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(sourceNode.outbound))
      .digest("hex");

    if (hashCounts.has(sourceHash)) {
      console.log(`Дубликат узла пропущен: ${name}`);
      countryCounts.set(country.code, index - 1);
      continue;
    }

    hashCounts.add(sourceHash);

    // Сохраняем настройки enabled и auto на повторных запусках.
    const existingMeta = getExistingMeta(id);

    const meta = {
      id,
      name,
      country: country.code,
      tier: "free",
      enabled: existingMeta?.enabled !== false,
      auto: existingMeta?.auto !== false,
      generatedBy: "upstream",
      sourceHash,
    };

    const serverConfig = makeIndividualConfig(
      template,
      sourceNode.outbound,
      templateTags
    );

    serverConfig.remarks = name;

    writeJson(
      path.join(FREE_DIR, `${id}.json`),
      serverConfig
    );

    writeJson(
      path.join(FREE_DIR, `${id}.meta.json`),
      meta
    );

    nextIds.push(id);
    generated.push({ id, config: serverConfig, meta });
  }

  if (generated.length === 0) {
    throw new Error(
      "Все узлы были отфильтрованы. Генерация остановлена."
    );
  }

  // Удаляем устаревшие профили, созданные предыдущим запуском.
  removeStaleGenerated(oldManifest.generated, nextIds);

  writeJson(MANIFEST_PATH, { generated: nextIds });

  // Собираем все Free-серверы, которым разрешено участвовать в AUTO.
  const freeProfiles = readFreeProfiles();
  const allProfilesById = new Map(
    freeProfiles.map((profile) => [profile.id, profile])
  );

  for (const profile of generated) {
    allProfilesById.set(profile.id, profile);
  }

  const allProfiles = [...allProfilesById.values()];

  // AUTO создаётся заново из шаблона с актуальным набором узлов.
  const autoResult = cleanTemplateForAuto(template, allProfiles);
  const autoConfig = autoResult.config;

  autoConfig.remarks =
    autoMeta.name || "🇪🇺 ⚡ AUTO — САМЫЙ БЫСТРЫЙ";

  writeJson(AUTO_PATH, autoConfig);

  // Формируем итоговые подписки.
  const finalFreeProfiles = readFreeProfiles();

  finalFreeProfiles.push({
    id: "auto",
    config: autoConfig,
    meta: autoMeta,
  });

  const finalFree = sortProfiles(
    finalFreeProfiles,
    CONFIG.servers?.freeOrder || []
  );

  const premium = sortProfiles(
    loadPremiumProfiles(),
    CONFIG.servers?.premiumOrder || []
  );

  writeJson(
    path.join(OUTPUT_DIR, "free.json"),
    finalFree.map((item) => item.config)
  );

  writeJson(
    path.join(OUTPUT_DIR, "premium.json"),
    premium.map((item) => item.config)
  );

  console.log(`Создано узлов из источника: ${generated.length}`);
  console.log(`Узлов включено в AUTO: ${autoResult.autoTags.length}`);
  console.log(`Free-профилей в подписке: ${finalFree.length}`);
  console.log(`Premium-профилей в подписке: ${premium.length}`);
  console.log("Генерация завершена.");
}

main().catch((error) => {
  console.error(`Ошибка генерации: ${error.message}`);
  process.exitCode = 1;
});
