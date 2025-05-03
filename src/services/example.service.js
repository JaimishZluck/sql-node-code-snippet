import { Name } from '../models/name.model.js';
import logger from '../logger/winston.logger.js';
import { createdata } from '../db/operations.db.js';
import { sequelize } from '../db/connection.db.js';
import { ApiError } from '../utils/apiError.util.js';

const serviceAsyncFucntion1 = async (body) => {
    const transaction = await sequelize.transaction(); // Start a transaction
    try {
        logger.info("serviceAsyncFucntion1: Creating data");
        await createdata(Name, body, transaction);
        await transaction.commit(); // Commit the transaction

        logger.info("serviceAsyncFucntion1: Data created successfully");
        return true; // Return success response
    } catch (error) {
        logger.error(`serviceAsyncFucntion1: Error occurred - ${error.message}`);
        await transaction.rollback(); // Rollback the transaction
        throw error instanceof ApiError ? error : new ApiError(500, "Internal Server Error", [ error ], error.stack); // Wrap other errors in ApiError
    }
};

export { serviceAsyncFucntion1 };