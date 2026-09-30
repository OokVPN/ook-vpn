import fs from "node:fs";
import path from "node:path";

export default function handler(req, res) {
  const { type } = req.query;

  if (type !== "free" && type !== "premium") {
    return res.status(404).json({
      error: "Subscription not found"
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
    "no-store"
  );

  return res.status(200).send(content);
}
