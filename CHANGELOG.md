# Changelog

All notable changes to PacketPilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Windows binary bundling - sharkd and AI sidecar now correctly included in installer

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
- Tauri 2 desktop framework
- React 19 frontend with TypeScript
- Rust backend with sharkd integration
- Python FastAPI sidecar for AI features
- GitHub Actions CI/CD for automated builds
