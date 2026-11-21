import fs from "node:fs";
import path from "node:path";

// Every file is read through a literal path.join(process.cwd(), "...") so that
// Vercel includes it in the serverless function bundle.
function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")
  );
}

export function getConfig() {
  return readJson(path.join(process.cwd(), "config.json"));
}

export function getPlans() {
  return readJson(path.join(process.cwd(), "plan.json"));
}

export function getRouting() {
  return readJson(path.join(process.cwd(), "routing.json"));
}

export function getMaintenanceConfig() {
  return getStub("maintenance");
}

// Built-in copies, used only if a file in stubs/ cannot be read (missing,
// not bundled by Vercel, broken JSON). A stub must never turn into a 500:
// the real reason is written to the log instead.
const BUILTIN_REMARKS = {
  maintenance: "☀ Ведутся технические работы",
  removed: "☀ Вас исключили из подписки",
  limit: "☀ Исчерпан лимит устройств"
};

function builtinStub(name) {
  return {
    log: { loglevel: "warning" },
    inbounds: [
      {
        listen: "127.0.0.1",
        port: 10808,
        protocol: "socks",
        settings: { auth: "noauth", udp: true },
        tag: "socks"
      }
    ],
    outbounds: [
      {
        protocol: "vless",
        settings: {
          vnext: [
            {
              address: "0000",
              port: 0,
              users: [
                {
                  id: "00000000-0000-0000-0000-000000000000",
                  encryption: "none"
                }
              ]
            }
          ]
        },
        streamSettings: { network: "tcp", security: "none" },
        tag: "proxy"
      },
      { protocol: "freedom", tag: "direct" },
      { protocol: "blackhole", tag: "block" }
    ],
    remarks: BUILTIN_REMARKS[name]
  };
}

export function getStub(name) {
  if (!(name in BUILTIN_REMARKS)) {
    throw new Error(`Unknown stub: ${name}`);
  }

  try {
    switch (name) {
      case "maintenance":
        return readJson(
          path.join(process.cwd(), "stubs", "maintenance.json")
        );
      case "removed":
        return readJson(
          path.join(process.cwd(), "stubs", "device-removed.json")
        );
      default:
        return readJson(
          path.join(process.cwd(), "stubs", "device-limit.json")
        );
    }
  } catch (error) {
    console.error(
      `Stub "${name}" could not be read from stubs/, using the built-in one:`,
      error.message
    );

    return builtinStub(name);
  }
}

// Project-wide texts and defaults used by the bot, with safe fallbacks.
export function getProject() {
  const config = getConfig();
  const project = config.project || {};

  return {
    name: project.name || "ClearanceVPN",
    support: project.support || "@Clearance_vpn",
    channel: project.channel || project.support || "@Clearance_vpn"
  };
}

export function getDefaults() {
  const defaults = getConfig().defaults || {};

  return {
    plan: defaults.plan || "free",
    source: defaults.source || "free"
  };
}

export function getDeviceSettings() {
  const devices = getConfig().devices || {};

  return {
    requireHwid: devices.requireHwid !== false,
    touchIntervalSeconds: Number(devices.touchIntervalSeconds ?? 300)
  };
}
