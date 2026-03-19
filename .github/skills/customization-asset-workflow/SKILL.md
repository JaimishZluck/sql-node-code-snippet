---
name: customization-asset-workflow
description: 'Create or refine Copilot customization assets with an iterative workflow. Use for hooks, agents, instructions, and prompts that need minimal-scope edits, ambiguity checks, and validation before finalizing.'
argument-hint: 'Describe the asset type, required behavior, scope, and strictness.'
user-invocable: true
---

# Customization Asset Workflow

## Outcome
Produce one high-quality customization change at a time, with explicit behavior, focused scope, and practical validation steps.

## Use When
- Creating or refining a hook, agent, instruction, or prompt.
- Turning repeated chat guidance into reusable project policy.
- Standardizing customization work into a consistent reviewable flow.

## Inputs
- Requested asset type or target file.
- Intended behavior and strictness (allow, ask, deny, or guidance-only).
- Scope boundaries (workspace-shared vs personal, specific folders vs broad).

## Procedure
1. Load requirements and active customization guidance.
2. Extract the repeatable pattern from conversation context.
3. Choose the correct primitive:
- Hook for deterministic enforcement at lifecycle events.
- Agent for specialized role and tool restrictions.
- Instruction for reusable coding and policy guidance.
- Prompt for single focused reusable task templates.
4. Draft the smallest viable change in one focused file whenever possible.
5. Validate syntax and diagnostics.
6. Identify weak or ambiguous policy choices and ask at least one focused follow-up question.
7. Apply user selections and finalize.
8. Summarize what was enforced, how to test it, and recommended next customizations.

## Decision Points
- Enforcement vs guidance:
- Use hook when behavior must be guaranteed.
- Use instruction when behavior should be encouraged.
- Scope selection:
- Prefer workspace scope for team policies.
- Use personal scope only when behavior is user-specific.
- Strictness:
- Prefer narrow, explicit rules and avoid broad defaults unless requested.
- Validation depth:
- Run lightweight validation for file correctness at minimum.
- Add behavioral test cases when changing hooks.

## Completion Checks
- Exactly one clear primary customization objective is implemented.
- Changes are minimal and do not include unrelated edits.
- Frontmatter is valid for the customization type.
- At least one ambiguity question was asked and resolved before finalization.
- A concise test plan is provided.

## Related Assets In This Repository
- Hook baseline: [pretooluse-safety.json](../../hooks/pretooluse-safety.json)
- Hook guard script: [guard-pretooluse.js](../../../scripts/hooks/guard-pretooluse.js)
- Customization instruction: [customization-guardrails.instructions.md](../../instructions/customization-guardrails.instructions.md)
- Reusable prompt: [create-customization-asset.prompt.md](../../prompts/create-customization-asset.prompt.md)
- Specialized agent: [policy-customization.agent.md](../../agents/policy-customization.agent.md)
