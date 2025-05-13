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
        validate(nameValidator, 'body'),
        upload.any(), 
        ControllerAsyncFunction1
    )
    .get(
        validate(queryValidator, 'query'),
        ControllerAsyncFunction1
    );

export default router;

