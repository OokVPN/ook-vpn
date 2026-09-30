import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const serversPath = path.join(root, "servers");
const outputPath = path.join(root, "output");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getJsonFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter(file =>
      file.endsWith(".json") &&
      !file.endsWith(".meta.json")
    );
}

function loadServers(tier) {
  const directory = path.join(serversPath, tier);
  const files = getJsonFiles(directory);

  const servers = [];

  for (const file of files) {
    const id = file.replace(".json", "");

    const configPath = path.join(directory, file);

    const freeMetaPath = path.join(
      serversPath,
      "free",
      `${id}.meta.json`
    );

    const premiumMetaPath = path.join(
      serversPath,
      "premium",
      `${id}.meta.json`
    );

    let metaPath;

    if (tier === "free") {
      metaPath = freeMetaPath;
    } else {
      if (fs.existsSync(freeMetaPath)) {
        metaPath = freeMetaPath;
      } else {
        metaPath = premiumMetaPath;
      }
    }

    if (!fs.existsSync(metaPath)) {
      console.warn(
        `Missing metadata for: ${tier}/${file}`
      );
      continue;
    }

    try {
      const config = readJson(configPath);
      const meta = readJson(metaPath);

      if (meta.enabled === false) {
        continue;
      }

      servers.push({
        id: meta.id ?? id,
        name: meta.name,
        country: meta.country,
        tier: meta.tier ?? tier,
        config
      });
    } catch (error) {
      console.error(
        `Failed to load ${tier}/${file}: ${error.message}`
      );
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
