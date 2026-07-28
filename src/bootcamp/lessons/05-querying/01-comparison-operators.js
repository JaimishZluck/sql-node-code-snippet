/**
 * LESSON 05-querying/01-comparison-operators — Equality, ranges, and lists
 *
 * The filter object you pass to find() is a tiny LANGUAGE, and comparison
 * operators are its basic vocabulary: implicit equality, $eq, $ne, $gt,
 * $gte, $lt, $lte, $in, $nin. This lesson walks through each one on real
 * store questions (price bands, staff roles, recent orders) and ends with
 * two traps every beginner hits: how $ne/$nin quietly match documents where
 * the field is MISSING, and what Mongoose's type casting protects you from.
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time, in any
 * order, as often as you like.
 *
 * Run it with:  npm run lesson 05-querying/01-comparison-operators
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

await runLesson("Querying 1/6 — Comparison operators", async () => {
  // --------------------------------------------------------------------
  section("1. Equality — { field: value } is sugar for { field: { $eq: value } }");
  // The shorthand and the explicit $eq form compile to the SAME query on
  // the server. You will write the shorthand 99% of the time; $eq exists
  // for symmetry (and for building filters programmatically).
  const sellersShort = await User.countDocuments({ role: "seller" });
  const sellersExplicit = await User.countDocuments({ role: { $eq: "seller" } });
  show("Sellers via shorthand vs explicit $eq", {
    shorthand: sellersShort,
    explicit$eq: sellersExplicit,
    identical: sellersShort === sellersExplicit,
  });
  note(
    "Both counts are 3 (the seed creates 3 sellers). Equality is the default " +
      "meaning of { field: value } — operators like $gt only enter the picture " +
      "when equality is not what you want."
  );

  // --------------------------------------------------------------------
  section("2. Ranges — $gt, $gte, $lt, $lte (and why the 'e' matters)");
  // A classic store question: mid-range products. Two operators on the SAME
  // field inside ONE object = an implicit AND (lesson 02 digs into this).
  const midRange = await Product.find({
    price: { $gte: 1000, $lte: 5000 },
    isActive: true,
  }).sort({ price: 1 });
  show(
    "Active products priced 1,000–5,000 (inclusive both ends)",
    midRange.map((p) => ({ name: p.name, price: p.price }))
  );

  // Inclusive vs exclusive on a value we KNOW exists: discountPercent is
  // always one of 0/5/10/15/20/30/40. $gt: 30 excludes the 30s themselves;
  // $gte: 30 includes them — the difference is exactly the "30% off" rows.
  const over30 = await Product.countDocuments({ discountPercent: { $gt: 30 } });
  const atLeast30 = await Product.countDocuments({ discountPercent: { $gte: 30 } });
  show("Discount > 30 vs >= 30", {
    "$gt 30 (only the 40% deals)": over30,
    "$gte 30 (30% and 40% deals)": atLeast30,
  });
  note(
    "$gt/$lt are EXCLUSIVE (strictly greater/less), $gte/$lte are INCLUSIVE. " +
      "Off-by-one bugs in price bands and date ranges almost always come from " +
      "picking the wrong one of these four."
  );

  // --------------------------------------------------------------------
  section("3. Ranges work on dates too — 'orders in the last 30 days'");
  // BSON dates compare chronologically with the exact same operators.
  // Compute the boundary once in JS, then let the SERVER do the filtering.
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000);

  const last30 = await Order.countDocuments({ placedAt: { $gte: daysAgo(30) } });
  // A bounded window: placed between 90 and 30 days ago. Same field, two
  // operators, one object — this is THE date-range pattern.
  const days90to30 = await Order.countDocuments({
    placedAt: { $gte: daysAgo(90), $lt: daysAgo(30) },
  });
  show("Order counts by window", {
    "last 30 days": last30,
    "90 to 30 days ago": days90to30,
  });
  note(
    "The 300 seeded orders are spread over 365 days, so expect roughly 25 per " +
      "30-day window. Notice the half-open window [$gte start, $lt end) — using " +
      "$lte on the end would let a boundary moment fall into TWO windows."
  );

  // --------------------------------------------------------------------
  section("4. $in — 'is the value any of these?'");
  // $in replaces a chain of ORs: role is seller OR admin. Perfect for
  // enum-ish fields and for id lists.
  const staff = await User.find({ role: { $in: ["seller", "admin"] } });
  show(
    "Staff (sellers + admins)",
    staff.map((u) => ({ name: u.name, role: u.role }))
  );
  note(
    "Prefer { role: { $in: [...] } } over { $or: [{ role: 'seller' }, " +
      "{ role: 'admin' }] } — same result, but $in is shorter, faster to plan, " +
      "and can walk one index with multiple point lookups."
  );

  // On an ARRAY field, $in means "the array CONTAINS at least one of these".
  // (Compare with $all in lesson 04, which demands ALL of them.)
  const dealTagged = await Product.countDocuments({ tags: { $in: ["sale", "budget"] } });
  show("Products tagged 'sale' OR 'budget' (any overlap)", dealTagged);

  // --------------------------------------------------------------------
  section("5. $ne and $nin — negations, and the missing-field surprise");
  // Products actually on discount: discountPercent has a default of 0, so
  // every document carries the field and $ne behaves as expected here.
  const discounted = await Product.countDocuments({ discountPercent: { $ne: 0 } });
  show("Products with a non-zero discount", discounted);

  // THE TRAP: $ne (and $nin) also match documents where the field does not
  // exist at all. "age is not 200" is TRUE for a user with no age! About
  // 15% of seeded users have no age field.
  const totalUsers = await User.countDocuments();
  const ageNot200 = await User.countDocuments({ age: { $ne: 200 } });
  const noAge = await User.countDocuments({ age: { $exists: false } });
  show("$ne counts missing fields as a match", {
    totalUsers,
    "age $ne 200": ageNot200,
    "users with NO age field": noAge,
  });
  note(
    "age $ne 200 matched EVERY user — including the ones with no age at all. " +
      "$ne means 'nothing stored here equals the value', and a missing field " +
      "stores nothing. If you need 'has an age AND it is not 200', combine: " +
      "{ age: { $ne: 200, $exists: true } }. Same warning applies to $nin."
  );

  // $nin on order status: orders that are neither cancelled nor pending —
  // status always exists (enum + default), so no surprise on this one.
  const inFlight = await Order.countDocuments({
    status: { $nin: ["cancelled", "pending"] },
  });
  show("Orders past 'pending' and not cancelled", inFlight);

  // --------------------------------------------------------------------
  section("6. Type matters — Mongoose casting vs raw BSON comparison");
  // MongoDB comparisons are TYPE-AWARE: a string "40000" and the number
  // 40000 live in different type brackets and never compare as equal or
  // greater/less across the bracket. Watch what happens when we send the
  // string bound through the NATIVE driver (no Mongoose casting at all):
  const rawProducts = mongoose.connection.db.collection("products");
  const rawStringBound = await rawProducts.countDocuments({ price: { $gt: "40000" } });

  // The same filter through Mongoose: the schema says price is a Number, so
  // Mongoose CASTS "40000" -> 40000 in Node.js BEFORE sending the query.
  const castNumber = await Product.countDocuments({ price: { $gt: "40000" } });
  const realNumber = await Product.countDocuments({ price: { $gt: 40000 } });
  show("price > '40000' (string) — three ways", {
    "native driver, string bound": rawStringBound,
    "Mongoose, string bound (auto-cast)": castNumber,
    "Mongoose, number bound": realNumber,
  });
  note(
    "Native driver: 0 matches — the server compared a STRING bound against " +
      "NUMBER prices, and cross-type range comparisons never match. Mongoose: " +
      "correct count, because casting fixed the type before the query left " +
      "Node.js. This is a Mongoose (client-side) feature; MongoDB itself is " +
      "strictly type-aware. It saves you from req.query values, which are " +
      "ALWAYS strings in Express."
  );
});
