/**
 * LESSON 16-native-driver-and-utilities/01-native-vs-mongoose
 *
 * Mongoose is not a database client. It is a layer ON TOP of one — the
 * official `mongodb` Node.js driver. Every query you have written in this
 * bootcamp was eventually translated into a driver call.
 *
 * Knowing where the seam is matters for three practical reasons:
 *  1. Some things are only available on the driver (admin commands,
 *     bulkWrite tuning, change streams, raw pipelines against any collection).
 *  2. Anything you do through the driver BYPASSES every Mongoose feature —
 *     validation, casting, defaults, middleware, virtuals. That is sometimes
 *     exactly what you want (migrations) and sometimes a disaster.
 *  3. Reading driver documentation stops being confusing once you can map
 *     it onto what Mongoose is doing for you.
 *
 * SAFE TO RE-RUN: writes only into the temporary collection
 * `tmp_native_lab`, dropped at the end. Seeded data is read-only.
 *
 * Run it with:  npm run lesson 16-native-driver-and-utilities/01-native-vs-mongoose
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";

const TEMP = "tmp_native_lab";

await runLesson("Native driver 1/2 — Driver vs Mongoose", async () => {
  // --------------------------------------------------------------------
  section("1. Finding the driver underneath");
  // Mongoose exposes the driver objects it is using. No second connection is
  // opened — you are reaching into the pool you already have.
  const client = mongoose.connection.getClient(); // MongoClient
  const db = mongoose.connection.db; // Db
  const usersCollection = db.collection("users"); // Collection

  show("The three driver objects", {
    "mongoose.connection.getClient()": client.constructor.name,
    "mongoose.connection.db": db.constructor.name,
    "db.collection('users')": usersCollection.constructor.name,
    "Model.collection (same thing)": User.collection.constructor.name,
    driverVersion: mongoose.mongo?.version ?? "(bundled with mongoose)",
    databaseName: db.databaseName,
  });
  note(
    "Always reach the driver THROUGH the existing Mongoose connection. " +
      "Creating a separate `new MongoClient(uri)` opens a SECOND connection " +
      "pool to the same server — double the sockets, and one of them will " +
      "not be closed by disconnectDB()."
  );

  // --------------------------------------------------------------------
  section("2. The same query, both ways");
  const viaMongoose = await User.find({ role: "admin" }).select("name email").lean();
  const viaDriver = await usersCollection
    .find({ role: "admin" }, { projection: { name: 1, email: 1, _id: 1 } })
    .toArray();

  show("Mongoose", viaMongoose);
  show("Native driver", viaDriver);
  show("API differences", {
    "returns": "Mongoose: a Query (deferred) | driver: a Cursor (needs .toArray())",
    "projection": "Mongoose: .select('name email') | driver: { projection: { name: 1 } }",
    "sorting": "Mongoose: .sort({...}) | driver: .sort({...}) — same",
    "results": "Mongoose: Documents (or plain objects with .lean()) | driver: always plain objects",
    "counting": "Mongoose: countDocuments() | driver: countDocuments() — same",
  });

  // --------------------------------------------------------------------
  section("3. What the driver does NOT do for you");
  const temp = db.collection(TEMP);
  await temp.drop().catch(() => {});

  // Through a Model, this would be rejected: name is required, age has a
  // minimum, role is an enum, and unknown fields are stripped.
  await temp.insertOne({
    age: -50,
    role: "definitely-not-a-real-role",
    randomField: "the driver does not care",
    email: "NOT-LOWERCASED@Example.COM",
  });
  const stored = await temp.findOne({}, { projection: { _id: 0 } });
  show("A document the driver happily stored", stored);
  show("What Mongoose would have done", {
    required: "rejected — `name` is required",
    min: "rejected — age must be at least 13",
    enum: "rejected — role must be customer|seller|admin",
    "unknown fields": "stripped — randomField would not be saved",
    "setters": "email would have been lowercased and trimmed",
    "defaults": "isActive, loyaltyPoints, deletedAt, createdAt, updatedAt would be filled in",
    middleware: "any pre('save') hook would have run",
  });
  note(
    "None of that happened. This is the whole trade: the driver is a thin, " +
      "fast, honest wrapper over the wire protocol, and every guarantee you " +
      "get from Mongoose lives in Mongoose. Use the driver deliberately, in " +
      "places where bypassing those guarantees is the POINT — not as a " +
      "shortcut in application code."
  );

  // --------------------------------------------------------------------
  section("4. No casting either");
  const someProduct = await Product.findOne().select("_id").lean();
  const idString = someProduct._id.toHexString();

  const mongooseCasts = await Product.countDocuments({ _id: idString });
  const driverDoesNot = await db.collection("products").countDocuments({ _id: idString });
  show("A string id, both ways", {
    "Mongoose (casts against the schema)": mongooseCasts,
    "driver (sends it verbatim)": driverDoesNot,
    "the fix for the driver": await db
      .collection("products")
      .countDocuments({ _id: new mongoose.Types.ObjectId(idString) }),
  });
  note(
    "1 versus 0. This is the same trap as aggregate() (module 11): anything " +
      "that does not go through a Mongoose Model must be cast by hand. " +
      "Wrapping ids in new mongoose.Types.ObjectId(...) becomes a reflex."
  );

  // --------------------------------------------------------------------
  section("5. bulkWrite — where the driver genuinely shines");
  // Available on Mongoose models too, but the shape is the driver's.
  await temp.deleteMany({});
  await temp.insertMany(
    Array.from({ length: 10 }, (_, i) => ({ code: `B-${i}`, qty: i, tier: "bronze" }))
  );

  const bulkResult = await temp.bulkWrite(
    [
      { updateOne: { filter: { code: "B-1" }, update: { $set: { tier: "gold" } } } },
      { updateMany: { filter: { qty: { $gte: 7 } }, update: { $set: { tier: "silver" } } } },
      { insertOne: { document: { code: "B-99", qty: 99, tier: "platinum" } } },
      { deleteOne: { filter: { code: "B-0" } } },
      // upsert: update if it exists, insert if it does not.
      {
        updateOne: {
          filter: { code: "B-100" },
          update: { $set: { qty: 100, tier: "new" } },
          upsert: true,
        },
      },
    ],
    // ordered: false lets the server run operations in parallel and keep
    // going past a failure. ordered: true (the default) stops at the first
    // error — which is what you want when later operations depend on
    // earlier ones.
    { ordered: false }
  );

  show("One round trip, five different operations", {
    inserted: bulkResult.insertedCount,
    matched: bulkResult.matchedCount,
    modified: bulkResult.modifiedCount,
    deleted: bulkResult.deletedCount,
    upserted: bulkResult.upsertedCount,
  });
  note(
    "This replaces a loop of five awaits with one command. On a migration " +
      "touching 100,000 documents, batching into bulkWrite calls of ~1,000 " +
      "is the difference between minutes and hours. Mongoose models expose " +
      "the same method (Model.bulkWrite) — and note that it BYPASSES " +
      "middleware, though it does apply casting."
  );

  // --------------------------------------------------------------------
  section("6. Running raw database commands");
  // Anything the server supports, whether or not the driver wraps it.
  const buildInfo = await db.admin().command({ buildInfo: 1 });
  const serverStatus = await db.admin().command({ serverStatus: 1 });
  show("Server information", {
    version: buildInfo.version,
    storageEngine: serverStatus.storageEngine?.name,
    uptimeSeconds: serverStatus.uptime,
    currentConnections: serverStatus.connections?.current,
    availableConnections: serverStatus.connections?.available,
  });
  note(
    "db.command() is the escape hatch for everything: collStats, dbStats, " +
      "profiling controls, replSetGetStatus, currentOp. If mongosh can do it, " +
      "db.command() can do it from Node."
  );

  // --------------------------------------------------------------------
  section("7. When to use which");
  show("Decision guide", {
    "use Mongoose for": [
      "all application code — you want validation, casting, hooks, virtuals",
      "anything touching user input",
      "populate, and schema-aware queries",
    ],
    "use the driver for": [
      "migrations and one-off data fixes (deliberately bypassing validation)",
      "admin/diagnostic commands (collStats, serverStatus, profiling)",
      "collection and index management scripts",
      "change streams",
      "performance-critical bulk paths where hydration is pure overhead",
      "querying a collection that has no Mongoose model",
    ],
    "never": "opening a second MongoClient when a Mongoose connection already exists",
  });

  // --------------------------------------------------------------------
  section("8. Change streams — a driver feature worth knowing");
  // Not started here (it needs a replica set and would hold the process
  // open), but this is the shape.
  show("Watching a collection for changes", {
    requires: "a replica set (change streams read the oplog)",
    code: `const stream = Order.watch([
  { $match: { operationType: "insert", "fullDocument.status": "paid" } },
]);
for await (const change of stream) {
  console.log("new paid order", change.fullDocument.orderNumber);
}`,
    "use cases": "cache invalidation, real-time dashboards, syncing to a search index, webhooks",
    "vs polling": "push-based — no repeated queries, and no missed changes between polls",
    "resumability": "store change._id as a resume token and pass { resumeAfter } to continue after a restart",
  });

  // --------------------------------------------------------------------
  section("9. Cleanup");
  await temp.drop().catch(() => {});
  show("Cleanup", { dropped: TEMP });
  note("Next: 02-utility-operations — collection and index administration.");
});
