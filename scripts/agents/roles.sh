#!/usr/bin/env bash
set -euo pipefail

cat <<'TABLE'
Canonical roles:
- coordinator
- frontend-fixer
- desktop-fixer
- sidecar-fixer
- test-runner
- reviewer

Canonical labels:
- frontend
- desktop
- python-sidecar
- tests
- release
- docs

Ownership map:
- frontend-fixer: src/**, public/**, vite.config.ts
- desktop-fixer: electron/**, shared/**, resources/**, package.json, .github/workflows/**, src-tauri/**
- sidecar-fixer: sidecar/**
- test-runner: cross-surface verification
- coordinator: decomposition, sequencing, merge prep
TABLE
