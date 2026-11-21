import { ensureSchema } from "../lib/schema.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const secret = process.env.MIGRATION_SECRET;

  if (!secret || req.query.secret !== secret) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  try {
    const report = await ensureSchema();

    return res.status(200).json({
      ok: report.indexes.every(index => index.ok),
      ...report
    });
  } catch (error) {
    console.error("Migration error:", error);

    return res.status(500).json({
      error: "Migration failed",
      message: error.message
    });
  }
}
