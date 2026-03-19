// Import your service functions here
// import { yourServiceFunction } from '../services/example.service.js';
import { getExampleStatus } from '../services/example.service.js';
import { ApiResponse } from '../utils/apiResponse.util.js';

// Define your controller functions below
// Example:
// const createItem = async (req, res, next) => {
//     try {
//         logger.info("createItem: Processing request");
//         const body = req.body;
//         const data = await yourServiceFunction(body);
//         logger.info("createItem: Successfully processed request");
//         return res.status(200).json(new ApiResponse(200, data, "Success"));
//     } catch (error) {
//         logger.error(`createItem: Error occurred - ${error.message}`);
//         next(error);
//     }
// };

// export { createItem };

const getStatus = async (req, res, next) => {
    try {
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