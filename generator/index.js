import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const configPath = path.join(root, "config.json");
const config = JSON.parse(
  fs.readFileSync(configPath, "utf8")
);

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
    .filter(
      file =>
        file.endsWith(".json") &&
        !file.endsWith(".meta.json")
    );
}

function loadServers(tier) {
  const relativePath = config.servers[`${tier}Path`];

  const directory = path.join(root, relativePath);
  const files = getJsonFiles(directory);
  const servers = [];

  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const configFile = path.join(directory, file);

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
      metaPath = fs.existsSync(freeMetaPath)
        ? freeMetaPath
        : premiumMetaPath;
    }

    if (!fs.existsSync(metaPath)) {
      console.warn(`Missing metadata for: ${tier}/${file}`);
      continue;
    }

    try {
      const serverConfig = readJson(configFile);
      const meta = readJson(metaPath);

      if (meta.enabled === false) {
        continue;
      }

      serverConfig.remarks = meta.name;

      servers.push({
        id,
        config: serverConfig
      });
    } catch (error) {
      console.error(
        `Failed to load ${tier}/${file}: ${error.message}`
      );
    }
  }

  return servers;
}

function sortServers(servers, order = []) {
  const priorities = new Map(
    order.map((id, index) => [id, index])
  );

  return servers.sort((a, b) => {
    const priorityA = priorities.has(a.id)
      ? priorities.get(a.id)
      : Infinity;

    const priorityB = priorities.has(b.id)
      ? priorities.get(b.id)
      : Infinity;

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    return a.id.localeCompare(b.id);
  });
}

function saveOutput(filename, servers) {
  const outputFile = path.join(outputPath, filename);

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      servers.map(server => server.config),
      null,
      2
    ),
    "utf8"
  );
}

fs.mkdirSync(outputPath, { recursive: true });

const freeServers = sortServers(
  loadServers("free"),
  config.servers.freeOrder || []
);

const premiumServers = sortServers(
  loadServers("premium"),
  config.servers.premiumOrder || []
);

saveOutput("free.json", freeServers);
saveOutput("premium.json", premiumServers);

console.log(
  `Free order: ${freeServers
    .map(server => server.id)
    .join(", ")}`
);

console.log(
  `Premium order: ${premiumServers
    .map(server => server.id)
    .join(", ")}`
);

console.log("Generation completed.");
