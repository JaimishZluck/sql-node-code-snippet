---
description: "Scaffold backend API files for one resource using this project's route-controller-service-validator pattern."
name: "Scaffold API Resource"
argument-hint: "Resource name, endpoints, fields, auth requirement, and validation strictness."
agent: "agent"
tools: [read, search, edit]
---
Generate or refine scaffolding for a single backend API resource in this workspace.

Required behavior:
- Follow Route -> Controller -> Service -> Utils architecture.
- Create or update validator schemas in src/validators.
- Use ApiResponse for success and ApiError for failure paths.
- Keep changes minimal and consistent with existing naming conventions.

Inputs to extract from argument:
- Resource name.
- Endpoint list and HTTP methods.
- Required request fields and validation expectations.
- Auth requirement by endpoint.

Output format:
1. Changed file paths.
2. Endpoint map.
3. Code changes summary.
4. Verification checklist.
