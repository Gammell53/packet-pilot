# Changelog

All notable changes to PacketPilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
