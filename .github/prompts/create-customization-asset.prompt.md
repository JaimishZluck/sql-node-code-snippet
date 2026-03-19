---
description: "Create or refine one Copilot customization asset in this repository using an iterative workflow (extract context, draft, clarify ambiguities, finalize). Keywords: hook, agent, instruction, prompt, guardrail, policy."
name: "Create Customization Asset"
argument-hint: "Describe what to create or update (type, behavior, scope, and strictness)."
agent: "agent"
tools: [read, search, edit, execute]
---
Create or refine exactly one Copilot customization asset in this workspace.

User request:
- Use the provided prompt argument as the primary requirement.
- If no argument is provided, infer the task from recent chat context.

Workflow:
1. Extract the task pattern and intended behavior from conversation context.
2. Choose the correct asset type: hook, agent, instruction, or prompt.
3. Draft the smallest viable file change with clear, auditable behavior.
4. Identify the weakest or most ambiguous policy decisions and ask focused follow-up questions.
5. Finalize with a concise summary, validation steps, and related next customizations.

Quality requirements:
- Keep scope narrow and avoid unrelated edits.
- Prefer explicit allow, ask, deny behavior where safety rules are involved.
- Provide practical test examples for the created or updated asset.
- Do not duplicate large policy text from other files; reference existing files when appropriate.

Output format:
- Changed file paths first
- Enforced behavior bullets
- Open questions (if any)
- 2 to 4 example invocations
