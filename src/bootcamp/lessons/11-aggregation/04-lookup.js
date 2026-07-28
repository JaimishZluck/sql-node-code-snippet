/**
 * LESSON 11-aggregation/04-lookup — The real server-side join
 *
 * populate() (module 10) is Mongoose running a second query and stitching
 * results together in your Node.js process. $lookup is different in kind: it
 * is a stage that runs ON THE MONGODB SERVER, joining one collection to
 * another inside a single pipeline, in a single round trip.
 *
 * That difference is not cosmetic. Because the join happens server-side, you
 * can filter the parent by a child's fields, group across the join, and sort
 * on joined values — none of which populate() can do.
 *
 * This lesson covers both forms of $lookup (the simple equality form and the
 * pipeline form), the always-an-array output, the $unwind pairing, self-joins,
 * multi-field joins, and when NOT to use it.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 11-aggregation/04-lookup
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Order from "../../../models/order.model.js";
import Product from "../../../models/product.model.js";
import Category from "../../../models/category.model.js";
import Review from "../../../models/review.model.js";

await runLesson("Aggregation 4/6 — $lookup", async () => {
  // --------------------------------------------------------------------
  section("1. The simple form: localField / foreignField");
  const joined = await Order.aggregate([
    { $match: { status: "delivered" } },
    { $limit: 2 },
    {
      $lookup: {
        // IMPORTANT: `from` is the COLLECTION name, not the Mongoose model
        // name. It is "users", not "User". Getting this wrong does not
        // error — it silently returns empty arrays.
        from: "users",
        localField: "user", // field on THIS collection (orders)
        foreignField: "_id", // field on the OTHER collection (users)
        as: "customer", // where to put the matches
      },
    },
    { $project: { _id: 0, orderNumber: 1, totalAmount: 1, customer: 1 } },
  ]);
  show("Orders joined to their users", joined);
  note(
    "Notice `customer` is an ARRAY — always, even for a one-to-one join, " +
      "even when exactly one document matched, even when none did (then it " +
      "is []). $lookup is conceptually a LEFT OUTER JOIN that collects all " +
      "matches. This is the number one surprise; section 2 handles it."
  );

  // --------------------------------------------------------------------
  section("2. Flattening the array — $unwind or $arrayElemAt");
  const flattened = await Order.aggregate([
    { $match: { status: "delivered" } },
    { $limit: 3 },
    { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "customer" } },
    // Option A: $unwind. For a one-to-one join this turns the 1-element
    // array into a plain object. preserveNullAndEmptyArrays keeps orders
    // whose user was deleted — without it they would VANISH from the report.
    { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        orderNumber: 1,
        totalAmount: 1,
        customerName: "$customer.name",
        customerCity: "$customer.address.city",
      },
    },
  ]);
  show("Option A — $unwind after $lookup", flattened);

  const viaArrayElem = await Order.aggregate([
    { $match: { status: "delivered" } },
    { $limit: 3 },
    { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "customer" } },
    {
      $project: {
        _id: 0,
        orderNumber: 1,
        // Option B: pick element 0 directly. No extra stage, and it cannot
        // accidentally drop documents — [] simply yields null.
        customerName: { $arrayElemAt: ["$customer.name", 0] },
      },
    },
  ]);
  show("Option B — $arrayElemAt, no extra stage", viaArrayElem);
  note(
    "Use $arrayElemAt (or $first, MongoDB 4.4+) for one-to-one joins — it is " +
      "cheaper and safer. Use $unwind when the join is genuinely one-to-many " +
      "and you want a row per match. If you do use $unwind on a join, decide " +
      "consciously about preserveNullAndEmptyArrays: it is the difference " +
      "between a LEFT JOIN and an INNER JOIN."
  );

  // --------------------------------------------------------------------
  section("3. What populate() CANNOT do: filter parents by child fields");
  // populate() fetches parents first, so it can never use a child's field to
  // decide which parents to return. $lookup joins before filtering, so it can.
  const mumbaiOrders = await Order.aggregate([
    { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
    { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "customer" } },
    { $unwind: "$customer" },
    // THIS is the stage populate() has no equivalent for: filtering orders
    // by a property of the joined user.
    { $match: { "customer.address.city": "Mumbai" } },
    {
      $group: {
        _id: "$customer.name",
        orders: { $sum: 1 },
        spend: { $sum: "$totalAmount" },
      },
    },
    { $sort: { spend: -1 } },
    { $limit: 5 },
  ]);
  show("Top Mumbai customers by spend", mumbaiOrders);
  note(
    "With populate() you would have to fetch every order, populate every " +
      "user, and filter in JavaScript — pulling thousands of documents into " +
      "Node just to discard most of them. (populate's `match` option filters " +
      "the CHILD, leaving nulls on the parent; it does not filter parents.) " +
      "Whenever the filter, sort, or grouping key lives on the joined side, " +
      "you need $lookup."
  );

  // --------------------------------------------------------------------
  section("4. The pipeline form — join with conditions");
  // The pipeline form replaces localField/foreignField with `let` (variables
  // carried in from the outer document) and a sub-pipeline. It allows joins
  // on anything, not just equality, and lets you filter/shape the joined
  // documents BEFORE they are returned.
  const productsWithTopReviews = await Product.aggregate([
    { $match: { isActive: true, "ratingSummary.count": { $gte: 3 } } },
    { $sort: { "ratingSummary.average": -1 } },
    { $limit: 3 },
    {
      $lookup: {
        from: "reviews",
        // `let` exposes outer fields to the sub-pipeline as $$variables.
        // Without it, the sub-pipeline can only see the reviews collection.
        let: { productId: "$_id" },
        pipeline: [
          // $expr is required to compare a field ($product) with a variable
          // ($$productId) — plain query syntax cannot reference variables.
          { $match: { $expr: { $and: [{ $eq: ["$product", "$$productId"] }, { $gte: ["$rating", 4] }] } } },
          { $sort: { helpfulVotes: -1 } },
          { $limit: 2 }, // only the 2 most helpful positive reviews
          { $project: { _id: 0, rating: 1, title: 1, helpfulVotes: 1 } },
        ],
        as: "topReviews",
      },
    },
    { $project: { _id: 0, name: 1, ratingSummary: 1, topReviews: 1 } },
  ]);
  show("Top-rated products with their 2 most helpful reviews", productsWithTopReviews);
  note(
    "The sub-pipeline limited each product to 2 reviews BEFORE they crossed " +
      "the wire. The simple form would have attached every review to every " +
      "product and left you to trim them afterwards. Two syntax rules to " +
      "remember: outer values arrive as $$variables (double dollar), and " +
      "comparing them to fields requires $expr."
  );

  // --------------------------------------------------------------------
  section("5. Joining on something other than equality");
  // Because the pipeline form is just a pipeline, the join condition can be
  // any expression. Here: for each category, find products priced ABOVE that
  // category's own average — impossible with localField/foreignField.
  const premiumPerCategory = await Product.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$category", avgPrice: { $avg: "$price" } } },
    {
      $lookup: {
        from: "products",
        let: { categoryId: "$_id", threshold: "$avgPrice" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$category", "$$categoryId"] },
                  { $gt: ["$price", "$$threshold"] }, // a RANGE join condition
                  { $eq: ["$isActive", true] },
                ],
              },
            },
          },
          { $sort: { price: -1 } },
          { $limit: 2 },
          { $project: { _id: 0, name: 1, price: 1 } },
        ],
        as: "aboveAverage",
      },
    },
    { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "cat" } },
    {
      $project: {
        _id: 0,
        category: { $arrayElemAt: ["$cat.name", 0] },
        avgPrice: { $round: ["$avgPrice", 0] },
        aboveAverage: 1,
      },
    },
    { $sort: { avgPrice: -1 } },
    { $limit: 4 },
  ]);
  show("Priciest products above their own category average", premiumPerCategory);

  // --------------------------------------------------------------------
  section("6. Self-join — resolving the category tree");
  // categories.parent references categories._id, so the collection joins to
  // itself. Perfectly legal: `from` may be the same collection.
  const tree = await Category.aggregate([
    { $lookup: { from: "categories", localField: "parent", foreignField: "_id", as: "parentDoc" } },
    {
      $project: {
        _id: 0,
        slug: 1,
        parentSlug: { $ifNull: [{ $arrayElemAt: ["$parentDoc.slug", 0] }, "(root)"] },
      },
    },
    { $sort: { parentSlug: 1, slug: 1 } },
  ]);
  show("Category tree, one level resolved", tree);
  note(
    "For a tree of unknown depth MongoDB has $graphLookup, which follows a " +
      "reference recursively. Our tree is only two levels deep, so a single " +
      "$lookup suffices — but remember $graphLookup exists for org charts, " +
      "category hierarchies, and comment threads."
  );

  // --------------------------------------------------------------------
  section("7. Joining through an embedded array");
  // orders.items[].product references products._id. $lookup can match an
  // ARRAY of local values against foreign _ids in one go.
  const orderWithCategories = await Order.aggregate([
    { $match: { status: "delivered" } },
    { $limit: 1 },
    {
      $lookup: {
        from: "products",
        // localField reaches into the array: every items[].product value is
        // used as a lookup key, and all matches land in `products`.
        localField: "items.product",
        foreignField: "_id",
        as: "products",
      },
    },
    {
      $project: {
        _id: 0,
        orderNumber: 1,
        itemCount: { $size: "$items" },
        matchedProducts: { $size: "$products" },
        productNames: "$products.name",
      },
    },
  ]);
  show("One order joined to the product catalog", orderWithCategories);
  note(
    "matchedProducts may be SMALLER than itemCount if two line items point " +
      "at the same product (the join deduplicates) — another reason the " +
      "snapshot fields (productName, unitPrice) live on the line item itself."
  );

  // --------------------------------------------------------------------
  section("8. Casting ObjectIds yourself");
  // Aggregation does NOT go through Mongoose casting. A string id in $match
  // simply never matches.
  const someProduct = await Product.findOne().select("_id").lean();
  const idAsString = someProduct._id.toHexString();

  const [withString] = await Review.aggregate([
    { $match: { product: idAsString } }, // string — will NOT match
    { $count: "n" },
  ]).then((r) => (r.length ? r : [{ n: 0 }]));
  const [withObjectId] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(idAsString) } }, // correct
    { $count: "n" },
  ]).then((r) => (r.length ? r : [{ n: 0 }]));

  show("Same id, two types, in an aggregation $match", {
    "matched with a string": withString.n,
    "matched with an ObjectId": withObjectId.n,
  });
  note(
    "Zero versus the real count. find({ product: idAsString }) WOULD work, " +
      "because Mongoose casts it against the schema. aggregate() does not — " +
      "the pipeline is sent to the server as-is. Any id arriving from " +
      "req.params or req.query must be wrapped in " +
      "new mongoose.Types.ObjectId(...) before it goes into a pipeline. " +
      "This is the single most common aggregation bug in Express apps."
  );

  // --------------------------------------------------------------------
  section("9. $lookup vs populate — choosing");
  show("Decision guide", {
    "use populate() when":
      "you just want related documents attached to Mongoose docs, filtering only on the parent",
    "use $lookup when": [
      "you must filter/sort/group by a JOINED field",
      "you are already aggregating (totals, rankings, reports)",
      "you want one round trip instead of two",
      "you need a non-equality join condition",
    ],
    "performance": "index the foreignField (usually _id — already indexed; otherwise add one)",
    "the real cost": "$lookup runs a query per input document unless the join field is indexed",
    "cardinality warning":
      "joining a large collection to another large collection is expensive in any database",
  });
  note(
    "One rule that saves real incidents: never $lookup inside a pipeline " +
      "that has already exploded via $unwind, unless you have filtered hard " +
      "first. 750 line items x one lookup each is 750 index probes. Look up " +
      "first, then unwind — or group before joining. Next: 05-expressions."
  );
});
