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

PacketPilot processes network packet captures which may contain sensitive data. Capture parsing with `sharkd` occurs locally. AI analysis is optional and uses a user-provided OpenRouter API key. When a user submits an AI message, PacketPilot may send selected packet contents and raw bytes, capture summaries, endpoint and conversation metadata, and reconstructed stream text to OpenRouter and the chosen model provider. During an answer, the model can request additional packet numbers or stream IDs beyond the current UI selection; every resulting tool response is appended to the AI conversation and transmitted on a subsequent model call. The PCAP file itself is not uploaded as a file, but sensitive payload data may be included in the AI context.

Users should:
- Only analyze captures from trusted sources
- Review the AI disclosure before connecting OpenRouter
- Avoid AI analysis for captures whose contents cannot leave the device
- Understand that ZDR routing is a provider retention policy, not local-only processing
- Protect their OpenRouter API key and monitor provider usage charges
