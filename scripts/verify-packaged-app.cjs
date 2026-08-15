#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { listPackage } = require("@electron/asar");

function defaultPackagedPath() {
  if (process.platform === "darwin") {
    return path.resolve(
      "dist",
      process.arch === "arm64" ? "mac-arm64" : "mac",
      "PacketPilot.app",
    );
  }

  if (process.platform === "win32") {
    return path.resolve("dist", "win-unpacked");
  }

  if (process.platform === "linux") {
    return path.resolve("dist", "linux-unpacked");
  }

  throw new Error(`Unsupported packaged-app verification platform: ${process.platform}`);
}

const packagedPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultPackagedPath();
const resourcesPath = packagedPath.endsWith(".asar")
  ? null
  : process.platform === "darwin" || packagedPath.endsWith(".app")
    ? path.join(packagedPath, "Contents", "Resources")
    : path.join(packagedPath, "resources");
const asarPath = packagedPath.endsWith(".asar")
  ? packagedPath
  : path.join(resourcesPath, "app.asar");

if (!fs.existsSync(asarPath)) {
  throw new Error(`Packaged app archive not found: ${asarPath}`);
}

const entries = listPackage(asarPath);
const nestedBuildArtifacts = entries.filter((entry) =>
  /^\/dist\/(?:mac(?:-[^/]+)?|win(?:-[^/]+)?|linux(?:-[^/]+)?)\//.test(entry),
);

if (nestedBuildArtifacts.length > 0) {
  throw new Error(
    `Packaged app recursively contains desktop build output (first match: ${nestedBuildArtifacts[0]})`,
  );
}

if (!entries.includes("/dist/renderer/index.html")) {
  throw new Error("Packaged renderer entry is missing from app.asar");
}

if (resourcesPath) {
  const resourceEntries = fs.readdirSync(resourcesPath);
  const bundledSharkd = resourceEntries.filter((entry) => /^sharkd(?:-|\.|$)/i.test(entry));

  if (process.platform === "darwin" && bundledSharkd.length > 0) {
    throw new Error(
      `macOS package unexpectedly contains a partial sharkd payload: ${bundledSharkd.join(", ")}`,
    );
  }

  if (process.platform === "linux") {
    const executable = bundledSharkd.find((entry) => /^sharkd-(?:x86_64|aarch64)-unknown-linux-gnu$/.test(entry));
    if (!executable) {
      throw new Error("Linux package is missing its bundled sharkd executable");
    }
    fs.accessSync(path.join(resourcesPath, executable), fs.constants.X_OK);
  }

  if (process.platform === "win32") {
    const executable = bundledSharkd.find((entry) => /^sharkd(?:-x86_64-pc-windows-msvc)?\.exe$/i.test(entry));
    if (!executable) {
      throw new Error("Windows package is missing its bundled sharkd executable");
    }
  }
}

console.log(`Packaged app structure verified: ${packagedPath}`);
