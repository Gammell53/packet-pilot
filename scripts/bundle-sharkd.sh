#!/bin/bash
# Bundle sharkd and all its dependencies for distribution

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/src-tauri/binaries"

# Determine target triple
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
    *)
        echo "Unsupported platform"
        exit 1
        ;;
esac

# Find sharkd
SHARKD_PATH=$(which sharkd 2>/dev/null || echo "")
if [ -z "$SHARKD_PATH" ]; then
    echo "Error: sharkd not found. Please install wireshark/tshark."
    exit 1
fi

echo "Found sharkd at: $SHARKD_PATH"

# Create output directory for libs
LIBS_DIR="$OUTPUT_DIR/wireshark-libs"
mkdir -p "$LIBS_DIR"

# Copy sharkd
cp "$SHARKD_PATH" "$OUTPUT_DIR/sharkd-$TARGET"
chmod +x "$OUTPUT_DIR/sharkd-$TARGET"

# Copy all shared library dependencies
echo "Copying dependencies..."
ldd "$SHARKD_PATH" | grep "=> /" | awk '{print $3}' | while read lib; do
    if [ -f "$lib" ]; then
        cp -L "$lib" "$LIBS_DIR/" 2>/dev/null || true
    fi
done

# Also copy the dynamic linker
LINKER=$(ldd "$SHARKD_PATH" | grep "ld-linux" | awk '{print $1}')
if [ -f "$LINKER" ]; then
    cp -L "$LINKER" "$LIBS_DIR/" 2>/dev/null || true
fi

# Create a wrapper script that sets LD_LIBRARY_PATH
cat > "$OUTPUT_DIR/sharkd-wrapper-$TARGET" << 'WRAPPER'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Try multiple locations for the libs directory (Tauri bundles resources differently)
if [ -d "$SCRIPT_DIR/wireshark-libs" ]; then
    LIBS_DIR="$SCRIPT_DIR/wireshark-libs"
elif [ -d "$SCRIPT_DIR/../lib/wireshark-libs" ]; then
    LIBS_DIR="$SCRIPT_DIR/../lib/wireshark-libs"
elif [ -d "$SCRIPT_DIR/../Resources/wireshark-libs" ]; then
    LIBS_DIR="$SCRIPT_DIR/../Resources/wireshark-libs"
else
    LIBS_DIR="$SCRIPT_DIR/wireshark-libs"
fi

export LD_LIBRARY_PATH="$LIBS_DIR:$LD_LIBRARY_PATH"
exec "$SCRIPT_DIR/sharkd-TARGETPLACEHOLDER" "$@"
WRAPPER

# Replace the target placeholder
sed -i "s/TARGETPLACEHOLDER/$TARGET/g" "$OUTPUT_DIR/sharkd-wrapper-$TARGET"
chmod +x "$OUTPUT_DIR/sharkd-wrapper-$TARGET"

# Calculate total size
TOTAL_SIZE=$(du -sh "$LIBS_DIR" "$OUTPUT_DIR/sharkd-$TARGET" 2>/dev/null | awk '{sum += $1} END {print sum}')
echo ""
echo "Bundled successfully!"
echo "  sharkd binary: $OUTPUT_DIR/sharkd-$TARGET"
echo "  Dependencies:  $LIBS_DIR/ ($(du -sh "$LIBS_DIR" | cut -f1))"
echo ""
echo "Note: For distribution, the Rust code should use sharkd-wrapper-$TARGET"
echo "which sets up the library path correctly."
