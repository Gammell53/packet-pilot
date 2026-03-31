# Contributing to PacketPilot

Thank you for your interest in contributing to PacketPilot.

## Getting Started

### Prerequisites

- **Node.js** 18+
- **Wireshark** with `sharkd` available on your PATH, or bundled under `resources/sharkd/`
- **Python** 3.11+ if you plan to work on `sidecar/**`
- **Rust** only if you are explicitly working in the archived `src-tauri/**` migration surface

### Development Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/Gammell53/packet-pilot.git
   cd packet-pilot
   ```

2. Install Node dependencies:

   ```bash
   npm install
   ```

3. If you are touching the legacy Python sidecar, set up its virtual environment:

   ```bash
   cd sidecar
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -e ".[dev]"
   cd ..
   ```

4. Run the Electron app in development mode:

   ```bash
   npm run dev
   ```

## How to Contribute

### Reporting Bugs

- Check existing issues first to avoid duplicates.
- Include reproduction steps, expected vs actual behavior, and your OS.
- Attach startup diagnostics or packaged smoke output when relevant.

### Suggesting Features

- Open an issue with the use case and why it matters.
- Be open to discussion about implementation tradeoffs.

### Submitting Code

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature`.
3. Make your changes.
4. Run the checks that match the surfaces you touched:

   ```bash
   # Frontend / desktop runtime
   npm run build

   # Packaged Electron flow or release-sensitive changes
   npm run dist
   npm run smoke:packaged

   # Python sidecar
   cd sidecar
   source .venv/bin/activate
   pytest tests/ -v

   # Archived Tauri migration forensics only
   cargo check --manifest-path src-tauri/Cargo.toml
   ```

5. Commit with a clear message.
6. Push and open a Pull Request.

## Code Style

**TypeScript / React / Electron:**

- Use functional React components and hooks.
- Keep preload APIs typed and narrow.
- Prefer shared contracts in `shared/**` for renderer-main boundaries.

**Python:**

- Follow PEP 8.
- Use type hints.
- Keep tests close to sidecar behavior changes.

**Archived Rust / Tauri:**

- Treat `src-tauri/**` as an archived migration surface unless a task explicitly targets it.

## Project Structure

```text
packet-pilot/
|- electron/                 # Electron main/preload + Node services
|- resources/                # Icons and bundled sharkd assets
|- shared/                   # Typed contracts shared across processes
|- src/                      # React frontend
|- sidecar/                  # Legacy Python sidecar surfaces
|- src-tauri/                # Archived Tauri implementation
`- scripts/                  # Build and verification utilities
```

## Communication

- **Issues**: bug reports and feature requests
- **Pull Requests**: code contributions
- **Discussions**: general questions and ideas

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
