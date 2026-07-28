/**
 * LESSON 15-errors-and-query-behavior/01-common-errors — Every error, on purpose
 *
 * Your API's quality is largely decided by how it fails. A 500 with
 * "Internal Server Error" for a mistyped id is a bug; a 400 saying "id is not
 * valid" is a feature.
 *
 * This lesson deliberately TRIGGERS every error you will realistically meet,
 * shows you its exact shape, and builds one error handler that maps each to
 * the right HTTP status. You cannot handle what you have never seen, so we
 * print the real objects rather than describing them.
 *
 * SAFE TO RE-RUN: writes only temporary documents (@lesson.test emails,
 * ZZ- SKUs), cleaned up at both ends.
 *
 * Run it with:  npm run lesson 15-errors-and-query-behavior/01-common-errors
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

/** Capture an error's identifying features without dumping a huge stack. */
const capture = async (fn) => {
  try {
    const value = await fn();
    return { threw: false, value };
  } catch (error) {
    return {
      threw: true,
      name: error.name,
      code: error.code,
      // ValidationError/CastError carry per-path detail here.
      paths: error.errors ? Object.keys(error.errors) : undefined,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue,
      message: error.message.slice(0, 160),
    };
  }
};

const cleanup = async () => {
  await User.deleteMany({ email: /@lesson\.test$/ });
  await Product.deleteMany({ sku: /^ZZ-/ });
  await Order.deleteMany({ orderNumber: /^ZZZ-/ });
};

await runLesson("Errors 1/2 — Every common error", async () => {
  await cleanup();

  // --------------------------------------------------------------------
  section("1. ValidationError — the user sent bad data");
  const validation = await capture(() =>
    User.create({ name: "X", email: "nope", age: 5, role: "wizard" })
  );
  show("Model.create with four broken rules", validation);

  // The detail you actually turn into a response body.
  try {
    await User.create({ name: "X", email: "nope", age: 5 });
  } catch (error) {
    show(
      "error.errors, field by field",
      Object.fromEntries(
        Object.entries(error.errors).map(([path, e]) => [
          path,
          { kind: e.kind, value: e.value, message: e.message },
        ])
      )
    );
  }
  note(
    "HTTP 400. error.errors is keyed by field path, and each entry has a " +
      "`kind` (which rule failed: 'required', 'min', 'enum', 'regexp') and " +
      "the offending `value`. Mapping that to { field: message } is " +
      "mechanical, and gives the frontend everything it needs to highlight " +
      "the right inputs."
  );

  // --------------------------------------------------------------------
  section("2. CastError — a value of the wrong type");
  const badId = await capture(() => User.findById("this-is-not-an-objectid"));
  show("findById with a malformed id", badId);

  const badNumber = await capture(() =>
    User.create({ name: "Cast", email: "cast@lesson.test", age: "twenty" })
  );
  show("A non-numeric value for a Number field", badNumber);
  note(
    "HTTP 400, not 500. A CastError from findById is overwhelmingly the most " +
      "common uncaught error in Express + Mongoose apps: someone hits " +
      "/api/users/undefined and the server returns 500. Validate the id " +
      "first with mongoose.Types.ObjectId.isValid(), or catch CastError " +
      "centrally. Note the CastError inside create() is wrapped in a " +
      "ValidationError, so error.errors covers both."
  );

  // --------------------------------------------------------------------
  section("3. E11000 — duplicate key");
  const existing = await User.findOne().select("email").lean();
  const duplicate = await capture(() => User.create({ name: "Dup", email: existing.email }));
  show("Inserting a duplicate unique value", duplicate);
  note(
    "HTTP 409 Conflict (or 400, if you prefer). Note the shape: name " +
      "'MongoServerError', code 11000, and — crucially — keyPattern and " +
      "keyValue telling you WHICH field collided and with what. Use " +
      "Object.keys(error.keyPattern)[0] to build 'That email is already " +
      "registered' instead of leaking the raw index name."
  );

  // The same error from a compound unique index looks the same, with two keys.
  const review = await mongoose.connection.db.collection("reviews").findOne();
  const compoundDup = await capture(() =>
    mongoose.connection.db
      .collection("reviews")
      .insertOne({ product: review.product, user: review.user, rating: 5 })
  );
  show("Duplicate on the compound { product, user } index", compoundDup);

  // --------------------------------------------------------------------
  section("4. DocumentNotFoundError vs a plain null");
  // find/findOne return null for 'not found' — NOT an error.
  const notFound = await User.findById(new mongoose.Types.ObjectId());
  show("findById for a nonexistent document", {
    returned: notFound,
    threw: false,
    "your job": "check for null and return 404 yourself",
  });

  // Some operations DO throw when nothing matched, if you ask them to.
  const orFail = await capture(() => User.findById(new mongoose.Types.ObjectId()).orFail());
  show(".orFail() turns null into a throw", orFail);
  note(
    "HTTP 404. Mongoose's default is to return null, which means every " +
      "controller must remember to check. .orFail() inverts that: it throws " +
      "DocumentNotFoundError, which your central handler maps to 404. " +
      ".orFail(new NotFoundError('User not found')) lets you supply your own " +
      "error class."
  );

  // --------------------------------------------------------------------
  section("5. StrictModeError — a field not in the schema");
  // By default Mongoose SILENTLY DROPS unknown fields on save.
  const silentlyDropped = new User({
    name: "Strict Demo",
    email: "strict@lesson.test",
    hackerField: "should not exist",
  });
  show("Assigning an unknown field (default strict mode)", {
    "value on the document": silentlyDropped.hackerField,
    "will it be saved?": "no — silently discarded",
  });

  // In a QUERY, an unknown field is not dropped — it is sent, and matches
  // nothing. This is a common source of "why does my filter return 0?".
  const strictQuery = await User.find({ hackerField: "x" }).countDocuments();
  show("Filtering on a field that is not in the schema", {
    matched: strictQuery,
    note: "the filter was sent to MongoDB and matched nothing",
  });

  // strictQuery: 'throw' makes typos loud instead of silent.
  const strictThrow = await capture(() =>
    User.find({ hackerField: "x" }).setOptions({ strictQuery: "throw" })
  );
  show("With strictQuery: 'throw'", strictThrow);
  note(
    "Silent field-dropping is a double-edged default: it protects you from " +
      "mass-assignment attacks (a request body cannot inject arbitrary " +
      "fields) but it hides typos. A misspelled filter field returns zero " +
      "results with no complaint. Consider strictQuery: 'throw' in " +
      "development."
  );

  // --------------------------------------------------------------------
  section("6. Server-side operation errors");
  // A bad aggregation stage, a bad update operator, a bad index hint — these
  // come back as MongoServerError with a numeric code.
  const badStage = await capture(() => Order.aggregate([{ $notARealStage: {} }]));
  show("An invalid aggregation stage", badStage);

  const badOperator = await capture(() =>
    mongoose.connection.db.collection("products").updateOne({}, { $notAnOperator: { x: 1 } })
  );
  show("An invalid update operator", badOperator);

  const badHint = await capture(() => Product.find({}).hint({ nonexistentField: 1 }).lean());
  show("A hint naming an index that does not exist", badHint);
  note(
    "HTTP 500 — these are programmer errors, not user errors. They should " +
      "never reach production, which is exactly why you want them to fail " +
      "loudly in development rather than being swallowed by a catch-all."
  );

  // --------------------------------------------------------------------
  section("7. VersionError — the document changed underneath you");
  const category = (await Product.findOne().select("category").lean()).category;
  const temp = await Product.create({
    name: "ZZ Version Demo",
    sku: "ZZ-VER-1",
    price: 100,
    stock: 1,
    category,
  });

  // Work on a TEMPORARY order, never a seeded one — this section modifies
  // the document it operates on.
  const seededUser = await User.findOne().select("_id").lean();
  const tempOrder = await Order.create({
    orderNumber: "ZZZ-VERSION-DEMO",
    user: seededUser._id,
    items: [
      { product: temp._id, productName: temp.name, unitPrice: 100, quantity: 1, subtotal: 100 },
    ],
    status: "pending",
    payment: { method: "cod", paidAt: null },
    shippingAddress: { city: "Pune", country: "India" },
    totalAmount: 100,
  });

  // Load the SAME document twice — two independent copies in memory, both
  // holding __v = 0.
  const copyA = await Order.findById(tempOrder._id);
  const copyB = await Order.findById(tempOrder._id);

  // Mongoose's version check guards ARRAY modifications specifically: a
  // positional array update is ambiguous if the array shifted underneath you.
  // Both copies push a line item, so both compute their update against __v 0.
  copyA.items.push({
    product: temp._id,
    productName: "added by A",
    unitPrice: 50,
    quantity: 1,
    subtotal: 50,
  });
  copyB.items.push({
    product: temp._id,
    productName: "added by B",
    unitPrice: 70,
    quantity: 1,
    subtotal: 70,
  });

  await copyA.save(); // succeeds, and bumps __v to 1
  const versionClash = await capture(() => copyB.save()); // still thinks __v is 0
  show("Two copies of one document, both modifying its items array", {
    ...versionClash,
    hint: "Order keeps __v (versionKey enabled); an array-modifying save checks it",
  });
  await Order.deleteOne({ _id: tempOrder._id });
  note(
    "HTTP 409. The right response is usually NOT to show an error — re-read " +
      "the document, re-apply the user's intent, and save again. Only when " +
      "the change is genuinely conflicting (a form the user has been staring " +
      "at for ten minutes) should you tell them the record moved."
  );

  // --------------------------------------------------------------------
  section("8. Connection and timeout errors");
  show("What they look like and what causes them", {
    MongooseServerSelectionError:
      "cannot reach any server. Wrong URI, mongod down, IP not allow-listed in Atlas, or a firewall.",
    "'buffering timed out after 10000ms'":
      "you queried before connect() succeeded. The REAL error is the failed connection — look earlier in the logs.",
    MongoNetworkError: "the connection dropped mid-operation. Usually transient; retryable writes handle single-doc cases.",
    MongoServerSelectionError: "no member matches your readPreference (e.g. no secondary available)",
    "'pool destroyed'": "you used a connection after disconnect()",
    "operation exceeded time limit": "maxTimeMS was hit — the query ran too long and was killed",
  });
  note(
    "These belong in a health check and an alert, not in a user-facing " +
      "message. Return 503 Service Unavailable, log loudly, and never leak " +
      "the connection string in the response."
  );

  // --------------------------------------------------------------------
  section("9. One error handler to map them all");
  show("The Express middleware this all builds toward", {
    code: `// middlewares/error.middleware.js
export const errorHandler = (error, req, res, next) => {
  // 1. Bad data from the client
  if (error.name === "ValidationError") {
    return res.status(400).json({
      message: "Validation failed",
      errors: Object.fromEntries(
        Object.entries(error.errors).map(([path, e]) => [path, e.message])
      ),
    });
  }

  // 2. A malformed id or uncastable value (outside a create)
  if (error.name === "CastError") {
    return res.status(400).json({ message: \`Invalid \${error.path}: \${error.value}\` });
  }

  // 3. Unique index violation
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? "field";
    return res.status(409).json({ message: \`That \${field} is already in use\` });
  }

  // 4. .orFail() found nothing
  if (error.name === "DocumentNotFoundError") {
    return res.status(404).json({ message: "Not found" });
  }

  // 5. Concurrent modification
  if (error.name === "VersionError") {
    return res.status(409).json({ message: "The record changed — please retry" });
  }

  // 6. Database unreachable
  if (error.name?.includes("ServerSelection") || error.name === "MongoNetworkError") {
    req.log?.error(error);
    return res.status(503).json({ message: "Service temporarily unavailable" });
  }

  // 7. Anything else is our bug
  req.log?.error(error);
  return res.status(500).json({ message: "Internal server error" });
};`,
  });
  note(
    "Two rules for the last branch. NEVER send error.message to the client " +
      "for unknown errors — it leaks schema names, index names, and " +
      "occasionally connection strings. And ALWAYS log the full error " +
      "server-side, or you have traded a bad user experience for no " +
      "debugging information at all."
  );

  // --------------------------------------------------------------------
  section("10. Cleanup");
  await cleanup();
  show("Cleanup", {
    tempUsers: await User.countDocuments({ email: /@lesson\.test$/ }),
    tempProducts: await Product.countDocuments({ sku: /^ZZ-/ }),
    tempProductRemoved: temp.sku,
  });
  note("Next: 02-query-behavior — when a Mongoose query actually hits the database.");
});
