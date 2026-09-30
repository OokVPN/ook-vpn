import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const serversPath = path.join(root, "servers");
const outputPath = path.join(root, "output");

function loadServers(tier) {
  const directory = path.join(serversPath, tier);

  if (!fs.existsSync(directory)) {
    return [];
  }

  const files = fs
    .readdirSync(directory)
    .filter(file => file.endsWith(".json") && !file.endsWith(".meta.json"));

  const servers = [];

  for (const file of files) {
    const id = file.replace(".json", "");
    const configPath = path.join(directory, file);
    const metaPath = path.join(directory, `${id}.meta.json`);

    if (!fs.existsSync(metaPath)) {
      console.warn(`Missing metadata: ${id}.meta.json`);
      continue;
    }

    try {
      const config = JSON.parse(
        fs.readFileSync(configPath, "utf8")
      );

      const meta = JSON.parse(
        fs.readFileSync(metaPath, "utf8")
      );

      if (meta.enabled === false) {
        continue;
      }

      servers.push({
        id: meta.id,
        name: meta.name,
        country: meta.country,
        tier: meta.tier,
        config
      });
    } catch (error) {
      console.error(`Failed to load ${file}:`, error.message);
    }
  }

  return servers;
}

function saveOutput(filename, servers) {
  const outputFile = path.join(outputPath, filename);

  fs.writeFileSync(
    outputFile,
    JSON.stringify(servers, null, 2),
    "utf8"
  );
}

fs.mkdirSync(outputPath, { recursive: true });

const freeServers = loadServers("free");
const premiumServers = loadServers("premium");

saveOutput("free.json", freeServers);
saveOutput("premium.json", premiumServers);

console.log(`Free servers: ${freeServers.length}`);
console.log(`Premium servers: ${premiumServers.length}`);
console.log("Generation completed.");
