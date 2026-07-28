/**
 * LESSON 01-fundamentals/02-bson-data-types — BSON, ObjectId, and every type
 *
 * MongoDB does not store JSON. It stores BSON — "Binary JSON" — a binary
 * format that keeps JSON's shape but adds real types (dates, 64-bit integers,
 * binary blobs, exact decimals) and records the type of every single value.
 * Almost every confusing MongoDB behavior traces back to that last point:
 * comparisons, sorting, and equality are all TYPE-AWARE.
 *
 * This lesson dissects an ObjectId, inspects the actual BSON type of fields
 * in the seeded data with $type, and writes one temporary document containing
 * every type worth knowing — then deletes it.
 *
 * SAFE TO RE-RUN: the only write is a single document in the temporary
 * collection `tmp_bson_types`, which is dropped at the end (and cleaned up
 * at the start in case a previous run crashed). Seeded data is never touched.
 *
 * Run it with:  npm run lesson 01-fundamentals/02-bson-data-types
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";

const TEMP_COLLECTION = "tmp_bson_types";

await runLesson("Fundamentals 2/3 — BSON data types", async () => {
  const db = mongoose.connection.db;

  // Clean up after any previous crashed run BEFORE we start. Every lesson in
  // this bootcamp that writes does this, so lessons stay re-runnable.
  await db.collection(TEMP_COLLECTION).drop().catch(() => {});

  // --------------------------------------------------------------------
  section("1. JSON vs BSON — why the difference matters");
  note(
    "JSON has six types: string, number, boolean, null, array, object. That " +
      "is not enough for a database. There is no date (so timestamps become " +
      "strings you cannot sort correctly), no integer-vs-float distinction, " +
      "no binary, and no exact decimal for money. BSON adds all of these, " +
      "stores them in a compact binary layout, and prefixes every value with " +
      "a type byte so the server always knows what it is holding."
  );
  note(
    "Consequence you will hit within a week: MongoDB compares ACROSS types " +
      "by a fixed type order, and range comparisons never match across type " +
      "brackets. The string \"40000\" is not greater than the number 39999 — " +
      "it is simply a different kind of thing. Mongoose's casting exists " +
      "largely to protect you from this."
  );

  // --------------------------------------------------------------------
  section("2. ObjectId — anatomy of the default _id");
  // Every document needs a unique _id. If you do not supply one, the driver
  // generates an ObjectId: 12 bytes, shown as 24 hex characters.
  const id = new mongoose.Types.ObjectId();
  const hex = id.toHexString();

  show("A freshly generated ObjectId", {
    value: id,
    asString: hex,
    lengthInHexChars: hex.length,
    lengthInBytes: 12,
    "bytes 0-3  (timestamp, seconds since epoch)": hex.slice(0, 8),
    "bytes 4-8  (random per process)": hex.slice(8, 18),
    "bytes 9-11 (incrementing counter)": hex.slice(18, 24),
    embeddedTimestamp: id.getTimestamp(),
  });
  note(
    "The first 4 bytes are a UNIX timestamp, which is why ObjectIds sort " +
      "roughly by creation time — sorting by _id gives you newest-last for " +
      "free, with no createdAt field. The next 5 bytes identify the process " +
      "that generated it, and the last 3 are a counter. That combination is " +
      "why ids can be generated on ANY client with no coordination and still " +
      "not collide — unlike a SQL AUTO_INCREMENT, which forces every insert " +
      "through one central sequence."
  );

  // A practical consequence: you can build an id from a date and use it as
  // a range bound, without ever storing a separate timestamp.
  const jan2024 = mongoose.Types.ObjectId.createFromTime(
    Math.floor(new Date("2024-01-01T00:00:00Z").getTime() / 1000)
  );
  show("ObjectId built from a date (useful as a range bound)", {
    generated: jan2024.toHexString(),
    decodesBackTo: jan2024.getTimestamp(),
    usage: '{ _id: { $gt: ObjectId.createFromTime(...) } }',
  });

  // The most common runtime error in MongoDB apps comes from ids that are
  // strings from a URL. Validate before casting.
  show("Validating an id from req.params", {
    "isValid('507f1f77bcf86cd799439011')":
      mongoose.Types.ObjectId.isValid("507f1f77bcf86cd799439011"),
    "isValid('not-an-id')": mongoose.Types.ObjectId.isValid("not-an-id"),
    // Careful: any 12-character string passes isValid, because 12 bytes is
    // a legal ObjectId. This is a real trap.
    "isValid('123456789012') -- 12 chars!":
      mongoose.Types.ObjectId.isValid("123456789012"),
  });
  note(
    "isValid() is necessary but not sufficient — any 12-character string " +
      "passes it. For strict checking compare round-trips: " +
      "String(new ObjectId(value)) === value. Skipping this check is how " +
      "you get a CastError crash from a bad URL (module 15)."
  );

  // --------------------------------------------------------------------
  section("3. $type — asking the server what a field actually holds");
  // $type queries by BSON type, using either the alias string or the
  // numeric type code. This is how you audit real data.
  const [asDouble, asInt, asString] = await Promise.all([
    Product.countDocuments({ price: { $type: "double" } }),
    Product.countDocuments({ price: { $type: "int" } }),
    Product.countDocuments({ price: { $type: "string" } }),
  ]);
  show("What BSON type is products.price?", {
    double: asDouble,
    int: asInt,
    string: asString,
    total: await Product.countDocuments(),
  });
  note(
    "Mongoose's Number type maps to BSON double (JavaScript has only one " +
      "number type, a 64-bit float). If you need a true 32/64-bit integer " +
      "you must ask for it explicitly with Schema.Types.Int32 / BigInt or " +
      "the native driver's Int32/Long."
  );

  // Arrays are special: $type: "array" matches the field itself, but most
  // operators look INSIDE the array instead. Worth seeing early.
  show("Arrays behave differently", {
    'tags $type "array"': await Product.countDocuments({ tags: { $type: "array" } }),
    'tags $type "string"': await Product.countDocuments({ tags: { $type: "string" } }),
  });
  note(
    'Both counts are high: $type "array" matches the field, and $type ' +
      '"string" matches because at least one ELEMENT is a string. Nearly ' +
      "every MongoDB operator, when it meets an array, applies itself to the " +
      "elements. Module 05 makes this precise."
  );

  // --------------------------------------------------------------------
  section("4. Writing one document containing every type worth knowing");
  const temp = db.collection(TEMP_COLLECTION);

  await temp.insertOne({
    // --- the JSON-ish types ---
    aString: "hello",                                  // type 2  ("string")
    aDouble: 3.14,                                     // type 1  ("double")
    aBoolean: true,                                    // type 8  ("bool")
    aNull: null,                                       // type 10 ("null")
    anArray: [1, "two", { three: 3 }],                 // type 4  ("array") — mixed is legal
    anObject: { nested: { deeper: "value" } },         // type 3  ("object")

    // --- the types JSON does not have ---
    // Stored as milliseconds since epoch, in UTC, always. Timezone is a
    // display concern for your application, never a storage concern.
    aDate: new Date(),                                 // type 9  ("date")
    anObjectId: new mongoose.Types.ObjectId(),         // type 7  ("objectId")
    // Exact base-10 decimal. THE type for money: 0.1 + 0.2 is exactly 0.3
    // here, unlike a float. Trade-off: arithmetic is slower and you get
    // Decimal128 objects back, not JS numbers.
    aDecimal: mongoose.Types.Decimal128.fromString("19.99"),   // type 19
    // 64-bit integer, for counters that exceed 2^53 (JS's safe integer limit).
    aLong: mongoose.mongo.Long.fromString("9007199254740993"), // type 18 ("long")
    anInt32: new mongoose.mongo.Int32(42),                     // type 16 ("int")
    // Server-side regex, usable directly in queries.
    aRegex: /^lap/i,                                   // type 11 ("regex")
    // Raw bytes: file contents, hashes, UUIDs.
    aBinary: new mongoose.mongo.Binary(Buffer.from("raw bytes")), // type 5
    // Sorts above and below EVERYTHING respectively. Used for open-ended
    // range bounds in index tricks.
    aMinKey: new mongoose.mongo.MinKey(),              // type -1
    aMaxKey: new mongoose.mongo.MaxKey(),              // type 127
  });

  // Read it back to see what the server stored (and how it round-trips).
  const stored = await temp.findOne({}, { projection: { _id: 0 } });
  show("The document as MongoDB stored it", stored);

  // Ask the server to report the type of each field, using an aggregation.
  // $type as an EXPRESSION (inside $project) returns the type name, unlike
  // $type as a query OPERATOR which filters.
  const [types] = await temp
    .aggregate([
      {
        $project: Object.fromEntries(
          Object.keys(stored).map((key) => [key, { $type: `$${key}` }])
        ),
      },
      { $project: { _id: 0 } },
    ])
    .toArray();
  show("Server-reported BSON type of each field", types);
  note(
    "Notice aDouble is 'double' and anInt32 is 'int' even though both are " +
      "plain numbers in JavaScript — BSON preserved the distinction we asked " +
      "for. Notice aDecimal is 'decimal', which is why it is the right type " +
      "for money: 0.1 + 0.2 is exactly 0.3 in decimal, and 0.30000000000000004 " +
      "in double."
  );

  // --------------------------------------------------------------------
  section("5. null vs missing — not the same thing");
  await temp.insertOne({ marker: "second", explicitNull: null });

  const matchesNull = await temp.countDocuments({ explicitNull: null });
  const matchesExists = await temp.countDocuments({ explicitNull: { $exists: true } });
  show("Querying { explicitNull: null }", {
    "documents matched by { explicitNull: null }": matchesNull,
    "documents that actually HAVE the field": matchesExists,
    totalDocuments: await temp.countDocuments(),
  });
  note(
    "{ field: null } matches BOTH documents where the field is null AND " +
      "documents where the field is absent — two different states, one " +
      "query result. To separate them use $type: 'null' (stored null only) " +
      "or $exists: false (absent only). Mixing these up produces bugs that " +
      "only appear on optional fields, which is why our seeder leaves age " +
      "and address off some users."
  );

  // --------------------------------------------------------------------
  section("6. Type ordering — how MongoDB sorts mixed types");
  note(
    "When a field holds different types across documents, MongoDB sorts by " +
      "a fixed order: MinKey < Null < Numbers < String < Object < Array < " +
      "Binary < ObjectId < Boolean < Date < Timestamp < Regex < MaxKey. " +
      "This is why a collection where some prices are numbers and some are " +
      "strings sorts nonsensically, and why { price: { $gt: 100 } } silently " +
      "skips the string ones. Enforce types with a schema and you never " +
      "meet this."
  );

  // --------------------------------------------------------------------
  section("7. Cleanup — dropping the temporary collection");
  // DESTRUCTIVE, but strictly scoped: only the tmp_ collection this lesson
  // created. The seeded collections are never touched.
  await db.collection(TEMP_COLLECTION).drop();
  const stillThere = await db.listCollections({ name: TEMP_COLLECTION }).toArray();
  show("Cleanup", {
    dropped: TEMP_COLLECTION,
    remainingMatchingCollections: stillThere.length,
  });
  note(
    "Next: 03-databases-and-collections compares this document model to a " +
      "relational database, concept by concept."
  );
});
