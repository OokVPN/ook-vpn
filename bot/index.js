import fs from "node:fs";
import path from "node:path";
import { handleStart } from "./handlers/start.js";

function getConfig() {
  const configPath = path.join(
    process.cwd(),
    "config.json"
  );

  return JSON.parse(
    fs.readFileSync(configPath, "utf8")
  );
}

export async function handleUpdate(update) {
  if (!update?.message) {
    return;
  }

  const config = getConfig();

  if (update.message.text === "/start") {
    await handleStart(
      update.message,
      config.maintenance
    );
  }
}
