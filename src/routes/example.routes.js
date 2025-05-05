import express from 'express';
import logger from '../logger/winston.logger.js';
const router = express.Router();
import { ControllerAsyncFunction1 } from '../controllers/name.controller.js';
import { upload } from '../middlewares/multer.middleware.js';

/**
 * * @swagger
 */

router.route('/example')
    .post(upload.any(), ControllerAsyncFunction1)
// .get(ControllerAsyncFunction2)
// .put(upload.any(), ControllerAsyncFunction3)
// .delete(ControllerAsyncFunction4)
export default router;

