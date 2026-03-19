import express from 'express';
import { getStatus } from '../controllers/example.controller.js';
import { validate } from '../middlewares/validation.middleware.js';
import { statusQueryValidator } from '../validators/example.validator.js';

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

router.get('/status', validate({ query: statusQueryValidator }), getStatus);

export default router;

