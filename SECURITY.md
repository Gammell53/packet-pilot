# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in PacketPilot, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainers directly or use GitHub's private vulnerability reporting
3. Include details about the vulnerability and steps to reproduce

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Scope

This policy applies to:
- The PacketPilot desktop application
- The Python AI sidecar service
- Build and release infrastructure

## Security Considerations

PacketPilot processes network packet captures which may contain sensitive data. Users should:
- Only analyze captures from trusted sources
- Be aware that AI analysis sends packet metadata to external APIs (when configured)
- Review the privacy implications of any API keys used
