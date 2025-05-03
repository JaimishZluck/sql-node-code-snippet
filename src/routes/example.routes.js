import express from 'express';
import logger from '../logger/winston.logger.js';
const router = express.Router();
import { ControllerAsyncFunction1 } from '../controllers/name.controller.js';
import { upload } from '../middlewares/multer.middleware.js';
import { healthCheck } from '../controllers/healthCheck.controller.js';

/**
 * * @swagger
 */

router.route('/example')
    .post(upload.any(), ControllerAsyncFunction1)
    // .get(ControllerAsyncFunction2)
    // .put(upload.any(), ControllerAsyncFunction3)
    // .delete(ControllerAsyncFunction4)
    router.route("/healthcheck",healthCheck)
export default router;

