/**
 * LESSON 04-crud/02-read — Reading documents
 *
 * Every read operation Mongoose offers, side by side: `find`, `findOne`,
 * `findById` (including the infamous undefined pitfall), the two ways to
 * count (`countDocuments` vs `estimatedDocumentCount`), `distinct`, and
 * `exists` — with special attention to what each one RETURNS, because that
 * is where most beginner bugs live (empty array vs null vs number vs {_id}).
 *
 * This lesson is 100% READ-ONLY on the seeded store data — safe to run any
 * time, in any order, as often as you like.
 *
 * Run it with:  npm run lesson 04-crud/02-read
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

await runLesson("CRUD 2/4 — Reading documents", async () => {
  // --------------------------------------------------------------------
  section("1. Model.find(filter) — many documents, ALWAYS an array");
  // find() answers "give me every doc matching this filter". The filter
  // uses dot notation ("address.city") to reach inside embedded documents.
  const mumbaiCustomers = await User.find({
    role: "customer",
    isActive: true,
    "address.city": "Mumbai",
  });
  show(
    "Active customers in Mumbai",
    mumbaiCustomers.map((u) => ({ name: u.name, city: u.address?.city }))
  );

  // Zero matches is NOT an error and NOT null — it is an empty array.
  const atlantis = await User.find({ "address.city": "Atlantis" });
  show("find() with zero matches", atlantis);
  note(
    "find() ALWAYS resolves to an array — [] when nothing matches, never " +
      "null. The classic bug `if (!users) return 404` therefore never fires: " +
      "an empty array is truthy! Check users.length instead."
  );

  // An empty filter {} matches EVERYTHING — fine on 30 users, a disaster on
  // 30 million. Real code always filters and/or paginates (module 06).
  const everyone = await User.find({});
  show("find({}) matched", `${everyone.length} documents (the whole collection)`);
  note(
    "find() returns a Query object — a 'thenable' that only runs when you " +
      "await it. That is why you can chain .sort().limit().select() before " +
      "awaiting (modules 06 and 15 dig into this)."
  );

  // --------------------------------------------------------------------
  section("2. Model.findOne(filter) — the FIRST match, or null");
  // findOne() sends the same query but asks for a single doc. With 2 seeded
  // admins, WHICH one comes back is unspecified — MongoDB returns the first
  // in "natural order" (whatever it finds first on disk).
  const anAdmin = await User.findOne({ role: "admin" });
  show("One of the admins", { name: anAdmin?.name, role: anAdmin?.role });
  note(
    "There are 2 admins — findOne() picked an arbitrary one. If 'first' " +
      "matters, say what first MEANS with .sort(): e.g. " +
      "findOne({ role: 'admin' }).sort({ createdAt: 1 }) for the oldest."
  );

  // A realistic store question: find something that is out of stock.
  const outOfStock = await Product.findOne({ stock: 0, isActive: true });
  show("An out-of-stock product", {
    name: outOfStock?.name,
    sku: outOfStock?.sku,
    stock: outOfStock?.stock,
  });

  // No match -> null (an object-or-null, unlike find's array).
  const ghost = await User.findOne({ email: "nobody@nowhere.example" });
  show("findOne() with zero matches", ghost);
  note(
    "Memorize the pair: find -> [] when empty, findOne -> null when empty. " +
      "APIs typically turn that null into a 404 response."
  );

  // --------------------------------------------------------------------
  section("3. Model.findById(id) — lookup by primary key");
  // findById(id) is sugar for findOne({ _id: id }). Mongoose casts the
  // string to an ObjectId for you — this is the single most common query in
  // any REST API (GET /users/:id).
  const sameAdmin = await User.findById(anAdmin._id);
  show("Fetched again by _id", {
    name: sameAdmin?.name,
    sameDocument: sameAdmin?._id.equals(anAdmin._id),
  });

  // A string that cannot possibly be an ObjectId fails CASTING — in
  // Mongoose, in Node — before any query is sent. You get a CastError.
  try {
    await User.findById("definitely-not-an-objectid");
  } catch (error) {
    show("Malformed id throws", { name: error.name, message: error.message });
  }
  note(
    "CastError is a Mongoose (client-side) error. Express APIs usually map " +
      "it to 400 Bad Request — the id is not even the right SHAPE."
  );

  // A well-formed ObjectId that simply matches nothing returns null — no
  // error. (new ObjectId() generates a fresh random id nothing can match.)
  const missing = await User.findById(new mongoose.Types.ObjectId());
  show("Valid-shape id with no match", missing);
  note(
    "Two different 'not found' behaviors: wrong SHAPE -> CastError (400), " +
      "right shape but absent -> null (404). Handle both in real routes."
  );

  // --------------------------------------------------------------------
  section("4. The undefined pitfall — findOne({ _id: undefined }) is a trap");
  // Simulate a real bug: the request body was supposed to carry a userId,
  // but the client never sent it.
  let userIdFromRequest; // undefined!

  // Mongoose STRIPS keys whose value is undefined from filters. So this
  // becomes findOne({}) — "give me the first document in the collection"!
  const leaked = await User.findOne({ _id: userIdFromRequest });
  show(
    "findOne({ _id: undefined }) returned",
    leaked ? `${leaked.name} <${leaked.email}> — a REAL, arbitrary user!` : null
  );

  // findById is special-cased: Mongoose translates findById(undefined) into
  // findOne({ _id: null }), which safely matches nothing.
  const guarded = await User.findById(userIdFromRequest);
  show("findById(undefined) returned", guarded);
  note(
    "This is a genuine security-bug pattern: an undefined id in findOne() " +
      "silently returns SOMEONE ELSE'S document (imagine it in GET /profile). " +
      "Defenses: validate ids before querying, and prefer findById() for " +
      "primary-key lookups — it treats undefined as 'match nothing'."
  );

  // --------------------------------------------------------------------
  section("5. countDocuments() vs estimatedDocumentCount()");
  // countDocuments(filter) actually runs the query server-side and counts
  // the matches — accurate, filterable, but it must do real work.
  const totalUsers = await User.countDocuments();
  const softDeleted = await User.countDocuments({ deletedAt: { $ne: null } });
  const outOfStockCount = await Product.countDocuments({ stock: 0 });
  show("Accurate counts", { totalUsers, softDeleted, outOfStockCount });

  // estimatedDocumentCount() does NOT scan anything: it reads the count the
  // server keeps in collection METADATA. Near-instant even on billions of
  // docs — but there is no filter parameter, and after an unclean server
  // shutdown the metadata can be slightly off until it self-corrects.
  const orderEstimate = await Order.estimatedDocumentCount();
  show("Estimated order count (from metadata)", orderEstimate);
  note(
    "Rule: need a FILTER or exactness -> countDocuments. Need a cheap " +
      "whole-collection number for a dashboard tile -> estimatedDocumentCount. " +
      "Both return a plain number. (Old tutorials use Model.count() — it was " +
      "removed; it does not exist in Mongoose 8.)"
  );

  // --------------------------------------------------------------------
  section("6. Model.distinct(field, filter?) — unique values of one field");
  // "Which cities do our users live in?" — one distinct() instead of
  // fetching every user and de-duplicating in JavaScript.
  const cities = await User.distinct("address.city");
  show("Cities users live in (deduplicated by the SERVER)", cities);

  const brands = await Product.distinct("specs.brand");
  show("Brands in the catalog", brands);

  // On an ARRAY field, distinct returns the unique ELEMENTS across all docs
  // — the multikey behavior you met in the User model.
  const interests = await User.distinct("interests");
  show("Every interest anyone has", interests);

  // The optional second argument filters WHICH docs contribute values:
  // order statuses used this year only.
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  const statusesThisYear = await Order.distinct("status", {
    placedAt: { $gte: startOfYear },
  });
  show("Order statuses seen this year", statusesThisYear);
  note(
    "distinct() returns a plain ARRAY OF VALUES (not documents), computed on " +
      "the MongoDB server. Docs missing the field simply contribute nothing. " +
      "Great for building filter dropdowns (city, brand, status...)."
  );

  // --------------------------------------------------------------------
  section("7. Model.exists(filter) — the cheapest 'is there at least one?'");
  // exists() runs findOne with a projection of only _id — MongoDB can stop
  // at the FIRST match instead of counting them all.
  const anyAdmin = await User.exists({ role: "admin" });
  show("exists() when a match exists", anyAdmin);

  const emailFree = await User.exists({ email: "new.signup@nowhere.example" });
  show("exists() when nothing matches", emailFree);
  note(
    "exists() does NOT return a boolean! It returns { _id: ... } when a doc " +
      "matches and null when none does. `if (await User.exists(f))` works " +
      "(object is truthy, null is falsy), but `=== true` is ALWAYS false — a " +
      "very common bug. Typical use: 'is this email taken?' during signup."
  );
});
