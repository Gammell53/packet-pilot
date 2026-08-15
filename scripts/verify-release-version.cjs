#!/usr/bin/env node
"use strict";

const path = require("node:path");

function validateReleaseVersion(tag, packageVersion) {
  const expectedTag = `v${packageVersion}`;
  if (tag !== expectedTag) {
    throw new Error(
      tag.startsWith("v")
        ? `Release tag ${tag} does not match package version ${packageVersion} (${expectedTag}).`
        : `Release tag must be ${expectedTag}; received ${tag || "an empty value"}.`,
    );
  }
}

if (require.main === module) {
  const packageJson = require(path.resolve(__dirname, "../package.json"));
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME || "";
  try {
    validateReleaseVersion(tag, packageJson.version);
    console.log(`Release tag ${tag} matches package version ${packageJson.version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { validateReleaseVersion };
