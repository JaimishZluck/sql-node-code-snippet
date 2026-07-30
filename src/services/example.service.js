/**
 * Services contain business logic
 *
 * Responsibilities:
 * - Validate business requirements
 * - Execute database operations
 * - Transform and format data
 * - Throw ApiError for validation failures and operational errors
 * - Re-wrap unexpected errors as ApiError(500)
 *
 * Error Handling Pattern:
 * - Use try-catch for all async operations
 * - Input validation: Throw ApiError(400, ...) with clear message
 * - Not found: Throw ApiError(404, ...) with resource identifier
 * - Database errors: Let them propagate or transform with meaningful message
 * - Operational errors: Throw ApiError(500, ...) with error details
 * - On catch: Re-throw if already ApiError, else wrap as ApiError(500)
 *
 * Transaction Pattern (Database):
 * - Session management for ACID operations
 * - try: Start transaction, execute operations, commit
 * - catch: Abort transaction on error before re-throwing
 * - finally: Ensure session cleanup (optional if catching all)
 *
 * File Cleanup Pattern (if service handles files):
 * - Validate file is provided before processing
 * - In catch: Delete file from disk if operation fails after upload
 * - In finally: Clean up request references
 *
 * Example of unified error pattern:
 *   throw error instanceof ApiError ? error : new ApiError(500, "Operation failed", [error.message], error.stack);
 */

import logger from "../logger/winston.logger.js";
import { ApiError } from "../utils/apierror.util.js";
import Example from "../models/example.model.js";
import { createdata, updateData, fetchSingleData, findAllData, deleteData, startTransaction } from "../db/operations.db.js";

/**
 * Example: Create item with transaction support
 * Pattern: try-catch-finally with transaction cleanup
 */
const createItem = async (body, Model = null) => {
  let session = null;
  try {
    if (!Model) {
      throw new ApiError(400, "Model not provided", ["This is a template function. Implement with your actual model."]);
    }

    logger.info("createItem: Starting item creation");

    if (!body || Object.keys(body).length === 0) {
      throw new ApiError(400, "Item data is required", ["Empty body provided"]);
    }

    session = await startTransaction();
    const result = await createdata(Model, body, session);
    await session.commitTransaction();

    logger.info("createItem: Item created successfully");
    return result;

  } catch (error) {
    if (session) await session.abortTransaction();
    throw error instanceof ApiError ? error : new ApiError(500, "Create item failed", [error.message], error.stack);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

/**
 * Example: Update item
 */
const updateItem = async (id, data, Model = null) => {
  try {
    if (!Model) {
      throw new ApiError(400, "Model not provided", ["This is a template function. Implement with your actual model."]);
    }

    logger.info("updateItem: Starting item update");

    if (!id) {
      throw new ApiError(400, "Item ID is required", ["ID not provided"]);
    }

    if (!data || Object.keys(data).length === 0) {
      throw new ApiError(400, "Update data is required", ["Empty update data"]);
    }

    const result = await updateData(Model, { _id: id }, data);

    if (!result) {
      throw new ApiError(404, "Item not found", [`Item with id ${id} not found`]);
    }

    logger.info("updateItem: Item updated successfully");
    return result;

  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Update item failed", [error.message], error.stack);
  }
};

/**
 * Example: Get single item
 */
const getItem = async (id, Model = null, populate = []) => {
  try {
    if (!Model) {
      throw new ApiError(400, "Model not provided", ["This is a template function. Implement with your actual model."]);
    }

    logger.debug("getItem: Fetching item");

    if (!id) {
      throw new ApiError(400, "Item ID is required", ["ID not provided"]);
    }

    const item = await fetchSingleData(Model, { _id: id }, populate);

    if (!item) {
      throw new ApiError(404, "Item not found", [`Item with id ${id} not found`]);
    }

    return item;

  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Fetch item failed", [error.message], error.stack);
  }
};

/**
 * Example: Get all items
 */
const getAllItems = async (Model = null, filter = {}, options = {}) => {
  try {
    if (!Model) {
      throw new ApiError(400, "Model not provided", ["This is a template function. Implement with your actual model."]);
    }

    logger.debug("getAllItems: Fetching items");

    const items = await findAllData(Model, filter, options);
    logger.info("getAllItems: Items fetched successfully");
    return items;

  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Fetch items failed", [error.message], error.stack);
  }
};

/**
 * Example: Delete item
 */
const removeItem = async (id, Model = null) => {
  try {
    if (!Model) {
      throw new ApiError(400, "Model not provided", ["This is a template function. Implement with your actual model."]);
    }

    logger.info("removeItem: Starting item deletion");

    if (!id) {
      throw new ApiError(400, "Item ID is required", ["ID not provided"]);
    }

    const result = await deleteData(Model, { _id: id });

    if (!result) {
      throw new ApiError(404, "Item not found", [`Item with id ${id} not found`]);
    }

    logger.info("removeItem: Item deleted successfully");
    return result;

  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Delete item failed", [error.message], error.stack);
  }
};

/**
 * Example: Aggregation pipeline with a filter
 * This shows how $match works like a filter before grouping the data.
 */
const getExampleNameSummary = async (filter = {}) => {
  try {
    logger.debug("getExampleNameSummary: Running aggregation pipeline");

    const pipeline = [
      {
        $match: {
          ...(filter.name ? { name: { $regex: filter.name, $options: "i" } } : {}),
        },
      },
      {
        $group: {
          _id: "$name",
          totalExamples: { $sum: 1 },
          latestCreatedAt: { $max: "$createdAt" },
        },
      },
      {
        $sort: { totalExamples: -1 },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          totalExamples: 1,
          latestCreatedAt: 1,
        },
      },
    ];

    return await Example.aggregate(pipeline);
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Aggregation failed", [error.message], error.stack);
  }
};

/**
 * Example: Get service status
 */
const getExampleStatus = async ({ includeUser, user }) => {
  const shouldIncludeUser = includeUser === true || includeUser === 'true';

  const data = {
    service: 'example',
    status: 'UP',
    timestamp: new Date().toISOString(),
    authenticated: true,
  };

  if (shouldIncludeUser) {
    data.user = {
      id: user?.id ?? null,
      role: user?.role ?? null,
    };
  }

  return data;
};

export {
  createItem,
  updateItem,
  getItem,
  getAllItems,
  removeItem,
  getExampleNameSummary,
  getExampleStatus
};
