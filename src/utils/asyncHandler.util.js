// Helper to wrap async route handlers and forward errors to the central error handler.
// Usage:
//   router.get("/example", asyncHandler(async (req, res) => { ... }));
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

