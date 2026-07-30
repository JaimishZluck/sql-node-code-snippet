import logger from "../logger/winston.logger.js";
import { ApiError } from "../utils/apierror.util.js";
import Order from "../models/order.model.js";
import { createdata, updateData, fetchSingleData, findAllData, deleteData, startTransaction } from "../db/operations.db.js";

/**
 * Order service
 *
 * Exposes the core CRUD and upsert operations for Order plus a single rich
 * "fetch" that demonstrates important aggregation stages used in real apps.
 *
 * Each function follows the project's error-handling pattern: validate inputs,
 * throw ApiError(400) for client errors, ApiError(404) when a resource is
 * not found, and ApiError(500) for unexpected problems.
 */

/**
 * Create an order
 * - Validates required fields (user, items, totalAmount, orderNumber)
 * - Uses a transaction so creation can be extended to update other documents
 *   (inventory, user stats, ledger) atomically in the future.
 */
const createOrder = async (body) => {
  let session = null;
  try {
    if (!body || typeof body !== "object") {
      throw new ApiError(400, "Order data is required", ["Empty or invalid body"]);
    }

    const { user, items, totalAmount, orderNumber, shippingAddress } = body;

    if (!user) throw new ApiError(400, "user is required");
    if (!orderNumber) throw new ApiError(400, "orderNumber is required");
    if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, "items must be a non-empty array");
    if (typeof totalAmount !== "number" || totalAmount < 0) throw new ApiError(400, "totalAmount must be a non-negative number");
    if (!shippingAddress) throw new ApiError(400, "shippingAddress is required");

    // Basic integrity checks for each line item
    for (const [idx, it] of items.entries()) {
      if (!it.product) throw new ApiError(400, `items[${idx}].product is required`);
      if (!it.productName) throw new ApiError(400, `items[${idx}].productName is required`);
      if (typeof it.unitPrice !== "number" || it.unitPrice < 0) throw new ApiError(400, `items[${idx}].unitPrice must be a non-negative number`);
      if (typeof it.quantity !== "number" || it.quantity <= 0) throw new ApiError(400, `items[${idx}].quantity must be > 0`);
      if (typeof it.subtotal !== "number" || it.subtotal < 0) throw new ApiError(400, `items[${idx}].subtotal must be a non-negative number`);
    }

    session = await startTransaction();

    // createdata uses the provided session so this create participates in the transaction
    const created = await createdata(Order, body, session);

    await session.commitTransaction();

    return created;
  } catch (error) {
    if (session) await session.abortTransaction();
    throw error instanceof ApiError ? error : new ApiError(500, "Create order failed", [error.message], error.stack);
  } finally {
    if (session) await session.endSession();
  }
};

/**
 * Get orders with powerful aggregation examples and pagination
 *
 * Learning-focused: this function demonstrates a few useful aggregation
 * patterns found in production dashboards and analytics queries.
 *
 * Supported options:
 *  - page, limit: pagination
 *  - sort: sort object for the data facet
 *  - include: array of analytics to include: ["totals", "topProducts", "monthly"]
 *
 * Implementation notes (why these stages are used):
 *  - $match: filters documents early, reducing the amount of work later.
 *  - $facet: runs multiple sub-pipelines on the same input. Here it's used to
 *            produce: metadata (total count), data (paginated results), and
 *            analytics (summaries like total sales). Using $facet avoids
 *            multiple round-trips to the database.
 *  - $unwind: expands arrays (items) so we can group by product for totals.
 *  - $group: classic aggregation to compute sums, counts, averages.
 *  - $project: reshapes documents and removes internal fields before returning.
 *  - $sort/$skip/$limit: implement stable pagination when combined with indexes.
 */
const getOrdersAggregate = async (filter = {}, options = {}) => {
  try {
    // Pagination defaults
    const page = Math.max(1, parseInt(options.page) || 1);
    const limit = Math.max(1, parseInt(options.limit) || 10);
    const skip = (page - 1) * limit;
    const sort = options.sort || { placedAt: -1 };
    const include = Array.isArray(options.include) ? options.include : [];

    // Build a $match stage from the filter to execute early in the pipeline.
    const matchStage = { $match: {} };
    if (filter.user) matchStage.$match.user = filter.user;
    if (filter.status) matchStage.$match.status = filter.status;
    if (filter.from || filter.to) {
      matchStage.$match.placedAt = {};
      if (filter.from) matchStage.$match.placedAt.$gte = new Date(filter.from);
      if (filter.to) matchStage.$match.placedAt.$lte = new Date(filter.to);
    }

    // The analytics facet runs only when requested. Examples included:
    const analyticsFacet = {};

    if (include.includes("totals")) {
      // totals: overall totals/counts for the matched set
      analyticsFacet.totals = [
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalSales: { $sum: "$totalAmount" },
            avgOrderValue: { $avg: "$totalAmount" },
          },
        },
        {
          $project: { _id: 0, totalOrders: 1, totalSales: 1, avgOrderValue: 1 },
        },
      ];
    }

    if (include.includes("topProducts")) {
      // topProducts: find best-selling products by quantity and revenue
      // $unwind expands items so each line can be grouped by product
      analyticsFacet.topProducts = [
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.product",
            productName: { $first: "$items.productName" },
            totalQuantity: { $sum: "$items.quantity" },
            totalRevenue: { $sum: "$items.subtotal" },
          },
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, product: "$_id", productName: 1, totalQuantity: 1, totalRevenue: 1 } },
      ];
    }

    if (include.includes("monthly")) {
      // monthly: sales aggregated per year-month. $dateToString converts the
      // placedAt date to a string bucket like "2026-07" so grouping is simple.
      analyticsFacet.monthly = [
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$placedAt" } },
            totalSales: { $sum: "$totalAmount" },
            orderCount: { $sum: 1 },
            avgOrderValue: { $avg: "$totalAmount" },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { period: "$_id", _id: 0, totalSales: 1, orderCount: 1, avgOrderValue: 1 } },
      ];
    }

    // Main pipeline: match -> facet
    const pipeline = [matchStage, {
      $facet: {
        metadata: [
          { $count: "total" },
          { $addFields: { page: page, limit: limit } },
        ],
        data: [
          { $sort: sort }, // sort before skip/limit for correct pagination
          { $skip: skip },
          { $limit: limit },
          // Optionally project fields to avoid sending entire nested documents
          { $project: { __v: 0 } },
        ],
        // Merge the requested analytics facets into the same $facet doc. If
        // none requested, analytics will be an empty object.
        analytics: [
          // placeholder: will be replaced below with the combined analytics pipeline
        ],
      },
    }];

    // If analyticsFacet has pipelines, compose them into a single analytics array
    const analyticsPipelines = [];
    for (const key of Object.keys(analyticsFacet)) {
      // Each analytics facet pipeline is wrapped with a $group to attach the
      // result under a key so the final analytics field contains each piece.
      analyticsPipelines.push(
        ...[
          { $facet: { [key]: analyticsFacet[key] } },
        ]
      );
    }

    // If analyticsPipelines is empty, leave pipeline as-is; else append them.
    // The technique above (multiple $facet stages) keeps each analytics result
    // isolated by name. Alternatively a single $facet with nested fields could
    // be used but building dynamic keys is more verbose.
    if (analyticsPipelines.length > 0) {
      pipeline.push(...analyticsPipelines);
    }

    // Run aggregation
    const result = await Order.aggregate(pipeline).allowDiskUse(true).exec();

    // The aggregation returns an array with one document because of the outer $facet
    // If analytics were appended as additional pipeline stages producing their own
    // output, merge them carefully. For simplicity, return the raw result for
    // learning and let callers explore the structure.
    return result;

  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Fetch orders aggregation failed", [error.message], error.stack);
  }
};

/**
 * Simple paginated find (non-aggregation) for normal listing endpoints
 * Demonstrates using findAllData with skip/limit and sort.
 */
const getOrders = async (filter = {}, options = {}) => {
  try {
    const page = Math.max(1, parseInt(options.page) || 1);
    const limit = Math.max(1, parseInt(options.limit) || 10);
    const skip = (page - 1) * limit;
    const sort = options.sort || { placedAt: -1 };

    const queryOptions = {
      skip,
      limit,
      sort,
      populate: options.populate || [],
    };

    const data = await findAllData(Order, filter, queryOptions);

    return data;
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Fetch orders failed", [error.message], error.stack);
  }
};

/**
 * Update an order by id
 */
const updateOrder = async (id, data) => {
  try {
    if (!id) throw new ApiError(400, "Order id is required");
    if (!data || Object.keys(data).length === 0) throw new ApiError(400, "Update data is required");

    const updated = await updateData(Order, { _id: id }, data);
    if (!updated) throw new ApiError(404, "Order not found", [`Order with id ${id} not found`]);

    return updated;
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Update order failed", [error.message], error.stack);
  }
};

/**
 * Delete an order by id
 */
const deleteOrder = async (id) => {
  try {
    if (!id) throw new ApiError(400, "Order id is required");

    const removed = await deleteData(Order, { _id: id });
    if (!removed) throw new ApiError(404, "Order not found", [`Order with id ${id} not found`]);

    return removed;
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Delete order failed", [error.message], error.stack);
  }
};

/**
 * Upsert an order: find by query and update, or insert if missing.
 * Useful for idempotent create-or-update flows (webhooks, external sync).
 */
const upsertOrder = async (query, data) => {
  try {
    if (!query || Object.keys(query).length === 0) throw new ApiError(400, "Upsert query is required");
    if (!data || Object.keys(data).length === 0) throw new ApiError(400, "Upsert data is required");

    const updated = await Order.findOneAndUpdate(query, data, { upsert: true, new: true, runValidators: true }).exec();
    return updated;
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Upsert order failed", [error.message], error.stack);
  }
};

export {
  createOrder,
  getOrders,
  getOrdersAggregate,
  updateOrder,
  deleteOrder,
  upsertOrder,
};
