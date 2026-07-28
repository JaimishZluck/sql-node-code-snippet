/**
 * LESSON 14-transactions-and-concurrency/01-sessions-and-transactions
 *
 * A transaction makes several writes ATOMIC: either all of them happen, or
 * none of them do. The classic case is placing an order — you must decrement
 * stock AND insert the order, and a crash between the two must not leave
 * stock reduced for an order that does not exist.
 *
 * Two things to understand before the syntax:
 *
 *  1. Transactions REQUIRE A REPLICA SET. A plain standalone `mongod` cannot
 *     run them. This lesson detects that and prints setup instructions
 *     instead of crashing.
 *  2. You need them far less often than in SQL, because a single-document
 *     update is ALREADY atomic — and MongoDB's document model lets you put
 *     related data in one document. Section 7 covers when you genuinely need
 *     one and when you are just importing SQL habits.
 *
 * SAFE TO RE-RUN: all writes use temporary documents (SKUs starting ZZ-,
 * order numbers starting ZZZ-) which are deleted at the start and the end.
 * Seeded stock is never permanently changed.
 *
 * Run it with:  npm run lesson 14-transactions-and-concurrency/01-sessions-and-transactions
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";

/** Are we connected to a replica set (or a sharded cluster)? */
const supportsTransactions = async () => {
  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    // `setName` exists on replica-set members; msg === 'isdbgrid' means mongos.
    return Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    return false;
  }
};

const cleanup = async () => {
  await Product.deleteMany({ sku: /^ZZ-/ });
  await Order.deleteMany({ orderNumber: /^ZZZ-/ });
};

await runLesson("Transactions 1/4 — Sessions and transactions", async () => {
  await cleanup();

  // --------------------------------------------------------------------
  section("1. Can this server run transactions?");
  const canTransact = await supportsTransactions();
  show("Server capability", {
    replicaSetOrSharded: canTransact,
    transactionsAvailable: canTransact,
  });

  if (!canTransact) {
    note(
      "This MongoDB is a STANDALONE server, so transactions are not " +
        "available. That is not a bug in your setup — transactions rely on " +
        "the replica-set oplog to coordinate and roll back, so a single " +
        "unreplicated node genuinely cannot provide them."
    );
    note(
      "To convert your local server into a one-node replica set:\n" +
        "  1. Stop mongod.\n" +
        "  2. Start it with the replSet flag:\n" +
        "       mongod --dbpath <your-data-dir> --replSet rs0\n" +
        "     (Windows service: add  replication:\\n  replSetName: rs0\\n" +
        "      to mongod.cfg, then restart the MongoDB service.)\n" +
        "  3. Initiate the set once, from mongosh:\n" +
        "       rs.initiate()\n" +
        "  4. Update .env:\n" +
        "       MONGO_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0\n" +
        "  5. Re-run:  npm run db:seed  &&  npm run lesson 14-transactions-and-concurrency/01-sessions-and-transactions\n\n" +
        "Docker alternative:\n" +
        "  docker run -d --name mongo-rs -p 27017:27017 mongo:7 --replSet rs0\n" +
        '  docker exec mongo-rs mongosh --eval "rs.initiate()"\n\n' +
        "MongoDB Atlas clusters are replica sets already — nothing to do there."
    );
  }

  // --------------------------------------------------------------------
  section("2. What a session is");
  note(
    "A SESSION is a context the server uses to group operations together. " +
      "Every operation already runs in an implicit session; a transaction " +
      "needs an EXPLICIT one so the server knows which writes belong to it. " +
      "In Mongoose you create it with startSession() and then pass " +
      "{ session } to every operation that should take part. Forgetting to " +
      "pass it is the number one transaction bug: that write executes " +
      "OUTSIDE the transaction and is not rolled back."
  );

  // A session can be created regardless of replica-set support; only
  // startTransaction() requires it.
  const probeSession = await mongoose.startSession();
  show("Session created", {
    id: probeSession.id?.id ? "(a UUID the server tracks)" : "(opaque)",
    hasEnded: probeSession.hasEnded,
  });
  await probeSession.endSession();

  // --------------------------------------------------------------------
  section("3. Set up temporary data to work with");
  const category = (await Product.findOne().select("category").lean()).category;
  const user = await User.findOne().select("_id name").lean();

  const widget = await Product.create({
    name: "ZZ Transaction Widget",
    sku: "ZZ-TXN-1",
    price: 2500,
    stock: 10,
    category,
  });
  show("Temporary product created", { sku: widget.sku, stock: widget.stock, price: widget.price });

  if (!canTransact) {
    // --------------------------------------------------------------------
    section("4. Without transactions — what the code WOULD look like");
    show("The order-placement flow, annotated", {
      step1: "session = await mongoose.startSession()",
      step2: "session.startTransaction()",
      step3: "await Product.updateOne({_id, stock: {$gte: qty}}, {$inc: {stock: -qty}}, { session })",
      step4: "await Order.create([{ ...orderData }], { session })   // note the ARRAY form",
      step5: "await session.commitTransaction()   // both become visible at once",
      onError: "await session.abortTransaction()  // neither write survives",
      always: "await session.endSession()",
    });
    note(
      "Everything else in this module still works on a standalone server: " +
        "lesson 03 (race conditions and optimistic concurrency) and lesson 04 " +
        "(write and read concerns) do not need a replica set for their core " +
        "demonstrations. Set up a replica set when you can and come back — " +
        "this lesson will then run its real transactions."
    );
    await cleanup();
    return;
  }

  // --------------------------------------------------------------------
  section("4. A committed transaction");
  const session = await mongoose.startSession();
  let committed = null;
  try {
    session.startTransaction();

    // EVERY operation must receive { session }. Without it, the write goes
    // through a different (implicit) session and is NOT part of the
    // transaction — it will not be rolled back on abort.
    await Product.updateOne(
      { _id: widget._id, stock: { $gte: 3 } },
      { $inc: { stock: -3 } },
      { session }
    );

    // NOTE the array form: Model.create([...], { session }). Passing the
    // session as a second argument only works with the array signature —
    // Model.create(doc, { session }) treats the options object as a SECOND
    // DOCUMENT to insert. This trips up everyone once.
    const [order] = await Order.create(
      [
        {
          orderNumber: "ZZZ-TXN-COMMIT",
          user: user._id,
          items: [
            {
              product: widget._id,
              productName: widget.name,
              unitPrice: widget.price,
              quantity: 3,
              subtotal: widget.price * 3,
            },
          ],
          status: "paid",
          payment: { method: "upi", paidAt: new Date() },
          shippingAddress: { city: "Pune", state: "Maharashtra", country: "India" },
          totalAmount: widget.price * 3,
        },
      ],
      { session }
    );

    // Reading INSIDE the transaction sees its own uncommitted writes...
    const insideView = await Product.findById(widget._id).select("stock").session(session).lean();
    // ...while a read OUTSIDE it still sees the old value.
    const outsideView = await Product.findById(widget._id).select("stock").lean();
    show("Visibility during an open transaction", {
      "stock seen INSIDE the transaction": insideView.stock,
      "stock seen OUTSIDE the transaction": outsideView.stock,
      orderCreatedInsideTransaction: order.orderNumber,
      "order visible outside?": Boolean(await Order.findOne({ orderNumber: "ZZZ-TXN-COMMIT" }).lean()),
    });
    note(
      "This is transaction ISOLATION. Other clients see nothing until the " +
        "commit — no half-finished state is ever observable. MongoDB uses " +
        "snapshot isolation: the transaction reads a consistent point-in-time " +
        "view of the data plus its own writes."
    );

    await session.commitTransaction();
    committed = true;
  } catch (error) {
    await session.abortTransaction();
    committed = false;
    show("Transaction failed", { message: error.message });
  } finally {
    // ALWAYS end the session. A leaked session holds server-side resources.
    await session.endSession();
  }

  const afterCommit = await Product.findById(widget._id).select("stock").lean();
  show("After commit — both writes are visible together", {
    committed,
    stock: afterCommit.stock,
    orderExists: Boolean(await Order.findOne({ orderNumber: "ZZZ-TXN-COMMIT" }).lean()),
  });

  // --------------------------------------------------------------------
  section("5. An aborted transaction — nothing survives");
  const abortSession = await mongoose.startSession();
  const stockBefore = (await Product.findById(widget._id).select("stock").lean()).stock;
  try {
    abortSession.startTransaction();

    await Product.updateOne({ _id: widget._id }, { $inc: { stock: -5 } }, { session: abortSession });
    await Order.create(
      [
        {
          orderNumber: "ZZZ-TXN-ABORT",
          user: user._id,
          items: [
            {
              product: widget._id,
              productName: widget.name,
              unitPrice: widget.price,
              quantity: 5,
              subtotal: widget.price * 5,
            },
          ],
          status: "paid",
          payment: { method: "card", paidAt: new Date() },
          shippingAddress: { city: "Pune", country: "India" },
          totalAmount: widget.price * 5,
        },
      ],
      { session: abortSession }
    );

    // Simulate a failure discovered late — a payment decline, say.
    throw new Error("payment gateway declined the card");
  } catch (error) {
    await abortSession.abortTransaction();
    show("Rolled back after", { reason: error.message });
  } finally {
    await abortSession.endSession();
  }

  const afterAbort = await Product.findById(widget._id).select("stock").lean();
  show("After abort — as if nothing happened", {
    stockBefore,
    stockAfter: afterAbort.stock,
    unchanged: stockBefore === afterAbort.stock,
    orderExists: Boolean(await Order.findOne({ orderNumber: "ZZZ-TXN-ABORT" }).lean()),
  });
  note(
    "Both writes vanished. This is the guarantee you are paying for: no " +
      "partial state, ever. Without a transaction the stock decrement would " +
      "have stuck and you would be short five units with no order to show " +
      "for it."
  );

  // --------------------------------------------------------------------
  section("6. The rules and the costs");
  show("Rules", {
    "pass { session } to EVERY operation": "an operation without it runs outside the transaction",
    "Model.create needs the ARRAY form": "create([doc], { session }) — not create(doc, { session })",
    "reads too": "Query.session(session) or .find(..., null, { session })",
    "always endSession()": "in a finally block, committed or not",
    "60 second default limit": "transactionLifetimeLimitSeconds — long transactions are aborted",
    "16 MB oplog entry limit": "a transaction's total changes must fit",
  });
  show("Costs", {
    performance: "locks and snapshot bookkeeping — measurably slower than a plain write",
    contention: "concurrent transactions touching the same documents cause WriteConflict aborts",
    complexity: "every caller must thread the session through",
    "not a substitute for good modelling":
      "if two collections must always change together, ask whether they should be one document",
  });

  // --------------------------------------------------------------------
  section("7. When you do NOT need a transaction");
  const singleDocDemo = await Product.findOneAndUpdate(
    { _id: widget._id, stock: { $gte: 1 } },
    { $inc: { stock: -1 }, $set: { "ratingSummary.count": 0 } },
    { new: true }
  ).select("stock ratingSummary").lean();
  show("One update touching several fields — already atomic, no session needed", singleDocDemo);
  note(
    "A single-document update is ALWAYS atomic in MongoDB, no matter how " +
      "many fields it touches or how deeply nested they are. That covers a " +
      "surprising share of what SQL needs transactions for, because the " +
      "document model lets related data live in one document — our orders " +
      "embed their line items precisely so that writing an order is ONE " +
      "atomic write."
  );
  show("Do you actually need a transaction?", {
    "one document changes": "NO — single-document writes are atomic",
    "several documents, but eventual consistency is fine":
      "NO — update one, then the other; reconcile if the second fails",
    "money moving between two accounts": "YES",
    "stock + order + payment record must all agree": "YES",
    "creating a user and their profile in two collections":
      "probably not — consider embedding, or tolerate the rare orphan and clean up",
  });

  // --------------------------------------------------------------------
  section("8. Cleanup");
  await cleanup();
  show("Cleanup", {
    tempProducts: await Product.countDocuments({ sku: /^ZZ-/ }),
    tempOrders: await Order.countDocuments({ orderNumber: /^ZZZ-/ }),
  });
  note("Next: 02-with-transaction — the safer, retrying wrapper you should actually use.");
});
