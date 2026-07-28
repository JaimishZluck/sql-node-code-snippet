/**
 * LESSON 14-transactions-and-concurrency/02-with-transaction — The safe wrapper
 *
 * The manual startTransaction / commit / abort / endSession dance from
 * lesson 01 is correct but easy to get wrong, and it misses something
 * important: MongoDB transactions can fail with TRANSIENT errors that simply
 * need retrying. Two orders touching the same product at the same instant
 * produce a WriteConflict; the operation is not wrong, it just needs to run
 * again.
 *
 * session.withTransaction(fn) handles all of it: it starts the transaction,
 * runs your function, commits on success, aborts on error, and RETRIES
 * automatically on transient failures.
 *
 * SAFE TO RE-RUN: temporary products (ZZ- SKUs) and orders (ZZZ- numbers),
 * cleaned up at both ends. Seeded data is untouched.
 *
 * Run it with:  npm run lesson 14-transactions-and-concurrency/02-with-transaction
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";

const supportsTransactions = async () => {
  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    return false;
  }
};

const cleanup = async () => {
  await Product.deleteMany({ sku: /^ZZ-/ });
  await Order.deleteMany({ orderNumber: /^ZZZ-/ });
};

/**
 * A realistic order-placement service.
 *
 * This is the shape you would actually ship: the business logic lives in one
 * function, the session is threaded through every operation, and any thrown
 * error rolls the whole thing back.
 */
const placeOrder = async ({ userId, productId, quantity, orderNumber }, session) => {
  // Conditional update: the { stock: { $gte: quantity } } filter means the
  // decrement only happens if there is enough stock. This is atomic on its
  // own — no read-then-write race is possible (lesson 03 explores why).
  const stockResult = await Product.updateOne(
    { _id: productId, stock: { $gte: quantity }, isActive: true },
    { $inc: { stock: -quantity } },
    { session }
  );

  // matchedCount 0 means the filter did not match: out of stock, or inactive.
  // Throwing here aborts the whole transaction.
  if (stockResult.matchedCount === 0) {
    throw new Error("INSUFFICIENT_STOCK");
  }

  const product = await Product.findById(productId).select("name price").session(session).lean();

  const [order] = await Order.create(
    [
      {
        orderNumber,
        user: userId,
        items: [
          {
            product: productId,
            productName: product.name,
            unitPrice: product.price,
            quantity,
            subtotal: product.price * quantity,
          },
        ],
        status: "paid",
        payment: { method: "upi", paidAt: new Date() },
        shippingAddress: { city: "Pune", state: "Maharashtra", country: "India" },
        totalAmount: product.price * quantity,
      },
    ],
    { session }
  );

  // Whatever the callback returns, withTransaction returns.
  return { orderNumber: order.orderNumber, total: order.totalAmount };
};

await runLesson("Transactions 2/4 — withTransaction", async () => {
  await cleanup();
  const canTransact = await supportsTransactions();

  // --------------------------------------------------------------------
  section("1. Why withTransaction exists");
  show("Manual vs wrapper", {
    manual: [
      "session.startTransaction()",
      "...your writes...",
      "await session.commitTransaction()",
      "catch -> await session.abortTransaction()",
      "finally -> await session.endSession()",
      "AND you must retry TransientTransactionError yourself",
      "AND retry UnknownTransactionCommitResult yourself",
    ],
    withTransaction: [
      "await session.withTransaction(async () => { ...your writes... })",
      "commit, abort, and BOTH retry loops are handled for you",
    ],
  });
  note(
    "Two error labels matter. TransientTransactionError means 'a conflict " +
      "happened, the whole transaction can safely be retried from the top'. " +
      "UnknownTransactionCommitResult means 'the commit may or may not have " +
      "landed — retry the commit'. Handling both correctly by hand is fiddly; " +
      "withTransaction already does it. Use it unless you have a specific " +
      "reason not to."
  );

  if (!canTransact) {
    note(
      "This server is a standalone mongod, so the live demonstrations below " +
        "are skipped. Lesson 01 prints the replica-set setup steps. The code " +
        "shapes shown here are exactly what you would run once you have one."
    );
    show("The pattern to copy", {
      code: `const session = await mongoose.startSession();
try {
  const result = await session.withTransaction(async () => {
    return placeOrder({ userId, productId, quantity, orderNumber }, session);
  });
} finally {
  await session.endSession();   // withTransaction does NOT end the session
}`,
    });
    await cleanup();
    return;
  }

  // --------------------------------------------------------------------
  section("2. A successful withTransaction");
  const category = (await Product.findOne().select("category").lean()).category;
  const user = await User.findOne().select("_id").lean();
  const widget = await Product.create({
    name: "ZZ WithTransaction Widget",
    sku: "ZZ-WT-1",
    price: 1800,
    stock: 20,
    category,
  });

  const session = await mongoose.startSession();
  let result = null;
  try {
    // withTransaction returns whatever the callback returns.
    result = await session.withTransaction(async () =>
      placeOrder(
        { userId: user._id, productId: widget._id, quantity: 4, orderNumber: "ZZZ-WT-OK" },
        session
      )
    );
  } finally {
    // IMPORTANT: withTransaction commits/aborts, but it does NOT end the
    // session. That is still your job.
    await session.endSession();
  }

  show("Result", {
    returnedByCallback: result,
    stockNow: (await Product.findById(widget._id).select("stock").lean()).stock,
    orderExists: Boolean(await Order.findOne({ orderNumber: "ZZZ-WT-OK" }).lean()),
  });

  // --------------------------------------------------------------------
  section("3. A failing withTransaction rolls everything back");
  const stockBefore = (await Product.findById(widget._id).select("stock").lean()).stock;
  const failSession = await mongoose.startSession();
  let failure = null;
  try {
    await failSession.withTransaction(async () =>
      placeOrder(
        // More than we have — the conditional update matches nothing and
        // placeOrder throws.
        { userId: user._id, productId: widget._id, quantity: 9999, orderNumber: "ZZZ-WT-FAIL" },
        failSession
      )
    );
  } catch (error) {
    failure = error.message;
  } finally {
    await failSession.endSession();
  }

  show("After a failed transaction", {
    error: failure,
    stockBefore,
    stockAfter: (await Product.findById(widget._id).select("stock").lean()).stock,
    orderCreated: Boolean(await Order.findOne({ orderNumber: "ZZZ-WT-FAIL" }).lean()),
  });
  note(
    "The error propagated out of withTransaction (so your controller can " +
      "turn INSUFFICIENT_STOCK into a 409), and the transaction was aborted " +
      "automatically. Note that withTransaction does NOT retry an error you " +
      "threw yourself — only MongoDB's transient ones. That is the behaviour " +
      "you want: a genuine business failure should not be retried."
  );

  // --------------------------------------------------------------------
  section("4. Concurrent transactions and WriteConflict");
  // Two transactions racing for the same document. One wins; the other gets
  // a WriteConflict, which withTransaction retries transparently.
  const contested = await Product.create({
    name: "ZZ Contested Item",
    sku: "ZZ-WT-RACE",
    price: 500,
    stock: 100,
    category,
  });

  const buy = async (index) => {
    const s = await mongoose.startSession();
    try {
      return await s.withTransaction(async () =>
        placeOrder(
          {
            userId: user._id,
            productId: contested._id,
            quantity: 2,
            orderNumber: `ZZZ-WT-RACE-${index}`,
          },
          s
        )
      );
    } finally {
      await s.endSession();
    }
  };

  // Fire 6 concurrent purchases at the same product.
  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => buy(i)));
  const finalStock = (await Product.findById(contested._id).select("stock").lean()).stock;

  show("6 concurrent transactions on one product", {
    fulfilled: outcomes.filter((o) => o.status === "fulfilled").length,
    rejected: outcomes.filter((o) => o.status === "rejected").length,
    rejectionReasons: outcomes.filter((o) => o.status === "rejected").map((o) => o.reason?.message),
    startingStock: 100,
    finalStock,
    "expected if all succeeded": 100 - 6 * 2,
    "orders created": await Order.countDocuments({ orderNumber: /^ZZZ-WT-RACE/ }),
  });
  note(
    "The arithmetic works out exactly — no lost updates, no oversold stock. " +
      "Behind the scenes several of these hit WriteConflict and were retried " +
      "automatically by withTransaction. That retry loop is precisely what " +
      "you would have had to write by hand with the manual API, and why " +
      "manual transaction code so often has a subtle bug under load."
  );

  // --------------------------------------------------------------------
  section("5. Tuning: transaction options");
  show("Options you can pass", {
    signature: "session.withTransaction(fn, { readConcern, writeConcern, readPreference, maxCommitTimeMS })",
    "readConcern: { level: 'snapshot' }":
      "read a consistent point-in-time view — the strongest isolation",
    "writeConcern: { w: 'majority' }":
      "do not report success until a majority of replicas have the write (the default for transactions)",
    "readPreference: 'primary'":
      "REQUIRED — transactions cannot read from secondaries",
    maxCommitTimeMS: "cap how long the commit may take before failing",
    transactionLifetimeLimitSeconds: "server-side default 60s — long transactions are killed",
  });
  note(
    "Keep transactions SHORT. Every document a transaction touches is held " +
      "under conflict detection until commit, so a long transaction makes " +
      "every concurrent writer more likely to conflict and retry. Never do " +
      "network I/O (a payment API call, an email) inside one — call the " +
      "external service first, then open the transaction to record the result."
  );

  // --------------------------------------------------------------------
  section("6. The production shape");
  show("How this looks in a real service", {
    code: `// services/order.service.js
export const createOrder = async (payload) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const stock = await Product.updateOne(
        { _id: payload.productId, stock: { $gte: payload.quantity } },
        { $inc: { stock: -payload.quantity } },
        { session }
      );
      if (stock.matchedCount === 0) throw new AppError("INSUFFICIENT_STOCK", 409);

      const [order] = await Order.create([{ ...payload }], { session });
      return order;
    });
  } finally {
    await session.endSession();
  }
};`,
    "controller": "catch AppError -> res.status(409); anything else -> 500",
    "idempotency": "give each attempt a client-supplied key stored on a unique index, so a retried HTTP request cannot place two orders",
  });

  // --------------------------------------------------------------------
  section("7. Cleanup");
  await cleanup();
  show("Cleanup", {
    tempProducts: await Product.countDocuments({ sku: /^ZZ-/ }),
    tempOrders: await Order.countDocuments({ orderNumber: /^ZZZ-/ }),
  });
  note(
    "Next: 03-concurrency-and-versioning — race conditions you can hit " +
      "WITHOUT transactions, and the two ways to prevent them."
  );
});
