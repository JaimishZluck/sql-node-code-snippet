---
name: api-development
description: 'Scaffold or implement backend API resources using the project pattern Route -> Controller -> Service -> Utils with validation and uniform responses.'
argument-hint: 'Provide resource name, endpoint operations, auth need, and required fields.'
user-invocable: true
---

# API Development Workflow

## Outcome
Create or update backend API resources that match project architecture and conventions.

## Use When
- Adding a new API resource.
- Expanding an existing endpoint set.
- Refactoring API code to match route/controller/service boundaries.

## Inputs
- Resource name and endpoint list.
- Validation requirements for body, params, and query.
- Authentication requirement per endpoint.
- Data operations and transaction needs.

## Procedure
1. Confirm requested endpoints and data contracts.
2. Create or update validator schema in src/validators.
3. Add routes in src/routes using validation middleware.
4. Implement controller handlers using ApiResponse and next(error).
5. Implement service logic with DB operations and transaction handling when needed.
6. Register routes in API routing entrypoint when applicable.
7. Run lint or targeted validation if requested.
8. Summarize changed files, endpoint behavior, and checks performed.

## Decision Points
- Transaction scope:
- Use transaction when multiple writes must be atomic.
- Keep simple read operations non-transactional.
- Validation strictness:
- Require validators for all write endpoints.
- Add query validators for filtered list/search endpoints.
- Error strategy:
- Throw ApiError for domain failures.
- Let unexpected errors bubble for centralized middleware handling.

## Completion Checks
- Follows Route -> Controller -> Service -> Utils.
- Uses ApiResponse and ApiError patterns.
- No console.log added.
- Validator coverage matches endpoint inputs.
- Summary includes endpoint map and verification steps.

## Key References
- [copilot-instructions.md](../../copilot-instructions.md)
- [customization-guardrails.instructions.md](../../instructions/customization-guardrails.instructions.md)
