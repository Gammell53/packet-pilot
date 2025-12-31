# PacketPilot

AI-powered network packet analyzer built with Tauri, React, and sharkd.

![PacketPilot](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Overview

PacketPilot is a modern desktop application for analyzing network packet captures (PCAP files). It leverages Wireshark's `sharkd` daemon for packet parsing and provides a fast, virtualized packet viewer capable of handling captures with 100k+ packets without lag.

### Features

- **High-Performance Packet Viewer** - Virtualized table handles massive captures smoothly
- **Native File Dialog** - Open PCAP, PCAPNG, and other capture formats
- **Display Filters** - Use Wireshark-compatible filter syntax
- **Cross-Platform** - Runs on Linux, macOS, and Windows

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
git clone https://github.com/yourusername/packet-pilot.git
cd packet-pilot

# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

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

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  ┌─────────────┐  ┌──────────────────────────────────┐  │
│  │ File Picker │  │      Virtual Packet Grid         │  │
│  └─────────────┘  │  (TanStack Table + Virtual)      │  │
│                   └──────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────┘
                            │ Tauri IPC
┌───────────────────────────┴─────────────────────────────┐
│                    Rust Backend                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │              Sharkd Client (JSON-RPC)               ││
│  └─────────────────────────────────────────────────────┘│
└───────────────────────────┬─────────────────────────────┘
                            │ stdin/stdout
┌───────────────────────────┴─────────────────────────────┐
│                     sharkd process                       │
│              (Wireshark's dissection engine)             │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
packet-pilot/
├── src/                    # React frontend
│   ├── components/         # React components
│   │   └── PacketGrid.tsx  # Virtualized packet table
│   ├── App.tsx             # Main application
│   └── App.css             # Styles
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── lib.rs          # Tauri commands
│   │   └── sharkd_client.rs # Sharkd JSON-RPC client
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
└── package.json            # Node dependencies
```

## Roadmap

- [ ] AI-powered packet analysis (Phase 2)
- [ ] Natural language to filter translation
- [ ] Stream reconstruction and summarization
- [ ] Protocol anomaly detection

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Wireshark](https://www.wireshark.org/) - The world's foremost network protocol analyzer
- [Tauri](https://tauri.app/) - Build smaller, faster, and more secure desktop applications
- [TanStack](https://tanstack.com/) - High-quality open-source software for web developers
