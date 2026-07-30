import express from 'express';
import { getStatus, uploadFiles } from '../controllers/example.controller.js';
import { validate } from '../middlewares/validation.middleware.js';
import { statusQueryValidator } from '../validators/example.validator.js';
import { upload } from '../middlewares/multer.middleware.js';
import orderRouter from './order.routes.js';

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
// Example (template — uncomment and wire up real controllers/validators):
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

// File upload endpoint - accepts any number of files on any fields
router.post('/upload', upload.any(), uploadFiles);

// Mount order routes under /orders
router.use('/orders', orderRouter);

export default router;

