/**
 * LESSON 12-indexes-and-performance/01-explain-basics — Reading the plan
 *
 * Every query you write is a REQUEST, not an instruction. The MongoDB query
 * planner decides how to actually execute it: scan every document, or walk an
 * index? explain() shows you that decision, and the numbers behind it.
 *
 * Learning to read an explain plan is the difference between "my API feels
 * slow" and "this query examines 63,000 documents to return 20, because the
 * sort has no index". This lesson teaches the four numbers that matter and
 * the two stage names you must recognise.
 *
 * 100% READ-ONLY — safe to run any time, in any order. (explain() with
 * executionStats actually RUNS the query, but ours are all reads.)
 *
 * Run it with:  npm run lesson 12-indexes-and-performance/01-explain-basics
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";

/**
 * Pull the numbers that actually matter out of a huge explain document.
 *
 * A raw explain() output is hundreds of lines. In practice you look at four
 * things: which plan won, how many documents it examined, how many index
 * entries it read, and how many it returned.
 */
const summarize = (plan) => {
  const stats = plan.executionStats;

  // The winning plan is a TREE of stages, executed leaf-first. Walk it down
  // to collect the stage names in order.
  const stageNames = [];
  let node = stats.executionStages;
  while (node) {
    stageNames.push(node.stage);
    node = node.inputStage;
  }

  return {
    stages: stageNames.join(" <- "),
    indexUsed: plan.queryPlanner.winningPlan?.inputStage?.indexName ?? findIndexName(plan.queryPlanner.winningPlan) ?? "(none - collection scan)",
    nReturned: stats.nReturned,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    executionTimeMillis: stats.executionTimeMillis,
    // The efficiency ratio every DBA looks at first. 1.0 is perfect.
    docsExaminedPerResult:
      stats.nReturned === 0 ? "n/a" : Number((stats.totalDocsExamined / stats.nReturned).toFixed(1)),
    rejectedPlans: plan.queryPlanner.rejectedPlans?.length ?? 0,
  };
};

/** Recursively hunt for an indexName anywhere in the plan tree. */
const findIndexName = (node) => {
  if (!node) return null;
  if (node.indexName) return node.indexName;
  if (node.inputStage) return findIndexName(node.inputStage);
  if (node.inputStages) {
    for (const child of node.inputStages) {
      const found = findIndexName(child);
      if (found) return found;
    }
  }
  return null;
};

await runLesson("Indexes 1/5 — Reading explain() plans", async () => {
  // --------------------------------------------------------------------
  section("1. Why explain() exists");
  note(
    "MongoDB's query planner tries several candidate plans on a small sample " +
      "of your data, picks the fastest, and caches that choice. explain() " +
      "reports what it chose and — with executionStats — what that choice " +
      "actually cost. It is the only honest answer to 'why is this slow?'; " +
      "everything else is guessing."
  );

  // --------------------------------------------------------------------
  section("2. A COLLSCAN — the query planner had no index to use");
  // `description` has no index, so the server must open every document and
  // check the field. That is a COLLection SCAN.
  const collscan = await Product.find({ description: /wireless/i })
    .explain("executionStats");
  show("find({ description: /wireless/i })", summarize(collscan));
  note(
    "COLLSCAN means 'read every document in the collection'. Notice " +
      "docsExamined equals the full collection size (63) regardless of how " +
      "many matched. On 63 documents that is instant. On 6 million it is a " +
      "multi-second query that also evicts your working set from RAM — " +
      "which slows down every OTHER query too."
  );

  // --------------------------------------------------------------------
  section("3. An IXSCAN — walking an index instead");
  // `sku` has a unique index (declared in product.model.js), so the server
  // can jump straight to the matching entry.
  const someSku = (await Product.findOne().select("sku").lean()).sku;
  const ixscan = await Product.find({ sku: someSku }).explain("executionStats");
  show(`find({ sku: "${someSku}" })`, summarize(ixscan));
  note(
    "IXSCAN <- FETCH is the shape you want. Read it right to left: IXSCAN " +
      "walked the index and found 1 matching entry (keysExamined 1), then " +
      "FETCH loaded that 1 document (docsExamined 1) to return it " +
      "(nReturned 1). The ratio is 1:1 — perfect. Compare with the COLLSCAN " +
      "above, which examined 63 documents to return a handful."
  );

  // --------------------------------------------------------------------
  section("4. The four numbers that matter");
  show("How to read any explain plan", {
    nReturned: "how many documents the query produced — your goal",
    totalDocsExamined:
      "how many full documents were read from disk/cache. Should be close to nReturned.",
    totalKeysExamined:
      "how many index entries were read. Cheap compared to documents.",
    executionTimeMillis: "wall clock — useful, but varies with cache state",
    "the ratio to watch": "totalDocsExamined / nReturned",
    "ratio ~1": "excellent — the index found exactly the right documents",
    "ratio 10-100": "the index narrowed things down, then filtering discarded a lot",
    "ratio = collection size": "COLLSCAN — no index was usable at all",
    "docsExamined = 0 with results": "a COVERED query — answered from the index alone",
  });

  // --------------------------------------------------------------------
  section("5. Index used, but inefficiently");
  // The index on { role: 1, isActive: 1 } can find the role quickly, but a
  // query that ALSO filters on an unindexed field must fetch and re-check.
  const partial = await User.find({ role: "customer", loyaltyPoints: { $gte: 3000 } })
    .explain("executionStats");
  show("Indexed field + unindexed field", summarize(partial));
  note(
    "The index handled `role`, cutting the candidates down from 30 to ~25. " +
      "Then a FETCH loaded each of those and a filter checked loyaltyPoints " +
      "in memory. keysExamined and docsExamined are both well above " +
      "nReturned. This is normal and often fine — but on a big collection it " +
      "is the signal to extend the index to cover the second field."
  );

  // --------------------------------------------------------------------
  section("6. The SORT stage — the silent performance killer");
  // Sorting by an unindexed field forces an in-memory SORT stage, which is
  // BLOCKING: it must read every candidate document before returning even
  // the first result.
  const inMemorySort = await Product.find({ isActive: true })
    .sort({ "specs.weightGrams": -1 })
    .limit(5)
    .explain("executionStats");
  show("Sort on an UNINDEXED field", summarize(inMemorySort));

  // The same shape of query, but sorting by an indexed field. The index is
  // already in order, so no SORT stage is needed at all.
  const indexedSort = await Product.find({ category: (await Product.findOne().select("category").lean()).category })
    .sort({ price: -1 })
    .limit(5)
    .explain("executionStats");
  show("Sort on an INDEXED field (compound { category: 1, price: -1 })", summarize(indexedSort));
  note(
    "Look for the word SORT in the stages list. If it is there, MongoDB " +
      "buffered documents in memory and sorted them — a blocking operation " +
      "capped at 32 MB, which throws 'Sort exceeded memory limit' on real " +
      "data. When the sort uses an index, no SORT stage appears: the index " +
      "IS the sorted order, so results stream out immediately. This is the " +
      "single most valuable thing explain() tells you."
  );

  // --------------------------------------------------------------------
  section("7. LIMIT changes everything");
  // With an index-provided sort, a LIMIT means the server stops early.
  // With an in-memory sort, it cannot stop early — it must see everything.
  const limitedWithIndex = await Order.find({ status: "delivered" })
    .sort({ placedAt: -1 })
    .limit(5)
    .explain("executionStats");
  show("Indexed filter, then limit", summarize(limitedWithIndex));
  note(
    "The { user: 1, placedAt: -1 } index does not lead with status, so this " +
      "query uses the { status: 1 } index and then sorts. Watch what happens " +
      "in lesson 03 when we look at the prefix rule — the fix is a compound " +
      "index in the right ORDER, not more indexes."
  );

  // --------------------------------------------------------------------
  section("8. explain() verbosity levels");
  // Three levels, increasing detail — and only the last two actually run.
  const planOnly = await Product.find({ sku: someSku }).explain("queryPlanner");
  show("queryPlanner (does NOT run the query)", {
    winningPlanStage: planOnly.queryPlanner.winningPlan.stage,
    indexName: findIndexName(planOnly.queryPlanner.winningPlan),
    rejectedPlans: planOnly.queryPlanner.rejectedPlans.length,
    hasExecutionStats: Boolean(planOnly.executionStats),
  });
  show("The three verbosity levels", {
    queryPlanner: "which plan would be chosen. Query is NOT executed. Safe on writes.",
    executionStats: "runs the winning plan and reports its numbers. What you want 95% of the time.",
    allPlansExecution: "runs EVERY candidate plan. Use when you disagree with the planner's choice.",
  });
  note(
    "IMPORTANT: executionStats actually EXECUTES the query. For a find() " +
      "that is harmless. For deleteMany().explain('executionStats') it is " +
      "NOT — MongoDB does not apply the writes, but always double-check " +
      "before explaining a destructive operation on real data."
  );

  // --------------------------------------------------------------------
  section("9. explain() on an aggregation pipeline");
  const aggPlan = await Order.aggregate([
    { $match: { status: "delivered" } },
    { $group: { _id: "$user", spend: { $sum: "$totalAmount" } } },
  ]).explain();
  // The shape differs between MongoDB versions; pull out the useful bits
  // defensively rather than assuming a fixed path.
  const firstStage = aggPlan.stages?.[0]?.$cursor ?? aggPlan;
  show("Aggregation explain — the leading $match's plan", {
    indexUsed: findIndexName(firstStage.queryPlanner?.winningPlan) ?? "(none)",
    note: "only the stages BEFORE the first blocking stage can use an index",
  });
  note(
    "In an aggregation, explain() shows how the initial $match/$sort were " +
      "executed. Everything after the first blocking stage ($group here) is " +
      "pure in-memory work with no index involvement — which is precisely " +
      "why 'filter early' matters so much."
  );

  // --------------------------------------------------------------------
  section("10. A checklist for reading any plan");
  show("Ask these in order", {
    "1. Is the top-level stage COLLSCAN?": "if yes, no index was usable — start there",
    "2. Is there a SORT stage?": "if yes, the sort is in memory and blocking",
    "3. What is docsExamined / nReturned?": "> 10 means the index is not selective enough",
    "4. keysExamined >> nReturned?": "the index was scanned broadly, e.g. a leading range",
    "5. docsExamined = 0?": "covered query — the best possible outcome",
    "6. rejectedPlans": "the planner had alternatives; use .hint() to force one if it chose badly",
  });
  note(
    "Next: 02-index-types builds the indexes that fix the problems you just " +
      "learned to spot."
  );
});
