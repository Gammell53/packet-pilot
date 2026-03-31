#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

missing=0

require_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    printf "[ok] %s\n" "$cmd"
  else
    printf "[missing] %s\n" "$cmd"
    missing=1
  fi
}

printf "Checking PacketPilot multi-agent prerequisites...\n"
require_cmd node
require_cmd npm
require_cmd python3
require_cmd codex

if [ -f "$ROOT_DIR/package.json" ]; then
  printf "[ok] package.json found\n"
else
  printf "[missing] package.json not found\n"
  missing=1
fi

if [ -f "$ROOT_DIR/electron/main.cts" ]; then
  printf "[ok] electron/main.cts found\n"
else
  printf "[missing] electron/main.cts not found\n"
  missing=1
fi

if [ -f "$ROOT_DIR/shared/electron-api.ts" ]; then
  printf "[ok] shared/electron-api.ts found\n"
else
  printf "[missing] shared/electron-api.ts not found\n"
  missing=1
fi

if [ -f "$ROOT_DIR/sidecar/pyproject.toml" ]; then
  printf "[ok] sidecar/pyproject.toml found\n"
else
  printf "[warn] sidecar/pyproject.toml not found\n"
  printf "       Sidecar work is optional for Electron-only tasks.\n"
fi

if command -v codex >/dev/null 2>&1; then
  if codex mcp list 2>/dev/null | grep -q "claw-connect"; then
    printf "[ok] codex MCP entry for claw-connect found\n"
  else
    printf "[warn] codex MCP entry for claw-connect not found\n"
    printf "       Add it before multi-agent runs.\n"
  fi
fi

if [ "$missing" -ne 0 ]; then
  printf "\nEnvironment check failed. Install missing prerequisites and rerun.\n"
  exit 1
fi

printf "\nEnvironment check passed.\n"
