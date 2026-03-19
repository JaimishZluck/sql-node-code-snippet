# Copilot Context

## Project Philosophy & Context

- **Centralized Error Handling:** All errors are caught and logged in a single error middleware, ensuring consistent logging and response formatting.
- **Standardized Responses:** Every successful API call returns an `ApiResponse` object. All errors are returned as `ApiError` objects.
- **No Scattered Logging:** Logging is centralized in the error middleware. Services and controllers do not log errors or use `console.log`.
- **Error Bubbling:** Errors thrown in utilities or services bubble up to controllers and are passed to the error middleware using `next(error)`. This preserves the full stack trace for debugging.
- **Minimal Try/Catch:** Only use try/catch in controllers to delegate errors. Avoid catching errors in services/utilities unless necessary for cleanup.
- **Debugging:** Stack traces are logged in the error middleware, allowing developers to trace issues to their root cause.
- **Empty Data Handling:** Return empty arrays/objects as success if valid, or throw a controlled `ApiError` if empty data is considered an error for the use case.
