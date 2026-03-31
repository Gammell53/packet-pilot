import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const compiledMain = join(projectRoot, ".electron", "electron", "main.cjs");

function run(command, args, options = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options,
  });
}

async function waitForPort(port) {
  for (;;) {
    const ready = await new Promise((resolve) => {
      const socket = net.createConnection(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });

    if (ready) {
      return;
    }

    await delay(250);
  }
}

async function waitForFile(path) {
  while (!existsSync(path)) {
    await delay(250);
  }
}

const vite = run("npm", ["run", "dev:renderer"]);
const tsc = run("npm", ["run", "dev:main"]);
let electron = null;

const shutdown = () => {
  vite.kill();
  tsc.kill();
  electron?.kill();
};

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

await Promise.all([waitForPort(1420), waitForFile(compiledMain)]);

const electronBinary = require("electron");
electron = run(electronBinary, [compiledMain], {
  env: {
    ...process.env,
    PACKET_PILOT_RENDERER_URL: "http://127.0.0.1:1420",
  },
});

electron.on("exit", (code) => {
  if (code && code !== 0) {
    process.exit(code);
  }
});
