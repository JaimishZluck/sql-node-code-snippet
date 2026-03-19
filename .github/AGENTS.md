# Agent Registry

This file documents workspace customization entry points for API-focused development tasks.

## Available Agent

### API Development Specialist

- File: `.github/agents/api-development.agent.md`
- Use for: Implementing or scaffolding backend API resources with route/controller/service/validator structure.
- Best prompt: "Create invoice endpoints with create, get, and list operations and strict body validation."

## Available Skill

### api-development

- File: `.github/skills/api-development/SKILL.md`
- Use for: Step-by-step API implementation workflow with decision points and completion checks.
- Best prompt: "/api-development Build customer CRUD with auth on write endpoints."

## Available Prompt

### Scaffold API Resource

- File: `.github/prompts/scaffold-api-resource.prompt.md`
- Use for: Quick reusable API scaffold generation for one resource.
- Best prompt: "/Scaffold API Resource resource=payment endpoints=create,get,list auth=write-only"

## Notes

- Global project behavior is still defined in `.github/copilot-instructions.md`.
- Use this registry to discover specialized assets quickly.
