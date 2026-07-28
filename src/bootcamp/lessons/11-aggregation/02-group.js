/**
 * LESSON 11-aggregation/02-group — $group and every accumulator
 *
 * $group is the stage that turns "many documents" into "one summary per
 * something". It is the direct equivalent of SQL's GROUP BY, and it is where
 * most real analytics happens: revenue per month, orders per customer,
 * average rating per product, count per status.
 *
 * Two things to hold on to. First, `_id` inside $group is not a document id —
 * it is the GROUPING KEY, the thing you are grouping by. Second, every other
 * field must be produced by an ACCUMULATOR ($sum, $avg, $push, ...), because
 * many documents are collapsing into one and MongoDB needs to know how.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 11-aggregation/02-group
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";
import Review from "../../../models/review.model.js";
import Product from "../../../models/product.model.js";

await runLesson("Aggregation 2/6 — $group and accumulators", async () => {
  // --------------------------------------------------------------------
  section("1. The anatomy of $group");
  note(
    "{ $group: { _id: <what to group by>, <field>: { <accumulator>: <expr> } } }\n" +
      "  _id  — the grouping key. Every document with the same key lands in\n" +
      "         the same bucket. _id: null means ONE bucket for everything.\n" +
      "  rest — accumulators. They fold many values into one: $sum, $avg,\n" +
      "         $min, $max, $push, $addToSet, $first, $last, $count, $stdDevPop.\n" +
      "Output: exactly one document per distinct key, and NOTHING else from\n" +
      "the original documents survives unless an accumulator carried it."
  );

  // --------------------------------------------------------------------
  section("2. _id: null — collapse everything into one summary row");
  const storeTotals = await Order.aggregate([
    { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
    {
      $group: {
        _id: null, // one bucket for the whole collection
        // $sum with a field path adds the values.
        revenue: { $sum: "$totalAmount" },
        // $sum with the literal 1 counts documents — the idiom for COUNT(*).
        orders: { $sum: 1 },
        averageOrderValue: { $avg: "$totalAmount" },
        smallestOrder: { $min: "$totalAmount" },
        largestOrder: { $max: "$totalAmount" },
        // Standard deviation over the population in this group.
        spread: { $stdDevPop: "$totalAmount" },
      },
    },
    { $project: { _id: 0, revenue: 1, orders: 1, smallestOrder: 1, largestOrder: 1, averageOrderValue: { $round: ["$averageOrderValue", 0] }, spread: { $round: ["$spread", 0] } } },
  ]);
  show("Whole-store totals (revenue-producing orders only)", storeTotals[0]);
  note(
    "{ $sum: 1 } is the counting idiom: add 1 for every document that " +
      "reaches this group. { $sum: '$field' } adds the field's values " +
      "instead. Mixing these two up ('why is my count 4,382,000?') is a " +
      "rite of passage."
  );

  // --------------------------------------------------------------------
  section("3. Grouping by a field — one row per status");
  const byStatus = await Order.aggregate([
    {
      $group: {
        _id: "$status", // the grouping key is the value of the status field
        orders: { $sum: 1 },
        revenue: { $sum: "$totalAmount" },
      },
    },
    { $sort: { orders: -1 } },
  ]);
  show("Orders and revenue per status", byStatus);
  note(
    "Five rows, one per enum value. Note that cancelled and pending orders " +
      "still report a revenue figure — money that was never collected. This " +
      "is why the previous section $match-ed first: aggregation gives you " +
      "exactly what you ask for, including nonsense, so the business meaning " +
      "of a number is your responsibility."
  );

  // --------------------------------------------------------------------
  section("4. Grouping by a computed key");
  // The key can be any expression, not just a field path. Here: bucket the
  // day of week out of a date, entirely on the server.
  const byWeekday = await Order.aggregate([
    { $match: { status: { $ne: "cancelled" } } },
    {
      $group: {
        // $dayOfWeek returns 1 (Sunday) .. 7 (Saturday).
        _id: { $dayOfWeek: "$placedAt" },
        orders: { $sum: 1 },
        revenue: { $sum: "$totalAmount" },
      },
    },
    {
      $project: {
        _id: 0,
        // $arrayElemAt with an index expression turns 1..7 into a name.
        // (Index 0 is a placeholder because $dayOfWeek is 1-based.)
        weekday: {
          $arrayElemAt: [
            ["-", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
            "$_id",
          ],
        },
        orders: 1,
        revenue: 1,
      },
    },
    { $sort: { orders: -1 } },
  ]);
  show("Which weekday do customers order on?", byWeekday);

  // --------------------------------------------------------------------
  section("5. Grouping by MULTIPLE fields — _id as an object");
  // A compound key is just an object. Each distinct combination is a bucket.
  const byStatusAndMethod = await Order.aggregate([
    { $match: { status: { $in: ["delivered", "cancelled"] } } },
    {
      $group: {
        _id: { status: "$status", method: "$payment.method" },
        orders: { $sum: 1 },
        revenue: { $sum: "$totalAmount" },
      },
    },
    { $sort: { "_id.status": 1, orders: -1 } },
  ]);
  show("Delivered vs cancelled, split by payment method", byStatusAndMethod);
  note(
    "The output _id is now an object. Downstream stages address its parts " +
      "with dot notation ('_id.status'), and you will usually $project it " +
      "into flat fields before returning it from an API."
  );

  // --------------------------------------------------------------------
  section("6. $push and $addToSet — collecting values instead of reducing them");
  // Not every accumulator reduces to a number. $push collects every value
  // into an array; $addToSet does the same but drops duplicates.
  const cityRoster = await User.aggregate([
    { $match: { "address.city": { $exists: true }, deletedAt: null } },
    {
      $group: {
        _id: "$address.city",
        people: { $sum: 1 },
        // Collect names into an array — order follows arrival order.
        names: { $push: "$name" },
        // Collect the distinct roles present in this city.
        roles: { $addToSet: "$role" },
        // $push can build objects too, not just scalars.
        topLoyalty: { $max: "$loyaltyPoints" },
      },
    },
    { $sort: { people: -1 } },
    { $limit: 4 },
  ]);
  show("Users per city, with their names and distinct roles", cityRoster);
  note(
    "$push builds an array of EVERY value (duplicates kept); $addToSet " +
      "builds a SET (duplicates dropped, order not guaranteed). Warning: " +
      "both grow with group size, and a single output document is still " +
      "capped at 16 MB — never $push raw documents from a large group. " +
      "Push a few fields, or use $topN/$firstN (MongoDB 5.2+) to cap it."
  );

  // --------------------------------------------------------------------
  section("7. $first and $last — order-dependent accumulators");
  // These take the value from the first/last document to reach the group,
  // which is only meaningful if you $sort BEFORE the $group.
  const latestOrderPerUser = await Order.aggregate([
    { $match: { status: "delivered" } },
    // The $sort must come first — $first/$last describe arrival order.
    { $sort: { placedAt: -1 } },
    {
      $group: {
        _id: "$user",
        mostRecentOrder: { $first: "$orderNumber" },
        mostRecentDate: { $first: "$placedAt" },
        oldestOrder: { $last: "$orderNumber" },
        lifetimeSpend: { $sum: "$totalAmount" },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { lifetimeSpend: -1 } },
    { $limit: 5 },
  ]);
  show("Top 5 customers by lifetime spend", latestOrderPerUser);
  note(
    "Forgetting the $sort before $group is a classic bug: $first then " +
      "returns an arbitrary document and your 'most recent order' is random. " +
      "MongoDB will not warn you. (MongoDB 5.2+ also offers $top/$bottom, " +
      "which take the sort spec inline and are safer for this pattern.)"
  );

  // --------------------------------------------------------------------
  section("8. $group is how you compute a DISTINCT list");
  // distinct() exists but returns a bare array and cannot be combined with
  // other work. $group gives you distinct values plus counts in one pass.
  const distinctTags = await Product.aggregate([
    { $match: { isActive: true } },
    // $unwind first (lesson 03) so each tag becomes its own document.
    { $unwind: "$tags" },
    { $group: { _id: "$tags", products: { $sum: 1 } } },
    { $sort: { products: -1 } },
  ]);
  show("Every tag in use, with how many active products carry it", distinctTags);

  // --------------------------------------------------------------------
  section("9. Grouping twice — average of an average");
  // A second $group consumes the output of the first. Here: reviews per
  // product, then the distribution of those per-product averages.
  const ratingDistribution = await Review.aggregate([
    // Pass 1: one row per product.
    { $group: { _id: "$product", avgRating: { $avg: "$rating" }, reviews: { $sum: 1 } } },
    // Only products with enough reviews to mean anything.
    { $match: { reviews: { $gte: 3 } } },
    // Pass 2: bucket those products by their rounded average.
    {
      $group: {
        _id: { $round: ["$avgRating", 0] },
        productsInThisBand: { $sum: 1 },
        totalReviews: { $sum: "$reviews" },
      },
    },
    { $sort: { _id: -1 } },
  ]);
  show("How many well-reviewed products sit at each star level", ratingDistribution);
  note(
    "Two $group stages in one pipeline, with a $match between them. That " +
      "middle $match is a HAVING clause in SQL terms — it filters GROUPS, " +
      "not documents, because it runs after grouping. $match before $group " +
      "filters documents; $match after $group filters groups. Same operator, " +
      "completely different meaning depending on position."
  );

  // --------------------------------------------------------------------
  section("10. Performance notes");
  show("What makes a $group fast or slow", {
    "always blocking": "$group cannot emit until every document has arrived",
    "memory scales with GROUPS, not documents":
      "grouping 10M orders by status (5 groups) is cheap; by _id (10M groups) is not",
    "100 MB limit": "per stage; pass { allowDiskUse: true } to spill to disk",
    "index help": "only a leading $match (and sometimes $sort) can use an index",
    "$sum: 1 vs $count": "{ $count: 'n' } is a shorthand stage for a group+project",
  });
  note(
    "Next: 03-unwind, the stage that explodes arrays — and the one that " +
      "silently changes your document counts if you are not careful."
  );
});
