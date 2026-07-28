/**
 * LESSON 12-indexes-and-performance/05-performance-patterns — Making it fast
 *
 * You can now read an explain plan and build the right index. This lesson is
 * the practical part: the patterns that make real endpoints fast, and the
 * anti-patterns that quietly make them slow.
 *
 * Everything here is measured against the seeded store, so the numbers are
 * small — the point is the RATIO between approaches and the shape of the
 * plan, both of which hold at any scale.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 12-indexes-and-performance/05-performance-patterns
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";
import Review from "../../../models/review.model.js";

/** Run something N times and report the median milliseconds. */
const bench = async (label, fn, runs = 5) => {
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const t = process.hrtime.bigint();
    await fn();
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  times.sort((a, b) => a - b);
  return { [label]: Number(times[Math.floor(runs / 2)].toFixed(2)) };
};

await runLesson("Indexes 5/5 — Performance patterns", async () => {
  // --------------------------------------------------------------------
  section("1. Pattern: project only what you need");
  // Every field you return costs network bytes, Node.js memory, and JSON
  // serialization time. On a list endpoint this is usually the easiest win.
  const projection = {
    ...(await bench("full documents", () => Product.find({ isActive: true }).lean())),
    ...(await bench("projected to 3 fields", () =>
      Product.find({ isActive: true }).select("name price stock").lean()
    )),
  };
  show("Fetching 58 products", projection);
  note(
    "Small here, decisive at scale. A product list endpoint returning full " +
      "documents (including a 2,000-character description) ships roughly 10x " +
      "the bytes it needs. Project on every list endpoint; return full " +
      "documents only on detail endpoints."
  );

  // --------------------------------------------------------------------
  section("2. Pattern: lean() for read-only responses");
  // Hydrating a Mongoose Document builds change tracking, getters, virtuals,
  // and methods. If you are only going to res.json() it, that is pure waste.
  const leanBench = {
    ...(await bench("hydrated documents", () => Order.find().limit(300))),
    ...(await bench(".lean() plain objects", () => Order.find().limit(300).lean())),
  };
  show("300 orders, hydrated vs lean", leanBench);
  note(
    "Typically 2-5x faster and much lighter on memory. Use .lean() by " +
      "default for GET endpoints; drop it when you need virtuals, instance " +
      "methods, or .save(). (Module 10 covers the trade-offs in full.)"
  );

  // --------------------------------------------------------------------
  section("3. Anti-pattern: N+1 queries");
  // The most common performance bug in any ORM/ODM codebase: one query for
  // the list, then one more per item inside a loop.
  const orders = await Order.find().limit(25).select("user totalAmount").lean();

  const n1 = await bench(
    "N+1: one query per order",
    async () => {
      const out = [];
      for (const order of orders) {
        // 25 separate round trips.
        const user = await User.findById(order.user).select("name").lean();
        out.push({ total: order.totalAmount, name: user?.name });
      }
      return out;
    },
    3
  );

  const batched = await bench(
    "batched: one query with $in",
    async () => {
      // Collect the ids, fetch them all at once, index them in a Map.
      const ids = [...new Set(orders.map((o) => String(o.user)))];
      const users = await User.find({ _id: { $in: ids } }).select("name").lean();
      const byId = new Map(users.map((u) => [String(u._id), u]));
      return orders.map((o) => ({ total: o.totalAmount, name: byId.get(String(o.user))?.name }));
    },
    3
  );
  show("25 orders + their users", { ...n1, ...batched });
  note(
    "Same result, one query instead of 26. This IS what populate() does " +
      "internally, which is why populate() is fine and a manual loop is not. " +
      "The tell-tale sign of N+1: an `await` inside a `for` loop over query " +
      "results. If you see one, batch it with $in or use populate/$lookup."
  );

  // --------------------------------------------------------------------
  section("4. Anti-pattern: counting with countDocuments on a hot path");
  const counts = {
    ...(await bench("countDocuments({}) — scans or walks an index", () =>
      Order.countDocuments({})
    )),
    ...(await bench("estimatedDocumentCount() — reads metadata", () =>
      Order.estimatedDocumentCount()
    )),
    ...(await bench("countDocuments(filter) — must actually count", () =>
      Order.countDocuments({ status: "delivered" })
    )),
  };
  show("Three ways to count", counts);
  note(
    "estimatedDocumentCount() is O(1) — it reads collection metadata — but " +
      "it accepts NO filter and can be slightly stale after an unclean " +
      "shutdown. Use it for 'total products in catalogue' style numbers. Use " +
      "countDocuments(filter) when the number must be exact and filtered, and " +
      "make sure the filter is indexed."
  );

  // --------------------------------------------------------------------
  section("5. Anti-pattern: skip() for deep pagination");
  // skip(n) makes the server walk past n documents. Cost grows linearly with
  // the page number — page 1 is instant, page 1000 is not.
  const deep = {
    ...(await bench("page 1  (skip 0)", () => Order.find().sort({ _id: 1 }).skip(0).limit(20).lean())),
    ...(await bench("page 6  (skip 100)", () => Order.find().sort({ _id: 1 }).skip(100).limit(20).lean())),
    ...(await bench("page 14 (skip 260)", () => Order.find().sort({ _id: 1 }).skip(260).limit(20).lean())),
  };
  show("skip() cost grows with page depth", deep);

  // Cursor (keyset) pagination stays constant: remember the last _id and use
  // a range filter, which the index jumps straight to.
  const firstPage = await Order.find().sort({ _id: 1 }).limit(20).select("_id").lean();
  const lastId = firstPage[firstPage.length - 1]._id;
  const cursorBench = await bench("cursor page 2 (range on _id)", () =>
    Order.find({ _id: { $gt: lastId } }).sort({ _id: 1 }).limit(20).lean()
  );
  show("Cursor pagination", cursorBench);
  note(
    "On 300 documents the difference is noise; on 3 million it is the " +
      "difference between 2ms and 4 seconds. Rule: skip/limit is fine for a " +
      "page-numbered admin table over modest data; use cursor pagination for " +
      "infinite scroll, public APIs, and anything unbounded. (Module 06 " +
      "covers both in detail.)"
  );

  // --------------------------------------------------------------------
  section("6. Pattern: let the database do the aggregation");
  const inNode = await bench(
    "fetch all, sum in JavaScript",
    async () => {
      const all = await Order.find({ status: "delivered" }).select("totalAmount").lean();
      return all.reduce((sum, o) => sum + o.totalAmount, 0);
    },
    3
  );
  const inMongo = await bench(
    "aggregate on the server",
    () =>
      Order.aggregate([
        { $match: { status: "delivered" } },
        { $group: { _id: null, revenue: { $sum: "$totalAmount" } } },
      ]),
    3
  );
  show("Revenue, computed two ways", { ...inNode, ...inMongo });
  note(
    "The JavaScript version shipped every matching document over the wire " +
      "to produce one number. With 150 orders that is invisible; with 15 " +
      "million it is impossible. Move reduction work to the server — that is " +
      "what aggregation is for."
  );

  // --------------------------------------------------------------------
  section("7. Pattern: denormalize a hot aggregate");
  // Our products carry ratingSummary, a copy of data derived from reviews.
  // Compare reading it with recomputing it.
  const sampleProduct = await Product.findOne({ "ratingSummary.count": { $gte: 3 } })
    .select("_id ratingSummary")
    .lean();

  const denorm = {
    ...(await bench("read the denormalized ratingSummary", () =>
      Product.findById(sampleProduct._id).select("name ratingSummary").lean()
    )),
    ...(await bench("recompute from reviews every time", () =>
      Review.aggregate([
        { $match: { product: sampleProduct._id } },
        { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
      ])
    )),
  };
  show("Product rating: stored vs recomputed", denorm);
  note(
    "The stored copy is a single indexed document read. Recomputing means " +
      "scanning that product's reviews on every page view. The cost of the " +
      "denormalized version is CORRECTNESS work: something must update " +
      "ratingSummary when a review is written (our seeder does it in bulk; " +
      "module 13 shows the middleware approach). That is the trade every " +
      "denormalization makes — cheap reads for careful writes."
  );

  // --------------------------------------------------------------------
  section("8. Pattern: bulk writes instead of a loop");
  // Not executed against real data here — the shape is the lesson.
  show("One round trip instead of N", {
    slow: "for (const item of items) await Model.updateOne({ _id: item.id }, { $set: ... })",
    fast: `await Model.bulkWrite(items.map(item => ({
      updateOne: { filter: { _id: item.id }, update: { $set: { ... } } }
    })))`,
    why: "bulkWrite sends every operation in one command; ordered:false lets the server parallelize",
    "also": "insertMany over a loop of create(); deleteMany over a loop of deleteOne()",
  });

  // --------------------------------------------------------------------
  section("9. Anti-pattern: unindexed sorts and the 32 MB wall");
  const sortPlan = await Product.find({}).sort({ "specs.weightGrams": -1 }).explain("executionStats");
  const stages = [];
  let node = sortPlan.executionStats.executionStages;
  while (node) {
    stages.push(node.stage);
    node = node.inputStage;
  }
  show("Sorting on an unindexed nested field", {
    stages: stages.join(" <- "),
    hasBlockingSort: stages.includes("SORT"),
    docsExamined: sortPlan.executionStats.totalDocsExamined,
  });
  note(
    "An in-memory SORT is capped at 32 MB of documents. Exceed it and the " +
      "query FAILS with 'Sort exceeded memory limit' — not slowly, but " +
      "outright. On a growing collection this is a time bomb: the endpoint " +
      "works in staging and dies in production. Index every field you sort by."
  );

  // --------------------------------------------------------------------
  section("10. Diagnosing a slow endpoint — the checklist");
  show("In order, every time", {
    "1. Reproduce with explain('executionStats')": "never optimize on a hunch",
    "2. COLLSCAN?": "add an index on the filter field",
    "3. SORT stage?": "extend the index to cover the sort (ESR: equality, sort, range)",
    "4. docsExamined >> nReturned?": "the index is not selective enough — reorder or extend it",
    "5. await inside a loop?": "N+1 — batch with $in, populate, or $lookup",
    "6. returning fields nobody uses?": "add .select() and .lean()",
    "7. deep skip()?": "switch to cursor pagination",
    "8. computing in Node what Mongo could compute?": "move it into an aggregation",
    "9. still slow?": "consider denormalizing the hot value, or caching it",
    "10. verify": "re-run explain and compare the numbers — do not assume the fix worked",
  });

  // --------------------------------------------------------------------
  section("11. Monitoring in production");
  show("What to watch", {
    "slow query log": "db.setProfilingLevel(1, { slowms: 100 }) writes slow ops to system.profile",
    $indexStats: "Model.aggregate([{ $indexStats: {} }]) — find indexes nobody uses",
    "Atlas Performance Advisor": "suggests indexes from real traffic",
    "currentOp": "db.currentOp() shows what is running right now",
    "the working set": "if your indexes + hot documents exceed RAM, everything slows down at once",
    "connection pool saturation": "queries waiting for a socket look like slow queries (module 02)",
  });
  show("Sanity check on this database", {
    indexes: (await Product.collection.listIndexes().toArray()).length,
    collectionStats: await mongoose.connection.db
      .command({ collStats: "products" })
      .then((s) => ({
        dataSizeKB: Number((s.size / 1024).toFixed(1)),
        indexSizeKB: Number((s.totalIndexSize / 1024).toFixed(1)),
      })),
  });
  note(
    "If total index size approaches or exceeds data size, you are probably " +
      "over-indexed. Every index must earn its keep — check $indexStats and " +
      "drop the ones nobody uses."
  );
  note(
    "Module 12 complete. Next: module 13 — validation, middleware, and " +
      "virtuals, where Mongoose's Node.js-side machinery takes over."
  );
});
