import express from 'express';
import * as controller from '../controllers/order.controller.js';

const router = express.Router();

// Create an order
router.post('/', controller.create);

// List orders (simple paginated list)
router.get('/', controller.list);

// Aggregation endpoint for learning/analytics (totals, topProducts, monthly)
// Example: /orders/aggregate?include=totals,topProducts&page=1&limit=5
router.get('/aggregate', controller.listAgg);

// Update an order
router.put('/:id', controller.modify);

// Delete an order
router.delete('/:id', controller.remove);

// Upsert an order (idempotent create-or-update). Body: { query: {...}, data: {...} }
router.post('/upsert', controller.upsert);

export default router;
