import { v4 as uuidv4 } from "uuid";

// Request ID middleware for tracing individual HTTP requests.
// Integrates with the correlation ID system in logger/correlation.logger.js.
// TODO(project-setup): decide if you want to propagate external request IDs from upstream services.
export const requestIdMiddleware = (req, res, next) => {
  const existingId =
    req.headers["x-request-id"] ||
    req.headers["x-correlation-id"] ||
    uuidv4();

  req.requestId = existingId;
  res.setHeader("X-Request-Id", existingId);

  next();
};

