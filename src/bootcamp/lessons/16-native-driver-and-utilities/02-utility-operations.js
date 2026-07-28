/**
 * LESSON 16-native-driver-and-utilities/02-utility-operations
 *
 * The operations that manage the database itself rather than the data in it:
 * creating collections with options, inspecting and building indexes, reading
 * stats, renaming, and dropping.
 *
 * There is also a discipline lesson here. Destructive operations — drop,
 * dropDatabase, unfiltered deleteMany — have no undo and no confirmation
 * prompt. Every one of them in this repo lives in a clearly-named script
 * (src/seeders/reset.js) rather than scattered through application code, and
 * every one in this lesson is scoped to a temporary collection.
 *
 * SAFE TO RE-RUN: everything happens in `tmp_utils_lab` (and a renamed copy),
 * dropped at the end. The five seeded collections are only INSPECTED.
 *
 * Run it with:  npm run lesson 16-native-driver-and-utilities/02-utility-operations
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

const TEMP = "tmp_utils_lab";
const RENAMED = "tmp_utils_lab_renamed";

await runLesson("Native driver 2/2 — Utility operations", async () => {
  const db = mongoose.connection.db;
  await db.collection(TEMP).drop().catch(() => {});
  await db.collection(RENAMED).drop().catch(() => {});

  // --------------------------------------------------------------------
  section("1. Listing what exists");
  const collections = await db.listCollections().toArray();
  show(
    "Collections in this database",
    collections.map((c) => ({ name: c.name, type: c.type }))
  );

  const dbStats = await db.command({ dbStats: 1, scale: 1024 });
  show("Database stats (KB)", {
    database: dbStats.db,
    collections: dbStats.collections,
    documents: dbStats.objects,
    avgObjSizeBytes: Math.round(dbStats.avgObjSize),
    dataSizeKB: Math.round(dbStats.dataSize),
    storageSizeKB: Math.round(dbStats.storageSize),
    indexes: dbStats.indexes,
    indexSizeKB: Math.round(dbStats.indexSize),
  });
  note(
    "Compare dataSize with indexSize. If your indexes are bigger than your " +
      "data, you are almost certainly over-indexed — check $indexStats " +
      "(section 5) and drop what nobody uses."
  );

  // --------------------------------------------------------------------
  section("2. Creating a collection EXPLICITLY, with options");
  // Collections normally appear on first write. You create one explicitly
  // when you need non-default options.
  await db.createCollection(TEMP, {
    // A SERVER-SIDE schema. Unlike Mongoose validation, this holds against
    // every writer — mongosh, migrations, other services.
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["code", "qty"],
        properties: {
          code: { bsonType: "string", description: "must be a string and is required" },
          qty: { bsonType: "int", minimum: 0, description: "must be a non-negative integer" },
          tier: { enum: ["bronze", "silver", "gold"], description: "must be one of the tiers" },
        },
      },
    },
    // "error" rejects invalid writes; "warn" only logs them (useful when
    // introducing validation to an existing collection).
    validationAction: "error",
    // "strict" applies the rules to updates of existing documents too;
    // "moderate" only applies them to documents that already conform.
    validationLevel: "strict",
  });
  show("Created with a $jsonSchema validator", { collection: TEMP });

  const lab = db.collection(TEMP);
  await lab.insertOne({ code: "A-1", qty: new mongoose.mongo.Int32(5), tier: "gold" });

  let rejected = null;
  try {
    await lab.insertOne({ code: 123, qty: -1, tier: "diamond" });
  } catch (error) {
    rejected = { name: error.name, code: error.code, reason: "failed document validation" };
  }
  show("A document violating the server-side schema", {
    accepted: await lab.countDocuments(),
    rejectedWrite: rejected,
  });
  note(
    "This is the third validation layer from module 13, and the only one " +
      "that cannot be bypassed. Note the awkward part: `qty` must be a real " +
      "BSON int, so a plain JavaScript number (a double) fails bsonType " +
      "'int'. That strictness is why most teams use $jsonSchema for a few " +
      "critical invariants and keep the detailed rules in Mongoose."
  );

  // --------------------------------------------------------------------
  section("3. Other collection types");
  show("Options worth knowing on createCollection", {
    capped: "{ capped: true, size: 1048576, max: 1000 } — fixed size, oldest documents overwritten. Logs, ring buffers.",
    timeseries: "{ timeseries: { timeField: 'ts', metaField: 'sensor' } } — optimized storage for metrics",
    collation: "{ collation: { locale: 'en', strength: 2 } } — collection-wide case-insensitive comparisons",
    clusteredIndex: "{ clusteredIndex: { key: { _id: 1 }, unique: true } } — documents stored in _id order",
    expireAfterSeconds: "on a timeseries collection, auto-expiry of old buckets",
  });

  // --------------------------------------------------------------------
  section("4. Index management");
  await lab.createIndex({ code: 1 }, { unique: true, name: "code_unique" });
  await lab.createIndex({ tier: 1, qty: -1 }, { name: "tier_qty" });
  // Background building is the default on modern MongoDB; on huge production
  // collections, build indexes during a maintenance window regardless — the
  // build consumes I/O and memory.
  show(
    "Indexes now on the temp collection",
    (await lab.listIndexes().toArray()).map((ix) => ({
      name: ix.name,
      key: ix.key,
      unique: ix.unique ?? false,
    }))
  );

  await lab.dropIndex("tier_qty");
  show("After dropIndex('tier_qty')", (await lab.listIndexes().toArray()).map((ix) => ix.name));
  note(
    "You cannot drop the _id_ index — MongoDB requires it. Also note that " +
      "you cannot MODIFY an index's options: to change { code: 1 } from " +
      "non-unique to unique you must drop and recreate it, which means a " +
      "window with no index at all. Plan that carefully on a live system."
  );

  // --------------------------------------------------------------------
  section("5. $indexStats — finding indexes nobody uses");
  // Counts how many times each index has been chosen since the server started.
  const productIndexUsage = await Product.aggregate([{ $indexStats: {} }]);
  show(
    "Index usage on products (since server start)",
    productIndexUsage.map((ix) => ({
      name: ix.name,
      key: ix.key,
      timesUsed: ix.accesses.ops,
      trackingSince: ix.accesses.since,
    }))
  );
  note(
    "In production, let this run for a few weeks. Any index with ops still " +
      "at 0 is costing you write throughput and RAM for nothing. Two " +
      "caveats: the counter resets on restart, and an index that only " +
      "serves a monthly report will look unused for 29 days."
  );

  // --------------------------------------------------------------------
  section("6. Mongoose's index helpers");
  show("Three ways Mongoose manages indexes", {
    "autoIndex (default true)":
      "Mongoose calls createIndex for every declared index on startup. Convenient in dev, DANGEROUS in production — index builds on a large collection can stall the app. Set autoIndex: false in production.",
    "Model.syncIndexes()":
      "creates declared indexes AND DROPS ones the schema no longer declares. Our seeder calls this. Powerful — and it will happily drop an index you added by hand.",
    "Model.ensureIndexes() / createIndexes()":
      "creates missing indexes without dropping anything. The safer choice for a deploy step.",
  });
  const declaredVsActual = {
    declaredInSchema: Product.schema.indexes().map(([key]) => key),
    actuallyOnServer: (await Product.collection.listIndexes().toArray()).map((ix) => ix.name),
  };
  show("Schema vs server", declaredVsActual);
  note(
    "These can drift: someone adds an index in mongosh to fix an incident, " +
      "and the next syncIndexes() removes it. Keep index definitions in the " +
      "schema (or in a migration), never only in a production shell."
  );

  // --------------------------------------------------------------------
  section("7. Collection stats and estimates");
  const stats = await db.command({ collStats: "orders" });
  show("orders collection", {
    documents: stats.count,
    avgObjSizeBytes: stats.avgObjSize,
    dataSizeKB: Number((stats.size / 1024).toFixed(1)),
    storageSizeKB: Number((stats.storageSize / 1024).toFixed(1)),
    indexes: stats.nindexes,
    indexSizesKB: Object.fromEntries(
      Object.entries(stats.indexSizes).map(([k, v]) => [k, Number((v / 1024).toFixed(1))])
    ),
  });
  show("Counting: three options", {
    "estimatedDocumentCount()": await Order.estimatedDocumentCount(),
    "countDocuments({})": await Order.countDocuments({}),
    "collStats.count": stats.count,
    difference:
      "estimatedDocumentCount and collStats read metadata (O(1), no filter possible); countDocuments actually counts",
  });

  // --------------------------------------------------------------------
  section("8. Renaming a collection");
  await lab.rename(RENAMED);
  show("After rename", {
    from: TEMP,
    to: RENAMED,
    exists: (await db.listCollections({ name: RENAMED }).toArray()).length === 1,
    documentsPreserved: await db.collection(RENAMED).countDocuments(),
    indexesPreserved: (await db.collection(RENAMED).listIndexes().toArray()).length,
  });
  note(
    "rename() is atomic and preserves documents and indexes, which makes it " +
      "the standard trick for a zero-downtime rebuild: write the new version " +
      "into a temp collection, then rename it over the old one with " +
      "{ dropTarget: true }. Note it does NOT work across databases."
  );

  // --------------------------------------------------------------------
  section("9. DESTRUCTIVE OPERATIONS — handle with care");
  show("The dangerous four", {
    "collection.drop()":
      "deletes the collection, its documents, AND its indexes. Instant, no undo.",
    "collection.deleteMany({})":
      "deletes every document but KEEPS the collection and indexes. Slower (per-document), and it fires Mongoose middleware.",
    "db.dropDatabase()": "deletes everything. Never in application code.",
    "updateMany with a wrong filter":
      "the quiet one — corrupts rather than deletes, and is far harder to notice",
  });
  show("How this repo handles them", {
    "src/seeders/reset.js": "the ONLY place that calls drop(). Named to be obvious. Lists what it will drop before doing it.",
    "src/seeders/seed.js": "uses deleteMany to clear, so indexes survive and re-seeding is fast",
    "every lesson that writes": "scopes writes to tmp_ collections or ZZ-/ZZZ-/@lesson.test markers",
    "the rule": "if it cannot be undone, it belongs in a named script, not in a controller",
  });
  note(
    "Two habits worth keeping for life: always run a find() with your filter " +
      "BEFORE running deleteMany() with it, and never type a filter object " +
      "in production that you have not first tested as a count. " +
      "deleteMany({}) with an accidentally-empty filter is how databases " +
      "disappear."
  );

  // --------------------------------------------------------------------
  section("10. Cleanup — dropping our temporary collection");
  await db.collection(RENAMED).drop();
  const leftovers = await db
    .listCollections({ name: { $in: [TEMP, RENAMED] } })
    .toArray();
  show("Cleanup", {
    dropped: [TEMP, RENAMED],
    leftovers: leftovers.length,
    seededCollectionsUntouched: (await db.listCollections().toArray())
      .map((c) => c.name)
      .filter((n) => ["users", "categories", "products", "orders", "reviews"].includes(n)),
  });
  note(
    "Module 16 complete. Next: module 17 — a runnable Express API that puts " +
      "everything from modules 1-16 into real HTTP endpoints."
  );
});
