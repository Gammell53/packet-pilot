This is a comprehensive **Developer Implementation Guide**. It breaks down the "PacketPilot" project into actionable engineering phases with specific coding tasks.

Archived note: this guide was written for the original **Tauri + React + Python** plan.

The active desktop runtime has since moved to Electron. Treat the rest of this file as migration history, and use `README.md`, `CONTRIBUTING.md`, `electron/`, and `shared/` for the current implementation path.

---

### 📂 The Master Plan: Project Structure

Before writing logic, organize your mono-repo to keep the "Brain" (Python) and "Body" (Rust/React) clean.

```text
packet-pilot/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs            # Rust: Spawns Sharkd & Python Sidecar
│   │   ├── sharkd_client.rs   # Rust: Handles JSON-RPC over Unix Socket
│   ├── tauri.conf.json        # Config: Defines sidecars & permissions
│   ├── capabilities/          # Security: Allow shell execute for sidecars
├── src/                       # Frontend (React + Shadcn)
│   ├── components/
│   │   ├── packet-grid/       # TanStack Virtual Table
│   │   ├── chat-sidebar/      # AI Interface
│   ├── hooks/                 # React Query hooks for Sharkd data
├── sidecar/                   # Python AI Agent
│   ├── agent.py               # PydanticAI Logic
│   ├── server.py              # FastAPI Interface
│   ├── engine.py              # Sharkd Helper Tools
├── binaries/                  # Compiled executables (sharkd, python-agent)

```

---

### 📅 Phase 1: The "Visualizer" (Weeks 1-2)

**Goal:** A working desktop app that opens a PCAP and scrolls through 100k+ packets without lag.

#### Step 1.1: The Rust Backend (Process Manager)

We need Rust to be the parent process that manages the lifecycle of `sharkd`.

* **Task:** Update `main.rs` to spawn `sharkd` with the `-` flag (stdio mode) or on a specific port.
* **Task:** Implement a `Command` in Rust called `load_pcap(path: String)`.
* *Logic:* It sends the `{"jsonrpc":"2.0","method":"load","params":{"file":"..."}}` request to the running `sharkd` instance.


* **Task:** Implement `get_frames(skip: u32, limit: u32)`.
* *Logic:* Calls `sharkd` method `frames` with `{"skip": n, "limit": n}`.



#### Step 1.2: The Virtualized Grid (Frontend)

This is the most critical UI component. If this lags, the app fails.

* **Tech:** Use `@tanstack/react-table` combined with `@tanstack/react-virtual`.
* **Strategy:** "Windowing".
1. Ask `sharkd` for the `total_frames` count.
2. Tell TanStack Virtual: "I have 1,000,000 rows." (It renders a fake scrollbar).
3. When the user scrolls to row 500, the `onRangeChange` event fires.
4. React calls Rust: `get_frames(skip=500, limit=50)`.
5. Rust asks `sharkd`, gets JSON, and returns it to React.


* **Performance Tip:** Use a fixed row height (e.g., 25px) to make the virtualization math O(1) instant.

---

### 📅 Phase 2: The "Bridge" (Week 3)

**Goal:** Connect the AI (Python) to the Data (Sharkd) via the UI.

#### Step 2.1: The Python Sidecar

* **Task:** Create a FastAPI server in `sidecar/server.py`.
* **Task:** Define the API Schema.
* `POST /analyze`: Accepts a user query + current packet context.
* `POST /filter`: Accepts a query, returns a Wireshark filter string.


* **Task:** Build the **Sharkd Connector** in Python.
* *Challenge:* Python cannot "own" the `sharkd` process (Rust does).
* *Solution:* Rust exposes a localhost HTTP proxy or Python connects to the same `sharkd` socket if using TCP.
* *Alternative:* Python asks Rust to ask Sharkd (Architecture decision: **Python -> Rust -> Sharkd** is safer for state management).



#### Step 2.2: The "Cursor" UI

* **Task:** Implement `Cmd+K` listener in React.
* **Task:** Create the **Context Manager**.
* When the user presses `Cmd+K`, capture:
* Selected Packet ID.
* Selected Stream ID.
* Visible Packet Range (e.g., 100-150).


* Send this JSON payload to the Python Sidecar.



---

### 📅 Phase 3: The "Intelligence" (Week 4+)

**Goal:** The Agent actually solves problems.

#### Step 3.1: The "Filter Translator" Tool

* **Input:** "Show me all failed DNS queries."
* **PydanticAI Logic:**
1. LLM generates `dns.flags.rcode != 0`.
2. Agent runs `sharkd.check(filter="...")` to validate syntax.
3. If valid, return to UI. If invalid, self-correct.



#### Step 3.2: The "Stream Summarizer" Tool

* **Task:** Implement `follow_stream` in Python.
* **Logic:**
1. Fetch full stream payload via `sharkd` `follow` method.
2. **Chunking:** If stream > 10KB, split into "Head" (Handshake), "Middle" (Sample), "Tail" (Teardown).
3. Feed chunks to LLM with prompt: *"Identify the root cause of disconnection."*



---

### 🚀 Sprint 1 Checklist (Start Today)

This list is your "Day 1" work queue.

* [ ] **Repo Setup:** Initialize `npm create tauri-app` (React/TS).
* [ ] **Environment:** Install Wireshark (ensure `sharkd` is in your PATH).
* [ ] **Rust Hello World:** Modify `main.rs` to print "Hello from Rust" and verify you can call it from React.
* [ ] **Sharkd Test:** Run `sharkd -` in a terminal. Paste this JSON to see if it responds:
```json
{"jsonrpc":"2.0","id":1,"method":"status"}

```


* [ ] **Python Setup:** Create `sidecar/` folder and `pyproject.toml`. Verify you can run `uv run server.py`.

### 💡 Technical Tip: The `Sharkd` JSON-RPC Quirk

Sharkd is strictly **newline-delimited**. When sending requests from Rust/Python, you **must** append `\n` to your JSON string, or it will hang forever waiting for the command to end.

**Which part would you like to build first: The Rust `Command` handler (to talk to Sharkd) or the React `VirtualTable`?**
