import db from "./db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    await db.execute(`
      ALTER TABLE devices
      ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    `);

    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    if (
      error.message.includes(
        "duplicate column name"
      )
    ) {
      return res.status(200).json({
        ok: true,
        message: "Column already exists"
      });
    }

    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
