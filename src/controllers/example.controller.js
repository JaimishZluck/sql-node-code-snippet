import { serviceAsyncFucntion1 } from '../services/example.service.js';
import { ApiResponse } from '../utils/apiResponse.util.js';
import logger from '../logger/winston.logger.js';

const ControllerAsyncFunction1 = async (req, res, next) => {
    try {
        logger.info("ControllerAsyncFunction1: Validating request body");

        const body = req.body;
        logger.info("ControllerAsyncFunction1: Calling serviceAsyncFucntion1");
        const Data = await serviceAsyncFucntion1(body);

        logger.info("ControllerAsyncFunction1: Successfully processed request");
        return res.status(200).json(new ApiResponse(200, Data, "Success"));
    } catch (error) {
        logger.error(`ControllerAsyncFunction1: Error occurred - ${error.message}`);
        next(error); // Pass error to the error handler middleware
    }
};

export { ControllerAsyncFunction1 };