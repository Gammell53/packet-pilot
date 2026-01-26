# Contributing to PacketPilot

Thank you for your interest in contributing to PacketPilot! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- **Node.js** 18+
- **Rust** (latest stable via [rustup](https://rustup.rs/))
- **Python** 3.11+
- **Wireshark** (for sharkd binary)

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

3. Set up the Python sidecar:
   ```bash
   cd sidecar
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -e ".[dev]"
   cd ..
   ```

4. Run in development mode:
   ```bash
   npm run tauri dev
   ```

## How to Contribute

### Reporting Bugs

- Check existing issues first to avoid duplicates
- Use the bug report template
- Include reproduction steps, expected vs actual behavior
- Include your OS, app version, and relevant logs

### Suggesting Features

- Open an issue with the feature request template
- Describe the use case and why it would be valuable
- Be open to discussion about implementation approaches

### Submitting Code

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests and linting:
   ```bash
   # Rust
   cargo fmt --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml

   # Python
   cd sidecar
   source .venv/bin/activate
   pytest
   ```
5. Commit with a clear message
6. Push and open a Pull Request

### Code Style

**Rust:**
- Follow standard Rust conventions
- Run `cargo fmt` before committing
- Address `cargo clippy` warnings

**TypeScript/React:**
- Use functional components with hooks
- Keep components focused and composable

**Python:**
- Follow PEP 8
- Use type hints
- Write docstrings for public functions

## Project Structure

```
packet-pilot/
├── src/                    # React frontend
├── src-tauri/              # Rust backend (Tauri)
│   └── src/
│       ├── sharkd_client.rs   # Wireshark integration
│       ├── python_sidecar.rs  # AI sidecar management
│       └── http_bridge.rs     # HTTP proxy
├── sidecar/                # Python AI service
│   └── src/packet_pilot_ai/
└── scripts/                # Build utilities
```

## Communication

- **Issues**: Bug reports and feature requests
- **Pull Requests**: Code contributions
- **Discussions**: General questions and ideas

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
