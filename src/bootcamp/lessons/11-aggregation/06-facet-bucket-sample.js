/**
 * LESSON 11-aggregation/06-facet-bucket-sample — Dashboards in one query
 *
 * The last three stages you need for real analytics work:
 *
 *   $facet   — run several independent pipelines over the SAME input and
 *              return all their results in one document. This is how a
 *              dashboard endpoint (or a paginated list with a total count)
 *              becomes a single round trip.
 *   $bucket  — group numbers into ranges you define ("price bands"), or let
 *              MongoDB pick the boundaries with $bucketAuto.
 *   $sample  — take a random subset, for previews and spot checks.
 *
 * Plus $replaceRoot, $count, and $sortByCount, which show up constantly
 * alongside them.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 11-aggregation/06-facet-bucket-sample
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import Review from "../../../models/review.model.js";

await runLesson("Aggregation 6/6 — $facet, $bucket, $sample", async () => {
  // --------------------------------------------------------------------
  section("1. $count and $sortByCount — the small conveniences");
  // $count is a whole stage that replaces the stream with a single
  // { field: n } document. It is shorthand for $group + $project.
  const [activeCount] = await Product.aggregate([
    { $match: { isActive: true, stock: { $gt: 0 } } },
    { $count: "availableProducts" },
  ]);
  show("$count", activeCount);

  // $sortByCount is shorthand for $group by an expression + $sort desc.
  // It is the "top values of a field" stage.
  const topBrands = await Product.aggregate([
    { $match: { isActive: true } },
    { $sortByCount: "$specs.brand" },
    { $limit: 5 },
  ]);
  show("$sortByCount — products per brand, most first", topBrands);
  note(
    "Careful with $count: it EMPTIES the stream and emits a single " +
      "document, so nothing can follow it except more work on that one " +
      "document. If you need a count alongside other results, that is " +
      "exactly what $facet is for."
  );

  // --------------------------------------------------------------------
  section("2. $bucket — price bands with boundaries you choose");
  const priceBands = await Product.aggregate([
    { $match: { isActive: true } },
    {
      $bucket: {
        groupBy: "$price",
        // Boundaries are lower-inclusive, upper-exclusive: [0,1000), [1000,5000)...
        boundaries: [0, 1000, 5000, 20000, 60000, 200000],
        // Anything outside the boundaries lands here. WITHOUT this option a
        // value beyond the last boundary makes the whole pipeline ERROR.
        default: "other",
        // Any accumulators you like, exactly as in $group.
        output: {
          products: { $sum: 1 },
          averagePrice: { $avg: "$price" },
          totalStock: { $sum: "$stock" },
          examples: { $push: "$name" },
        },
      },
    },
    {
      $project: {
        band: "$_id",
        _id: 0,
        products: 1,
        averagePrice: { $round: ["$averagePrice", 0] },
        totalStock: 1,
        examples: { $slice: ["$examples", 2] },
      },
    },
  ]);
  show("Products bucketed into price bands", priceBands);
  note(
    "Always set `default`. Without it, a single product priced above your " +
      "top boundary aborts the entire aggregation with '$bucket could not " +
      "find a matching branch' — a production incident waiting for the day " +
      "someone adds an expensive item."
  );

  // --------------------------------------------------------------------
  section("3. $bucketAuto — let MongoDB pick the boundaries");
  const autoBands = await Product.aggregate([
    { $match: { isActive: true } },
    {
      $bucketAuto: {
        groupBy: "$price",
        buckets: 4, // aim for 4 roughly equal-sized groups
        output: { products: { $sum: 1 }, averagePrice: { $avg: "$price" } },
      },
    },
    {
      $project: {
        _id: 0,
        from: "$_id.min",
        to: "$_id.max",
        products: 1,
        averagePrice: { $round: ["$averagePrice", 0] },
      },
    },
  ]);
  show("$bucketAuto — 4 buckets of similar population", autoBands);
  note(
    "$bucket gives you bands that mean something to the business (under " +
      "1,000 is 'budget'); $bucketAuto gives you bands with similar " +
      "populations, which is what you want for a histogram or a price " +
      "filter sidebar. The bucket COUNT is a target, not a guarantee — " +
      "heavily clustered data produces fewer."
  );

  // --------------------------------------------------------------------
  section("4. $facet — many pipelines, one round trip");
  // Each key is an independent pipeline; all of them see the SAME input
  // documents (whatever reached the $facet stage).
  const [dashboard] = await Order.aggregate([
    // This $match applies to EVERY facet below — filter once, reuse.
    { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              revenue: { $sum: "$totalAmount" },
              orders: { $sum: 1 },
              averageOrderValue: { $avg: "$totalAmount" },
            },
          },
          { $project: { _id: 0, revenue: 1, orders: 1, averageOrderValue: { $round: ["$averageOrderValue", 0] } } },
        ],
        byStatus: [
          { $group: { _id: "$status", orders: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
          { $sort: { revenue: -1 } },
        ],
        byPaymentMethod: [{ $sortByCount: "$payment.method" }],
        monthlyTrend: [
          { $group: { _id: { $dateTrunc: { date: "$placedAt", unit: "month" } }, revenue: { $sum: "$totalAmount" } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, month: { $dateToString: { format: "%Y-%m", date: "$_id" } }, revenue: 1 } },
          { $limit: 6 },
        ],
        biggestOrders: [
          { $sort: { totalAmount: -1 } },
          { $limit: 3 },
          { $project: { _id: 0, orderNumber: 1, totalAmount: 1 } },
        ],
      },
    },
  ]);
  show("A complete dashboard from ONE query", dashboard);
  note(
    "Five different reports, one round trip, one $match evaluated once. " +
      "Doing this with five separate queries would mean five network round " +
      "trips and five passes over the same documents. Every facet's result " +
      "is an ARRAY (it is a pipeline output), so the totals facet needs " +
      "[0] on the client — or a $project with $arrayElemAt to flatten it."
  );

  // --------------------------------------------------------------------
  section("5. $facet's flagship use — paginated results WITH a total count");
  // The classic API problem: return page 2 of the products AND the total
  // matching count, so the UI can render "showing 11-20 of 47".
  const page = 2;
  const perPage = 5;
  const filter = { isActive: true, price: { $gte: 1000 } };

  const [paged] = await Product.aggregate([
    { $match: filter },
    {
      $facet: {
        // Facet 1: the actual page of data.
        data: [
          { $sort: { price: -1 } },
          { $skip: (page - 1) * perPage },
          { $limit: perPage },
          { $project: { _id: 0, name: 1, price: 1, stock: 1 } },
        ],
        // Facet 2: how many matched in total, ignoring skip/limit.
        meta: [{ $count: "total" }],
      },
    },
    // Flatten meta from [{ total: 47 }] into usable numbers.
    {
      $project: {
        data: 1,
        total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
      },
    },
    {
      $addFields: {
        page,
        perPage,
        totalPages: { $ceil: { $divide: ["$total", perPage] } },
      },
    },
  ]);
  show("Page 2 of matching products, with pagination metadata", paged);
  note(
    "One query instead of two (a find and a countDocuments), and the filter " +
      "is written once so the two can never drift apart. The trade-off: the " +
      "$sort inside the data facet cannot use an index once $facet has " +
      "started, so for very large collections two separate queries can " +
      "actually be faster. Measure before assuming."
  );

  // --------------------------------------------------------------------
  section("6. $sample — random documents");
  // $sample pulls N documents pseudo-randomly. Useful for previews,
  // 'you might also like', and eyeballing real data during development.
  const randomProducts = await Product.aggregate([
    { $match: { isActive: true, stock: { $gt: 0 } } },
    { $sample: { size: 4 } },
    { $project: { _id: 0, name: 1, price: 1 } },
  ]);
  show("4 random in-stock products (different every run)", randomProducts);
  note(
    "$sample has two implementations. If it is the FIRST stage and size is " +
      "under 5% of the collection, it uses an efficient random-cursor trick. " +
      "Otherwise it falls back to sorting the whole stream by a random value " +
      "— which is a blocking, memory-hungry operation. Our $match forces the " +
      "slow path; on 63 documents that is irrelevant, on 63 million it is " +
      "not. Also note $sample may return duplicates in the fast path."
  );

  // --------------------------------------------------------------------
  section("7. $replaceRoot — promoting a nested object to the top level");
  // After a $group or $lookup you often end up with the data you want buried
  // one level down. $replaceRoot (alias $replaceWith) lifts it up.
  const promoted = await Review.aggregate([
    { $sort: { helpfulVotes: -1 } },
    { $limit: 3 },
    {
      $group: {
        _id: "$product",
        // Keep the whole review document as a nested field.
        best: { $first: "$$ROOT" },
        reviewCount: { $sum: 1 },
      },
    },
    // Promote `best` to be the document itself, merging in an extra field
    // so nothing is lost.
    { $replaceRoot: { newRoot: { $mergeObjects: ["$best", { reviewCount: "$reviewCount" }] } } },
    { $project: { _id: 0, rating: 1, title: 1, helpfulVotes: 1, reviewCount: 1 } },
  ]);
  show("$replaceRoot + $mergeObjects", promoted);
  note(
    "$$ROOT captures the entire incoming document, $replaceRoot promotes a " +
      "sub-object to the top, and $mergeObjects combines objects (later keys " +
      "win). Together they are the standard way to say 'keep the best " +
      "document per group, plus a computed field'."
  );

  // --------------------------------------------------------------------
  section("8. Where to go from here");
  show("Stages worth knowing that this module did not need", {
    $graphLookup: "recursive joins — org charts, category trees of unknown depth",
    $merge: "write pipeline output INTO a collection (materialized views)",
    $out: "replace a whole collection with the pipeline result",
    $setWindowFields: "running totals, moving averages, rankings (MongoDB 5.0+)",
    $densify: "fill gaps in a time series so empty months still appear",
    $search: "Atlas Search — full-text with relevance, only on Atlas",
    $unionWith: "concatenate another collection's documents into this pipeline",
  });
  note(
    "Module 11 complete. You can now express essentially any report: filter, " +
      "reshape, group, join, bucket, and combine. Next: module 12 makes them " +
      "FAST — indexes, explain(), and where a pipeline actually spends its " +
      "time."
  );
});
