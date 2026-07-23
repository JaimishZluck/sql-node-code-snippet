// middleware/validation.middleware.js
import logger from "../logger/winston.logger.js";
import { ValidationError } from "../utils/validationError.util.js";
import { ApiResponse } from "../utils/apiResponse.util.js";

export const validate = (schemas) => {
  return async (req, res, next) => {
    try {
      logger.info("Performing validation checks");

      // Process each schema based on source (body, params, query)
      for (const [source, schema] of Object.entries(schemas)) {
        if (!schema) continue;

        const data = req[source];
        const { error } = schema.validate(data, { abortEarly: false });

        if (error) {
          logger.error("Validation Error:", { errors: error.details.map((err) => err.message) });
          throw new ValidationError(
            error.details[0].message,
            error.details.map((err) => err.message)
          );
        }
      }
      logger.info("Completed validation checks");

      next();
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json(
          new ApiResponse(400, { errors: error.errors }, error.message)
        );
      }
      next(error);
    }
  };
};
