# Changelog

All notable changes to PacketPilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-14

### Added
- Apple Silicon macOS packaging and a packaged-app smoke test against a real public DNS capture
- Platform-aware discovery for Wireshark's `sharkd`, including `/Applications`, `~/Applications`, Homebrew, and explicit overrides
- Pull-request CI for renderer tests, sidecar tests, audits, builds, package structure, and macOS smoke coverage
- An explicit privacy notice and versioned informed consent for optional OpenRouter analysis
- Package-structure and release-tag verification gates

### Changed
- Upgraded Electron to 43.4 and documented Node.js 22.12 as the minimum development runtime
- Made renderer assets relative and isolated Vite output in `dist/renderer` to prevent recursive packaging
- Positioned macOS as an Apple Silicon beta that requires the latest official Wireshark application
- Kept saved OpenRouter credentials in the main process and exposed only redacted key status to the renderer

### Fixed
- Correct Apple Silicon packaged-app target discovery (`dist/mac-arm64`)
- Packaged renderer/preload loading and macOS keyboard shortcut labels
- AI-sidecar default model selection
- Flaky Playwright setup that could interact with virtualized placeholder packet rows

### Security
- Blocked untrusted renderer navigation and restricted external links to HTTPS
- Added trusted-renderer checks to privileged IPC handlers
- Refused plaintext API-key persistence when operating-system secure storage is unavailable
- Expanded AI disclosure to cover capture filenames, filters, selection metadata, raw packet bytes, and reconstructed streams

## [0.2.0] - 2026-03-31

### Added
- Multi-provider AI support (OpenRouter, Anthropic, OpenAI)
- Protocol-aware agent tools for HTTP, DNS, TLS, and timeline analysis
- Electron desktop runtime (migrated from Tauri)
- Windows NSIS installer with bundled sharkd and DLLs
- Linux AppImage and .deb packaging

### Fixed
- Windows Python sidecar discovery (venv path and `where` vs `which`)
- Windows DLL bundling and resolution in CI

## [0.1.0] - 2025-01-06

### Added
- Initial release
- High-performance virtualized packet viewer (handles 100k+ packets)
- Wireshark-compatible display filters
- AI-powered packet analysis with natural language queries
- Streaming chat interface for AI responses
- Protocol hierarchy statistics
- TCP/UDP conversation analysis
- Cross-platform support (Windows, Linux, macOS)
- Dark mode interface

### Technical
- Electron desktop framework
- React 19 frontend with TypeScript
- Node.js backend with sharkd integration
- Python FastAPI sidecar for AI features
- GitHub Actions CI/CD for automated builds
