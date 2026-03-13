import express from 'express';
import logger from '../logger/winston.logger.js';
const router = express.Router();
// Import your controllers, middlewares, and validators here
// import { yourController } from '../controllers/example.controller.js';
// import { upload } from '../middlewares/multer.middleware.js';
// import { validate } from '../middlewares/validation.middleware.js';
// import { yourValidator } from '../validators/example.validator.js';

/**
 * @swagger
 */

// Define your routes below
// Example:
// router.route('/your-resource')
//     .post(
//         validate({ body: yourValidator }),
//         upload.any(),
//         yourController
//     )
//     .get(
//         validate({ query: queryValidator }),
//         yourController
//     );

export default router;

