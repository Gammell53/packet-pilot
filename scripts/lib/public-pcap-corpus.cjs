const fs = require("node:fs");
const path = require("node:path");

const PUBLIC_PCAP_MANIFEST_PATH = path.resolve("e2e", "corpora", "public-pcaps.json");
const PUBLIC_PCAP_CACHE_DIR = path.resolve("test-results", "public-pcaps");

function loadPublicPcapManifest() {
  return JSON.parse(fs.readFileSync(PUBLIC_PCAP_MANIFEST_PATH, "utf8"));
}

function getPublicPcapEntries(manifest = loadPublicPcapManifest()) {
  return Object.entries(manifest.captures || {}).map(([id, capture]) => ({
    id,
    ...capture,
  }));
}

function resolvePublicPcapEntries(ids, manifest = loadPublicPcapManifest()) {
  const entries = getPublicPcapEntries(manifest);
  if (!ids || ids.length === 0) {
    return entries;
  }

  const requested = new Set(ids.map((value) => String(value).trim()).filter(Boolean));
  const selected = entries.filter((entry) => requested.has(entry.id));
  const found = new Set(selected.map((entry) => entry.id));
  const missing = [...requested].filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new Error(`Unknown public pcap id(s): ${missing.join(", ")}`);
  }

  return selected;
}

function getPublicPcapLocalPath(entry) {
  return path.join(PUBLIC_PCAP_CACHE_DIR, entry.localFileName);
}

function getPublicPcapStatus(entry) {
  const localPath = getPublicPcapLocalPath(entry);
  return {
    localPath,
    exists: fs.existsSync(localPath),
  };
}

async function downloadPublicPcap(entry) {
  const targetPath = getPublicPcapLocalPath(entry);
  if (fs.existsSync(targetPath)) {
    return {
      id: entry.id,
      title: entry.title,
      localPath: targetPath,
      downloaded: false,
      sizeBytes: fs.statSync(targetPath).size,
    };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const response = await fetch(entry.downloadUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download ${entry.id}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, targetPath);

  return {
    id: entry.id,
    title: entry.title,
    localPath: targetPath,
    downloaded: true,
    sizeBytes: buffer.length,
  };
}

async function syncPublicPcaps(ids, manifest = loadPublicPcapManifest()) {
  const selected = resolvePublicPcapEntries(ids, manifest);
  const results = [];

  for (const entry of selected) {
    results.push(await downloadPublicPcap(entry));
  }

  return results;
}

module.exports = {
  PUBLIC_PCAP_CACHE_DIR,
  PUBLIC_PCAP_MANIFEST_PATH,
  loadPublicPcapManifest,
  getPublicPcapEntries,
  resolvePublicPcapEntries,
  getPublicPcapLocalPath,
  getPublicPcapStatus,
  downloadPublicPcap,
  syncPublicPcaps,
};
