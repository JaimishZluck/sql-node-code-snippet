/**
 * The single error handler for the bootcamp API.
 *
 * This is module 15 turned into working code: every error type Mongoose and
 * MongoDB can produce is mapped to the HTTP status that actually describes
 * it. Controllers never build error responses themselves — they throw, and
 * this decides what the client sees.
 *
 * Express recognises a middleware as an error handler by its FOUR arguments.
 * Removing `next` (even though it looks unused) silently turns this into an
 * ordinary middleware that never runs.
 */
import { ApiError } from "./helpers.js";

// eslint-disable-next-line no-unused-vars
export const errorMiddleware = (error, req, res, next) => {
  // 1. Errors we threw on purpose already know their status.
  if (error instanceof ApiError) {
    return res.status(error.status).json({ message: error.message, details: error.details });
  }

  // 2. A schema rule failed -> the client sent bad data.
  if (error.name === "ValidationError") {
    return res.status(400).json({
      message: "Validation failed",
      // error.errors is keyed by field path — exactly what a form needs.
      errors: Object.fromEntries(
        Object.entries(error.errors).map(([path, detail]) => [path, detail.message])
      ),
    });
  }

  // 3. A value could not be converted to its schema type (usually a bad id).
  if (error.name === "CastError") {
    return res.status(400).json({ message: `Invalid ${error.path}: ${error.value}` });
  }

  // 4. A unique index rejected the write. keyPattern names the field.
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? "value";
    return res.status(409).json({ message: `That ${field} is already in use` });
  }

  // 5. .orFail() matched nothing.
  if (error.name === "DocumentNotFoundError") {
    return res.status(404).json({ message: "Not found" });
  }

  // 6. The document changed between our read and our write.
  if (error.name === "VersionError") {
    return res.status(409).json({ message: "The record changed — please retry" });
  }

  // 7. The database is unreachable. Ours to fix, and probably temporary.
  if (error.name?.includes("ServerSelection") || error.name === "MongoNetworkError") {
    console.error("[db unreachable]", error.message);
    return res.status(503).json({ message: "Service temporarily unavailable" });
  }

  // 8. Anything else is our bug. Log everything, tell the client nothing —
  //    raw messages leak index names, schema paths, and connection strings.
  console.error("[unhandled]", error);
  return res.status(500).json({ message: "Internal server error" });
};

/** 404 for unmatched routes. Registered after all real routes. */
export const notFoundMiddleware = (req, res) =>
  res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` });
