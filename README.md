# PacketPilot 🦈

**AI-powered network packet analyzer.** Ask questions about your captures in plain English.

[![Build Status](https://github.com/Gammell53/packet-pilot/actions/workflows/build.yml/badge.svg)](https://github.com/Gammell53/packet-pilot/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/Gammell53/packet-pilot?include_prereleases)](https://github.com/Gammell53/packet-pilot/releases)
[![License](https://img.shields.io/github/license/Gammell53/packet-pilot)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-blue?logo=tauri)](https://tauri.app)

> *"Show me all failed TLS handshakes"* → PacketPilot finds them.

## Why PacketPilot?

Wireshark is powerful, but its filter syntax is arcane. PacketPilot lets you **ask questions in natural language** while using Wireshark's actual dissection engine under the hood.

**Instead of memorizing:** `tcp.flags.syn == 1 && tcp.flags.ack == 0 && tcp.analysis.retransmission`

**Just ask:** *"Find TCP SYN packets that were retransmitted"*

## Features

### 🤖 AI-Powered Analysis
- **Natural language queries** — Ask questions, get answers
- **Agentic tool use** — AI searches packets, analyzes conversations, finds anomalies
- **Streaming responses** — Watch the AI think in real-time

### ⚡ High Performance
- **Virtualized packet grid** — Handles 100k+ packets without lag
- **Native desktop app** — Rust backend, not Electron bloat
- **Wireshark-compatible** — Uses `sharkd` for real protocol dissection

### 🔍 Full Analysis Toolkit
- Display filters (Wireshark syntax works!)
- Conversation tracking
- Protocol hierarchy
- Endpoint statistics
- Stream reconstruction

### 💻 Cross-Platform
- Linux, macOS, and Windows

## Prerequisites

### For Development

1. **Wireshark** - Install Wireshark and ensure `sharkd` is in your PATH
   - Download from [wireshark.org](https://www.wireshark.org/download.html)
   - Or via package manager (see below)
   - Verify: `sharkd -v`

2. **Node.js** - Version 18 or later
   - Download from [nodejs.org](https://nodejs.org/)

3. **Rust** - Latest stable version
   - Install via [rustup](https://rustup.rs/): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### For Distribution (Bundled sharkd)

For production builds, sharkd can be bundled as a sidecar binary. Place platform-specific binaries in `src-tauri/binaries/`:

| Platform | Filename |
|----------|----------|
| Linux x64 | `sharkd-x86_64-unknown-linux-gnu` |
| macOS x64 | `sharkd-x86_64-apple-darwin` |
| macOS ARM | `sharkd-aarch64-apple-darwin` |
| Windows | `sharkd-x86_64-pc-windows-msvc.exe` |

See `src-tauri/binaries/README.md` for details on obtaining sharkd binaries.

### Linux (Debian/Ubuntu)

Install the required system dependencies:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libglib2.0-dev \
  libcairo2-dev \
  libpango1.0-dev \
  libatk1.0-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev
```

### macOS

```bash
xcode-select --install
```

### Windows

- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++"
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## Installation

```bash
# Clone the repository
git clone https://github.com/Gammell53/packet-pilot.git
cd packet-pilot

# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

For Windows releases, use the NSIS `.exe` installer by default. The `.msi` package is primarily intended for managed/enterprise deployment.

## Building

```bash
# Build for production
npm run tauri build
```

The compiled application will be in `src-tauri/target/release/`.

## Usage

1. Launch PacketPilot
2. Click "Open Capture" to select a PCAP file
3. Browse packets in the virtualized table
4. Use display filters (e.g., `tcp.port == 80`, `dns`, `http`)

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + O` | Open file |
| `Ctrl/Cmd + F` | Focus filter input |
| `Enter` | Apply filter |
| `Esc` | Clear filter |

## Windows Troubleshooting

If startup fails with `Failed to initialize sharkd` or a missing DLL error:

1. Reinstall using the latest Windows `.exe` installer.
2. Confirm these files exist under `%LOCALAPPDATA%\\PacketPilot\\`:
   - `sharkd-x86_64-pc-windows-msvc.exe`
   - `libwireshark.dll`
   - `libwiretap.dll`
   - `libwsutil.dll`
3. Restart PacketPilot.

If the problem persists, open an issue and include the full startup debug block.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Packet Grid │  │  AI Chat    │  │ Filter Bar      │  │
│  │ (Virtual)   │  │  Panel      │  │                 │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└───────────────────────────┬─────────────────────────────┘
                            │ Tauri IPC + HTTP
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌─────────────────┐  ┌──────────────┐
│  Rust Backend │  │  AI Sidecar     │  │   sharkd     │
│  (Tauri)      │◄─┤  (Python/LLM)   │  │  (Wireshark) │
│               │  │                 │  │              │
│  - IPC bridge │  │  - Tool calling │  │  - Dissector │
│  - HTTP proxy │  │  - Streaming    │  │  - Filters   │
└───────┬───────┘  └─────────────────┘  └──────┬───────┘
        │                                       │
        └───────────────────────────────────────┘
                     JSON-RPC over stdin/stdout
```

## Project Structure

```
packet-pilot/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── PacketGrid/     # Virtualized packet table
│   │   └── AiChat/         # AI chat panel
│   └── App.tsx             # Main application
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── lib.rs          # Tauri commands & HTTP bridge
│   │   └── sharkd_client.rs # Sharkd JSON-RPC client
│   └── tauri.conf.json     # Tauri configuration
├── sidecar/                # AI agent (Python)
│   └── src/packet_pilot_ai/
│       ├── services/       # AI agent with tool calling
│       └── routes/         # FastAPI endpoints
└── package.json
```

## Roadmap

- [x] High-performance packet viewer
- [x] AI-powered analysis with tool calling
- [x] Natural language to filter translation
- [x] Streaming AI responses
- [ ] Stream reconstruction visualization
- [ ] Save/export analysis reports
- [ ] Plugin system for custom analyzers

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Wireshark](https://www.wireshark.org/) - The world's foremost network protocol analyzer
- [Tauri](https://tauri.app/) - Build smaller, faster, and more secure desktop applications
- [TanStack](https://tanstack.com/) - High-quality open-source software for web developers
