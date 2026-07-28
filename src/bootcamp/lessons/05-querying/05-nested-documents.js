/**
 * LESSON 05-querying/05-nested-documents — Dot notation and how matching works
 *
 * Documents nest: a user has an address, a product has specs, an order has
 * a payment block. Dot notation ("address.city") is THE way to filter on
 * nested fields — and this lesson also demonstrates, with the native
 * driver, why the "obvious" alternative { address: { city: "Mumbai" } }
 * silently returns nothing. It closes with a look at HOW MongoDB actually
 * evaluates a filter (document at a time, index first when it can).
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 05-querying/05-nested-documents
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

/**
 * Tiny helper for section 4: flatten an explain() winning plan into a
 * readable chain like "FETCH <- IXSCAN(address.city_1)". Defensive on
 * purpose — explain output varies slightly across server versions.
 */
function planChain(explainResult) {
  const stages = [];
  let stage = explainResult?.queryPlanner?.winningPlan;
  while (stage) {
    stages.push(stage.indexName ? `${stage.stage}(${stage.indexName})` : stage.stage);
    stage = stage.inputStage ?? (Array.isArray(stage.inputStages) ? stage.inputStages[0] : undefined);
  }
  return stages.join(" <- ") || "(plan unavailable)";
}

await runLesson("Querying 5/6 — Nested documents & dot notation", async () => {
  // --------------------------------------------------------------------
  section("1. Dot notation — the path INTO a nested field");
  // Quote the key (JS identifiers cannot contain dots) and give the full
  // path from the document root. Everything else works exactly like a
  // top-level field — operators included.
  const mumbaikars = await User.find({ "address.city": "Mumbai" });
  show(
    "Users living in Mumbai",
    mumbaikars.map((u) => ({ name: u.name, city: u.address?.city }))
  );

  const voltGear = await Product.find({
    "specs.brand": "Volt",
    price: { $lt: 60000 },
  });
  show(
    "Volt-branded products under 60,000 (nested + top-level fields mixed)",
    voltGear.map((p) => ({ name: p.name, brand: p.specs?.brand, price: p.price }))
  );

  const codUnpaid = await Order.countDocuments({
    "payment.method": "cod",
    "payment.paidAt": null,
  });
  show("Cash-on-delivery orders not yet paid", codUnpaid);
  note(
    "Dot notation asks about ONE nested field and ignores everything else " +
      "in the sub-document — extra fields, missing fields, field order. " +
      "Note 'payment.paidAt': null also uses lesson 03's null-matching: it " +
      "would match a missing paidAt too."
  );

  // --------------------------------------------------------------------
  section("2. THE PITFALL — { address: { city: 'Mumbai' } } matches nothing");
  // First, look at what a seeded address actually stores:
  const sample = await User.findOne({ "address.city": "Mumbai" });
  show("A real stored address", sample?.address);

  // Passing an OBJECT as the value asks for EXACT sub-document equality —
  // the stored address must be precisely { city: "Mumbai" }: no street, no
  // state, no country, no zip, nothing more, nothing less, same order.
  // We run this through the NATIVE driver so you see pure MongoDB
  // semantics, with zero Mongoose processing in between:
  const rawUsers = mongoose.connection.db.collection("users");
  const exactMatch = await rawUsers.countDocuments({ address: { city: "Mumbai" } });
  const dotMatch = await rawUsers.countDocuments({ "address.city": "Mumbai" });
  show("Exact sub-document vs dot notation", {
    "{ address: { city: 'Mumbai' } }": exactMatch,
    "{ 'address.city': 'Mumbai' }": dotMatch,
  });
  note(
    "0 vs many. The exact form compares the WHOLE embedded document " +
      "byte-for-byte against your literal — every stored address also has " +
      "street/state/country/zip, so nothing can equal { city: 'Mumbai' }. " +
      "This bug is nasty because it is silently wrong: no error, just an " +
      "empty result that looks like 'no users in Mumbai'."
  );

  // --------------------------------------------------------------------
  section("3. Exact matching is even stricter — FIELD ORDER counts");
  // Orders store payment as { method, paidAt } in that key order. An exact
  // match with the SAME fields succeeds only when the key order matches
  // too, because BSON documents are ordered byte sequences:
  const rawOrders = mongoose.connection.db.collection("orders");
  const rightOrder = await rawOrders.countDocuments({
    payment: { method: "cod", paidAt: null },
  });
  const wrongOrder = await rawOrders.countDocuments({
    payment: { paidAt: null, method: "cod" },
  });
  show("Exact match on payment — same fields, different key order", {
    "{ method, paidAt } (matches storage order)": rightOrder,
    "{ paidAt, method } (reversed)": wrongOrder,
  });
  note(
    "Same two fields, same two values — reversed order finds ZERO. Exact " +
      "sub-document equality compares raw BSON, and BSON preserves key " +
      "order. Even when exact matching 'works' it is a trap: add one field " +
      "to the schema tomorrow and every exact-match query silently breaks. " +
      "Rule: ALWAYS filter nested fields with dot notation (or $elemMatch " +
      "inside arrays). Exact object equality is practically never the intent."
  );

  // --------------------------------------------------------------------
  section("4. How MongoDB evaluates your filter — document at a time");
  // There is no schema on the server and no row/column layout. Conceptually
  // MongoDB takes each CANDIDATE document, walks your predicate tree
  // (every condition, nested paths, arrays), and keeps the doc on a full
  // pass. The only question is WHICH candidates it must look at:
  //  - no helpful index -> COLLSCAN: every document in the collection
  //  - helpful index    -> IXSCAN: walk the sorted index, jump straight to
  //    matching entries, fetch only those documents
  // explain() reveals the chosen plan. users has an index {address.city: 1}
  // (declared in the User schema) — and loyaltyPoints has none:
  const indexedPlan = await User.find({ "address.city": "Pune" }).explain("queryPlanner");
  const unindexedPlan = await User.find({ loyaltyPoints: { $gte: 4000 } }).explain("queryPlanner");
  show("Plan for { 'address.city': 'Pune' } (indexed nested field)", planChain(indexedPlan));
  show("Plan for { loyaltyPoints: { $gte: 4000 } } (no index)", planChain(unindexedPlan));
  note(
    "IXSCAN(address.city_1) <- the index over the NESTED path did the " +
      "narrowing; FETCH then loaded just those documents. The loyaltyPoints " +
      "query shows COLLSCAN — with 30 users that is instant, with 30 million " +
      "it is an outage. Indexes never change WHAT matches, only how many " +
      "documents must be examined to find out. Module 12 goes deep on this."
  );

  // --------------------------------------------------------------------
  section("5. Deeper paths and realistic combinations");
  // Paths can go as deep as the documents do, and combine freely with
  // everything from earlier lessons.
  const gujaratOrders = await Order.countDocuments({
    "shippingAddress.state": "Gujarat",
    status: { $in: ["shipped", "delivered"] },
  });
  show("Orders shipped (or delivered) to Gujarat", gujaratOrders);

  const crowdFavorites = await Product.find({
    "ratingSummary.average": { $gte: 4.5 },
    "ratingSummary.count": { $gte: 2 },
    isActive: true,
  }).sort({ "ratingSummary.average": -1 });
  show(
    "Crowd favorites (avg >= 4.5 from 2+ reviews)",
    crowdFavorites.map((p) => ({
      name: p.name,
      average: p.ratingSummary?.average,
      reviews: p.ratingSummary?.count,
    }))
  );
  note(
    "ratingSummary is DENORMALIZED data (a copy maintained from the reviews " +
      "collection) precisely so this query is a cheap one-collection filter " +
      "instead of a join + group on every listing-page load. Filtering " +
      "nested fields costs the same as top-level ones — depth of the path " +
      "does not matter, indexes work on nested paths too."
  );
});
