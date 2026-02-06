# Packet Pilot — Strategic Plan

*Thunder, CEO | February 2026*

---

## Executive Summary

Packet Pilot is an AI-powered network packet analyzer that makes Wireshark-level analysis accessible through natural language. Our target: security analysts in SOC teams who need deep packet inspection but don't have time to master arcane filter syntax.

**The opportunity:** Wireshark has 600K+ active users but brutal UX. We're building the "ChatGPT for packet analysis."

---

## Vision

**2-year vision:** The default tool SOC analysts reach for when they need to understand network traffic.

**5-year vision:** The packet analysis layer for enterprise security stacks — integrated with SIEMs, EDR, and threat intelligence platforms.

---

## Market Analysis

### Target Market: Security Operations

**Primary ICP (Ideal Customer Profile):**
- Role: Security Analyst (L1-L3), SOC Engineer
- Company: 500-10,000 employees with dedicated security team
- Pain: Spends hours writing Wireshark filters, misses threats due to complexity
- Budget: $10K-100K/year for security tools

**Market Size:**
- ~500K security analysts globally
- Enterprise security tools market: $25B+ (growing 15% YoY)
- Network security subset: ~$5B

### Competitive Landscape

| Competitor | Strengths | Weaknesses |
|------------|-----------|------------|
| **Wireshark** | Industry standard, free, powerful | Terrible UX, steep learning curve |
| **Zeek** | Great for automated analysis | No GUI, requires programming |
| **NetworkMiner** | Good for forensics | Limited analysis, dated UI |
| **Commercial NDR** (Darktrace, Vectra) | Enterprise features | $100K+, overkill for many teams |

**Our wedge:** NL interface + Wireshark's actual engine. Power users trust the underlying tech; new users can actually use it.

---

## Business Model: Open Core

### Tier Structure

| Tier | Price | Target | Key Features |
|------|-------|--------|--------------|
| **Free** | $0 | Individual analysts, students, evaluators | Core analysis, NL queries, single user, local only |
| **Pro** | $39/seat/mo | Small security teams (2-10) | Team collaboration, saved templates, export reports, priority support |
| **Enterprise** | Custom ($15K-100K/yr) | SOC teams, MSSPs | SSO/SAML, audit logging, API access, SIEM integration, on-prem, SLA |

### Revenue Projections (Conservative)

| Year | ARR | Customers | Notes |
|------|-----|-----------|-------|
| Y1 | $50K | 50 Pro + 2 Enterprise | Product-market fit, first reference customers |
| Y2 | $500K | 300 Pro + 10 Enterprise | Sales motion established |
| Y3 | $2M | 800 Pro + 30 Enterprise | Series A territory |

---

## Go-to-Market Strategy

### Phase 1: Community & Credibility (Q1-Q2 2026)

**Goal:** Establish presence, get first users, build credibility.

**Tactics:**
1. **Fix Windows build** — can't grow without working software
2. **Launch on Hacker News** — our audience lives there
3. **Post on r/netsec, r/blueteam** — show, don't tell
4. **Create YouTube tutorials** — "Wireshark filter → Packet Pilot query"
5. **Write blog content:**
   - "Top 10 packet analysis queries for incident response"
   - "How to find TLS misconfigurations in 30 seconds"
   - "From Wireshark filters to natural language"

**Success metrics:**
- 1,000+ GitHub stars
- 500+ active users (telemetry opt-in)
- 10+ community contributions

### Phase 2: First Revenue (Q3-Q4 2026)

**Goal:** Convert free users to paid, land first enterprise deal.

**Tactics:**
1. **Add Pro features:**
   - Export reports (PDF, JSON)
   - Saved query templates
   - Team sharing
2. **Set up billing** (Stripe, license key system)
3. **Outbound to design partners:**
   - Find 3-5 friendly SOC teams
   - Offer free Pro in exchange for feedback + case study
4. **Conference presence:**
   - BSides (low cost, security-focused)
   - Local ISSA/ISACA chapters
   - Security meetups

**Success metrics:**
- $50K ARR
- 2+ enterprise pilots
- NPS > 40

### Phase 3: Scale (2027)

**Goal:** Repeateable sales motion, enterprise traction.

**Tactics:**
1. **Hire first sales rep** (former SE or security practitioner)
2. **Build integrations:**
   - Splunk / Elastic SIEM
   - CrowdStrike / SentinelOne
   - PagerDuty / Slack alerts
3. **Partner with MSSPs** — they manage SOCs, resell tools
4. **Content flywheel:**
   - Guest posts on security blogs
   - Podcast appearances
   - Webinars with design partners

---

## Product Roadmap

### Now (Q1 2026)
- [x] Core NL query engine
- [x] Virtualized packet grid
- [ ] **Fix Windows sharkd bundling** ← BLOCKER
- [ ] Pre-build verification (done, needs merge)
- [ ] First official release v0.1.0

### Next (Q2 2026)
- [ ] Export reports (PDF, JSON, CSV)
- [ ] License key system
- [ ] Landing page with pricing
- [ ] Usage telemetry (opt-in)

### Later (Q3-Q4 2026)
- [ ] Team collaboration features
- [ ] Saved query templates
- [ ] SSO/SAML (enterprise)
- [ ] Audit logging (enterprise)
- [ ] API access

### Future (2027+)
- [ ] SIEM integrations
- [ ] Plugin system
- [ ] Cloud-hosted version
- [ ] Threat intelligence feeds

---

## Competitive Moat

**Short-term:** UX differentiation. We're 10x easier than Wireshark.

**Medium-term:** Data network effects. More users → more queries → better AI.

**Long-term:** Integration depth. Embedded in security workflows, switching cost high.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Wireshark Foundation adds NL | Low | High | Move faster, build integrations they won't |
| Security vendor builds competing feature | Medium | Medium | Stay focused on packet analysis; they're generalists |
| Enterprise sales cycles too long | High | Medium | Start with SMB/pro tier, use for cash flow |
| Open source doesn't convert to paid | Medium | High | Strong feature gating, enterprise-only features |

---

## Key Decisions Needed

1. **Pricing validation:** Is $39/seat right? Should we test $29 or $49?
2. **Feature gating:** What stays free vs Pro vs Enterprise?
3. **First enterprise pilot:** Who do we reach out to?
4. **Fundraising:** Bootstrap longer or raise seed?

---

## Action Items (Next 2 Weeks)

1. ✅ Fix Windows sharkd bundling
2. ✅ Merge pre-build verification PR
3. [ ] Create landing page (simple: hero + features + pricing + waitlist)
4. [ ] Write first blog post
5. [ ] Post Show HN
6. [ ] Set up Stripe account
7. [ ] Design license key system

---

*"The best time to plant a tree was 20 years ago. The second best time is now."*

Let's build. ⚡🦈
