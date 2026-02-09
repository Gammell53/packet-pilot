# Packet Pilot — Project Tracking

## Current Sprint: Foundation

### Blockers 🔴
- [ ] **Windows sharkd not found** — sharkd binary not bundling correctly in Windows builds
  - Root cause: CI builds sharkd from source but something breaks in the bundle step
  - Need to verify DLLs are being copied correctly
  - Need to test on actual Windows machine

### In Progress 🟡
- [x] Linux build verification — ✅ verification script works, full compile needs more RAM
- [x] Pre-build verification script — ✅ created, committed to branch `fix/sharkd-verification`

### Ready for Review 🟢
- [x] `scripts/verify-sharkd.js` — pre-build check that catches missing sharkd early
- [x] `package.json` updates — verify:sharkd runs before builds

---

## Backlog

### Phase 1: Polish & Stability
- [ ] Fix Windows sharkd bundling
- [ ] Add better error messages for missing dependencies
- [ ] Test on all platforms (Linux, macOS, Windows)
- [ ] Create first official release (v0.1.0)

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

*Last updated: 2026-02-06*
*To migrate to Linear: Export issues as CSV or use Linear API*
