#!/usr/bin/env node

const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  loadPublicPcapManifest,
  getPublicPcapEntries,
  resolvePublicPcapEntries,
  getPublicPcapStatus,
  getPublicPcapLocalPath,
  syncPublicPcaps,
} = require("./lib/public-pcap-corpus.cjs");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command: command || "list",
    id: null,
    ids: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];

    if (value === "--id") {
      options.id = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === "--ids") {
      const raw = rest[index + 1] || "";
      options.ids = raw.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    }
  }

  return options;
}

function formatSize(sizeBytes) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${sizeBytes} B`;
}

function printStarterPrompts(entry) {
  if (!Array.isArray(entry.starterPrompts) || entry.starterPrompts.length === 0) {
    return;
  }

  console.log("");
  console.log("Starter prompts:");
  for (const prompt of entry.starterPrompts) {
    console.log(`- ${prompt}`);
  }
}

async function runList() {
  const manifest = loadPublicPcapManifest();
  const entries = getPublicPcapEntries(manifest);
  console.log(`Public PCAP corpus: ${entries.length} captures`);

  for (const entry of entries) {
    const status = getPublicPcapStatus(entry);
    console.log(
      `${status.exists ? "downloaded" : "missing   "}  ${entry.id}  [${entry.category}]  ${entry.title}`,
    );
    console.log(`  source: ${entry.sourcePage}`);
    console.log(`  local:  ${status.localPath}`);
  }
}

async function runSync(ids) {
  const results = await syncPublicPcaps(ids);
  let downloadedCount = 0;

  for (const result of results) {
    if (result.downloaded) {
      downloadedCount += 1;
    }

    console.log(
      `${result.downloaded ? "downloaded" : "cached    "}  ${result.id}  ${formatSize(result.sizeBytes)}  ${result.localPath}`,
    );
  }

  console.log("");
  console.log(`Synced ${results.length} public capture(s); downloaded ${downloadedCount}.`);
}

async function runOpen(id) {
  if (!id) {
    throw new Error("corpus:open requires --id <capture-id>");
  }

  const manifest = loadPublicPcapManifest();
  const [entry] = resolvePublicPcapEntries([id], manifest);
  await syncPublicPcaps([id], manifest);
  const capturePath = getPublicPcapLocalPath(entry);

  console.log(`Opening ${entry.id}: ${entry.title}`);
  console.log(`Local capture: ${capturePath}`);
  printStarterPrompts(entry);
  console.log("");
  console.log("Launching PacketPilot dev app with the sample preloaded...");

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd: path.resolve("."),
    stdio: "inherit",
    env: {
      ...process.env,
      PACKET_PILOT_OPEN_CAPTURE: capturePath,
    },
  });

  child.once("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

  child.once("exit", (code) => {
    process.exit(code ?? 0);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  switch (options.command) {
    case "list":
      await runList();
      return;
    case "sync":
      await runSync(options.ids);
      return;
    case "open":
      await runOpen(options.id);
      return;
    default:
      throw new Error(`Unknown public pcap corpus command: ${options.command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
