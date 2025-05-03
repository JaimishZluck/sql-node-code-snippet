import { Sequelize } from "sequelize";
import logger from "../logger/winston.logger.js";
import { ApiError } from "../utils/apiError.util.js";
import { ValidationError } from "../utils/validationError.util.js";

const errorHandler = (err, req, res, next) => {
  let error = err;

  // Handle ValidationError
  if (error instanceof ValidationError) {
    logger.error(`Validation Error: ${error.errors.join(', ')}`);
    error = error
    return res.status(400).json({
      success: false,
      statusCode: 400,
      message: error.message,
      errors: error.errors,
    });
  }

  // Handle Sequelize errors
  if (error instanceof Sequelize.BaseError) {
    let statusCode = 400;
    let message = "Database Error";
    let errors = [ error.message ];

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
      errors = [ `Invalid reference: ${error.table}` ];
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

    error = new ApiError(statusCode, message, errors, error.stack);
  }

  // Handle other errors
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || "Something went wrong";
    error = new ApiError(statusCode, message, error?.errors || [], error.stack);
  }

  const response = {
    success: false,
    statusCode: error.statusCode,
    message: error.message,
    errors: error.errors,
    ...(process.env.NODE_ENV === "development" ? { stack: error.stack } : {}),
  };

  logger.error(
    ` \n ${req.method} ${req.originalUrl} || ${req.ip || req.headers[ "x-forwarded-for" ] || req.connection.remoteAddress} || ${req.user?.username || "anonymous"} || ${error.statusCode} || ${error.message || "unknown error"}\n\n ${error.errors || "unknown error"}\n\n ${error.stack || "unknown stack"}`
  );

  return res.status(error.statusCode).json(response);
};

export { errorHandler };
