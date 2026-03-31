#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const dir = path.join(__dirname, "tests");
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.cjs"))
  .map((f) => path.join(dir, f));

if (files.length === 0) {
  console.error("No test files found in", dir);
  process.exit(1);
}

execSync("node --test " + files.join(" "), { stdio: "inherit" });
