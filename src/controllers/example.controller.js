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
import fileCleanup from '../utils/fileCleanup.util.js';

/**
 * Get service status
 * @route GET /api/v1/status
 * @query {boolean} includeUser - Include authenticated user info in response
 * @returns {Object} Service status information
 */
const getStatus = async (req, res, next) => {
  try {
    logger.info('getStatus: Processing status request');
    const { includeUser } = req.query
    const data = await getExampleStatus({
      includeUser: includeUser,
      user: req.user,
    });
    return res
      .status(200)
      .json(new ApiResponse(200, data, 'Example API is working'));

  } catch (error) {
    return next(error);
  }
};
/**
 * Upload files handler
 * Accepts any number of files via `upload.any()` middleware
 */
const uploadFiles = async (req, res, next) => {
  const filePaths = Array.isArray(req.files) ? req.files.map(f => f.path) : [];

  try {
    logger.info('uploadFiles: Received files', { count: filePaths.length });

    // Business logic placeholder: process files as needed
    const result = {
      uploaded: (req.files || []).map((f) => ({ originalname: f.originalname, filename: f.filename, path: f.path, size: f.size }))
    };

    return res.status(200).json(new ApiResponse(200, result, 'Files processed successfully'));
  } catch (error) {
    logger.error('uploadFiles: Error processing files', { error: error?.message, stack: error?.stack });
    return next(error);
  } finally {
    // Ensure uploaded files are cleaned up from disk
    try {
      if (filePaths.length > 0) {
        await fileCleanup.deleteMultipleFiles(filePaths);
        // Clear references on request object
        req.files = [];
        req.file = undefined;
      }
    } catch (cleanupErr) {
      logger.error('uploadFiles: Cleanup failed', { error: cleanupErr?.message });
    }
  }
};

export { getStatus, uploadFiles };
