// middleware/validation.middleware.js
import logger from "../logger/winston.logger.js";
import { ValidationError } from "../utils/validationError.util.js";

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
          console.error(
            "Validation Error:",
            error.details.map((err) => err.message)
          );
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
        return res.status(400).json({
          success: false,
          message: error.message,
          errors: error.errors,
        });
      }
      next(error);
    }
  };
};
