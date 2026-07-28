/**
 * LESSON 11-aggregation/01-pipeline-basics — The assembly line
 *
 * find() answers "which documents match?". Aggregation answers everything
 * else: totals, averages, rankings, joins, reshaping, bucketing. It works as
 * a PIPELINE — an ordered list of stages, where each stage takes the stream
 * of documents from the previous stage, transforms it, and passes it on.
 *
 * This lesson builds a pipeline one stage at a time so you can watch the
 * stream change shape, then covers the two rules that separate fast
 * pipelines from slow ones: filter early, and know which stages are blocking.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 11-aggregation/01-pipeline-basics
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

await runLesson("Aggregation 1/6 — Pipeline basics", async () => {
  // --------------------------------------------------------------------
  section("1. The mental model");
  note(
    "Think of a factory conveyor belt. Documents enter at one end. Each " +
      "STAGE is a station that may drop documents, add or remove fields, " +
      "reorder them, or replace many documents with one summary. Whatever " +
      "comes out of the last station is your result. Two things follow: the " +
      "ORDER of stages changes both the answer and the speed, and after any " +
      "reshaping stage the documents no longer look like your model — they " +
      "are plain objects with whatever fields you produced."
  );

  // --------------------------------------------------------------------
  section("2. One stage at a time — watch the stream change");
  // Stage 1 only: $match behaves exactly like a find() filter.
  const afterMatch = await Product.aggregate([
    { $match: { isActive: true, price: { $gte: 20000 } } },
  ]);
  show("After $match — full documents, just fewer of them", {
    documentsRemaining: afterMatch.length,
    firstDocumentKeys: Object.keys(afterMatch[0]),
  });

  // Stage 2: $project reshapes each document. Note the SAME count — $project
  // never adds or removes documents, only fields.
  const afterProject = await Product.aggregate([
    { $match: { isActive: true, price: { $gte: 20000 } } },
    // "$price" with a dollar sign is a FIELD PATH — "the value of the price
    // field of the current document". Without the dollar sign it would be
    // the literal string "price". This is the single most important piece
    // of aggregation syntax.
    {
      $project: {
        _id: 0,
        name: 1,
        price: 1,
        // A computed field: expressions are nestable function calls written
        // as objects. Read this inside out: multiply price by (1 - pct/100).
        finalPrice: {
          $round: [
            { $multiply: ["$price", { $subtract: [1, { $divide: ["$discountPercent", 100] }] }] },
            0,
          ],
        },
      },
    },
  ]);
  show("After $project — same count, new shape", {
    documentsRemaining: afterProject.length,
    sample: afterProject.slice(0, 3),
  });

  // Stage 3 + 4: $sort then $limit. Now the stream is ordered and truncated.
  const afterSortLimit = await Product.aggregate([
    { $match: { isActive: true, price: { $gte: 20000 } } },
    {
      $project: {
        _id: 0,
        name: 1,
        price: 1,
        finalPrice: {
          $round: [
            { $multiply: ["$price", { $subtract: [1, { $divide: ["$discountPercent", 100] }] }] },
            0,
          ],
        },
      },
    },
    { $sort: { finalPrice: -1 } },
    { $limit: 5 },
  ]);
  show("After $sort + $limit — the 5 most expensive after discount", afterSortLimit);
  note(
    "Notice we sorted by finalPrice — a field that does not exist in the " +
      "database. It was computed by $project one stage earlier, and later " +
      "stages can use it freely. find().sort() could never do this."
  );

  // --------------------------------------------------------------------
  section("3. Stage order changes the ANSWER");
  // $limit then $sort: take 5 arbitrary documents, then sort those 5.
  const limitThenSort = await Product.aggregate([
    { $match: { isActive: true } },
    { $limit: 5 },
    { $sort: { price: -1 } },
    { $project: { _id: 0, name: 1, price: 1 } },
  ]);
  // $sort then $limit: sort everything, then take the top 5.
  const sortThenLimit = await Product.aggregate([
    { $match: { isActive: true } },
    { $sort: { price: -1 } },
    { $limit: 5 },
    { $project: { _id: 0, name: 1, price: 1 } },
  ]);
  show("$limit then $sort (WRONG for 'top 5')", limitThenSort);
  show("$sort then $limit (correct)", sortThenLimit);
  note(
    "Completely different results. $limit takes whatever arrives first, so " +
      "limiting before sorting gives you 5 random products sorted among " +
      "themselves. This is the most common aggregation bug, and it is silent " +
      "— you get plausible-looking data that is simply wrong."
  );

  // --------------------------------------------------------------------
  section("4. Stage order changes the SPEED");
  // Same answer, different work. Filtering first means every later stage
  // handles fewer documents — and $match at the very front can use an index.
  const timeIt = async (pipeline) => {
    const t = process.hrtime.bigint();
    const result = await Order.aggregate(pipeline);
    return {
      ms: Number((Number(process.hrtime.bigint() - t) / 1e6).toFixed(2)),
      rows: result.length,
    };
  };

  const filterEarly = await timeIt([
    { $match: { status: "delivered" } },
    { $project: { totalAmount: 1, placedAt: 1 } },
    { $sort: { totalAmount: -1 } },
    { $limit: 10 },
  ]);
  const filterLate = await timeIt([
    { $project: { totalAmount: 1, placedAt: 1, status: 1 } },
    { $sort: { totalAmount: -1 } },
    { $match: { status: "delivered" } },
    { $limit: 10 },
  ]);
  show("Same answer, different cost", {
    "$match first": filterEarly,
    "$match after $project + $sort": filterLate,
  });
  note(
    "Rule 1 of aggregation: FILTER EARLY. A $match at the very start of a " +
      "pipeline can use an index (orders has an index on status); once any " +
      "reshaping stage has run, the documents are intermediate results and " +
      "no index can help. On 300 documents the gap is small — on 300,000 it " +
      "is the difference between 20ms and 20 seconds."
  );
  note(
    "MongoDB's optimizer does move some $match stages earlier automatically, " +
      "but only when it can prove the move is safe. Do not rely on it; write " +
      "the pipeline in the efficient order yourself."
  );

  // --------------------------------------------------------------------
  section("5. Blocking vs streaming stages");
  note(
    "STREAMING stages ($match, $project, $limit, $skip, $unwind, $addFields) " +
      "handle one document at a time and pass it on immediately — memory " +
      "stays flat. BLOCKING stages ($sort, $group, $facet, $bucket) must see " +
      "EVERY document before they can emit anything, so they hold the whole " +
      "stream in memory. Each blocking stage is capped at 100 MB by default; " +
      "exceed it and the pipeline errors unless you pass " +
      "{ allowDiskUse: true }."
  );
  show("Practical consequences", {
    "$sort without an index": "blocking — must buffer everything",
    "$sort immediately after $match on an indexed field":
      "can use the index and stream",
    "$sort + $limit together": "optimizer keeps only the top N — memory stays small",
    "$group": "always blocking; memory grows with the NUMBER OF GROUPS, not documents",
    "the 100 MB rule": "per blocking stage; { allowDiskUse: true } spills to disk (slower but works)",
  });

  // --------------------------------------------------------------------
  section("6. aggregate() returns PLAIN OBJECTS, not documents");
  const [doc] = await Product.find().limit(1);
  const [agg] = await Product.aggregate([{ $limit: 1 }]);
  show("find() vs aggregate() results", {
    "find(): is a Mongoose Document": typeof doc.save === "function",
    "find(): has virtuals (finalPrice)": doc.finalPrice,
    "aggregate(): is a Mongoose Document": typeof agg.save === "function",
    "aggregate(): has the finalPrice virtual": agg.finalPrice,
  });
  note(
    "This surprises everyone once. Aggregation runs entirely on the SERVER, " +
      "which knows nothing about your Mongoose schema — no virtuals, no " +
      "getters, no defaults, no instance methods, and no casting of your " +
      "pipeline values. Two practical rules: (1) compute derived values " +
      "inside the pipeline, not by relying on virtuals; (2) cast ObjectIds " +
      "yourself in $match — { user: someIdString } will NOT match, you need " +
      "new mongoose.Types.ObjectId(someIdString)."
  );

  // --------------------------------------------------------------------
  section("7. A complete, realistic pipeline");
  // "Revenue and order count per month for the last year, best month first."
  const revenueByMonth = await Order.aggregate([
    // 1. Only orders that actually produced revenue.
    { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
    // 2. Collapse to one document per year+month, summing as we go.
    {
      $group: {
        _id: { year: { $year: "$placedAt" }, month: { $month: "$placedAt" } },
        revenue: { $sum: "$totalAmount" },
        orders: { $sum: 1 },
        averageOrderValue: { $avg: "$totalAmount" },
      },
    },
    // 3. Tidy the shape for the API response.
    {
      $project: {
        _id: 0,
        period: {
          $concat: [
            { $toString: "$_id.year" },
            "-",
            // Zero-pad the month so "2025-03" sorts correctly as a string.
            { $cond: [{ $lt: ["$_id.month", 10] }, "0", ""] },
            { $toString: "$_id.month" },
          ],
        },
        revenue: 1,
        orders: 1,
        averageOrderValue: { $round: ["$averageOrderValue", 0] },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 6 },
  ]);
  show("Top 6 months by revenue", revenueByMonth);
  note(
    "Five stages, one round trip, all the work done on the server — no " +
      "documents shipped to Node.js just to be summed there. That is the " +
      "whole point of aggregation. Next: 02-group takes $group apart " +
      "properly, including every accumulator."
  );
});
