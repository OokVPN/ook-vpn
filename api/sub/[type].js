import fs from "node:fs";
import path from "node:path";
import { getTokenInfo } from "../lib/tokens.js";

const TEST_UPLOAD_BYTES =
  Number(process.env.TEST_UPLOAD_BYTES || 0);

const TEST_DOWNLOAD_BYTES =
  Number(process.env.TEST_DOWNLOAD_BYTES || 0);

const TEST_TOTAL_BYTES =
  Number(process.env.TEST_TOTAL_BYTES || 0);

const TEST_EXPIRE =
  Number(
    process.env.TEST_EXPIRE ||
    Math.floor(
      new Date("3026-01-01T00:00:00Z").getTime() / 1000
    )
  );

function toBase64(value) {
  return Buffer
    .from(value, "utf8")
    .toString("base64");
}

function getProfileTitle(type) {
  return type === "premium"
    ? "OokVPN Premium"
    : "OokVPN Free";
}

function getAnnounce() {
  return [
    "Не работает? Нажмите 🔄 и проверьте еще раз!",
    "",
    "v2.0"
  ].join("\n");
}

export default async function handler(req, res) {
  const { type } = req.query;
  const token = req.query.token;

  if (type !== "free" && type !== "premium") {
    return res.status(404).json({
      error: "Subscription not found"
    });
  }

  if (!token) {
    return res.status(401).json({
      error: "Token required"
    });
  }

  try {
    const tokenInfo =
      await getTokenInfo(token);

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

    const content =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    const expire =
      tokenInfo.subscription_expires_at
        ? Math.floor(
            new Date(
              tokenInfo.subscription_expires_at
            ).getTime() / 1000
          )
        : TEST_EXPIRE;

    const subscriptionUserinfo =
      [
        `upload=${TEST_UPLOAD_BYTES}`,
        `download=${TEST_DOWNLOAD_BYTES}`,
        `total=${TEST_TOTAL_BYTES}`,
        `expire=${expire}`
      ].join("; ");

    const profileTitle =
      `base64:${toBase64(
        getProfileTitle(type)
      )}`;

    const announce =
      `base64:${toBase64(
        getAnnounce()
      )}`;

    res.setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
      "Subscription-Userinfo",
      subscriptionUserinfo
    );

    res.setHeader(
      "Profile-Update-Interval",
      "1"
    );

    res.setHeader(
      "Profile-Title",
      profileTitle
    );

    res.setHeader(
      "Announce",
      announce
    );

    if (req.method === "HEAD") {
      return res.status(200).end();
    }

    return res.status(200).send(content);
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
