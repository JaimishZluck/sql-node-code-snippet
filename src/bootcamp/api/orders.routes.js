/**
 * Order endpoints — cursor pagination and a write path with stock control.
 *
 * The POST route is the most important code in this module: it is a real
 * checkout, using the concurrency-safe patterns from module 14 and falling
 * back gracefully when the server is a standalone that cannot run
 * transactions.
 *
 *   GET  /api/orders             cursor-paginated list (module 06)
 *   GET  /api/orders/:id         one order with its customer
 *   POST /api/orders             place an order — stock-safe (module 14)
 */
import express from "express";
import mongoose from "mongoose";
import Order from "../../models/order.model.js";
import Product from "../../models/product.model.js";
import User from "../../models/user.model.js";
import { asyncHandler, ApiError, requireObjectId, parsePagination } from "./lib/helpers.js";

const router = express.Router();

/** Cached once — asking the server on every request would be wasteful. */
let transactionsSupported = null;
const canUseTransactions = async () => {
  if (transactionsSupported === null) {
    try {
      const info = await mongoose.connection.db.admin().command({ hello: 1 });
      transactionsSupported = Boolean(info.setName) || info.msg === "isdbgrid";
    } catch {
      transactionsSupported = false;
    }
  }
  return transactionsSupported;
};

/**
 * GET /api/orders?after=<id>&limit=20
 *
 * CURSOR pagination rather than page numbers (module 06). The client sends
 * back the last id it saw, and we ask for everything after it — a range
 * query the { _id } index jumps straight to. Cost is constant regardless of
 * how deep the client has scrolled, unlike skip().
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.user) filter.user = requireObjectId(req.query.user, "user id");

    // The cursor. Sorting by _id descending means "newest first", and _id is
    // unique so there are never ties to break.
    if (req.query.after) {
      filter._id = { $lt: requireObjectId(req.query.after, "after cursor") };
    }

    // Fetch one extra document: if it exists, there is another page.
    const items = await Order.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .select("orderNumber status totalAmount placedAt payment.method user")
      .populate("user", "name email")
      .lean();

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    res.json({
      data: page,
      meta: {
        limit,
        hasMore,
        // The client sends this back as ?after=... to get the next page.
        nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
      },
    });
  })
);

/** GET /api/orders/:id */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, "order id");
    const order = await Order.findById(id)
      .populate("user", "name email address.city")
      // Nested populate: follow items[].product, then that product's category.
      .populate({ path: "items.product", select: "name sku category", populate: { path: "category", select: "name" } })
      .orFail()
      .lean();

    res.json({ data: order });
  })
);

/**
 * The order-placement logic, extracted so it can run with or without a
 * session. Everything that writes takes { session }, which is null on a
 * standalone server (Mongoose ignores a null session).
 */
const placeOrder = async ({ userId, items }, session) => {
  const sessionOption = session ? { session } : {};

  // Load every product in ONE query rather than one per line item (the N+1
  // fix from module 12).
  const productIds = items.map((item) => item.productId);
  const products = await Product.find({ _id: { $in: productIds }, isActive: true })
    .select("name price discountPercent stock")
    .session(session ?? null)
    .lean();

  const byId = new Map(products.map((product) => [String(product._id), product]));

  const missing = productIds.filter((id) => !byId.has(String(id)));
  if (missing.length > 0) {
    throw new ApiError("Some products are unavailable", 400, { productIds: missing.map(String) });
  }

  const lineItems = [];
  for (const item of items) {
    const product = byId.get(String(item.productId));

    // CONDITIONAL UPDATE (module 14): the stock check lives in the FILTER, so
    // checking and decrementing are one atomic operation. Reading stock and
    // then deciding in JavaScript would let two buyers pass the same check.
    const result = await Product.updateOne(
      { _id: product._id, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      sessionOption
    );

    if (result.matchedCount === 0) {
      // Inside a transaction this rolls back every earlier decrement. On a
      // standalone server it does not — see the note in the POST handler.
      throw new ApiError(`Insufficient stock for ${product.name}`, 409, {
        productId: String(product._id),
        requested: item.quantity,
      });
    }

    // SNAPSHOT the price and name (module 09). An invoice must show what the
    // customer actually paid, even if the product is renamed or repriced.
    const unitPrice = Math.round(product.price * (1 - product.discountPercent / 100));
    lineItems.push({
      product: product._id,
      productName: product.name,
      unitPrice,
      quantity: item.quantity,
      subtotal: unitPrice * item.quantity,
    });
  }

  const user = await User.findById(userId).select("address").session(session ?? null).lean();
  const totalAmount = lineItems.reduce((sum, line) => sum + line.subtotal, 0);

  // Model.create with a session REQUIRES the array form — create(doc, opts)
  // would treat the options object as a second document to insert.
  const [order] = await Order.create(
    [
      {
        // A unique index on orderNumber makes a duplicate a 409 rather than a
        // silent double order (see the E11000 branch in the error middleware).
        orderNumber: `ORD-${Date.now().toString(36).toUpperCase()}`,
        user: userId,
        items: lineItems,
        status: "pending",
        payment: { method: "upi", paidAt: null },
        shippingAddress: user?.address ?? { city: "Pickup point", country: "India" },
        totalAmount,
        placedAt: new Date(),
      },
    ],
    sessionOption
  );

  return order;
};

/**
 * POST /api/orders
 *
 * Body: { "userId": "...", "items": [{ "productId": "...", "quantity": 2 }] }
 */
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { userId, items } = req.body ?? {};

    // Validate the SHAPE of the request before touching the database. This is
    // the first of the three validation layers from module 13 — a real app
    // would use Joi or zod here.
    if (!userId) throw new ApiError("userId is required", 400);
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError("items must be a non-empty array", 400);
    }

    const parsedUserId = requireObjectId(userId, "userId");
    const parsedItems = items.map((item, index) => {
      const quantity = Number(item?.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new ApiError(`items[${index}].quantity must be a positive integer`, 400);
      }
      return { productId: requireObjectId(item?.productId, `items[${index}].productId`), quantity };
    });

    // Confirm the user exists — MongoDB does NOT enforce this reference
    // (module 09), so nothing else would catch a bogus id.
    const userExists = await User.exists({ _id: parsedUserId, deletedAt: null });
    if (!userExists) throw new ApiError("User not found", 404);

    let order;
    if (await canUseTransactions()) {
      // withTransaction commits, aborts, and retries transient WriteConflicts
      // for us (module 14, lesson 02).
      const session = await mongoose.startSession();
      try {
        order = await session.withTransaction(() =>
          placeOrder({ userId: parsedUserId, items: parsedItems }, session)
        );
      } finally {
        // withTransaction does not end the session — that is still our job.
        await session.endSession();
      }
    } else {
      // Standalone fallback. Each stock decrement is still atomic on its own,
      // so we can never OVERSELL. What we lose is all-or-nothing across line
      // items: if item 3 is out of stock, items 1 and 2 stay decremented and
      // a compensating job would have to restore them. Honest trade-off,
      // clearly marked.
      order = await placeOrder({ userId: parsedUserId, items: parsedItems }, null);
    }

    res.status(201).json({
      data: {
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        status: order.status,
        items: order.items,
      },
      meta: { transactional: await canUseTransactions() },
    });
  })
);

export default router;
