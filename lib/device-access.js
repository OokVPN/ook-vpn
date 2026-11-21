import {
  findDeviceByHwid,
  createDevice,
  touchDevice,
  getDeviceCount
} from "./devices.js";

// Header sent by the client app (Happ and similar) with every
// subscription request. Anything that does not look like an id is ignored.
export function getHwid(headers) {
  const raw = headers["x-hwid"];
  const value = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim();

  return /^[\x21-\x7E]{4,128}$/.test(value) ? value : null;
}

function clean(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function header(headers, name) {
  const raw = headers[name];
  return clean(Array.isArray(raw) ? raw[0] : raw);
}

// "iPhone15,2 (iOS 18.1)" or the app's User-Agent; null when the client
// sent nothing usable (then a stored name is never overwritten).
export function getDeviceName(headers) {
  const model = header(headers, "x-device-model");
  const os = header(headers, "x-device-os");
  const version = header(headers, "x-ver-os");

  const system = [os, version].filter(Boolean).join(" ");

  let name = "";

  if (model && system) {
    name = `${model} (${system})`;
  } else {
    name = model || system || header(headers, "user-agent");
  }

  return name ? name.slice(0, 60) : null;
}

// SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" (UTC, no zone);
// we store ISO strings. Accept both.
export function parseDbDate(value) {
  if (!value) {
    return null;
  }

  const text = String(value);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(text)
    ? text
    : `${text.replace(" ", "T")}Z`;

  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Registers or refreshes the device and decides what it may receive:
 *   "removed" - the user deleted this device in the bot
 *   "limit"   - more active devices than the plan allows (every device)
 *   "ok"      - normal subscription
 * limit === -1 means unlimited.
 */
export async function checkDeviceAccess({
  userId,
  hwid,
  name,
  limit,
  touchIntervalSeconds = 300
}) {
  let device = await findDeviceByHwid(userId, hwid);

  if (!device) {
    await createDevice(
      userId,
      hwid,
      name || `Устройство ${hwid.slice(0, 6)}`
    );
    device = await findDeviceByHwid(userId, hwid);
  } else {
    const lastSeen = parseDbDate(device.last_seen);
    const stale =
      !lastSeen ||
      Date.now() - lastSeen.getTime() >=
        touchIntervalSeconds * 1000;

    const renamed = name && name !== device.name;

    // Write only when needed: every write costs a Turso row write.
    if (stale || renamed) {
      await touchDevice(device.id, renamed ? name : null);
    }
  }

  if (device.status === "removed") {
    return { decision: "removed", device };
  }

  if (limit !== -1) {
    const count = await getDeviceCount(userId);

    if (count > limit) {
      return { decision: "limit", device, count, limit };
    }
  }

  return { decision: "ok", device };
}
