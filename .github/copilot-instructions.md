# Copilot Instructions

## Build And Run

- Install dependencies with `npm install`.
- Local development server: `npm run dev`.
- Production start: `npm start`.
- Lint: `npm run lint`.
- Tests are not configured yet (`npm test` exits with placeholder failure).

## Architecture

- Always follow the flow: Route -> Controller -> Service -> Utils.
- Keep business logic in services, not in routes or controllers.
- Keep validators in `src/validators` and apply them through `src/middlewares/validation.middleware.js`.
- Keep database access and transaction handling in services and DB helper modules under `src/db`.

## API And Response Conventions

- Use `ApiResponse` for successful API responses.
- Use `ApiError` for failures and pass errors using `next(error)` from controllers.
- Preserve stack traces when converting or rethrowing errors.
- Keep response and error shape uniform across endpoints.

## Error Handling And Logging Rules

- Never use `console.log`.
- Do not log errors from controllers or services; let centralized middleware handle error logging.
- `src/middlewares/error.middleware.js` is the single source of truth for API error responses.
- Avoid unnecessary try/catch blocks that only wrap and rethrow without adding value.

## Environment And Runtime Facts

- Required env var: `JWT_SECRET` (validated in `src/config/env.config.js`).
- Default API prefix is `/api/v1` via `API_BASE_PREFIX`.
- Default server port is `4000` unless overridden by `PORT`.

## Naming Conventions

- Follow `naming.txt` for file, folder, class, variable, function, and constant naming.
- File names are lowercase and dot-separated by role, for example `example.controller.js` and `example.service.js`.

## Implementation Notes For This Template

- Some scaffold files still contain placeholder patterns and TODO blocks.
- Prefer `src/utils/apiError.util.js`, `src/utils/apiResponse.util.js`, and `src/middlewares/error.middleware.js` as canonical patterns.
- If existing scaffold code conflicts with these instructions, follow these instructions for new or updated code.
