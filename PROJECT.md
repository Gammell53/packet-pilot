# Packet Pilot — Project Tracking

## Current Sprint: Foundation

### Blockers 🔴
- [ ] **macOS signing and notarization** — no Developer ID identity or notarization credentials are configured
- [ ] **macOS sharkd distribution decision** — current Apple Silicon build works with an installed Wireshark runtime, but the public installer is not yet self-contained

### In Progress 🟡
- [x] Windows sharkd packaging — CI build and packaged smoke test pass
- [x] Apple Silicon macOS discovery, packaging, and real-PCAP smoke test
- [ ] Validate the macOS workflow on GitHub Actions and publish a signed release candidate

### Ready for Review 🟢
- [x] Runtime discovery checks Wireshark app bundles, Homebrew, `PATH`, and `PACKET_PILOT_SHARKD_PATH`
- [x] Packaged smoke harness detects `dist/mac-arm64`
- [x] Release workflow includes an Apple Silicon macOS artifact

---

## Backlog

### Phase 1: Polish & Stability
- [x] Fix Windows sharkd bundling
- [x] Verify Apple Silicon macOS build against a real capture
- [ ] Configure Developer ID signing and Apple notarization
- [ ] Bundle the macOS sharkd runtime or make the Wireshark prerequisite part of onboarding
- [ ] Add better error messages and an install link for missing dependencies
- [ ] Validate release candidates on Linux, macOS, and Windows
- [ ] Publish the first non-draft release

### Phase 2: Monetization Foundation
- [ ] License key system (basic implementation)
- [ ] Export reports feature (PDF, JSON) — first Pro feature
- [ ] Landing page with pricing
- [ ] Stripe integration

### Phase 3: Enterprise Features
- [ ] Audit logging
- [ ] SSO/SAML integration
- [ ] Team collaboration features
- [ ] API access for automation

### Phase 4: Growth
- [ ] Content marketing (blog, tutorials)
- [ ] Discord community
- [ ] Conference presence (BSides, DEF CON)

---

## Business Model: Open Core

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Core analysis, NL queries, local/single user |
| Pro | $30-50/seat/mo | Team features, saved templates, reports, priority support |
| Enterprise | Custom | SSO, audit logs, on-prem, API, SIEM integrations, SLA |

---

## Notes

### Target Market
- Primary: Security Analysts / SOC teams
- Secondary: Network engineers, pentesters

### Key Differentiator
- Wireshark's power with natural language interface
- "Show me failed TLS handshakes" instead of memorizing `tcp.flags.syn == 1 && tcp.flags.ack == 0`

---

*Last updated: 2026-08-14*
*To migrate to Linear: Export issues as CSV or use Linear API*
