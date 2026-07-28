/**
 * LESSON 11-aggregation/05-expressions — The expression language
 *
 * Stages are the pipeline's verbs; EXPRESSIONS are its grammar. An expression
 * computes a value from the current document, and it appears everywhere:
 * inside $project, $addFields, $group accumulators, $match's $expr, and
 * $lookup's sub-pipelines.
 *
 * They are written as nested objects — { $operator: [arg1, arg2] } — which
 * reads awkwardly at first because it is a function call turned inside out.
 * Once you see it as `operator(arg1, arg2)`, the whole language opens up.
 *
 * This lesson tours the operator families you will actually use: field paths,
 * arithmetic, conditionals, strings, dates, arrays, type handling, and $expr.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 11-aggregation/05-expressions
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";

await runLesson("Aggregation 5/6 — Expressions", async () => {
  // --------------------------------------------------------------------
  section("1. Field paths — the $ prefix");
  const paths = await Product.aggregate([
    { $limit: 2 },
    {
      $project: {
        _id: 0,
        // "$price" = the VALUE of the price field.
        theValue: "$price",
        // "price" without $ = the literal string "price".
        justAString: "price",
        // Dot notation reaches into nested objects.
        brand: "$specs.brand",
        // "$$ROOT" = the whole current document.
        everything: { $type: "$$ROOT" },
      },
    },
  ]);
  show("With and without the dollar sign", paths);
  note(
    "One dollar = a field path. Two dollars = a system or user variable " +
      "($$ROOT, $$NOW, $$this, and anything you declare with `let`). No " +
      "dollar = a literal. If you ever need a literal string that genuinely " +
      "starts with $, wrap it: { $literal: '$notAPath' }."
  );

  // --------------------------------------------------------------------
  section("2. Arithmetic — reading nested calls inside out");
  const arithmetic = await Product.aggregate([
    { $match: { discountPercent: { $gt: 0 } } },
    { $limit: 4 },
    {
      $project: {
        _id: 0,
        name: 1,
        price: 1,
        discountPercent: 1,
        // price * (1 - pct/100), written as nested operator objects.
        finalPrice: {
          $round: [
            { $multiply: ["$price", { $subtract: [1, { $divide: ["$discountPercent", 100] }] }] },
            0,
          ],
        },
        // The amount saved.
        youSave: {
          $round: [{ $multiply: ["$price", { $divide: ["$discountPercent", 100] }] }, 0],
        },
        // Other members of the family.
        priceInThousands: { $floor: { $divide: ["$price", 1000] } },
        absoluteExample: { $abs: { $subtract: ["$price", 50000] } },
      },
    },
  ]);
  show("Arithmetic operators at work", arithmetic);
  note(
    "The family: $add $subtract $multiply $divide $mod $abs $ceil $floor " +
      "$round $trunc $pow $sqrt $ln $log $exp. $add and $multiply take an " +
      "array of any length; $subtract and $divide take exactly two. $add " +
      "also does date arithmetic: { $add: ['$placedAt', 86400000] } is " +
      "'one day later'."
  );

  // --------------------------------------------------------------------
  section("3. Conditionals — $cond, $switch, $ifNull");
  const conditionals = await Product.aggregate([
    { $limit: 6 },
    {
      $project: {
        _id: 0,
        name: 1,
        stock: 1,
        price: 1,
        // $cond is if/else: [condition, thenValue, elseValue].
        availability: { $cond: [{ $gt: ["$stock", 0] }, "in stock", "out of stock"] },
        // The object form is more readable for complex conditions.
        urgency: {
          $cond: {
            if: { $and: [{ $gt: ["$stock", 0] }, { $lt: ["$stock", 10] }] },
            then: "low stock",
            else: "fine",
          },
        },
        // $switch is a chain of cases — cleaner than nested $cond.
        priceBand: {
          $switch: {
            branches: [
              { case: { $lt: ["$price", 1000] }, then: "budget" },
              { case: { $lt: ["$price", 20000] }, then: "mid-range" },
              { case: { $lt: ["$price", 80000] }, then: "premium" },
            ],
            // `default` is REQUIRED if no branch may match, or the pipeline
            // errors on the first unmatched document.
            default: "luxury",
          },
        },
        // $ifNull supplies a fallback for null OR missing.
        brand: { $ifNull: ["$specs.brand", "unbranded"] },
        weight: { $ifNull: ["$specs.weightGrams", 0] },
      },
    },
  ]);
  show("Conditional expressions", conditionals);
  note(
    "$ifNull is the workhorse of report pipelines: any field that is " +
      "optional in your data will otherwise produce null in your output and " +
      "break the arithmetic downstream ({ $add: [5, null] } is null, not 5). " +
      "Defend at the point of use."
  );

  // --------------------------------------------------------------------
  section("4. Comparison and boolean operators");
  const comparisons = await Order.aggregate([
    { $limit: 4 },
    {
      $project: {
        _id: 0,
        orderNumber: 1,
        status: 1,
        totalAmount: 1,
        // In expressions, comparison operators take an ARRAY of two values
        // and return a boolean — different from query syntax, where
        // { price: { $gt: 100 } } describes a filter.
        isBigOrder: { $gte: ["$totalAmount", 20000] },
        isFinished: { $in: ["$status", ["delivered", "cancelled"]] },
        // $and / $or / $not combine booleans.
        needsAttention: {
          $and: [{ $eq: ["$status", "pending"] }, { $gte: ["$totalAmount", 5000] }],
        },
        // $cmp returns -1, 0, or 1 — handy for sorting keys.
        comparedTo10k: { $cmp: ["$totalAmount", 10000] },
      },
    },
  ]);
  show("Comparison expressions return booleans", comparisons);
  note(
    "This is the single biggest source of confusion. QUERY syntax: " +
      "{ totalAmount: { $gte: 20000 } } — a filter describing documents. " +
      "EXPRESSION syntax: { $gte: ['$totalAmount', 20000] } — a computation " +
      "returning true/false. Same operator name, different shape, different " +
      "place. $match uses query syntax; $project/$group/$addFields use " +
      "expression syntax; $expr lets you use expression syntax inside $match."
  );

  // --------------------------------------------------------------------
  section("5. $expr — expression syntax inside a filter");
  // The killer feature: comparing two fields OF THE SAME DOCUMENT, which
  // plain query syntax simply cannot express.
  const selfComparing = await Order.aggregate([
    {
      $match: {
        // "orders where the total is more than 3x the average line value" —
        // both sides come from the same document.
        $expr: {
          $gt: ["$totalAmount", { $multiply: [3000, { $size: "$items" }] }],
        },
      },
    },
    { $project: { _id: 0, orderNumber: 1, totalAmount: 1, lines: { $size: "$items" } } },
    { $sort: { totalAmount: -1 } },
    { $limit: 5 },
  ]);
  show("Orders whose total exceeds 3000 per line item", selfComparing);
  note(
    "$expr also works in find(): " +
      "Order.find({ $expr: { $gt: ['$totalAmount', 50000] } }). The trade-off " +
      "is that $expr often cannot use an index the way a plain filter can, " +
      "so put a normal indexed $match in front of it whenever possible."
  );

  // --------------------------------------------------------------------
  section("6. String operators");
  const strings = await User.aggregate([
    { $match: { "address.city": { $exists: true } } },
    { $limit: 4 },
    {
      $project: {
        _id: 0,
        name: 1,
        email: 1,
        // Build a display string.
        label: { $concat: ["$name", " <", "$email", ">"] },
        // Case conversion.
        shouting: { $toUpper: "$name" },
        // Substrings (byte offsets, so beware multi-byte characters —
        // $substrCP is the code-point-safe version).
        initial: { $toUpper: { $substrCP: ["$name", 0, 1] } },
        // Split and take a piece.
        emailDomain: { $arrayElemAt: [{ $split: ["$email", "@"] }, 1] },
        // Length, again in code points.
        nameLength: { $strLenCP: "$name" },
        // Search within a string; -1 means not found.
        hasDotCom: { $gte: [{ $indexOfCP: ["$email", ".com"] }, 0] },
        // Trim whitespace or specific characters.
        trimmed: { $trim: { input: "$name" } },
        // Regex as an expression (MongoDB 4.2+).
        startsWithA: { $regexMatch: { input: "$name", regex: /^a/i } },
      },
    },
  ]);
  show("String expressions", strings);

  // --------------------------------------------------------------------
  section("7. Date operators");
  const dates = await Order.aggregate([
    { $limit: 3 },
    {
      $project: {
        _id: 0,
        orderNumber: 1,
        placedAt: 1,
        // Component extraction.
        year: { $year: "$placedAt" },
        month: { $month: "$placedAt" },
        day: { $dayOfMonth: "$placedAt" },
        weekday: { $dayOfWeek: "$placedAt" }, // 1 = Sunday
        // Formatting — the readable way to build report labels.
        label: { $dateToString: { format: "%Y-%m-%d", date: "$placedAt" } },
        // Timezone-aware formatting. Dates are stored in UTC; the timezone
        // belongs at the presentation layer.
        istLabel: {
          $dateToString: { format: "%Y-%m-%d %H:%M", date: "$placedAt", timezone: "Asia/Kolkata" },
        },
        // Truncate to a period — the modern way to group by month.
        monthStart: { $dateTrunc: { date: "$placedAt", unit: "month" } },
        // Difference between two dates in a named unit.
        daysSincePlaced: { $dateDiff: { startDate: "$placedAt", endDate: "$$NOW", unit: "day" } },
        // Date arithmetic.
        estimatedDelivery: { $dateAdd: { startDate: "$placedAt", unit: "day", amount: 5 } },
      },
    },
  ]);
  show("Date expressions", dates);
  note(
    "$$NOW is the server's clock at pipeline start — using it keeps 'days " +
      "ago' calculations on the server instead of shipping dates to Node. " +
      "For grouping by period prefer $dateTrunc (one clean field) over " +
      "$year + $month (a compound key you must reassemble)."
  );

  // --------------------------------------------------------------------
  section("8. Array operators — working inside an array without $unwind");
  const arrays = await Order.aggregate([
    { $match: { "items.1": { $exists: true } } },
    { $limit: 3 },
    {
      $project: {
        _id: 0,
        orderNumber: 1,
        lineCount: { $size: "$items" },
        // $map transforms each element. "$$this" is the current element.
        productNames: { $map: { input: "$items", in: "$$this.productName" } },
        // $filter keeps elements matching a condition. "$$item" is named by
        // the `as` option (default is "this").
        bigLines: {
          $filter: { input: "$items", as: "item", cond: { $gte: ["$$item.subtotal", 5000] } },
        },
        // $reduce folds an array into a single value. $$value is the
        // accumulator so far, $$this the current element.
        totalUnits: {
          $reduce: { input: "$items", initialValue: 0, in: { $add: ["$$value", "$$this.quantity"] } },
        },
        // $sum / $avg / $max / $min also work on an array directly.
        largestLine: { $max: { $map: { input: "$items", in: "$$this.subtotal" } } },
        // Slicing and membership.
        firstTwo: { $slice: ["$items.productName", 2] },
        // $anyElementTrue over a $map is the "does any element satisfy X" idiom.
        hasBulkLine: {
          $anyElementTrue: { $map: { input: "$items", in: { $gte: ["$$this.quantity", 3] } } },
        },
      },
    },
  ]);
  show("Array expressions", arrays);
  note(
    "$map, $filter, and $reduce cover almost everything you would otherwise " +
      "$unwind for — and they keep one document per order, so no double " +
      "counting is possible. Reach for $unwind only when elements from " +
      "DIFFERENT documents must be grouped together (lesson 03)."
  );

  // --------------------------------------------------------------------
  section("9. Type conversion — cleaning messy data");
  const conversions = await Product.aggregate([
    { $limit: 3 },
    {
      $project: {
        _id: 0,
        name: 1,
        priceAsString: { $toString: "$price" },
        priceAsInt: { $toInt: "$price" },
        idAsString: { $toString: "$_id" }, // ObjectId -> hex string, for APIs
        typeOfPrice: { $type: "$price" },
        // $convert is the safe form: it lets you handle failures instead of
        // erroring out the whole pipeline.
        safeNumber: {
          $convert: { input: "$specs.weightGrams", to: "double", onError: -1, onNull: 0 },
        },
      },
    },
  ]);
  show("Type conversion expressions", conversions);
  note(
    "Prefer $convert over $toInt/$toDouble when the data might be dirty: " +
      "the short forms THROW on a bad value and kill the entire aggregation, " +
      "while $convert's onError/onNull let one bad document degrade " +
      "gracefully instead of failing the report."
  );

  // --------------------------------------------------------------------
  section("10. $addFields / $set — adding without listing everything");
  // $project is exclusive by default: name a field and everything else
  // disappears. $addFields (alias $set) keeps the whole document and adds to
  // it — usually what you want mid-pipeline.
  const added = await Product.aggregate([
    { $match: { discountPercent: { $gte: 20 } } },
    { $limit: 2 },
    {
      $addFields: {
        finalPrice: {
          $round: [{ $multiply: ["$price", { $subtract: [1, { $divide: ["$discountPercent", 100] }] }] }, 0],
        },
        isBargain: { $gte: ["$discountPercent", 30] },
      },
    },
    // $unset (alias for $project exclusion) removes noise before returning.
    { $unset: ["description", "specs", "tags", "createdAt", "updatedAt"] },
  ]);
  show("$addFields keeps the document, $unset trims it", added);
  note(
    "Rule of thumb: use $addFields/$set while computing mid-pipeline, and " +
      "one $project at the END to shape the API response. Writing $project " +
      "early forces you to list every field you still need, and forgetting " +
      "one breaks a later stage with a confusing null."
  );
  note(
    "Next: 06-facet-bucket-sample — running several pipelines at once, " +
      "bucketing into ranges, and taking random samples."
  );
});
