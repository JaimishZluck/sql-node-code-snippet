/**
 * LESSON 03-mongoose-basics/03-validation-vs-db-constraints — Who enforces what
 *
 * The most important mental model of this module, proven live:
 *   1. required / enum / min / match run in NODE — validateSync() catches
 *      them before a single byte reaches the network;
 *   2. unique is NOT validation — it is a DATABASE index, and the SERVER
 *      rejects duplicates with error code 11000 (E11000);
 *   3. the native driver bypasses EVERY Mongoose rule, because the schema
 *      only exists inside your Node.js process;
 *   4. ...yet database constraints bite even the native driver.
 *
 * Temp data: users with emails ending "@lesson.test" and the temp collection
 * tmp_no_rules — all removed in the cleanup section. Seeded documents are
 * never modified.
 *
 * Run it with:  npm run lesson 03-mongoose-basics/03-validation-vs-db-constraints
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";

const TEMP_EMAIL_PATTERN = /@lesson\.test$/; // bootcamp temp-user marker
const DUP_EMAIL = "duplicate.check@lesson.test";
const TMP_COLLECTION = "tmp_no_rules"; // tmp_* = safe-to-drop lesson collection

await runLesson("Mongoose validation (Node) vs database constraints (server)", async () => {
  // Start clean: remove temp leftovers a crashed earlier run may have left.
  // (Temp markers only — seeded data is never touched.)
  await User.deleteMany({ email: TEMP_EMAIL_PATTERN });
  await mongoose.connection.dropCollection(TMP_COLLECTION).catch(() => {});

  try {
    section("1. required / enum / min / match run in Node — validateSync() proves it");

    // Four broken rules at once: no name (required), malformed email
    // (match), age 7 (min is 13), role "superhero" (not in the enum).
    const invalid = new User({
      email: "not-an-email",
      age: 7,
      role: "superhero",
    });

    // validateSync() is SYNCHRONOUS — and network I/O in Node.js can never
    // happen synchronously. So the error below CANNOT have come from the
    // server: it was produced entirely inside this process, by Mongoose.
    const err = invalid.validateSync();
    show(
      "err instanceof mongoose.Error.ValidationError",
      err instanceof mongoose.Error.ValidationError
    );
    show("failing paths", Object.keys(err.errors));
    for (const [path, detail] of Object.entries(err.errors)) {
      show(`${path} -> kind: ${detail.kind}`, detail.message);
    }
    note(
      "ONE ValidationError carries one entry PER failing path (err.errors). The `kind` names " +
        "the rule that failed: required, regexp (from match), min, enum. All of them were " +
        "checked in Node — MongoDB itself would happily have stored this document."
    );

    section("2. save() stops at the same wall — the invalid doc never leaves Node");

    try {
      // save() runs full validation FIRST. It fails, so no insert command is
      // ever built, encoded, or sent.
      await invalid.save();
    } catch (saveErr) {
      show("save() rejected with", saveErr.name);
      show("same error class as validateSync?", saveErr instanceof mongoose.Error.ValidationError);
    }
    note("save() = validate + write. Validation failed, so the write step never existed.");

    section("3. unique is NOT a validator — the SERVER enforces it");

    // Make sure the unique index on email actually exists before testing it:
    // init() resolves once Mongoose has finished building this schema's
    // indexes in MongoDB (they are built in the DATABASE, not in Node).
    await User.init();

    const first = await User.create({ name: "First Copy", email: DUP_EMAIL });
    show("first copy saved", { id: first._id, email: first.email });

    // A second user with the SAME email. Watch Mongoose validation pass:
    const second = new User({ name: "Second Copy", email: DUP_EMAIL });
    show("second.validateSync() (undefined = every rule passes!)", second.validateSync());

    try {
      // Passes validation in Node... and dies on the server, where the
      // unique index on email lives.
      await second.save();
    } catch (dupErr) {
      show("dupErr.name", dupErr.name); // MongoServerError — NOT ValidationError
      show("dupErr.code", dupErr.code); // 11000 = duplicate key
      show("dupErr.keyValue (the offending value)", dupErr.keyValue);
    }
    note(
      "Uniqueness cannot be guaranteed by app code: two simultaneous requests could both " +
        "check for a duplicate, both see none, and both insert — a race condition. Only the " +
        "database, which orders all writes against the unique index, can enforce it. That is " +
        "why the failure arrives as a MongoServerError (server) instead of a ValidationError " +
        "(Node)."
    );

    section("4. The native driver bypasses EVERY Mongoose rule");

    // mongoose.connection.db is the raw driver's Db object — same socket
    // pool, zero Mongoose. We insert a document that breaks every schema
    // rule imaginable... into a TEMP collection, and MongoDB accepts it.
    const raw = mongoose.connection.db.collection(TMP_COLLECTION);
    const rawResult = await raw.insertOne({
      email: 42, // a Number where the schema wants a unique, matched String
      role: "superhero", // not in any enum
      age: -5, // far below any min
      shoeSize: { anything: ["goes"] }, // a field no schema has ever heard of
    });
    show("inserted without any complaint", rawResult.insertedId);
    show("what MongoDB actually stored", await raw.findOne({ _id: rawResult.insertedId }));
    note(
      "MongoDB is schemaless: it stores any valid BSON document. Your schema is an agreement " +
        "that exists ONLY in Node processes that load your Mongoose models. Another service, " +
        "a migration script, or a mongosh session is not bound by it — which is why critical " +
        "invariants must ALSO live in the database (unique indexes, or MongoDB's optional " +
        "$jsonSchema collection validator)."
    );

    section("5. ...but DATABASE constraints bite everyone — even the raw driver");

    try {
      // Duplicate email into the REAL users collection via the raw driver:
      // Mongoose validation is skipped entirely, but the unique INDEX is part
      // of the database itself. (We use our temp email, so the cleanup below
      // removes the doc even in the unlikely case this insert succeeds.)
      await mongoose.connection.db
        .collection("users")
        .insertOne({ name: "Raw Duplicate", email: DUP_EMAIL });
      note(
        "Unexpected: the insert succeeded, so the unique index is missing. " +
          "Run `npm run db:seed` (or any lesson) to let Mongoose rebuild indexes."
      );
    } catch (rawDupErr) {
      show("rawDupErr.code (duplicate key — from the server)", rawDupErr.code);
      show("rawDupErr.keyValue", rawDupErr.keyValue);
    }
    note(
      "Same E11000 as section 3, with no Mongoose in sight. That is the whole distinction: " +
        "VALIDATION lives in your app and protects only writes that go through your models; " +
        "CONSTRAINTS live in the database and apply to every client, every driver, every tool."
    );
  } finally {
    section("Cleanup — TEMP data only");
    // Deletes only users matching the "@lesson.test" temp marker.
    const del = await User.deleteMany({ email: TEMP_EMAIL_PATTERN });
    show("temp users deleted", del.deletedCount);

    // DESTRUCTIVE — temp collection only:
    await mongoose.connection.dropCollection(TMP_COLLECTION).catch(() => {});
    note(`Dropped ${TMP_COLLECTION}. Seeded collections were never modified.`);
  }
});
