# PacketPilot Multi-Agent Templates

Use these templates when operating with `claw-connect`.

## Task Template

```text
Subject: <short task title>
Labels: <frontend|rust|python-sidecar|tests|release|docs>
Assigned role: <role>
Depends on: <task ids or none>

Goal:
<single measurable outcome>

Scope:
In:
- <paths or components>
Out:
- <explicit exclusions>

Acceptance criteria:
1. <criterion>
2. <criterion>

Verification:
- <exact command>
- <exact command>
```

## Request Message Template

```json
{
  "type": "request",
  "task_id": "<task id>",
  "action": "<what you need>",
  "owner_role": "<sender role>",
  "status": "blocked",
  "summary": "<one-line blocker>",
  "context_keys": ["task-<id>-artifact-<kind>-<timestamp>"]
}
```

## Response Message Template

```json
{
  "type": "response",
  "task_id": "<task id>",
  "action": "<response action>",
  "owner_role": "<sender role>",
  "status": "in_progress",
  "summary": "<one-line response>",
  "context_keys": []
}
```

## Context Artifact Template

```text
Key: task-<id>-artifact-<kind>-<timestamp>
Content-Type: text/plain | application/json | text/diff
Summary: <what this artifact proves>
Produced by: <role>
```

## Completion Update Template

```text
Task: <task id>
Status: completed
Owner: <role>

Result:
- <change summary>

Verification performed:
- <command> -> pass/fail
- <command> -> pass/fail

Artifacts:
- <context key>
```

## Review Verdict Template

Passed:

```text
Review: passed
Task: <task id>
Verifier: <reviewer role>
Evidence:
- <context key>
Notes:
- <short note>
```

Failed:

```text
Review: failed
Task: <task id>
Verifier: <reviewer role>
Findings:
1. <severity> <file>:<line> <issue>
2. <severity> <file>:<line> <issue>
Rework owner: <role>
Artifacts:
- <context key>
```

## Event Payload Template

```json
{
  "event_type": "task.completed",
  "payload": {
    "task_id": "<task id>",
    "owner_role": "<role>",
    "summary": "<one line>",
    "next": "<next action>"
  }
}
```
