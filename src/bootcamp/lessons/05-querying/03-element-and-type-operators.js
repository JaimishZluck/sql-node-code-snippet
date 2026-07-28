/**
 * LESSON 05-querying/03-element-and-type-operators — $exists and $type
 *
 * MongoDB has no fixed table columns: a field can be present, present-but-
 * null, or simply NOT THERE. This lesson uses the seeded users (about 15%
 * have no age/address on purpose) to separate the three flavors of
 * "nothing", then shows $type — including the int-vs-double surprise the
 * Node.js driver creates for perfectly ordinary numbers.
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 05-querying/03-element-and-type-operators
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

await runLesson("Querying 3/6 — Element & type operators", async () => {
  // --------------------------------------------------------------------
  section("1. $exists — 'does this document have the field at all?'");
  // In SQL every row has every column. In MongoDB a document simply omits
  // fields nobody set. The seeder skips age AND address together for ~15%
  // of users — $exists: false finds them.
  const noAge = await User.find({ age: { $exists: false } });
  show(
    "Users with NO age field",
    noAge.map((u) => ({ name: u.name, email: u.email }))
  );

  const noAddressCount = await User.countDocuments({ address: { $exists: false } });
  show("Users with NO address field", noAddressCount);
  note(
    "Both queries should return the SAME users — the seeder omits age and " +
      "address together. $exists: false is how you audit incomplete profiles; " +
      "$exists: true is how you demand a field is present (it accepts a null " +
      "value as 'present', though — see section 3)."
  );

  // A very real product question: who has never logged in? lastLoginAt is
  // only set for ~85% of users; the rest never signed in after registering.
  const neverLoggedIn = await User.find({ lastLoginAt: { $exists: false } });
  show(
    "Users who never logged in (candidates for a welcome-back email)",
    neverLoggedIn.map((u) => ({ name: u.name, createdAt: u.createdAt }))
  );

  // --------------------------------------------------------------------
  section("2. The three flavors of 'nothing' — missing vs null vs neither");
  // Flavor A: field ABSENT (age on ~15% of users — nothing stored at all).
  // Flavor B: field PRESENT with value null (deletedAt: null on every
  //           non-deleted user — the schema default writes the null).
  // Watch how three different queries slice these differently:
  const stats = {
    "age: null                (missing OR stored null)": await User.countDocuments({ age: null }),
    "age: {$exists: false}    (only truly missing)": await User.countDocuments({ age: { $exists: false } }),
    'age: {$type: "null"}     (only stored null)': await User.countDocuments({ age: { $type: "null" } }),
  };
  show("The 'age' field (absent on ~15%, never stored as null)", stats);

  const deletedStats = {
    "deletedAt: null                (missing OR stored null)": await User.countDocuments({ deletedAt: null }),
    "deletedAt: {$exists: false}    (only truly missing)": await User.countDocuments({ deletedAt: { $exists: false } }),
    'deletedAt: {$type: "null"}     (only stored null)': await User.countDocuments({ deletedAt: { $type: "null" } }),
  };
  show("The 'deletedAt' field (present on EVERY user, null unless soft-deleted)", deletedStats);
  note(
    "Compare the two tables. age: the null-equality and $exists:false counts " +
      "match (all 'nothing' is missing), $type:'null' is 0. deletedAt: " +
      "$exists:false is 0 — Mongoose's `default: null` physically stores a " +
      "null on every insert! Practical rules: '{ field: null }' = 'no usable " +
      "value' (matches both flavors — usually what you want, e.g. " +
      "deletedAt: null for not-deleted users); $exists:false = 'field truly " +
      "absent'; $type:'null' = 'an explicit null was written'."
  );

  // --------------------------------------------------------------------
  section("3. $exists: true accepts null — combine when you need a real value");
  // 'Has the field' is not the same as 'has a value'. deletedAt exists on
  // everyone; only combining operators isolates the actually-deleted users.
  const hasField = await User.countDocuments({ deletedAt: { $exists: true } });
  const actuallyDeleted = await User.countDocuments({
    deletedAt: { $exists: true, $ne: null },
  });
  show("deletedAt present vs present-and-not-null", {
    "$exists: true (the field is there)": hasField,
    "$exists + $ne null (soft-deleted users)": actuallyDeleted,
  });
  note(
    "Both counts agree, and that is no accident: since a MISSING field " +
      "equals null in queries, $ne: null already excludes missing fields too " +
      "— so { $ne: null } alone means 'present with a real value'. Adding " +
      "$exists: true changes nothing; it just states the intent louder. This " +
      "exact filter is how soft-delete systems find their deleted rows."
  );

  // --------------------------------------------------------------------
  section("4. $type — asking what BSON type is actually stored");
  // MongoDB stores BSON, and every value carries its concrete type. $type
  // matches on it. With Mongoose feeding the data, types are consistent —
  // but $type is the audit tool for data that arrived any other way
  // (imports, scripts, old app versions, manual shell edits).
  const typeChecks = {
    'sku is a "string" on every product': await Product.countDocuments({ sku: { $type: "string" } }),
    'placedAt is a "date" on every order': await Order.countDocuments({ placedAt: { $type: "date" } }),
    'sku stored as "number" (corrupt data?)': await Product.countDocuments({ sku: { $type: "number" } }),
  };
  show("Type audits", typeChecks);
  note(
    "A schemaless database cannot promise 'this column is VARCHAR'. After a " +
      "bad CSV import you can end up with prices as strings — invisible to " +
      "equality queries (lesson 01 section 6!) until a $type audit finds them."
  );

  // --------------------------------------------------------------------
  section('5. The int/double surprise — why you should query $type: "number"');
  // The Node.js driver picks the BSON number type per value: a JS number
  // that is a whole number fitting 32 bits -> int32; anything fractional ->
  // double. Same schema field, mixed BSON types! ratingSummary.average was
  // computed from reviews: 4.3 became a double, but a clean 4 (or the
  // default 0) became an int32.
  const avgTypes = {
    '$type: "int"    (whole-number averages, incl. default 0)': await Product.countDocuments({ "ratingSummary.average": { $type: "int" } }),
    '$type: "double" (fractional averages like 4.3)': await Product.countDocuments({ "ratingSummary.average": { $type: "double" } }),
    '$type: "number" (alias matching int+long+double+decimal)': await Product.countDocuments({ "ratingSummary.average": { $type: "number" } }),
  };
  show("BSON type of ratingSummary.average across 63 products", avgTypes);
  note(
    "int + double should sum to the 'number' count. Nobody chose these types " +
      "— the driver did, value by value. Range/equality operators do not care " +
      "(numeric types compare with each other just fine), but a literal " +
      '$type: "int" check misses the doubles. Rule: for numbers, audit with ' +
      'the "number" alias unless you truly care about the storage format.'
  );

  // --------------------------------------------------------------------
  section("6. $type on arrays — the element-vs-array twist");
  // For a field holding an array, $type: "array" matches the field itself —
  // but any OTHER type is tested against each ELEMENT (the same multikey
  // behavior that makes { tags: "sale" } work — lesson 04).
  const arrayTwist = {
    'interests $type "array"  (every user — even empty arrays)': await User.countDocuments({ interests: { $type: "array" } }),
    'interests $type "string" (users with at least ONE interest)': await User.countDocuments({ interests: { $type: "string" } }),
    "interests: [] (exact empty-array equality)": await User.countDocuments({ interests: [] }),
  };
  show("Array type checks on users.interests", arrayTwist);
  note(
    'All 30 users match "array" (an empty array is still an array). But ' +
      '"string" matches only users whose array CONTAINS a string element — ' +
      "users with interests: [] have no elements to test, so they drop out. " +
      "The exact-equality { interests: [] } is the idiomatic 'empty array' " +
      "check. Expect roughly a fifth of users to have zero interests."
  );
});
