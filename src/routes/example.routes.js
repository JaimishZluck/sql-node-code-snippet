import express from 'express';
import logger from '../logger/winston.logger.js';
const router = express.Router();
import { ControllerAsyncFunction1 } from '../controllers/example.controller.js';
import { upload } from '../middlewares/multer.middleware.js';
import { validate } from '../middlewares/validation.middleware.js';
import { nameValidator, queryValidator } from '../validators/example.validator.js';

/**
 * @swagger
 */

router.route('/example')
    .post(
        validate({ body: nameValidator }),
        upload.any(),
        ControllerAsyncFunction1
    )
    .get(
        validate({ body: nameValidator }),
        ControllerAsyncFunction1
    );

export default router;

