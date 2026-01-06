"""Entry point for PyInstaller bundled executable."""

import sys
import os

# When running as a bundled app, we need to handle the path differently
if getattr(sys, 'frozen', False):
    # Running in a bundle
    bundle_dir = sys._MEIPASS
else:
    # Running in normal Python environment
    bundle_dir = os.path.dirname(os.path.abspath(__file__))


def main():
    """Run the uvicorn server."""
    import uvicorn

    # Get port from environment or use default
    port = int(os.environ.get("SIDECAR_PORT", "8765"))
    host = os.environ.get("SIDECAR_HOST", "127.0.0.1")

    uvicorn.run(
        "packet_pilot_ai.server:app",
        host=host,
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
