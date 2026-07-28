/**
 * LESSON 12-indexes-and-performance/03-compound-indexes-and-sort — The prefix rule
 *
 * A compound index is not "an index on three fields". It is ONE sorted
 * structure, ordered by the first field, then by the second within each first
 * value, then by the third within each second. Exactly like a phone book
 * sorted by city, then surname, then first name.
 *
 * Everything that confuses people about compound indexes follows from that
 * one fact:
 *   - you can look up by city, or city+surname, or city+surname+firstname
 *   - you CANNOT look up by surname alone (the PREFIX RULE)
 *   - sort direction matters, but only relative direction
 *   - one well-ordered compound index beats three single-field ones
 *
 * SAFE TO RE-RUN: all experiments happen in the temporary collection
 * `tmp_compound_lab`, dropped at the end. Seeded collections are read-only here.
 *
 * Run it with:  npm run lesson 12-indexes-and-performance/03-compound-indexes-and-sort
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

const TEMP = "tmp_compound_lab";

await runLesson("Indexes 3/5 — Compound indexes and sorting", async () => {
  const db = mongoose.connection.db;
  await db.collection(TEMP).drop().catch(() => {});
  const lab = db.collection(TEMP);

  // Enough documents that a scan is clearly worse than an index walk.
  const cities = ["Mumbai", "Pune", "Delhi", "Jaipur", "Surat"];
  const statuses = ["pending", "paid", "shipped", "delivered", "cancelled"];
  await lab.insertMany(
    Array.from({ length: 5000 }, (_, i) => ({
      city: cities[i % cities.length],
      status: statuses[i % statuses.length],
      amount: (i * 37) % 9000,
      placedAt: new Date(2025, 0, 1 + (i % 365)),
      customer: `cust-${i % 250}`,
    }))
  );

  /** Return the parts of an explain plan that reveal index usage. */
  const plan = async (label, cursorFactory) => {
    const explained = await cursorFactory().explain("executionStats");
    const stats = explained.executionStats;
    const stages = [];
    let node = stats.executionStages;
    while (node) {
      stages.push(node.stage);
      node = node.inputStage;
    }
    return {
      [label]: {
        stages: stages.join(" <- "),
        usedIndex: !stages.includes("COLLSCAN"),
        inMemorySort: stages.includes("SORT"),
        keysExamined: stats.totalKeysExamined,
        docsExamined: stats.totalDocsExamined,
        returned: stats.nReturned,
      },
    };
  };

  // --------------------------------------------------------------------
  section("1. Build one compound index");
  await lab.createIndex({ city: 1, status: 1, amount: -1 }, { name: "city_status_amount" });
  show("Created", {
    index: { city: 1, status: 1, amount: -1 },
    ordering: "sorted by city, then by status within each city, then by amount (desc) within each status",
  });

  // --------------------------------------------------------------------
  section("2. THE PREFIX RULE");
  // A compound index can serve a query that uses a PREFIX of its fields:
  // the 1st, or the 1st+2nd, or all three — always starting from the left.
  const results = {
    ...(await plan("city only (prefix ✓)", () => lab.find({ city: "Pune" }))),
    ...(await plan("city + status (prefix ✓)", () => lab.find({ city: "Pune", status: "paid" }))),
    ...(await plan("all three (full ✓)", () =>
      lab.find({ city: "Pune", status: "paid", amount: { $gte: 5000 } })
    )),
    ...(await plan("status only (NOT a prefix ✗)", () => lab.find({ status: "paid" }))),
    ...(await plan("amount only (NOT a prefix ✗)", () => lab.find({ amount: { $gte: 8000 } }))),
    ...(await plan("status + amount (skips city ✗)", () =>
      lab.find({ status: "paid", amount: { $gte: 5000 } })
    )),
  };
  show("Which queries can use { city: 1, status: 1, amount: -1 }?", results);
  note(
    "The three queries starting with `city` used the index. The three that " +
      "skipped it fell back to COLLSCAN and examined all 5,000 documents. " +
      "Think of the phone book: sorted by city then surname, you cannot " +
      "find 'everyone named Patel' without reading the whole book — the " +
      "Patels are scattered across every city section."
  );
  note(
    "Practical consequence: ONE index { a: 1, b: 1, c: 1 } serves queries on " +
      "{a}, {a,b}, and {a,b,c}. So put your most commonly filtered field " +
      "FIRST, and you get three indexes for the price of one."
  );

  // --------------------------------------------------------------------
  section("3. Field ORDER: equality, then sort, then range (ESR)");
  // The rule that determines whether an index can serve a filter AND a sort
  // at the same time.
  await lab.createIndex({ status: 1, placedAt: -1, amount: 1 }, { name: "esr_good" });
  await lab.createIndex({ status: 1, amount: 1, placedAt: -1 }, { name: "esr_bad" });

  const esr = {
    ...(await plan("ESR order — equality(status), sort(placedAt), range(amount)", () =>
      lab.find({ status: "paid", amount: { $gte: 3000 } }).sort({ placedAt: -1 }).limit(10).hint("esr_good")
    )),
    ...(await plan("range before sort — same fields, wrong order", () =>
      lab.find({ status: "paid", amount: { $gte: 3000 } }).sort({ placedAt: -1 }).limit(10).hint("esr_bad")
    )),
  };
  show("Two indexes, same fields, different order", esr);
  note(
    "The ESR rule: put EQUALITY fields first, then the SORT field, then " +
      "RANGE fields. In esr_good the sort is served by the index (no SORT " +
      "stage). In esr_bad the range on `amount` sits between the equality " +
      "and the sort field, which breaks the index's ordering for placedAt — " +
      "so MongoDB must sort in memory. Same fields, same query, completely " +
      "different plan. (We used .hint() here to force each index; normally " +
      "the planner chooses.)"
  );

  // --------------------------------------------------------------------
  section("4. Sort DIRECTION — what actually matters");
  // MongoDB can walk an index forwards or backwards. So a sort matches the
  // index if the directions are all the same OR all exactly reversed.
  const directions = {
    ...(await plan("sort matching the index exactly", () =>
      lab.find({ city: "Pune" }).sort({ status: 1, amount: -1 })
    )),
    ...(await plan("sort fully REVERSED (walk the index backwards)", () =>
      lab.find({ city: "Pune" }).sort({ status: -1, amount: 1 })
    )),
    ...(await plan("sort MIXED (neither forwards nor backwards)", () =>
      lab.find({ city: "Pune" }).sort({ status: 1, amount: 1 })
    )),
  };
  show("Index { city: 1, status: 1, amount: -1 } vs three sorts", directions);
  note(
    "The first two avoided a SORT stage; the third did not. The rule: an " +
      "index serves a sort if the requested directions are identical to the " +
      "index's, or the exact mirror image of them. Anything in between " +
      "forces an in-memory sort. This is why { createdAt: -1 } and " +
      "{ createdAt: 1 } are interchangeable for a single-field index, but " +
      "direction is critical once you compound."
  );

  // --------------------------------------------------------------------
  section("5. Covered queries — answering from the index alone");
  // If every field the query needs (filter AND projection) lives in the
  // index, MongoDB never touches the documents. docsExamined stays 0.
  const covered = {
    ...(await plan("projection inside the index — COVERED", () =>
      lab.find({ city: "Pune", status: "paid" }, { projection: { _id: 0, city: 1, status: 1, amount: 1 } })
    )),
    ...(await plan("projection needs an extra field — must FETCH", () =>
      lab.find({ city: "Pune", status: "paid" }, { projection: { _id: 0, city: 1, customer: 1 } })
    )),
  };
  show("Covered vs non-covered", covered);
  note(
    "docsExamined: 0 in the first case — MongoDB answered entirely from the " +
      "index, never reading a single document. That is the fastest possible " +
      "query. Two requirements: every projected field must be in the index, " +
      "and _id must be explicitly excluded (it is not in this index). " +
      "Covered queries are how you make hot list endpoints extremely fast."
  );

  // --------------------------------------------------------------------
  section("6. One compound index beats several single-field ones");
  // MongoDB can intersect two indexes, but rarely chooses to — it is
  // usually slower than one well-chosen compound index.
  await lab.createIndex({ customer: 1 }, { name: "single_customer" });
  await lab.createIndex({ placedAt: -1 }, { name: "single_date" });
  const intersect = {
    ...(await plan("two single-field indexes available", () =>
      lab.find({ customer: "cust-42" }).sort({ placedAt: -1 }).limit(5)
    )),
  };
  await lab.createIndex({ customer: 1, placedAt: -1 }, { name: "compound_customer_date" });
  const compoundPlan = {
    ...(await plan("one compound index", () =>
      lab.find({ customer: "cust-42" }).sort({ placedAt: -1 }).limit(5).hint("compound_customer_date")
    )),
  };
  show("'This customer's orders, newest first'", { ...intersect, ...compoundPlan });
  note(
    "With two separate indexes MongoDB used one for the filter and then " +
      "sorted in memory (SORT stage present). The compound index served both " +
      "at once. This exact pattern — filter by owner, sort by date — is why " +
      "our real Order model declares { user: 1, placedAt: -1 } rather than " +
      "two separate indexes."
  );

  // --------------------------------------------------------------------
  section("7. The real store's compound indexes, explained");
  const orderIndexes = await Order.collection.listIndexes().toArray();
  const productIndexes = await Product.collection.listIndexes().toArray();
  show("Why our models index what they index", {
    "orders { user: 1, placedAt: -1 }":
      "serves 'my orders, newest first' — the most common customer query. Also serves 'all orders for a user' by prefix.",
    "orders { status: 1 }":
      "serves admin filters and the revenue pipelines' leading $match",
    "products { category: 1, price: -1 }":
      "serves 'products in this category, most expensive first' — the category page",
    "products { tags: 1 }": "multikey, serves tag filters",
    "products { sku: 1 } unique": "lookup by SKU + the uniqueness guarantee",
    declaredOnOrders: orderIndexes.map((i) => i.name),
    declaredOnProducts: productIndexes.map((i) => i.name),
  });

  // Prove the category-page index works on real data.
  const realCategory = (await Product.findOne().select("category").lean()).category;
  const realPlan = await Product.find({ category: realCategory })
    .sort({ price: -1 })
    .limit(10)
    .explain("executionStats");
  const realStages = [];
  let n = realPlan.executionStats.executionStages;
  while (n) {
    realStages.push(n.stage);
    n = n.inputStage;
  }
  show("Real category page query", {
    stages: realStages.join(" <- "),
    inMemorySort: realStages.includes("SORT"),
    docsExamined: realPlan.executionStats.totalDocsExamined,
    returned: realPlan.executionStats.nReturned,
  });

  // --------------------------------------------------------------------
  section("8. Designing a compound index — the checklist");
  show("How to choose the field order", {
    "1. Equality fields first":
      "fields matched with an exact value. Most selective (fewest matches) first among them.",
    "2. Then the sort field": "so the index provides the order and no SORT stage is needed",
    "3. Range fields last": "$gt/$lt/$in scan a span, which breaks ordering for anything after them",
    "4. Aim for prefix reuse": "one { a, b, c } index also serves {a} and {a,b} — plan for that",
    "5. Consider covering": "adding a projected field at the end can eliminate document reads entirely",
    "6. Cap the total": "each index costs write time and RAM; 5-10 per collection is a sane ceiling",
  });
  note(
    "Field order is a design decision with real consequences, not a " +
      "formatting choice. Write the three or four queries the collection " +
      "must serve, then design the smallest set of indexes that covers them " +
      "using the prefix rule."
  );

  // --------------------------------------------------------------------
  section("9. Cleanup");
  await db.collection(TEMP).drop();
  show("Cleanup", { dropped: TEMP });
  note("Next: 04-text-search — full-text search, scoring, and its limitations.");
});
