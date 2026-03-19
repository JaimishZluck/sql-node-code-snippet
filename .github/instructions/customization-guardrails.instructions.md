---
description: "Use when creating or updating Copilot customization assets (hooks, agents, prompts, instructions) in this repository. Enforces auditable guardrails, minimal scope edits, and hook safety patterns."
name: "Customization Guardrails"
applyTo: ".github/hooks/**/*.json, .github/agents/**/*.agent.md, .github/instructions/**/*.instructions.md, .github/prompts/**/*.prompt.md, scripts/hooks/**/*.js"
---
# Customization Guardrails

## Purpose
- Keep Copilot customization changes deterministic, small, and easy to review.
- Prefer policy files and hook scripts that are explicit about trigger, behavior, and side effects.

## Rules
- Use the smallest change that satisfies the request.
- Keep one concern per file. If needed, split into separate customization files.
- When defining safety behavior, classify actions as allow, ask, or deny with a clear reason.
- Avoid broad global behavior unless the user explicitly requests repository-wide enforcement.
- Document testing steps for new or changed hooks.

## Hook Design
- Keep hooks short, auditable, and fast.
- Parse hook input defensively and tolerate missing fields.
- For command-guard hooks, use explicit pattern lists for deny and ask categories.
- Default to allow when input is malformed, unless the user requests strict fail-closed behavior.
- On Windows, normalize stdin payloads before JSON parsing to handle null-byte and BOM input artifacts.

## Validation Checklist
- Confirm hook output matches expected schema for its event.
- Test at least one allow, one ask, and one deny path when implementing PreToolUse guards.
- Verify no unrelated files were changed.

## Output Expectations
- Summarize changed file paths first.
- List enforced behavior as concise bullets.
- Call out ambiguities and ask focused follow-up questions.
