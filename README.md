# PacketPilot 🦈

**AI-powered network packet analyzer.** Ask questions about your captures in plain English.

[![Build Status](https://github.com/Gammell53/packet-pilot/actions/workflows/build.yml/badge.svg)](https://github.com/Gammell53/packet-pilot/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/Gammell53/packet-pilot?include_prereleases)](https://github.com/Gammell53/packet-pilot/releases)
[![License](https://img.shields.io/github/license/Gammell53/packet-pilot)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Built%20with-Electron-47848F?logo=electron)](https://www.electronjs.org/)

> *"Show me all failed TLS handshakes"* → PacketPilot finds them.

https://github.com/user-attachments/assets/f1ac9685-9b0c-45d8-888e-7a965a55f683

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
- **Desktop runtime** — Electron shell with Node-managed `sharkd`
- **Wireshark-compatible** — Uses `sharkd` for real protocol dissection

### 🔍 Full Analysis Toolkit
- Display filters (Wireshark syntax works!)
- Conversation tracking
- Protocol hierarchy
- Endpoint statistics
- Stream reconstruction

### 💻 Cross-Platform
- Linux and Windows via CI, with macOS assets supported for manual packaging

## Prerequisites

### For Development

1. **Wireshark** - Install Wireshark and ensure `sharkd` is in your PATH
   - Download from [wireshark.org](https://www.wireshark.org/download.html)
   - Or via package manager (see below)
   - Verify: `sharkd -v`

2. **Node.js** - Version 18 or later
   - Download from [nodejs.org](https://nodejs.org/)

### For Distribution (Bundled sharkd)

For production builds, sharkd can be bundled with the Electron app. Place platform-specific binaries in `resources/sharkd/`:

| Platform | Filename |
|----------|----------|
| Linux x64 | `sharkd-x86_64-unknown-linux-gnu` |
| macOS x64 | `sharkd-x86_64-apple-darwin` |
| macOS ARM | `sharkd-aarch64-apple-darwin` |
| Windows | `sharkd-x86_64-pc-windows-msvc.exe` |

See `resources/sharkd/README.md` for details on obtaining sharkd binaries.

### Platform Notes

- **Linux**: install Node.js and Wireshark/`sharkd`, then use `npm install` and `npm run dev`.
- **macOS**: install Node.js and Wireshark/`sharkd`, then use `npm install` and `npm run dev`.
- **Windows**: install Node.js and Wireshark, then use `npm install` and `npm run dev`.

For packaged releases, use the Electron build flow in `package.json` (`npm run dist` or `npm run dist:win`) and bundle `sharkd` assets under `resources/sharkd/`.
The current CI release workflow publishes Linux and Windows artifacts; macOS packaging is still a manual path.

## Installation

```bash
# Clone the repository
git clone https://github.com/Gammell53/packet-pilot.git
cd packet-pilot

# Install dependencies
npm install

# Run in development mode
npm run dev
```

For Windows releases, use the NSIS `.exe` installer by default. The `.msi` package is primarily intended for managed/enterprise deployment.

## Multi-Agent Development

PacketPilot supports structured multi-agent development with Codex via `claw-connect`.

- Operating model and guardrails: `AGENTS.md`
- Copy/paste message and task templates: `docs/agent-templates.md`
- Environment bootstrap checks: `scripts/agents/check-env.sh`

## Building

```bash
# Build for production
npm run dist
```

Packaged applications will be emitted under `dist/` and the Electron builder output directory.

### Packaged Smoke Test

After producing an unpacked build, run the packaged smoke harness:

```bash
npm run smoke:packaged
```

To verify capture loading and filter/detail flows against a real file:

```bash
npm run smoke:packaged -- --capture /path/to/sample.pcapng
```

To require AI startup as part of the smoke pass:

```bash
npm run smoke:packaged -- --capture /path/to/sample.pcapng --require-ai
```

## Public PCAP Corpus

PacketPilot includes a download-on-demand public capture corpus for manual chat sessions and live harness runs. Downloads are cached under `test-results/public-pcaps/` and are ignored by git.

```bash
# Show the corpus and local cache status
npm run corpus:list

# Download all public samples
npm run corpus:sync

# Download one sample and launch the dev app with it preloaded
npm run corpus:open -- --id dns-lookups
```

You can also benchmark those captures through the live AI harness:

```bash
OPENROUTER_API_KEY=... npm run test:ai-harness:live -- --suite public-pcaps --scenario dns-lookups --driver direct --model google/gemini-3.1-flash-lite-preview
OPENROUTER_API_KEY=... npm run test:ai-harness:live -- --suite public-pcaps --scenario all --driver smoke --model google/gemini-3.1-flash-lite-preview
```

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

If the problem persists, open Settings and use `Copy Diagnostics`, or copy the debug info from the startup banner, then include that output with the issue.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Packet Grid │  │  AI Chat    │  │ Filter Bar      │  │
│  │ (Virtual)   │  │  Panel      │  │                 │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└───────────────────────────┬─────────────────────────────┘
                            │ Electron preload IPC
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌────────────────┐  ┌────────────────────┐  ┌──────────────┐
│ Electron Main  │  │   AI Providers     │  │   sharkd     │
│ (Node runtime) │◄─┤ OpenRouter/Claude/  │  │  (Wireshark) │
│                │  │ ChatGPT            │  │              │
│ - File dialogs │  │ - Tool calling     │  │ - Dissector  │
│ - Settings     │  │ - Streaming        │  │ - Filters    │
│ - sharkd IPC   │  │ - Conversation     │  │ - Statistics │
└────────────────┘  └────────────────────┘  └──────────────┘
```

## Project Structure

```
packet-pilot/
├── electron/               # Electron main/preload + Node services
│   └── services/           # sharkd runtime + OpenRouter agent harness
├── resources/              # Electron icons and bundled sharkd assets
├── shared/                 # Typed contracts shared by renderer and main
├── sidecar/                # Python FastAPI AI sidecar
│   └── src/                # Multi-provider AI service
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── PacketGrid/     # Virtualized packet table
│   │   └── AiChat/         # AI chat panel
│   └── App.tsx             # Main application
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
- [Electron](https://www.electronjs.org/) - Cross-platform desktop runtime
- [TanStack](https://tanstack.com/) - High-quality open-source software for web developers
