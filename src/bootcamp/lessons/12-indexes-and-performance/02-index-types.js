/**
 * LESSON 12-indexes-and-performance/02-index-types — Every kind of index
 *
 * An index is a sorted data structure (a B-tree) holding the values of one or
 * more fields, each paired with a pointer to the document. Because it is
 * sorted, MongoDB can jump straight to a value instead of reading everything —
 * the same reason a book's index beats flipping through every page.
 *
 * MongoDB offers several index TYPES, each solving a different problem. This
 * lesson inspects the ones our models already declare, then creates a few
 * more on a temporary collection so you can see them being built, used, and
 * dropped.
 *
 * SAFE TO RE-RUN: the only writes are into the temporary collection
 * `tmp_index_lab`, dropped at the end. Indexes on the seeded collections are
 * only INSPECTED, never changed.
 *
 * Run it with:  npm run lesson 12-indexes-and-performance/02-index-types
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import User from "../../../models/user.model.js";
import Review from "../../../models/review.model.js";

const TEMP = "tmp_index_lab";

await runLesson("Indexes 2/5 — Index types", async () => {
  const db = mongoose.connection.db;
  await db.collection(TEMP).drop().catch(() => {});

  // --------------------------------------------------------------------
  section("1. What is already indexed in our store?");
  // listIndexes() reports what actually exists on the SERVER — which can
  // differ from what your schema declares if syncIndexes() has not run.
  for (const [name, model] of [["products", Product], ["users", User], ["reviews", Review]]) {
    const indexes = await model.collection.listIndexes().toArray();
    show(
      `${name} indexes`,
      indexes.map((ix) => ({
        name: ix.name,
        keys: ix.key,
        unique: ix.unique ?? false,
        ...(ix.weights ? { textWeights: ix.weights } : {}),
      }))
    );
  }
  note(
    "Every collection has an _id_ index you never asked for — MongoDB " +
      "creates it automatically and you cannot drop it. The rest come from " +
      "our schemas, built by syncIndexes() during npm run db:seed."
  );

  // --------------------------------------------------------------------
  section("2. Single-field index");
  const lab = db.collection(TEMP);
  // Seed a small realistic dataset so index effects are visible.
  await lab.insertMany(
    Array.from({ length: 2000 }, (_, i) => ({
      code: `SKU-${String(i).padStart(5, "0")}`,
      score: i % 100,
      city: ["Mumbai", "Pune", "Delhi", "Jaipur"][i % 4],
      tags: [`t${i % 7}`, `t${(i + 3) % 7}`],
      // Deliberately absent on most documents, for the sparse/partial demos.
      ...(i % 50 === 0 ? { promoCode: `PROMO${i}` } : {}),
      // A far-future date so nothing actually expires during the lesson.
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
    }))
  );

  const timed = async (label, filter, options = {}) => {
    const plan = await lab.find(filter, options).explain("executionStats");
    return {
      [label]: {
        docsExamined: plan.executionStats.totalDocsExamined,
        keysExamined: plan.executionStats.totalKeysExamined,
        returned: plan.executionStats.nReturned,
        ms: plan.executionStats.executionTimeMillis,
      },
    };
  };

  const before = await timed("no index", { code: "SKU-01500" });
  // createIndex is idempotent: calling it twice with the same spec is a
  // no-op, which is why it is safe in startup code.
  await lab.createIndex({ code: 1 });
  const after = await timed("with { code: 1 }", { code: "SKU-01500" });
  show("Single-field index on 2,000 documents", { ...before, ...after });
  note(
    "2,000 documents examined became 1. The 1 or -1 in { code: 1 } is the " +
      "sort DIRECTION stored in the index. For a single-field index the " +
      "direction is irrelevant — MongoDB can walk a B-tree backwards just as " +
      "easily. It only matters for compound indexes (lesson 03)."
  );

  // --------------------------------------------------------------------
  section("3. Compound index — several fields, one structure");
  await lab.createIndex({ city: 1, score: -1 });
  const compound = await timed("city + score range", { city: "Pune", score: { $gte: 90 } });
  show("Compound index { city: 1, score: -1 }", compound);
  note(
    "One index serving 'documents in this city, highest score first'. " +
      "A compound index is sorted by the FIRST field, then the second within " +
      "each first value — like a phone book sorted by surname then first " +
      "name. That ordering is why the PREFIX RULE exists (lesson 03)."
  );

  // --------------------------------------------------------------------
  section("4. Multikey index — indexing every element of an array");
  await lab.createIndex({ tags: 1 });
  const multikey = await timed("tags contains t3", { tags: "t3" });
  const ixInfo = (await lab.listIndexes().toArray()).find((i) => i.name === "tags_1");
  show("Multikey index { tags: 1 }", { ...multikey, indexSpec: ixInfo.key });
  note(
    "You do not declare a multikey index — MongoDB makes one automatically " +
      "when the indexed field holds an array. It creates ONE INDEX ENTRY PER " +
      "ELEMENT, so a document with 7 tags contributes 7 entries. That is why " +
      "indexing a large array is expensive on writes, and why you cannot " +
      "have a compound index with two array fields (the entry count would " +
      "multiply)."
  );

  // --------------------------------------------------------------------
  section("5. Unique index — a real database constraint");
  await lab.createIndex({ code: 1 }, { unique: true, name: "code_unique" }).catch(async () => {
    // The plain { code: 1 } index already exists; drop it so we can rebuild
    // it as unique. (You cannot change an index's options in place.)
    await lab.dropIndex("code_1");
    await lab.createIndex({ code: 1 }, { unique: true, name: "code_unique" });
  });

  let duplicateError = null;
  try {
    await lab.insertOne({ code: "SKU-00001" }); // already exists
  } catch (error) {
    duplicateError = {
      code: error.code, // 11000 — the duplicate key error code
      keyPattern: error.keyPattern,
      keyValue: error.keyValue,
    };
  }
  show("Inserting a duplicate into a unique index", duplicateError);
  note(
    "Error code 11000 (E11000 duplicate key). This is enforced by MONGODB " +
      "itself, not by Mongoose — it holds even for writes from mongosh, " +
      "another service, or a migration script. Mongoose's `unique: true` is " +
      "NOT a validator; it is a request to build this index. That distinction " +
      "matters: a validator runs in Node and can be bypassed, an index " +
      "cannot. Handle 11000 explicitly in your error middleware (module 15)."
  );

  // --------------------------------------------------------------------
  section("6. Sparse index — skip documents missing the field");
  // A normal index stores an entry (with value null) for documents lacking
  // the field. A sparse index simply omits them.
  await lab.createIndex({ promoCode: 1 }, { sparse: true, name: "promo_sparse" });
  const indexStats = await lab.aggregate([{ $indexStats: {} }]).toArray().catch(() => []);
  const withPromo = await lab.countDocuments({ promoCode: { $exists: true } });
  show("Sparse index", {
    documentsInCollection: await lab.countDocuments(),
    documentsWithPromoCode: withPromo,
    "entries a normal index would store": 2000,
    "entries the sparse index stores": withPromo,
    indexesTracked: indexStats.length,
  });
  note(
    "40 entries instead of 2,000 — smaller index, faster writes for the 98% " +
      "of documents that have no promo code. The trade-off: a sparse index " +
      "cannot answer queries that need the missing documents, so " +
      "{ promoCode: null } or a sort on promoCode will not use it. Combine " +
      "sparse with unique when you want 'unique IF present' (e.g. an " +
      "optional GST number)."
  );

  // --------------------------------------------------------------------
  section("7. Partial index — index only the rows you actually query");
  // More flexible than sparse: index only documents matching a filter.
  await lab.createIndex(
    { score: -1 },
    {
      name: "high_scores_only",
      partialFilterExpression: { score: { $gte: 90 } },
    }
  );
  const partialPlan = await lab.find({ score: { $gte: 95 } }).explain("executionStats");
  show("Partial index { score: -1 } where score >= 90", {
    keysExamined: partialPlan.executionStats.totalKeysExamined,
    docsExamined: partialPlan.executionStats.totalDocsExamined,
    returned: partialPlan.executionStats.nReturned,
  });
  note(
    "Partial indexes are the modern replacement for sparse ones. Classic " +
      "uses: index only active users, only undeleted documents, only orders " +
      "from the last year. CRUCIAL RULE: the query must be provably a subset " +
      "of the partial filter, or MongoDB refuses to use the index. Here " +
      "score >= 95 is inside score >= 90, so it qualifies; a query for " +
      "score >= 50 would NOT use it and would fall back to a scan."
  );

  // --------------------------------------------------------------------
  section("8. TTL index — documents that delete themselves");
  // A TTL index on a Date field makes MongoDB delete documents once the
  // date is older than expireAfterSeconds.
  await lab.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_demo" });
  show("TTL index", {
    spec: { expiresAt: 1 },
    expireAfterSeconds: 0,
    meaning: "delete each document when its expiresAt value passes",
    sweeperInterval: "a background task runs every 60 seconds",
    "our test data": "expiresAt is one hour in the future, so nothing is deleted now",
  });
  note(
    "TTL is how you build self-cleaning sessions, password-reset tokens, " +
      "rate-limit counters, and OTPs — no cron job required. Three gotchas: " +
      "(1) deletion is not instant, the sweeper runs about once a minute; " +
      "(2) the field must be a Date (or an array of Dates), otherwise the " +
      "document is silently never deleted; (3) it must be a single-field " +
      "index — you cannot TTL on a compound one."
  );

  // --------------------------------------------------------------------
  section("9. Text index — for the products collection");
  // Our Product schema declares { name: "text", description: "text" }.
  const productIndexes = await Product.collection.listIndexes().toArray();
  const textIndex = productIndexes.find((ix) => ix.textIndexVersion);
  show("The text index on products", {
    name: textIndex?.name,
    fields: textIndex?.weights,
    note: "a collection may have AT MOST ONE text index (it can cover many fields)",
  });
  note("Lesson 04 covers text search properly — searching, scoring, and its limits.");

  // --------------------------------------------------------------------
  section("10. The other types, briefly");
  show("Specialised index types", {
    "2dsphere": "geospatial queries on GeoJSON — 'stores within 5 km of this point'",
    "2d": "legacy flat-plane coordinates; use 2dsphere for anything on Earth",
    hashed: "hashes the value — used for even shard-key distribution, no range queries",
    wildcard: '{ "$**": 1 } — indexes every field. For unpredictable shapes only; large and slow.',
    "clustered collections": "MongoDB 5.3+ — store documents IN _id order, no separate _id index",
    "columnstore": "analytics-oriented, Atlas only",
  });

  // --------------------------------------------------------------------
  section("11. The cost side of the ledger");
  // Indexes are not free. Every write must update every affected index.
  const writeCost = async (label) => {
    const docs = Array.from({ length: 500 }, (_, i) => ({
      code: `BULK-${label}-${i}`,
      score: i % 100,
      city: "Mumbai",
      tags: [`b${i % 5}`],
      expiresAt: new Date(Date.now() + 3600_000),
    }));
    const t = process.hrtime.bigint();
    await lab.insertMany(docs);
    return Number((Number(process.hrtime.bigint() - t) / 1e6).toFixed(1));
  };

  const withIndexes = await writeCost("indexed");
  const indexCount = (await lab.listIndexes().toArray()).length;
  show("Insert cost with indexes present", {
    indexesOnCollection: indexCount,
    "500 inserts (ms)": withIndexes,
    perDocumentMs: Number((withIndexes / 500).toFixed(3)),
  });
  note(
    "Every insert wrote one entry into EACH of those indexes (more for the " +
      "multikey one — one entry per tag). Updates are worse: changing an " +
      "indexed field means removing the old entry and inserting a new one. " +
      "The rule is simple: index what you QUERY, not everything. An unused " +
      "index is pure cost — it slows every write and consumes RAM that your " +
      "useful indexes need."
  );
  note(
    "In production, find unused indexes with $indexStats: any index whose " +
      "accesses.ops has stayed at 0 for weeks is a candidate for removal."
  );

  // --------------------------------------------------------------------
  section("12. Cleanup");
  await db.collection(TEMP).drop();
  show("Cleanup", { dropped: TEMP });
  note(
    "Next: 03-compound-indexes-and-sort — the prefix rule, which explains " +
      "why field ORDER in a compound index decides whether it works at all."
  );
});
