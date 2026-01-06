#!/bin/bash
# Build script for PacketPilot AI sidecar

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building PacketPilot AI sidecar..."

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# Ensure PyInstaller is installed
pip install pyinstaller --quiet

# Build the executable
pyinstaller --clean --noconfirm packet-pilot-ai.spec

# Copy to the Tauri binaries directory
TAURI_BIN_DIR="../src-tauri/binaries"
mkdir -p "$TAURI_BIN_DIR"

# Determine the target triple for the current platform
case "$(uname -s)" in
    Linux*)
        case "$(uname -m)" in
            x86_64)  TARGET="x86_64-unknown-linux-gnu" ;;
            aarch64) TARGET="aarch64-unknown-linux-gnu" ;;
            *)       TARGET="unknown-linux" ;;
        esac
        ;;
    Darwin*)
        case "$(uname -m)" in
            x86_64)  TARGET="x86_64-apple-darwin" ;;
            arm64)   TARGET="aarch64-apple-darwin" ;;
            *)       TARGET="unknown-darwin" ;;
        esac
        ;;
    MINGW*|MSYS*|CYGWIN*)
        TARGET="x86_64-pc-windows-msvc"
        ;;
    *)
        TARGET="unknown"
        ;;
esac

# Copy the built executable with the target triple suffix (required by Tauri)
BINARY_NAME="packet-pilot-ai-${TARGET}"
cp "dist/packet-pilot-ai" "$TAURI_BIN_DIR/$BINARY_NAME"
chmod +x "$TAURI_BIN_DIR/$BINARY_NAME"

echo "Built successfully: $TAURI_BIN_DIR/$BINARY_NAME"
echo ""
echo "Binary size: $(du -h "$TAURI_BIN_DIR/$BINARY_NAME" | cut -f1)"
