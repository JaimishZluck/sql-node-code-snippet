/**
 * LESSON 01-fundamentals/03-databases-and-collections — MongoDB vs SQL
 *
 * You almost certainly know tables, rows, and JOINs. That knowledge is
 * useful, but half of it actively misleads in MongoDB. This lesson translates
 * every relational concept into its MongoDB counterpart AND shows where the
 * translation breaks down, using the seeded store.
 *
 * The punchline: in SQL you model the data and then write queries against
 * it. In MongoDB you look at your queries first and then shape the data so
 * the important ones need no joins at all.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 01-fundamentals/03-databases-and-collections
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Order from "../../../models/order.model.js";
import Product from "../../../models/product.model.js";
import Category from "../../../models/category.model.js";

await runLesson("Fundamentals 3/3 — Databases, collections, and SQL", async () => {
  const db = mongoose.connection.db;

  // --------------------------------------------------------------------
  section("1. The vocabulary map");
  show("Relational term -> MongoDB term", {
    database: "database (same idea)",
    table: "collection",
    row: "document",
    column: "field",
    "primary key": "_id (always present, always unique, indexed automatically)",
    "AUTO_INCREMENT id": "ObjectId (generated client-side, no central sequence)",
    "foreign key": "a stored ObjectId — but NOT enforced by the server",
    JOIN: "$lookup (aggregation) — or avoid it entirely by embedding",
    "CREATE TABLE": "nothing — collections appear on first write",
    "ALTER TABLE ADD COLUMN": "nothing — just write documents with the new field",
    "schema (enforced by the DB)": "schema (enforced by Mongoose, optionally by $jsonSchema)",
    transaction: "transaction — available, but needed far less often (module 14)",
  });

  // --------------------------------------------------------------------
  section("2. No CREATE TABLE, no ALTER TABLE");
  // Collections are created implicitly. There is no migration step to add a
  // field: you simply start writing it. Older documents just do not have it.
  const productsWithSpecs = await Product.countDocuments({ specs: { $exists: true } });
  const productsWithBrand = await Product.countDocuments({ "specs.brand": { $exists: true } });
  show("Adding a field is a non-event", {
    totalProducts: await Product.countDocuments(),
    "have a specs object": productsWithSpecs,
    "have specs.brand": productsWithBrand,
    "cost of adding a new field tomorrow": "zero — no table lock, no migration",
  });
  note(
    "In SQL, adding a column to a large table locks it or requires an online " +
      "migration tool. Here you deploy code that writes the new field and " +
      "you are done. The price you pay: your application must tolerate " +
      "documents written before the change. 'Handle the old shape' replaces " +
      "'run the migration' — the work does not vanish, it moves into code."
  );

  // --------------------------------------------------------------------
  section("3. The join that isn't: embedding");
  // The single biggest structural difference. An order and its line items
  // are ONE document, so 'show me this order' is one read with zero joins.
  const order = await Order.findOne({ status: "delivered" }).lean();
  show("An order, complete, from one round trip", {
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    lineItems: order.items,
    shippingAddress: order.shippingAddress,
  });
  note(
    "The SQL equivalent needs three tables (orders, order_items, addresses) " +
      "and two JOINs. Here the data that is always read together is stored " +
      "together, so the disk reads one contiguous chunk. This is the core " +
      "MongoDB performance idea: locality beats normalization for read-heavy " +
      "access patterns."
  );

  // --------------------------------------------------------------------
  section("4. The join that is: references");
  // Not everything can be embedded. A product is shared by many orders and
  // changes on its own schedule, so orders store only its ObjectId.
  const rawOrderItem = order.items[0];
  show("A line item mixes a REFERENCE with SNAPSHOT copies", {
    product: rawOrderItem.product,
    "productName (snapshot at purchase time)": rawOrderItem.productName,
    "unitPrice (snapshot at purchase time)": rawOrderItem.unitPrice,
    quantity: rawOrderItem.quantity,
  });

  // Following the reference is a SECOND query — MongoDB did not do it for us.
  const referenced = await Product.findById(rawOrderItem.product).select("name price").lean();
  show("The product as it is TODAY", referenced);
  note(
    "Compare productName/unitPrice with today's values. The snapshot is " +
      "deliberate: an invoice must show what the customer actually paid. In " +
      "SQL you would join to products and accidentally show today's price on " +
      "a two-year-old invoice. Duplication is sometimes the CORRECT answer " +
      "here, which is the opposite of what normal forms teach."
  );

  // --------------------------------------------------------------------
  section("5. MongoDB does not enforce referential integrity");
  // A reference is a promise your application makes to itself. Nothing stops
  // you from storing an id that points nowhere.
  const orphanId = new mongoose.Types.ObjectId(); // points at nothing
  const orphanTarget = await Product.findById(orphanId);
  show("Looking up a reference that points nowhere", {
    lookedFor: orphanId.toHexString(),
    found: orphanTarget,
  });
  note(
    "null — no error, no warning. There is no ON DELETE CASCADE and no " +
      "foreign-key constraint. Delete a user and their 12 orders keep " +
      "pointing at a ghost. Your options: soft delete (module 07), cascade " +
      "manually in middleware (module 13), or tolerate dangling references " +
      "in the read path. Choosing one is a design decision you must make " +
      "consciously — SQL made it for you."
  );

  // --------------------------------------------------------------------
  section("6. Counting the round trips: JOIN vs $lookup vs embedded");
  // Same business question, three shapes. Watch the number of queries.
  const questions = {};

  // (a) Fully embedded: 1 query, 0 joins.
  const t0 = process.hrtime.bigint();
  await Order.find({ status: "delivered" }).limit(20).lean();
  questions["embedded items — 1 query"] = `${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)}ms`;

  // (b) Reference + populate: 2 queries, joined in Node.js memory.
  const t1 = process.hrtime.bigint();
  await Order.find({ status: "delivered" }).limit(20).populate("user", "name email").lean();
  questions["populate('user') — 2 queries, stitched in Node"] =
    `${(Number(process.hrtime.bigint() - t1) / 1e6).toFixed(1)}ms`;

  // (c) $lookup: 1 query, joined on the SERVER.
  const t2 = process.hrtime.bigint();
  await Order.aggregate([
    { $match: { status: "delivered" } },
    { $limit: 20 },
    {
      $lookup: {
        from: "users", // NOTE: the COLLECTION name, not the model name
        localField: "user",
        foreignField: "_id",
        as: "userDoc",
      },
    },
  ]);
  questions["$lookup — 1 query, joined on the server"] =
    `${(Number(process.hrtime.bigint() - t2) / 1e6).toFixed(1)}ms`;

  show("Three ways to assemble related data", questions);
  note(
    "populate() is NOT a join — Mongoose runs a second query and stitches " +
      "the results together in your Node process. $lookup IS a server-side " +
      "join. Embedding needs neither. Modules 10 and 11 cover populate and " +
      "$lookup properly; the lesson here is simply that MongoDB gives you " +
      "three answers where SQL gives one."
  );

  // --------------------------------------------------------------------
  section("7. Schema flexibility is a spectrum, not a switch");
  // The server allows anything. Mongoose narrows it. $jsonSchema narrows it
  // at the server. You pick the point on the spectrum.
  const categoryShapes = await Category.aggregate([
    // $objectToArray turns { a: 1, b: 2 } into [{k:'a',v:1},{k:'b',v:2}] so
    // we can inspect field NAMES as data — a neat trick for auditing shapes.
    { $project: { fields: { $map: { input: { $objectToArray: "$$ROOT" }, in: "$$this.k" } } } },
    { $group: { _id: "$fields", documents: { $sum: 1 } } },
  ]);
  show("Distinct document shapes in the categories collection", categoryShapes);
  note(
    "The root categories have parent: null while children have a real " +
      "ObjectId, but every document carries the same KEYS — because our " +
      "Mongoose schema gave `parent` a default. Mongoose (in Node.js) " +
      "produced that consistency; MongoDB would happily have stored ten " +
      "different shapes. Always know which layer is enforcing what."
  );

  // --------------------------------------------------------------------
  section("8. What you actually give up, and what you gain");
  show("Honest trade-offs", {
    "you give up": [
      "server-enforced foreign keys and cascades",
      "declarative table constraints (CHECK, NOT NULL) unless you add $jsonSchema",
      "arbitrary ad-hoc JOINs across many tables being cheap and natural",
      "a single obvious 'correct' schema handed to you by normalization rules",
    ],
    "you gain": [
      "read locality: one document, one round trip, no joins",
      "shape flexibility: optional and evolving fields cost nothing",
      "arrays and nested objects as first-class stored types",
      "horizontal scaling designed in from the start (sharding, module 18)",
    ],
    "the real rule": "model around your QUERIES, not around normal forms",
  });
  note(
    "Module 01 complete. You know what a document is, what BSON stores, and " +
      "how this differs from SQL. Next: module 02 — how Node.js actually " +
      "connects to this server, and what a connection pool is."
  );

  // Keep the linter honest: `db` is used above via listCollections in
  // sibling lessons; here we surface one last server-level fact.
  const stats = await db.command({ dbStats: 1 });
  show("Database at a glance", {
    database: stats.db,
    collections: stats.collections,
    documents: stats.objects,
    dataSizeKB: Number((stats.dataSize / 1024).toFixed(1)),
    indexes: stats.indexes,
  });
});
