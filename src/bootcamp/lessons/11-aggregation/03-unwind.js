/**
 * LESSON 11-aggregation/03-unwind — Exploding arrays
 *
 * Our orders embed their line items. That is great for reading an order, but
 * it makes product-level questions awkward: "which product sold the most
 * units?" needs to look INSIDE the arrays, across 300 orders.
 *
 * $unwind is the answer. It takes one document with an N-element array and
 * emits N documents, each carrying one element. After that, every ordinary
 * stage ($match, $group, $sort) works on individual items.
 *
 * The catch — and it is a big one — is that $unwind changes your document
 * count, so any $sum you write after it is summing a different population
 * than you might think. This lesson makes that concrete.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 11-aggregation/03-unwind
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";

await runLesson("Aggregation 3/6 — $unwind", async () => {
  // --------------------------------------------------------------------
  section("1. Before and after — one order becomes N documents");
  const original = await Order.findOne({ "items.2": { $exists: true } }).lean();
  show("One order with several line items", {
    orderNumber: original.orderNumber,
    totalAmount: original.totalAmount,
    itemCount: original.items.length,
    items: original.items.map((i) => ({ name: i.productName, qty: i.quantity })),
  });

  const unwound = await Order.aggregate([
    { $match: { _id: original._id } },
    // $unwind: "$items" — the string form. Everything outside the array is
    // COPIED onto each output document; the array field is replaced by one
    // element.
    { $unwind: "$items" },
    { $project: { _id: 0, orderNumber: 1, totalAmount: 1, item: "$items" } },
  ]);
  show(`The same order after $unwind — now ${unwound.length} documents`, unwound);
  note(
    "Look at totalAmount: the SAME value is repeated on every output " +
      "document. $unwind duplicates the parent's fields onto each element. " +
      "That is exactly why summing totalAmount after an $unwind gives you an " +
      "inflated number — section 4 proves it."
  );

  // --------------------------------------------------------------------
  section("2. Document counts through the pipeline");
  const orderCount = await Order.countDocuments();
  const [{ lineItems }] = await Order.aggregate([
    { $unwind: "$items" },
    { $count: "lineItems" },
  ]);
  show("Counts", {
    "orders in the collection": orderCount,
    "documents after $unwind": lineItems,
    "average items per order": Number((lineItems / orderCount).toFixed(2)),
  });
  note(
    "300 orders became roughly 750 documents. Nothing was written — this " +
      "expansion exists only inside the pipeline, in memory, for the length " +
      "of the query."
  );

  // --------------------------------------------------------------------
  section("3. The natural use — per-product sales across all orders");
  const bestSellers = await Order.aggregate([
    // Filter FIRST: only orders that really sold. This runs before the
    // expansion, so we never unwind rows we are going to throw away.
    { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        productName: { $first: "$items.productName" },
        unitsSold: { $sum: "$items.quantity" },
        revenue: { $sum: "$items.subtotal" },
        // How many separate orders included this product.
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { unitsSold: -1 } },
    { $limit: 8 },
    { $project: { _id: 0, productName: 1, unitsSold: 1, revenue: 1, orderCount: 1 } },
  ]);
  show("Top 8 products by units sold", bestSellers);
  note(
    "This question is impossible with find(). The array had to be flattened " +
      "before items from DIFFERENT orders could be grouped together. Note " +
      "that $sum works on '$items.quantity' — after $unwind, 'items' is a " +
      "single object, so dot notation reaches into it normally."
  );

  // --------------------------------------------------------------------
  section("4. THE TRAP — double counting after $unwind");
  // Correct: sum each order's total ONCE, without unwinding.
  const [correct] = await Order.aggregate([
    { $match: { status: "delivered" } },
    { $group: { _id: null, revenue: { $sum: "$totalAmount" }, orders: { $sum: 1 } } },
  ]);
  // Wrong: unwind first, then sum totalAmount — every order is counted once
  // PER LINE ITEM.
  const [inflated] = await Order.aggregate([
    { $match: { status: "delivered" } },
    { $unwind: "$items" },
    { $group: { _id: null, revenue: { $sum: "$totalAmount" }, rows: { $sum: 1 } } },
  ]);
  show("Delivered revenue, computed two ways", {
    "correct (no $unwind)": { revenue: correct.revenue, orders: correct.orders },
    "WRONG (summed after $unwind)": { revenue: inflated.revenue, rows: inflated.rows },
    inflationFactor: Number((inflated.revenue / correct.revenue).toFixed(2)),
  });
  note(
    "The inflated number is roughly 2.5x too high — one multiple per average " +
      "line item. The rule: after $unwind, only sum fields that belong to " +
      "the ELEMENT ($items.subtotal, $items.quantity). Summing a PARENT " +
      "field ($totalAmount) double counts. If you need both, either compute " +
      "them in separate pipelines, use $facet (lesson 06), or group back up " +
      "by order _id first."
  );

  // The group-back-up fix, since it is the pattern you will actually reach for.
  const [regrouped] = await Order.aggregate([
    { $match: { status: "delivered" } },
    { $unwind: "$items" },
    // Pass 1: back to one row per order, with item-level work already done.
    {
      $group: {
        _id: "$_id",
        totalAmount: { $first: "$totalAmount" }, // $first, not $sum — one value per order
        units: { $sum: "$items.quantity" },
      },
    },
    // Pass 2: now totals are safe to add.
    { $group: { _id: null, revenue: { $sum: "$totalAmount" }, units: { $sum: "$units" }, orders: { $sum: 1 } } },
  ]);
  show("The fix: group back to one row per order first", regrouped);

  // --------------------------------------------------------------------
  section("5. $unwind DROPS documents with empty or missing arrays");
  // By default, a document whose array is empty (or absent) produces NO
  // output at all. It vanishes from the pipeline.
  const usersTotal = await User.countDocuments();
  const [{ n: afterPlainUnwind }] = await User.aggregate([
    { $unwind: "$interests" },
    { $group: { _id: "$_id" } },
    { $count: "n" },
  ]);
  const [{ n: afterPreserving }] = await User.aggregate([
    // The OBJECT form of $unwind unlocks the options.
    { $unwind: { path: "$interests", preserveNullAndEmptyArrays: true } },
    { $group: { _id: "$_id" } },
    { $count: "n" },
  ]);
  show("How many distinct users survive the unwind?", {
    "users in the collection": usersTotal,
    "distinct users after plain $unwind": afterPlainUnwind,
    "distinct users with preserveNullAndEmptyArrays: true": afterPreserving,
  });
  note(
    "Any user with an empty interests array disappeared. This is an " +
      "INNER JOIN in SQL terms; preserveNullAndEmptyArrays: true makes it a " +
      "LEFT JOIN. The bug it causes is subtle — 'why is my report missing " +
      "customers?' — and it is the single most common $unwind mistake after " +
      "double counting."
  );

  // --------------------------------------------------------------------
  section("6. includeArrayIndex — keeping the element's position");
  const withIndex = await Order.aggregate([
    { $match: { _id: original._id } },
    {
      $unwind: {
        path: "$items",
        // Adds a field holding the element's 0-based position in the array.
        includeArrayIndex: "lineNumber",
      },
    },
    {
      $project: {
        _id: 0,
        orderNumber: 1,
        // Humans count from 1.
        line: { $add: ["$lineNumber", 1] },
        product: "$items.productName",
        quantity: "$items.quantity",
      },
    },
  ]);
  show("Line numbers preserved from the array order", withIndex);
  note(
    "Useful for invoices and for anything where 'the first element' has " +
      "meaning (a primary image, a default address). Without it, array " +
      "position is lost the moment you unwind."
  );

  // --------------------------------------------------------------------
  section("7. Alternatives — you do not always need $unwind");
  // For simple per-document array work, expression operators are cheaper:
  // no expansion, no regrouping, no double-counting risk.
  const perOrderStats = await Order.aggregate([
    { $match: { status: "delivered" } },
    {
      $project: {
        _id: 0,
        orderNumber: 1,
        // $size: how many elements — no unwind needed.
        lineCount: { $size: "$items" },
        // $sum over an array of numbers extracted with $map.
        units: { $sum: { $map: { input: "$items", in: "$$this.quantity" } } },
        // $reduce for anything $sum cannot express.
        heaviestLine: { $max: { $map: { input: "$items", in: "$$this.subtotal" } } },
      },
    },
    { $sort: { units: -1 } },
    { $limit: 5 },
  ]);
  show("Per-order array stats WITHOUT $unwind", perOrderStats);
  note(
    "Rule of thumb: if the answer stays within one document (how many items " +
      "does THIS order have?), use $size / $map / $reduce / $filter. Use " +
      "$unwind only when elements from DIFFERENT documents must meet — " +
      "grouping, sorting, or joining across the array. $unwind is the " +
      "expensive option; reach for it deliberately."
  );

  // --------------------------------------------------------------------
  section("8. Multikey indexes and $unwind");
  // A $match BEFORE $unwind can use a multikey index; after $unwind it
  // cannot, because the documents are now intermediate results.
  const tagged = await Product.aggregate([
    // This $match uses the { tags: 1 } multikey index from product.model.js.
    { $match: { tags: "bestseller", isActive: true } },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", products: { $sum: 1 } } },
    { $sort: { products: -1 } },
    { $limit: 5 },
  ]);
  show("Tags that co-occur with 'bestseller'", tagged);
  note(
    "Always $match before $unwind when you can — it shrinks the stream " +
      "before it multiplies, and it is the only position where an index can " +
      "help. Next: 04-lookup, the real server-side join."
  );
});
