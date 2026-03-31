# PacketPilot Multi-Agent Runbook

This file defines the default operating model for Codex-based multi-agent work in PacketPilot.

## Default Topology

Use one coordinator and four workers by default:

1. `coordinator`
2. `frontend-fixer`
3. `desktop-fixer`
4. `sidecar-fixer`
5. `test-runner`

Use `reviewer` as a separate role on larger changes, or let `coordinator` handle review on small tasks.

## Control Plane

Use `claw-connect` in local mode as the communication hub.

Required channels:

1. Task board: `cc_create_task`, `cc_claim_task`, `cc_update_task`
2. Direct messages: `cc_send_message`, `cc_get_messages`, `cc_wait_for_messages`, `cc_ack_message`
3. Events: `cc_subscribe`, `cc_publish_event`, `cc_poll_events`
4. Artifact context: `cc_share_context`, `cc_get_context`

## Ownership Map

1. `frontend-fixer` owns `src/**`, `public/**`, `vite.config.ts`
2. `desktop-fixer` owns `electron/**`, `shared/**`, `resources/**`, `package.json`, `.github/workflows/**`, and archived desktop migration surfaces under `src-tauri/**`
3. `sidecar-fixer` owns `sidecar/**`
4. `test-runner` owns cross-surface verification and CI parity checks
5. `coordinator` owns decomposition, dependencies, and merge sequencing

## Labels

Use these canonical task labels:

1. `frontend`
2. `desktop`
3. `python-sidecar`
4. `tests`
5. `release`
6. `docs`

## Message Contract

All direct messages must use one of:

1. `request`
2. `response`
3. `info`
4. `error`
5. `context`

Message bodies must include:

```json
{
  "task_id": "<task id>",
  "action": "<verb phrase>",
  "owner_role": "<role>",
  "status": "<state>",
  "summary": "<one line>",
  "context_keys": ["optional", "artifact", "keys"]
}
```

Keep message text short. Put large output in shared context and send only keys in a `context` message.

## Task State Machine

Use this state flow:

1. `open`
2. `claimed`
3. `in_progress`
4. `blocked` or `completed` or `failed`

Required behavior:

1. Workers heartbeat every 30-60 seconds while active.
2. Coordinator reclaims tasks when heartbeat is missing for 2+ minutes.
3. Blocked tasks must include explicit unblock condition.

## Event Contract

Use these event names:

1. `task.claimed`
2. `task.blocked`
3. `task.completed`
4. `review.requested`
5. `review.failed`
6. `review.passed`

## Default Workflow: Issue -> Taskboard -> PR

1. Coordinator reads issue and splits into atomic tasks with labels and dependencies.
2. Workers claim by label and immediately move task to `in_progress`.
3. Workers implement and attach artifacts with `cc_share_context`.
4. Workers set task to `completed` with verification summary.
5. Reviewer validates acceptance criteria and publishes `review.passed` or `review.failed`.
6. Coordinator assembles final branch and opens PR.

## Verification Gates

Run the minimum checks for touched areas.

Frontend (`src/**`):

```bash
npm run build
```

Desktop runtime (`electron/**`, `shared/**`, `resources/**`, `package.json`, `.github/workflows/**`):

```bash
npm run build
npm run smoke:packaged
```

Archived Tauri (`src-tauri/**`, migration forensics only):

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Python sidecar (`sidecar/**`):

```bash
cd sidecar
source .venv/bin/activate
pytest tests/unit -v
pytest tests/integration -v
```

Cross-surface or release-sensitive changes:

```bash
npm run dist
npm run smoke:packaged
cd sidecar && source .venv/bin/activate && pytest tests/ -v
```

## Branching And Naming

Use branch names tied to task and role:

1. `codex/<task-id>-frontend`
2. `codex/<task-id>-desktop`
3. `codex/<task-id>-sidecar`
4. `codex/<task-id>-tests`

Use shared context keys with deterministic names:

1. `task-<id>-artifact-testlog-<timestamp>`
2. `task-<id>-artifact-diff-<timestamp>`
3. `task-<id>-artifact-review-<timestamp>`

## Failure Recovery

Worker crash:

1. Coordinator marks task back to `open`.
2. Coordinator emits reassignment info message and assigns a new owner.

Conflicting edits:

1. Reviewer flags conflict with concrete files.
2. Coordinator serializes merge order and updates dependencies.

Flaky tests:

1. `test-runner` attaches failing logs and retries count.
2. Coordinator marks task `blocked` until deterministic pass or scoped exception.

## Quick Start

1. Run `scripts/agents/check-env.sh`.
2. Use `scripts/agents/roles.sh` to confirm role and label vocabulary.
3. Start coordinator and workers.
4. Process one issue end-to-end using the default workflow.
