import fs from "node:fs";
import path from "node:path";
import { getTokenInfo } from "../lib/tokens.js";

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
    const tokenInfo = await getTokenInfo(token);

    if (!tokenInfo) {
      return res.status(401).json({
        error: "Invalid or expired token"
      });
    }

    if (tokenInfo.plan !== type) {
      return res.status(403).json({
        error: "Token does not have access to this subscription"
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

    const content = fs.readFileSync(filePath, "utf8");

    res.setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    return res.status(200).send(content);
  } catch (error) {
    console.error("Subscription API error:", error);

    return res.status(500).json({
      error: "Internal server error"
    });
  }
}
