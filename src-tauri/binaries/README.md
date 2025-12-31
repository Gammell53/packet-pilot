# Sharkd Binaries

This folder should contain platform-specific `sharkd` binaries for bundling with PacketPilot.

## Required Files

Place the following binaries here (depending on target platforms):

| Platform | Filename |
|----------|----------|
| Linux x64 | `sharkd-x86_64-unknown-linux-gnu` |
| Linux ARM64 | `sharkd-aarch64-unknown-linux-gnu` |
| macOS x64 | `sharkd-x86_64-apple-darwin` |
| macOS ARM64 | `sharkd-aarch64-apple-darwin` |
| Windows x64 | `sharkd-x86_64-pc-windows-msvc.exe` |

## How to Obtain sharkd

### Option 1: From Wireshark Installation

On most systems with Wireshark installed:

```bash
# Linux - find and copy
which sharkd
# or
find /usr -name "sharkd" 2>/dev/null

# Copy with correct name
cp /path/to/sharkd ./sharkd-x86_64-unknown-linux-gnu
```

### Option 2: Build from Source

```bash
# Clone Wireshark
git clone https://gitlab.com/wireshark/wireshark.git
cd wireshark

# Build sharkd only
mkdir build && cd build
cmake .. -DBUILD_wireshark=OFF -DBUILD_tshark=OFF -DBUILD_sharkd=ON
make sharkd

# Copy the binary
cp run/sharkd ../binaries/sharkd-x86_64-unknown-linux-gnu
```

### Option 3: Download Pre-built

Check the Wireshark releases page for pre-built binaries:
https://www.wireshark.org/download.html

## Development Mode

During development, if no sidecar binary is found, PacketPilot will fall back to using `sharkd` from your system PATH.

Install Wireshark/sharkd on your system:

```bash
# Ubuntu/Debian
sudo add-apt-repository ppa:wireshark-dev/stable
sudo apt update
sudo apt install wireshark

# macOS
brew install wireshark

# Windows
# Download installer from wireshark.org
```
