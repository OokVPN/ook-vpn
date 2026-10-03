import db from "./db.js";

export default async function handler(req, res) {
  try {
    const result = await db.execute("SELECT 1 AS ok");

    return res.status(200).json({
      success: true,
      database: result.rows[0].ok === 1
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Database connection failed"
    });
  }
}
