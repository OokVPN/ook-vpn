import fs from "node:fs";
import path from "node:path";
import { getTokenInfo } from "../../lib/tokens.js";
import {
  getConfig,
  getMaintenanceConfig,
  getRouting,
  getStub,
  getDeviceSettings
} from "../../lib/config.js";
import { resolvePlan } from "../../lib/plans.js";
import {
  checkDeviceAccess,
  getDeviceName,
  getHwid
} from "../../lib/device-access.js";

const TEST_EXPIRE =
  Number(
    process.env.TEST_EXPIRE ||
    Math.floor(
      new Date("3026-01-01T00:00:00Z").getTime() / 1000
    )
  );

const SUPPORT_URL = "https://telegram.me/Clearance_vpn";
const PROFILE_WEB_PAGE_URL = "https://clearance-vpn.duckdns.org";

function toBase64(value) {
  return Buffer
    .from(value, "utf8")
    .toString("base64");
}

function getProfileTitle(type) {
  return type === "premium"
    ? "ClearanceVPN Premium ☀"
    : "ClearanceVPN Free ☀";
}

function getAnnounce() {
  return [
    "Подписка от Clearance-vpn! ☀",
    "Трафик – безлимитный ♾",
    "",
    "v1.0"
  ].join("\n");
}

function getRoutingHeader() {
  const encodedProfile = toBase64(
    JSON.stringify(getRouting())
  );

  return `happ://routing/onadd/${encodedProfile}`;
}

function getClientIp(req) {
  const forwarded =
    req.headers["x-vercel-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.headers["x-forwarded-for"];

  if (forwarded) {
    return String(forwarded)
      .split(",")[0]
      .trim()
      .replace(/^::ffff:/, "");
  }

  return (req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

function getAllowedIps(config) {
  const fromEnv = process.env.MAINTENANCE_ALLOWED_IPS;

  if (fromEnv) {
    return fromEnv
      .split(",")
      .map(ip => ip.trim())
      .filter(Boolean);
  }

  return Array.isArray(config.maintenanceAllowedIps)
    ? config.maintenanceAllowedIps
    : [];
}

// Maintenance: everyone except the allowed IPs gets a single
// "technical works" server instead of the real subscription.
function getMaintenancePayload(config, clientIp) {
  if (config.maintenance !== true) {
    return null;
  }

  if (getAllowedIps(config).includes(clientIp)) {
    return null;
  }

  return JSON.stringify([getMaintenanceConfig()], null, 2) + "\n";
}

function sendSubscription(req, res, {
  type,
  content,
  expire
}) {
  // Only the expiry date is reported; no traffic counter.
  const subscriptionUserinfo = `expire=${expire}`;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");

  res.setHeader(
    "Subscription-Userinfo",
    subscriptionUserinfo
  );

  res.setHeader("Profile-Update-Interval", "1");

  res.setHeader(
    "Profile-Title",
    `base64:${toBase64(getProfileTitle(type))}`
  );

  res.setHeader(
    "Announce",
    `base64:${toBase64(getAnnounce())}`
  );

  res.setHeader("support-url", SUPPORT_URL);
  res.setHeader("profile-web-page-url", PROFILE_WEB_PAGE_URL);

  res.setHeader("routing", getRoutingHeader());

  if (req.method === "HEAD") {
    return res.status(200).end();
  }

  return res.status(200).send(content);
}

function stubContent(name) {
  return JSON.stringify([getStub(name)], null, 2) + "\n";
}

export default async function handler(req, res) {
  const { type } = req.query;
  const token = req.query.token;

  if (type !== "free" && type !== "premium") {
    return res.status(404).json({
      error: "Subscription not found"
    });
  }


  try {
    const config = getConfig();
    const clientIp = getClientIp(req);
    const maintenancePayload =
      getMaintenancePayload(config, clientIp);

    if (maintenancePayload) {
      res.setHeader(
        "X-Detected-IP",
        clientIp || "unknown"
      );

      return sendSubscription(req, res, {
        type,
        content: maintenancePayload,
        expire: TEST_EXPIRE
      });
    }
  } catch (error) {
    console.error("Maintenance check error:", error);

    return res.status(500).json({
      error: "Internal server error"
    });
  }

  if (!token) {
    return res.status(401).json({
      error: "Token required"
    });
  }

  try {
    const tokenInfo = await getTokenInfo(token);

    if (!tokenInfo) {
      return res.status(401).json({
        error: "Invalid or expired token"
      });
    }

    if (tokenInfo.plan !== type) {
      return res.status(403).json({
        error:
          "Token does not have access to this subscription"
      });
    }

    const expire = tokenInfo.subscription_expires_at
      ? Math.floor(
          new Date(
            tokenInfo.subscription_expires_at
          ).getTime() / 1000
        )
      : TEST_EXPIRE;

    // Device manager (x-hwid). HEAD probes are not devices.
    if (req.method !== "HEAD") {
      const settings = getDeviceSettings();
      const hwid = getHwid(req.headers);

      if (!hwid) {
        if (settings.requireHwid) {
          return res.status(403).json({
            error: "Device ID (x-hwid) is required"
          });
        }
      } else {
        const plan = resolvePlan({
          plan: tokenInfo.plan,
          source: tokenInfo.source
        });

        const access = await checkDeviceAccess({
          userId: tokenInfo.user_id,
          hwid,
          name: getDeviceName(req.headers),
          limit: plan.devices,
          touchIntervalSeconds: settings.touchIntervalSeconds
        });

        if (access.decision !== "ok") {
          return sendSubscription(req, res, {
            type,
            content: stubContent(access.decision),
            expire
          });
        }
      }
    }

    const filePath = path.join(
      process.cwd(),
      "output",
      `${type}.json`
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: "Subscription file not found"
      });
    }

    const content = fs.readFileSync(
      filePath,
      "utf8"
    );

    return sendSubscription(req, res, {
      type,
      content,
      expire
    });
  } catch (error) {
    console.error(
      "Subscription API error:",
      error
    );

    return res.status(500).json({
      error: "Internal server error"
    });
  }
}
