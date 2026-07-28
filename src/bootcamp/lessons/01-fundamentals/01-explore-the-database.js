/**
 * LESSON 01-fundamentals/01-explore-the-database — Your first look inside
 *
 * Before any syntax, you need a mental picture of what MongoDB is actually
 * storing. This lesson opens the seeded store database and shows you the
 * real thing: the databases on the server, the collections in ours, one
 * complete raw document, and the shape-freedom that makes a document
 * database different from a table.
 *
 * We deliberately use the NATIVE driver here (mongoose.connection.db) rather
 * than models. Models add schemas, casting, and defaults — helpful later, but
 * right now they would hide exactly what we came to see.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 01-fundamentals/01-explore-the-database
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";

await runLesson("Fundamentals 1/3 — Explore the database", async () => {
  // `mongoose.connection.db` is the raw native-driver Db object for the
  // connection the runner already opened. Everything below is plain MongoDB —
  // no Mongoose behavior involved.
  const db = mongoose.connection.db;

  // --------------------------------------------------------------------
  section("1. The hierarchy: server -> database -> collection -> document");
  note(
    "MongoDB nests in four levels. A SERVER (mongod) holds many DATABASES. " +
      "A database holds many COLLECTIONS. A collection holds many DOCUMENTS. " +
      "In SQL terms: database = database, collection = table, document = row. " +
      "The similarity ends at 'document', because a document is not a flat " +
      "row — it is a whole JSON-shaped object that can nest."
  );

  // admin().listDatabases() asks the SERVER what it holds. `admin` is a
  // special database used for server-wide commands.
  //
  // This needs a privileged user, which a shared cluster (Atlas M0) will not
  // give you — so fall back gracefully rather than failing the lesson.
  const databases = await db
    .admin()
    .listDatabases()
    .then((result) =>
      result.databases.map((entry) => ({
        name: entry.name,
        sizeOnDiskMB: Number((entry.sizeOnDisk / 1024 / 1024).toFixed(2)),
      }))
    )
    .catch(() => [{ name: db.databaseName, note: "listDatabases needs a privileged user" }]);
  show("Databases on this server", databases);
  note(
    "admin, config, and local are MongoDB's own bookkeeping databases — " +
      "never store application data in them. Ours is the one named in your " +
      `.env (this connection is on '${db.databaseName}').`
  );

  // --------------------------------------------------------------------
  section("2. Collections in our database");
  // Databases and collections are created LAZILY: they spring into existence
  // the first time you write to them. That is why nothing here needed a
  // "CREATE TABLE" step — seed.js just inserted, and the collections appeared.
  const collections = await db.listCollections().toArray();

  const summary = [];
  for (const entry of collections) {
    summary.push({
      collection: entry.name,
      type: entry.type, // "collection" (or "view" / "timeseries")
      documents: await db.collection(entry.name).countDocuments(),
    });
  }
  show("Collections and their document counts", summary);
  note(
    "Expect users 30, categories 10, products 63, orders 300, reviews 200. " +
      "No CREATE TABLE ever ran: MongoDB creates a database and a collection " +
      "implicitly on first insert. Convenient — and the reason a typo'd " +
      "collection name silently creates a NEW empty collection instead of " +
      "erroring, which is a classic beginner bug."
  );

  // --------------------------------------------------------------------
  section("3. One real document, exactly as stored");
  // findOne() with no filter returns whatever the storage engine hands over
  // first. Through the native driver you see the true stored shape: no
  // Mongoose getters, no virtuals, no `id` alias.
  const rawUser = await db.collection("users").findOne();
  show("A raw user document", rawUser);
  note(
    "Read the shape carefully. `_id` is an ObjectId (not a number). " +
      "`address` is a NESTED OBJECT living inside this same document — in " +
      "SQL that would be a second table plus a join. `interests` is an ARRAY " +
      "of strings — in SQL, a third table. One read here fetches all of it."
  );

  // --------------------------------------------------------------------
  section("4. Documents in one collection may have DIFFERENT shapes");
  // This is the headline difference from a relational table. Our seeder
  // deliberately leaves `age` and `address` off ~15% of users.
  const withAge = await db.collection("users").countDocuments({ age: { $exists: true } });
  const withoutAge = await db.collection("users").countDocuments({ age: { $exists: false } });
  const noAddress = await db.collection("users").countDocuments({ address: { $exists: false } });

  show("Field presence varies per document", {
    "users WITH an age field": withAge,
    "users with NO age field at all": withoutAge,
    "users with NO address": noAddress,
  });

  // Prove it by looking at one of each and comparing their key lists.
  const [hasEverything, missingFields] = await Promise.all([
    db.collection("users").findOne({ age: { $exists: true }, address: { $exists: true } }),
    db.collection("users").findOne({ age: { $exists: false } }),
  ]);
  show("Two users from the SAME collection, side by side", {
    "keys of a complete user": Object.keys(hasEverything),
    "keys of a sparse user": Object.keys(missingFields),
  });
  note(
    "Different key lists, same collection. MongoDB is SCHEMA-FLEXIBLE: the " +
      "server does not require documents to match each other. A missing " +
      "field costs nothing — there is no NULL cell reserved for it. This is " +
      "what makes optional data cheap, and it is why queries must handle " +
      "'field absent' as a real case (see $exists in module 05)."
  );
  note(
    "IMPORTANT: flexible does not mean structureless. Our Mongoose schemas " +
      "impose shape from Node.js, and MongoDB can enforce a $jsonSchema " +
      "validator server-side. Flexibility is a choice you opt out of — " +
      "which is exactly what module 03 is about."
  );

  // --------------------------------------------------------------------
  section("5. Nesting: a document that contains an ARRAY OF DOCUMENTS");
  // Orders store their line items INSIDE the order. This single feature
  // removes the most common join in an e-commerce schema.
  const order = await db.collection("orders").findOne({ "items.1": { $exists: true } });
  show("An order with its line items embedded", order);
  note(
    "In SQL this is `orders` + `order_items` + a JOIN on every read. Here " +
      "it is ONE document fetched in ONE round trip. Notice each item keeps " +
      "`productName` and `unitPrice` COPIES alongside the product reference: " +
      "an invoice must show what the customer actually paid, even if the " +
      "product is renamed or repriced later. That deliberate duplication is " +
      "called denormalization (module 09)."
  );

  // --------------------------------------------------------------------
  section("6. Storage stats — what a collection actually costs");
  const productStats = await db.command({ collStats: "products" });
  show("products collection", {
    documents: productStats.count,
    avgDocumentSizeBytes: productStats.avgObjSize,
    dataSizeKB: Number((productStats.size / 1024).toFixed(1)),
    indexes: productStats.nindexes,
    totalIndexSizeKB: Number((productStats.totalIndexSize / 1024).toFixed(1)),
  });
  note(
    "Two things to file away. (1) A single document is capped at 16 MB — " +
      "generous, but it is why you never embed an unbounded array (a " +
      "product's reviews grow forever, so they live in their own " +
      "collection). (2) Indexes take real space and are updated on every " +
      "write; that trade-off is module 12."
  );

  note(
    "Next: 02-bson-data-types looks at WHAT can go inside a document — " +
      "BSON, ObjectId, and every type you will meet."
  );
});
