# PacketPilot Privacy Notice

_Last updated: August 14, 2026_

PacketPilot is an open-source desktop packet-analysis application. This notice describes the data handling implemented by the current application. It is not a statement about independent services that you choose to use with PacketPilot.

## Local capture analysis

PacketPilot opens packet-capture files from your Mac and parses them locally with Wireshark's `sharkd` engine. PacketPilot does not upload an entire PCAP file to a PacketPilot-operated server.

Packet captures can contain sensitive information, including IP addresses, hostnames, credentials, cookies, message contents, and reconstructed application data. Use captures only when you have authority to inspect them.

## Optional AI analysis

AI analysis is optional and requires your own OpenRouter API key. When you open the AI assistant, PacketPilot requests OpenRouter's public model catalog so the model selector is current. That catalog request does not include your API key, prompt, capture filename, or packet data.

When you submit an AI message, PacketPilot may send the following context to OpenRouter and the model provider selected in the app:

- Your prompt and recent AI conversation
- Capture filename, total frame count, active display filter, and visible frame range
- Selected packet and stream identifiers
- Capture summaries and protocol statistics
- Endpoint and conversation metadata
- Selected packet dissection fields and raw packet bytes
- Reconstructed stream text, when requested for analysis

During an answer, the model can request additional packet numbers or stream IDs beyond the packet or stream currently selected in the interface. PacketPilot appends every requested tool result—including protocol fields, raw packet bytes, conversation metadata, and reconstructed stream content—to the AI conversation and sends it to OpenRouter and the selected model provider on subsequent model calls for that answer.

Although the PCAP is not uploaded as a file, AI context may contain packet payload data or other sensitive information from the capture. Do not use AI analysis if that information cannot leave your device.

PacketPilot requests Zero Data Retention-compatible routing. ZDR is a provider retention policy; it does not mean analysis is local or that no third party receives the request. Review [OpenRouter's privacy documentation](https://openrouter.ai/privacy) and the selected model provider's policies before use.

OpenRouter usage charges may apply to your account.

## API keys and local settings

PacketPilot stores settings on your Mac. It uses Electron's operating-system-backed `safeStorage` encryption for newly saved OpenRouter API keys. PacketPilot refuses to save a new API key when secure storage is unavailable rather than falling back to plaintext. If an existing encrypted key or a legacy plaintext key from an earlier PacketPilot version cannot be read securely, PacketPilot preserves the credential contents, restricts the settings file to the current operating-system user where supported, marks the credential unavailable, and blocks AI use until credential storage is unlocked, the key is replaced, or you explicitly remove it. The renderer receives only credential status, not the stored or decrypted key itself. You can remove the saved key by disconnecting OpenRouter in the application.

## Telemetry

The current PacketPilot application does not include PacketPilot-operated product analytics or telemetry. Network requests occur when you explicitly use AI features or open external links.

## Your choices

You can use local packet analysis without configuring AI. You can disconnect OpenRouter at any time and avoid submitting sensitive captures to AI analysis.

## Questions and security reports

For security vulnerabilities, follow [SECURITY.md](SECURITY.md). For privacy questions, open a repository discussion or contact the repository maintainer through GitHub.
