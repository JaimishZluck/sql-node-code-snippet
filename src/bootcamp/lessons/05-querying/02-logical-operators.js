/**
 * LESSON 05-querying/02-logical-operators — AND, OR, NOR, NOT
 *
 * Multiple conditions in one filter object are ANDed automatically — so why
 * does an explicit $and operator exist at all? Because JavaScript object
 * literals silently DROP duplicate keys, and this lesson makes that bug
 * visible before teaching $or, $nor, and $not (which negates an OPERATOR,
 * not a value — and matches missing fields, unlike $lt/$gte).
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 05-querying/02-logical-operators
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";

await runLesson("Querying 2/6 — Logical operators", async () => {
  // --------------------------------------------------------------------
  section("1. Implicit AND — every key in the filter must match");
  // Listing several conditions side by side means ALL of them must hold.
  // No operator needed — this covers the vast majority of real queries.
  const vips = await User.find({
    role: "customer",
    isActive: true,
    loyaltyPoints: { $gte: 3000 },
  });
  show(
    "Active customers with 3000+ loyalty points (three ANDed conditions)",
    vips.map((u) => ({ name: u.name, loyaltyPoints: u.loyaltyPoints }))
  );

  // Same FIELD twice with DIFFERENT operators is also fine implicitly —
  // put both operators inside ONE object under the one field key.
  const affordable = await Product.countDocuments({
    price: { $gte: 500, $lt: 2000 },
  });
  show("Products with 500 <= price < 2000 (one key, two operators)", affordable);
  note(
    "Implicit AND handles different fields, and one field with different " +
      "operators. Where it BREAKS is the same key written twice — next section."
  );

  // --------------------------------------------------------------------
  section("2. The silent-overwrite trap — why $and exists");
  // A JavaScript object cannot hold the same key twice. Write it anyway and
  // JS keeps only the LAST one — no error, no warning. MongoDB never even
  // sees your first condition. Watch the key vanish:
  const broken = {
    name: { $regex: /Volt/ }, // condition 1: name contains "Volt"  <- LOST!
    name: { $regex: /Ultrabook/ }, // condition 2 overwrites the key
  };
  show("What the broken filter ACTUALLY contains", JSON.stringify(broken));

  const brokenCount = await Product.countDocuments(broken);
  const secondOnly = await Product.countDocuments({ name: /Ultrabook/ });
  // $and takes an ARRAY of sub-filters — an array happily holds the same
  // field twice, so nothing is lost.
  const correctCount = await Product.countDocuments({
    $and: [{ name: /Volt/ }, { name: /Ultrabook/ }],
  });
  show("Counts", {
    "broken duplicate-key filter": brokenCount,
    "second condition alone": secondOnly,
    "explicit $and (both conditions)": correctCount,
    "broken === second-only?": brokenCount === secondOnly,
  });
  note(
    "The broken filter matched every 'Ultrabook' — the /Volt/ condition was " +
      "discarded by JAVASCRIPT before the query was sent. This is a JS-object " +
      "problem, not a MongoDB one. Rule: same field + same operator twice " +
      "(or two $or clauses — next demo) REQUIRES $and."
  );

  // The same trap with $or: "(cheap OR heavily discounted) AND (in stock OR
  // limited edition)" — two $or keys collide, first one silently dropped.
  const affordability = [{ price: { $lt: 1000 } }, { discountPercent: { $gte: 30 } }];
  const availability = [{ stock: { $gt: 0 } }, { tags: "limited-edition" }];

  const brokenTwoOrs = { $or: affordability, $or: availability }; // first $or LOST
  const naive = await Product.countDocuments(brokenTwoOrs);
  const availabilityOnly = await Product.countDocuments({ $or: availability });
  const correct = await Product.countDocuments({
    $and: [{ $or: affordability }, { $or: availability }],
  });
  show("Two $or clauses", {
    "naive { $or, $or } (first dropped)": naive,
    "availability $or alone": availabilityOnly,
    "correct $and of both $or": correct,
  });

  // --------------------------------------------------------------------
  section("3. $or — at least one condition must match");
  // A real support question: which accounts cannot place orders right now?
  // Either the account is switched off OR it was soft-deleted.
  const blocked = await User.find({
    $or: [{ isActive: false }, { deletedAt: { $ne: null } }],
  });
  show(
    "Users who cannot log in (inactive OR soft-deleted)",
    blocked.map((u) => ({
      name: u.name,
      isActive: u.isActive,
      deletedAt: u.deletedAt,
    }))
  );
  note(
    "$or takes an array of complete sub-filters; a document matches if ANY " +
      "one holds. A doc matching several clauses is still returned ONCE. " +
      "For 'same field equals any of these values', prefer $in (lesson 01) — " +
      "save $or for conditions on DIFFERENT fields, like here."
  );

  // --------------------------------------------------------------------
  section("4. $nor — every condition must FAIL");
  // $nor is the mirror of $or: match documents where NONE of the clauses
  // hold. Great for 'clean list' queries — here: the boring, reliable
  // catalog (no discount games, not out of stock, not discontinued).
  const fullPriceInStock = await Product.countDocuments({
    $nor: [{ discountPercent: { $gt: 0 } }, { stock: 0 }, { isActive: false }],
  });
  show("Full-price, in-stock, active products", fullPriceInStock);

  // CAREFUL: like $ne, $nor treats a MISSING field as a failed condition —
  // which counts toward the match. Users with no age pass '$nor age < 40'!
  const norAge = await User.countDocuments({ $nor: [{ age: { $lt: 40 } }] });
  const gteAge = await User.countDocuments({ age: { $gte: 40 } });
  show("$nor [age < 40] vs age >= 40", {
    "$nor (40+ OR no age at all)": norAge,
    "$gte 40 (only users WITH an age)": gteAge,
  });
  note(
    "The difference between the two counts is exactly the users with no age " +
      "field. 'NOT (age < 40)' and 'age >= 40' are different questions when a " +
      "field can be absent — MongoDB answers the one you literally asked."
  );

  // --------------------------------------------------------------------
  section("5. $not — negates an OPERATOR expression, not a value");
  // $not wraps another operator: { price: { $not: { $gt: 50000 } } } reads
  // 'price is NOT greater than 50000'. Like $nor, it also matches docs
  // where the field is missing — that is the whole reason to use it over
  // simply flipping the comparison.
  const notGte30 = await User.countDocuments({ age: { $not: { $gte: 30 } } });
  const lt30 = await User.countDocuments({ age: { $lt: 30 } });
  show("age $not $gte 30 vs age $lt 30", {
    "$not $gte 30 (under 30 OR no age)": notGte30,
    "$lt 30 (only users WITH an age)": lt30,
  });

  // $not CANNOT wrap a bare value — that is $ne's job. This is invalid and
  // gets rejected (by Mongoose while casting, or by the server as BadValue):
  try {
    await Product.countDocuments({ price: { $not: 500 } });
    show("{ price: { $not: 500 } }", "unexpectedly accepted?!");
  } catch (error) {
    show("{ price: { $not: 500 } } was rejected", {
      name: error.name,
      message: error.message,
    });
  }
  note(
    "Memorize the pairing: 'not equal to a VALUE' -> $ne. 'not matching an " +
      "OPERATOR (or a regex)' -> $not. { field: { $not: { $gt: x } } } and " +
      "{ field: { $not: /^A/ } } are valid; { field: { $not: x } } is not."
  );

  // --------------------------------------------------------------------
  section("6. Choosing the right tool — a cheat sheet in one query");
  // Everything combined: active, non-deleted customers who are EITHER very
  // loyal OR brand new (no login yet), excluding minors-without-known-age
  // pitfalls by requiring age to exist.
  const campaignTargets = await User.find({
    role: "customer", //             implicit AND
    isActive: true, //               implicit AND
    deletedAt: null, //              equality (null matching — lesson 03)
    age: { $exists: true, $gte: 18 }, // two operators, one field
    $or: [
      { loyaltyPoints: { $gte: 4000 } },
      { lastLoginAt: { $exists: false } },
    ],
  });
  show(
    "Marketing campaign targets",
    campaignTargets.map((u) => ({
      name: u.name,
      loyaltyPoints: u.loyaltyPoints,
      lastLoginAt: u.lastLoginAt ?? "(never)",
    }))
  );
  note(
    "Real filters mix all of these freely: top-level keys AND together, one " +
      "$or handles the alternative, and operators stack inside a field. Only " +
      "reach for explicit $and when a key would otherwise repeat."
  );
});
