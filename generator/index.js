import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const freePath = path.join(root, "servers", "free");
const premiumPath = path.join(root, "servers", "premium");

function getJsonFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter(file => file.endsWith(".json"));
}

const freeServers = getJsonFiles(freePath);
const premiumServers = getJsonFiles(premiumPath);

console.log(`Free servers: ${freeServers.length}`);
console.log(`Premium servers: ${premiumServers.length}`);
