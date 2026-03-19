// Import your models here
// import { YourModel } from '../models/example.model.js';

// Define your service functions below
// Example:
// const createItem = async (body) => {
//     const transaction = await sequelize.transaction();
//     try {
//         logger.info("createItem: Creating data");
//         await createdata(YourModel, body, transaction);
//         await transaction.commit();
//         logger.info("createItem: Data created successfully");
//         return true;
//     } catch (error) {
//         logger.error(`createItem: Error occurred - ${error.message}`);
//         await transaction.rollback();
//         throw error instanceof ApiError ? error : new ApiError(500, "Internal Server Error", [error], error.stack);
//     }
// };

// export { createItem };

const getExampleStatus = async ({ includeUser, user }) => {
    const shouldIncludeUser = includeUser === true || includeUser === 'true';

    const data = {
        service: 'example',
        status: 'UP',
        timestamp: new Date().toISOString(),
        authenticated: true,
    };

    if (shouldIncludeUser) {
        data.user = {
            id: user?.id ?? null,
            role: user?.role ?? null,
        };
    }

    return data;
};

export { getExampleStatus };