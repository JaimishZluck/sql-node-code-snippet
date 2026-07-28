/**
 * Shared helpers for the bootcamp API.
 *
 * Everything here exists because it is needed in more than one route. This
 * is the "reusable utility" line: parsing query strings and wrapping async
 * handlers are genuinely repeated concerns; the actual database work stays
 * visible in each route file.
 */
import mongoose from "mongoose";

/**
 * Express 4 does not forward errors thrown from an async handler, so an
 * unhandled rejection becomes a hung request instead of a 500. Wrapping every
 * async route in this passes rejections to next(), where the error middleware
 * can turn them into a proper response.
 *
 * (Express 5 does this automatically — this wrapper is why you often see
 * "asyncHandler" or "catchAsync" in Express 4 codebases.)
 */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/** An error carrying the HTTP status the client should receive. */
export class ApiError extends Error {
  constructor(message, status = 400, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Validate an id BEFORE it reaches the database.
 *
 * Without this, /api/products/not-an-id throws a CastError deep inside
 * Mongoose and — unless caught — becomes a 500. A 400 with a clear message is
 * both more correct and more useful.
 */
export const requireObjectId = (value, label = "id") => {
  if (!mongoose.Types.ObjectId.isValid(value) || String(new mongoose.Types.ObjectId(value)) !== value) {
    throw new ApiError(`Invalid ${label}: ${value}`, 400);
  }
  return new mongoose.Types.ObjectId(value);
};

/**
 * Parse page/limit from a query string safely.
 *
 * Two protections that matter in production:
 *  - every query-string value is a STRING, so it must be converted
 *  - `limit` must be CAPPED, or one request asking for ?limit=999999999
 *    can exhaust your memory and your database's
 */
export const parsePagination = (query, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requested = Number.parseInt(query.limit, 10) || defaultLimit;
  const limit = Math.min(Math.max(1, requested), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * Translate a small allow-list of sort keys into a Mongoose sort object.
 *
 * NEVER pass a raw query value into .sort(). An allow-list keeps the sort on
 * indexed fields and stops a client from forcing an expensive unindexed sort.
 */
export const parseSort = (value, allowed, fallback) => allowed[value] ?? fallback;

/** Standard envelope so every list endpoint responds the same shape. */
export const paginated = (items, { page, limit, total }) => ({
  data: items,
  meta: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  },
});
