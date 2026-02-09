# Show HN: Packet Pilot — AI-powered packet analysis

**Draft post for Hacker News launch**

---

## Title Options

1. "Show HN: Packet Pilot – Ask questions about network captures in plain English"
2. "Show HN: Packet Pilot – Natural language packet analysis using Wireshark's engine"
3. "Show HN: I built an AI layer on top of Wireshark because filter syntax is ridiculous"

*Recommended: Option 3 (more personality, relatable pain)*

---

## Post Body (Draft)

Hey HN,

I've been doing packet analysis for years, and I finally got tired of googling "wireshark filter for [thing I actually want]" every time I needed something beyond `tcp.port == 443`.

So I built Packet Pilot.

**What it does:**
Instead of writing `tcp.flags.syn == 1 && tcp.flags.ack == 0 && tcp.analysis.retransmission`, you just ask "Find TCP SYN packets that were retransmitted."

Under the hood, it uses Wireshark's actual dissection engine (sharkd), so you get real protocol analysis — not pattern matching on bytes.

**Stack:**
- Frontend: React + TypeScript
- Backend: Rust (Tauri) — not Electron, actually fast
- AI: Python sidecar with FastAPI
- The important bit: Wireshark's sharkd for real dissection

**Why open source:**
Security tools should be auditable. Also, I want feedback from people who actually do this for a living.

**What I'd love feedback on:**
1. What queries do you wish you could just *ask*?
2. Is the open core model right? (Free core, paid team/enterprise features)
3. Any red flags in the architecture?

GitHub: https://github.com/Gammell53/packet-pilot
Demo video: [TODO: record]

Would love to hear what you think.

---

## Key Points to Emphasize

1. **Pain is real** — Wireshark filters are notoriously hard to remember
2. **Trust the engine** — We use Wireshark's actual dissector, not reinventing the wheel
3. **Performance matters** — Tauri/Rust, not Electron bloat
4. **Open source** — Security tools should be auditable
5. **Looking for feedback** — HN loves being asked to critique

## What NOT to Do

- Don't oversell the AI
- Don't position as "ChatGPT for X" (overdone)
- Don't spam the thread with responses
- Don't get defensive if people criticize

## Timing

- Best days: Tuesday, Wednesday, Thursday
- Best time: 9-11am ET (HN peak)
- Avoid: Weekends, Fridays, holidays

## Follow-up Strategy

1. Monitor thread closely first 2 hours
2. Respond thoughtfully to every comment
3. If something's broken, fix it LIVE and comment "just shipped a fix"
4. Thank critics genuinely
5. Don't argue with trolls

---

## Metrics to Track Post-Launch

- GitHub stars
- Forks
- Issues opened
- HN points
- Comment sentiment
- Traffic to landing page (set up analytics first)

---

*Ready to launch when Windows build is fixed and we have a landing page.*
