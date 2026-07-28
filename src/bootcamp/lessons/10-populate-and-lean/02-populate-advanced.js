/**
 * LESSON 10-populate-and-lean/02-populate-advanced — Deep, virtual, match & traps
 *
 * Populate beyond one level: nested populate (Review -> Product -> Category),
 * virtual populate (Product.reviews — the reference lives on the OTHER side),
 * and the match option with its famous trap (children filtered, parents not —
 * and null holes whose behavior depends on the path's shape). Then the
 * mistakes every beginner makes — typo'd paths, missing ref, the N+1 loop,
 * over-populating — and the moment populate is the wrong tool: server-side
 * filtering on joined data, where aggregation's $lookup wins.
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 10-populate-and-lean/02-populate-advanced
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Review from "../../../models/review.model.js";
// Category is never queried directly here, but deep populate resolves
// ref: "Category" through the registered model — importing the file (even
// without a binding) is what registers it.
import "../../../models/category.model.js";

await runLesson("Advanced populate — deep, virtual, match & $lookup", async () => {
  // --------------------------------------------------------------------
  section("1. Deep (nested) populate: Review -> Product -> Category");
  // A review references a product; the product references a category. The
  // inner `populate` option chains a THIRD query onto the second:
  //   #1 reviews.find(...)
  //   #2 products.find({ _id: { $in: [...] } })   <- from review.product
  //   #3 categories.find({ _id: { $in: [...] } }) <- from product.category
  // One extra round trip per LEVEL — same mechanics, applied recursively.
  const reviews = await Review.find({ rating: 5 })
    .sort({ helpfulVotes: -1 })
    .limit(2)
    .select("rating title product user")
    .populate({
      path: "product",
      // GOTCHA: the inner select MUST include `category` — that id is what
      // level 3 follows. Project it away and the nested populate silently
      // has nothing to do (no error, just a missing category).
      select: "name price category",
      populate: { path: "category", select: "name slug" },
    })
    .populate({ path: "user", select: "name" });

  show(
    "Top 5-star reviews with product AND its category",
    reviews.map((r) => ({
      rating: r.rating,
      title: r.title,
      by: r.user?.name,
      product: r.product && {
        name: r.product.name,
        price: r.product.price,
        category: r.product.category, // populated inside the populated doc
      },
    }))
  );
  note(
    "Three collections stitched in Node from three queries. Depth 2 is " +
      "everyday (breadcrumbs, review cards); depth 3+ is a smell — you are " +
      "paying a round trip per level to assemble a mega-object. Consider " +
      "$lookup (section 8) or denormalized snapshot fields instead."
  );

  // --------------------------------------------------------------------
  section("2. Virtual populate: Product.reviews — the ref lives elsewhere");
  // Products do NOT store review ids. Each REVIEW stores a product id —
  // correct modeling, because reviews per product are unbounded (module 09).
  // The product schema declares a populate VIRTUAL that describes the
  // reverse lookup:
  //   productSchema.virtual("reviews", {
  //     ref: "Review",           // model to query
  //     localField: "_id",       // value taken from THIS product...
  //     foreignField: "product", // ...matched against Review.product
  //   });
  // populate("reviews") then runs: reviews.find({ product: { $in: [ids] } })
  // — same two-query stitch, just matching on a field instead of _id.
  const product = await Product.findOne({ "ratingSummary.count": { $gte: 3 } })
    .select("name ratingSummary")
    .populate({
      path: "reviews",
      select: "rating title helpfulVotes product",
      options: { sort: { helpfulVotes: -1 } }, // options of query #2
    });

  show("Product with virtually-populated reviews", {
    name: product.name,
    denormalizedSummary: product.ratingSummary, // stored copy on the product
    populatedReviewCount: product.reviews.length, // fetched just now
    topReviews: product.reviews.slice(0, 2).map((r) => ({
      rating: r.rating,
      title: r.title,
      helpfulVotes: r.helpfulVotes,
    })),
  });
  note(
    "Nothing was ever stored on the product: `reviews` exists only because " +
      "we asked. If ratingSummary.count equals the populated count, the " +
      "denormalized copy is in sync — comparing a stored aggregate against " +
      "the source of truth like this is a real consistency check. Note the " +
      "select includes `product` (the foreignField): Mongoose needs it to " +
      "know which parent each review belongs to when stitching."
  );

  // --------------------------------------------------------------------
  section("3. match — filtering the CHILDREN of a populate");
  // `match` is a normal filter merged into populate's second query. Here:
  // only reviews rated 4+. On a populate VIRTUAL (an array built from
  // matches), non-matching reviews are simply never fetched — the array
  // genuinely shrinks.
  const picky = await Product.findById(product._id)
    .select("name ratingSummary")
    .populate({
      path: "reviews",
      match: { rating: { $gte: 4 } },
      select: "rating title product",
    });
  show("Same product, only 4-star-and-up reviews", {
    name: picky.name,
    totalReviews: picky.ratingSummary.count,
    matchingReviews: picky.reviews.length,
    ratings: picky.reviews.map((r) => r.rating),
  });
  note(
    "matchingReviews <= totalReviews: the match filtered query #2 on the " +
      "SERVER (good — rejected reviews never crossed the network). So far, " +
      "so intuitive. Now the trap."
  );

  // --------------------------------------------------------------------
  section("4. THE TRAP: match never filters the PARENTS");
  // "Give me orders from active customers" — a beginner reaches for match.
  // But the orders were fetched by query #1 BEFORE the user query ran.
  // Every order still comes back; orders whose user failed the match get
  // user: null. Populate filters children. It cannot un-fetch parents.
  const sample = await Order.find()
    .sort({ placedAt: -1 })
    .limit(30)
    .select("orderNumber user status")
    .populate({ path: "user", match: { isActive: true }, select: "name isActive" });

  const nullUsers = sample.filter((o) => o.user === null);
  show("30 orders, populate user with match {isActive: true}", {
    ordersReturned: sample.length, // still 30 — parents untouched
    ordersWithNullUser: nullUsers.length, // ~12% of users are inactive
    exampleNullHole: nullUsers[0]
      ? { orderNumber: nullUsers[0].orderNumber, user: nullUsers[0].user }
      : "(none in this sample — rerun or raise the limit)",
  });
  note(
    "Still 30 orders — the match punched null HOLES instead of filtering. " +
      "Filtering afterwards in Node (orders.filter(o => o.user)) 'works' " +
      "but breaks pagination: page 1 of 10 might render 7 rows. To truly " +
      "select parents by child data: query children first (find active " +
      "user ids, then orders with user $in ids) — or use $lookup " +
      "(section 8), where the server filters BEFORE anything is returned. " +
      "Unchecked, these nulls become the classic crash: order.user.name."
  );

  // --------------------------------------------------------------------
  section("5. match + arrays: counts don't shrink predictably");
  // What does a non-matching ref become? It depends on the SHAPE of the
  // path. order.items is an array of SUBDOCUMENTS, each holding a product
  // ref. A match keeps every subdocument (they are stored order data, not
  // refs!) and nulls only the ref field inside. items.length is unchanged.
  const brandOrders = await Order.find()
    .limit(8)
    .select("orderNumber items")
    .populate({
      path: "items.product",
      match: { "specs.brand": "Volt" }, // only Volt products survive
      select: "name specs.brand",
    });

  show(
    "items.length vs populated products per order",
    brandOrders.map((o) => ({
      orderNumber: o.orderNumber,
      itemCount: o.items.length, // unchanged by the match
      voltProducts: o.items.filter((i) => i.product !== null).length,
      nullProducts: o.items.filter((i) => i.product === null).length,
    }))
  );
  note(
    "Three shapes, three behaviors: single ref (order.user) -> null; ref " +
      "inside subdocuments (items.product) -> subdoc stays, ref field null, " +
      "array length UNCHANGED; direct array of refs / populate virtual " +
      "(product.reviews, section 3) -> dropped, array SHRINKS. Moral: " +
      "never read an array length after a matched populate as a count."
  );

  // --------------------------------------------------------------------
  section("6. Common mistakes: typo'd paths and forgotten refs");
  // Mistake A: populating a path that is not in the schema. Since Mongoose
  // 6, strictPopulate throws instead of silently doing nothing — a typo
  // becomes a loud error. (Order has `user`, not `customer`.)
  try {
    await Order.findOne().populate("customer");
    show("populate('customer')", "no error?! (unexpected)");
  } catch (error) {
    show("populate('customer') was rejected", {
      name: error.name, // StrictPopulateError
      message: error.message,
    });
  }
  note(
    "Mistake B — forgetting `ref`: if a path is a plain ObjectId with NO " +
      "ref in the schema, populate has no idea which model to query and " +
      "errors. Fix the schema, or pass the model explicitly for one call: " +
      ".populate({ path: 'user', model: 'User' }). Mistake C — " +
      "over-populating: populating whole documents (no select) or paths " +
      "the screen never shows. Populate is a fetch, not a decoration; " +
      "every path is a round trip and every unselected field is payload."
  );

  // --------------------------------------------------------------------
  section("7. The N+1 problem — populate in a loop");
  // The most expensive mistake: fetch N orders, then query the user for
  // EACH one. N parents -> N+1 queries -> N+1 round trips. Populate does
  // the same job in exactly 2 queries.
  const plainOrders = await Order.find()
    .sort({ placedAt: -1 })
    .limit(20)
    .select("orderNumber user")
    .lean();

  // BAD: one query per order, awaited one after another.
  const t0 = process.hrtime.bigint();
  for (const o of plainOrders) {
    await User.findById(o.user).select("name").lean(); // 20 round trips!
  }
  const t1 = process.hrtime.bigint();

  // GOOD: same data, one batched $in query.
  await Order.find()
    .sort({ placedAt: -1 })
    .limit(20)
    .select("orderNumber user")
    .populate({ path: "user", select: "name" })
    .lean();
  const t2 = process.hrtime.bigint();

  show("N+1 loop vs populate, 20 orders", {
    loop_21_queries: `${(Number(t1 - t0) / 1e6).toFixed(1)} ms`,
    populate_2_queries: `${(Number(t2 - t1) / 1e6).toFixed(1)} ms`,
  });
  note(
    "On localhost the gap is modest — round trips are sub-millisecond. On " +
      "a real deployment with ~20 ms to the database, the loop costs " +
      "21 x 20 = ~420 ms of pure waiting vs ~40 ms for populate. The bug " +
      "usually hides as await inside a .map/for over route results. If " +
      "you take one habit from this module: NEVER query per-item in a " +
      "loop — batch with populate or $in."
  );

  // --------------------------------------------------------------------
  section("8. When populate is the wrong tool: $lookup");
  // "Top delivered orders placed by customers in Mumbai." Populate cannot
  // do this: it would fetch ALL orders, populate users, then discard most
  // in Node (section 4). $lookup is MongoDB's true server-side join — an
  // aggregation stage — so later stages can filter PARENTS by joined data,
  // and only the final rows cross the network. One round trip.
  const mumbaiOrders = await Order.aggregate([
    // Filter early on indexed order fields — before the join.
    { $match: { status: "delivered" } },
    {
      $lookup: {
        from: "users", // RAW collection name — models/ref don't exist here
        localField: "user",
        foreignField: "_id",
        as: "customer", // always lands as an array
      },
    },
    { $unwind: "$customer" }, // [user] -> user, one doc per match
    // The move populate can't make: filtering ORDERS by a USER field.
    { $match: { "customer.address.city": "Mumbai" } },
    { $sort: { totalAmount: -1 } },
    { $limit: 5 },
    {
      $project: {
        _id: 0,
        orderNumber: 1,
        totalAmount: 1,
        customerName: "$customer.name",
        city: "$customer.address.city",
      },
    },
  ]);
  show("Top delivered orders by Mumbai customers ($lookup)", mumbaiOrders);
  note(
    "Everything — join, filter, sort, trim — ran INSIDE the MongoDB " +
      "server; Node received only these 5 rows. Choose $lookup when you " +
      "filter/group/sort ACROSS the relationship or join large sets; " +
      "choose populate for simple display reads (easier, schema-aware). " +
      "Two footnotes: `from` takes the collection name ('users', not " +
      "'User') — a wrong name yields silent empty joins; and aggregation " +
      "returns plain objects (no hydration, no virtuals). Module 11 goes " +
      "deep on pipelines; next lesson, 03-lean, makes reads cheap."
  );
});
