import logger from "../logger/winston.logger.js";
import { ApiError } from "../utils/apiError.util.js";
import { ValidationError } from "../utils/validationError.util.js";
import { getRootCause } from "../utils/stackTraceParser.util.js";
import { Sequelize } from "sequelize";
import multer from "multer";

const errorHandler = (err, req, res, next) => {
  let error = err;

  // Handle Multer errors (file upload)
  if (error instanceof multer.MulterError) {
    const multerStatusCode = mapMulterError(error);
    const multerMessage = getMulterErrorMessage(error);
    error = new ApiError(multerStatusCode, multerMessage, [error.message], error.stack);
  }
  // Handle ValidationError (from Joi validators)
  else if (error instanceof ValidationError) {
    // Keep as-is
  }
  // Handle Sequelize errors
  else if (error instanceof Sequelize.BaseError) {
    const dbError = transformSequelizeError(error);
    error = dbError;
  }
  // Handle other errors
  else if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || "Something went wrong";
    error = new ApiError(statusCode, message, error?.errors || [], error.stack);
  }

  // Get root cause from stack trace (user code only, filters node_modules)
  const rootCause = getRootCause(error.stack || error);

  // Build response - include devInfo only in development
  const response = {
    success: false,
    statusCode: error.statusCode,
    message: error.message,
    errors: error.errors || []
  };

  // Add devInfo only in development mode
  if (process.env.NODE_ENV === "development") {
    response.devInfo = {
      file: rootCause.file,
      line: rootCause.line,
      column: rootCause.column,
      function: rootCause.function,
      stack: rootCause.stack,
      timestamp: new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      })
    };
  }

  // Log error with root cause - ONLY safe/defined metadata
  const safeLogMeta = {};
  if (req?.method) safeLogMeta.method = req.method;
  if (req?.originalUrl) safeLogMeta.url = req.originalUrl;
  if (req?.ip) safeLogMeta.ip = req.ip;
  if (req?.user?.id) safeLogMeta.user = req.user.id;
  if (rootCause.file) safeLogMeta.file = rootCause.file;
  if (rootCause.line) safeLogMeta.line = rootCause.line;
  if (rootCause.column) safeLogMeta.column = rootCause.column;
  if (rootCause.function) safeLogMeta.function = rootCause.function;

  logger.error(`${error.message}`, safeLogMeta);

  return res.status(error.statusCode).json(response);
};

/**
 * Transform Sequelize errors to ApiError
 */
function transformSequelizeError(error) {
  let statusCode = 400;
  let message = "Database Error";
  let errors = [error.message];

  if (error instanceof Sequelize.ValidationError) {
    statusCode = 400;
    message = "Validation Error";
    errors = error.errors.map(e => e.message);
  } else if (error instanceof Sequelize.UniqueConstraintError) {
    statusCode = 409;
    message = "Duplicate Entry";
    errors = error.errors.map(e => e.message);
  } else if (error instanceof Sequelize.ForeignKeyConstraintError) {
    statusCode = 400;
    message = "Foreign Key Constraint Error";
    errors = [`Invalid reference: ${error.table}`];
  } else if (error instanceof Sequelize.DatabaseError) {
    statusCode = 500;
    message = "Database Query Error";
  } else if (error instanceof Sequelize.ConnectionError) {
    statusCode = 503;
    message = "Database Connection Error";
  } else if (error instanceof Sequelize.TimeoutError) {
    statusCode = 504;
    message = "Database Timeout Error";
  }

  return new ApiError(statusCode, message, errors, error.stack);
}

/**
 * Map Multer errors to HTTP status codes
 */
function mapMulterError(error) {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return 413; // Payload Too Large
    case 'LIMIT_FILE_COUNT':
      return 400; // Bad Request
    default:
      return 400; // Bad Request
  }
}

/**
 * Get user-friendly message for Multer errors
 */
function getMulterErrorMessage(error) {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return `File size exceeds maximum limit`;
    case 'LIMIT_FILE_COUNT':
      return `Exceeds maximum files allowed`;
    case 'LIMIT_UNEXPECTED_FILE':
      return `Unexpected file field`;
    default:
      return 'File upload error';
  }
}

export { errorHandler };
