import { ValidationError } from '../utils/validationError.util.js';
import logger from '../logger/winston.logger.js';

export const validate = (schema, source = 'body') => {
    return async (req, res, next) => {
        try {
            logger.info(`Validating request ${source}`);
            const dataToValidate = req[source];
            const { error } = schema.validate(dataToValidate, { abortEarly: false });
            
            if (error) {
                logger.error(`Validation error in ${source}: ${error.details.map(err => err.message).join(', ')}`);
                throw new ValidationError(
                    error.details[0].message,
                    error.details.map(err => err.message)
                );
            }
            
            next();
        } catch (error) {
            next(error);
        }
    };
};
