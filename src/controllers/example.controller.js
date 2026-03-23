/**
 * Controllers handle HTTP requests and responses
 *
 * Responsibilities:
 * - Extract request data (body, params, query)
 * - Validate inputs using middleware (validation happens before controller)
 * - Call service methods with validated data
 * - Return ApiResponse for successful operations
 * - Pass errors to next() for centralized error handling middleware
 *
 * Error Handling Pattern:
 * - Use try-catch to wrap async service calls
 * - Catch all errors and pass to next(error)
 * - Never manually handle errors or return error responses
 * - Let error middleware (error.middleware.js) handle all error formatting and logging
 *
 * File Upload Pattern (for routes with file uploads):
 * - Multer middleware stores files before controller
 * - Validate: Check if req.file/req.files exists
 * - Process: Business logic with file data
 * - On error: In catch block, delete files from filesystem
 * - In finally: Clean up request.file/files references
 */

import logger from '../logger/winston.logger.js';
import { getExampleStatus } from '../services/example.service.js';
import { ApiResponse } from '../utils/apiResponse.util.js';

/**
 * Get service status
 * @route GET /api/v1/status
 * @query {boolean} includeUser - Include authenticated user info in response
 * @returns {Object} Service status information
 */
const getStatus = async (req, res, next) => {
  try {
    logger.info('getStatus: Processing status request');

    const data = await getExampleStatus({
      includeUser: req.query.includeUser,
      user: req.user,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, data, 'Example API is working'));

  } catch (error) {
    return next(error);
  }
};

export { getStatus };
