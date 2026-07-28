/**
 * LESSON 05-querying/04-array-queries — Containment, $all, $size, $elemMatch
 *
 * Arrays are where MongoDB filters get genuinely different from SQL. This
 * lesson covers the friendly parts (a plain equality quietly means
 * "contains", $all, $size) and then builds a PROOF of the one behavior
 * that bites everyone: conditions written with dot notation may be
 * satisfied by DIFFERENT array elements, while $elemMatch forces them to
 * hit ONE element together.
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 05-querying/04-array-queries
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

await runLesson("Querying 4/6 — Array queries", async () => {
  // --------------------------------------------------------------------
  section("1. Containment — equality on an array field means 'contains'");
  // { tags: "wireless" } does NOT mean tags EQUALS "wireless". For array
  // fields MongoDB tests the value against the field AND against each
  // element — so this reads "the tags array CONTAINS 'wireless'".
  const wireless = await Product.find({ tags: "wireless" }).limit(5);
  show(
    "Products whose tags contain 'wireless' (first 5)",
    wireless.map((p) => ({ name: p.name, tags: p.tags }))
  );

  const yogis = await User.countDocuments({ interests: "yoga" });
  show("Users interested in yoga", yogis);
  note(
    "This is the 'multikey' behavior — the same reason a multikey index on " +
      "tags can index every ELEMENT (module 12). One value per query, ANY " +
      "element may match. Simple and fast — until you need two conditions..."
  );

  // --------------------------------------------------------------------
  section("2. The exact-match pitfall — passing an ARRAY as the value");
  // Give an array as the value and the meaning flips to EXACT equality:
  // same elements, same ORDER, nothing extra. Almost never what you want.
  const exactOne = await Product.countDocuments({ tags: ["wireless"] });
  const contains = await Product.countDocuments({ tags: "wireless" });
  show("tags: ['wireless'] (exact) vs tags: 'wireless' (contains)", {
    "exact array [wireless] — only single-tag docs": exactOne,
    "containment — any doc with the tag": contains,
  });
  note(
    "The exact form only matches products whose ENTIRE tags array is " +
      "['wireless'] — one element, that value. And ['a','b'] would not match " +
      "['b','a']: element ORDER counts in exact equality. Beginners hit this " +
      "when forwarding a query-string array straight into the filter."
  );

  // --------------------------------------------------------------------
  section("3. $all — 'contains ALL of these' (vs $in's 'any of these')");
  // $all is order-independent containment of every listed value — really
  // an AND of single containments (the $and of { tags: 'premium' } and
  // { tags: 'wireless' }, in one operator).
  const counts = {
    "$all [premium, wireless] (must have BOTH)": await Product.countDocuments({
      tags: { $all: ["premium", "wireless"] },
    }),
    "$in [premium, wireless] (EITHER is enough)": await Product.countDocuments({
      tags: { $in: ["premium", "wireless"] },
    }),
  };
  show("$all vs $in on the same tag list", counts);
  note(
    "$all <= $in always: demanding both tags can only shrink the result. " +
      "Order never matters for $all — unlike the exact-array match above."
  );

  // --------------------------------------------------------------------
  section("4. $size — exact length only (and the range workarounds)");
  // $size matches an EXACT array length. It accepts no ranges — a design
  // gap you must know the workarounds for.
  const sizes = {
    "users with NO interests ($size: 0)": await User.countDocuments({ interests: { $size: 0 } }),
    "orders with exactly 4 line items ($size: 4)": await Order.countDocuments({ items: { $size: 4 } }),
  };
  show("$size checks", sizes);

  // Workaround 1 for 'at least N': ask if index N-1 exists. Arrays are
  // zero-indexed, so 'items.2' existing means there are 3 or more items.
  const atLeast3 = await Order.countDocuments({ "items.2": { $exists: true } });
  // Workaround 2: $expr evaluates an aggregation expression per document —
  // flexible, but it cannot use a normal index (it must examine every doc).
  const atLeast3Expr = await Order.countDocuments({
    $expr: { $gte: [{ $size: "$items" }, 3] },
  });
  show("Orders with 3+ items — two workarounds, same answer", {
    "'items.2' $exists (positional trick)": atLeast3,
    "$expr with aggregation $size": atLeast3Expr,
  });
  note(
    "{ items: { $size: { $gte: 3 } } } is INVALID — $size takes a plain " +
      "number only. Apps that filter by length a lot usually store a " +
      "separate itemCount field, kept in sync on write, and index THAT."
  );

  // --------------------------------------------------------------------
  section("5. Arrays of documents — dot notation reaches into every element");
  // orders.items is an array of embedded docs. 'items.quantity' tests the
  // quantity of EVERY element; any single element matching is enough.
  const hasTriple = await Order.countDocuments({ "items.quantity": 3 });
  show("Orders containing at least one quantity-3 line", hasTriple);

  // --------------------------------------------------------------------
  section("6. PROOF — dot notation matches ACROSS elements, $elemMatch within ONE");
  // The question we THINK we are asking: "orders where someone bought 2
  // units of an expensive (>50,000) product". Two honest-looking filters:
  //
  //   A) { "items.quantity": 2, "items.unitPrice": { $gt: 50000 } }
  //   B) { items: { $elemMatch: { quantity: 2, unitPrice: { $gt: 50000 } } } }
  //
  // A only requires SOME element with quantity 2 and SOME element (possibly
  // a DIFFERENT one!) priced over 50,000. B requires ONE element satisfying
  // both. Let's fetch both sets and inspect the difference.
  const PRICE = 50000;
  const dotMatches = await Order.find({
    "items.quantity": 2,
    "items.unitPrice": { $gt: PRICE },
  });
  const elemMatches = await Order.find({
    items: { $elemMatch: { quantity: 2, unitPrice: { $gt: PRICE } } },
  });
  show("Result sizes", {
    "A: dot notation (conditions may split across items)": dotMatches.length,
    "B: $elemMatch (both conditions on ONE item)": elemMatches.length,
  });

  // Every B-order is also an A-order (one element satisfying both trivially
  // satisfies each separately) — so A minus B is exactly the FALSE
  // POSITIVES of the dot-notation version. Find one and dissect it:
  const elemMatchNumbers = new Set(elemMatches.map((o) => o.orderNumber));
  const crossOnly = dotMatches.filter((o) => !elemMatchNumbers.has(o.orderNumber));
  show("Orders matched by A but NOT by B (cross-element matches)", crossOnly.length);

  if (crossOnly.length > 0) {
    const suspect = crossOnly[0];
    // Annotate each line item: which condition does it satisfy? If the
    // order were a true match, some row would show BOTH flags true.
    const dissection = suspect.items.map((item) => ({
      product: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      "qty === 2?": item.quantity === 2,
      "price > 50000?": item.unitPrice > PRICE,
    }));
    show(`Dissecting ${suspect.orderNumber}`, dissection);
    const anyRowHasBoth = suspect.items.some(
      (item) => item.quantity === 2 && item.unitPrice > PRICE
    );
    show("Does ANY single line satisfy both conditions?", anyRowHasBoth);
    note(
      "There it is: one line contributes 'quantity 2', a DIFFERENT line " +
        "contributes 'price > 50,000', and no line has both — yet filter A " +
        "matched the order. Each dot-notation condition independently asks " +
        "'does ANY element satisfy me?'. $elemMatch pins all its conditions " +
        "to a single element, which is what the business question meant."
    );
  } else {
    note(
      "This particular seed produced no cross-element-only orders (rare but " +
        "possible). The rule still stands: A asks each condition separately " +
        "against ANY element; B binds them to one element. Re-seed and rerun " +
        "to see a live counterexample."
    );
  }

  // --------------------------------------------------------------------
  section("7. When $elemMatch is overkill — and when it is not");
  // ONE condition never splits across elements, so $elemMatch adds nothing:
  const plainDot = await Order.countDocuments({ "items.quantity": 3 });
  const wrapped = await Order.countDocuments({
    items: { $elemMatch: { quantity: 3 } },
  });
  show("Single condition — dot vs $elemMatch (identical)", {
    "dot notation": plainDot,
    "$elemMatch": wrapped,
  });
  note(
    "Rule of thumb: TWO OR MORE conditions that must hold for the SAME " +
      "element -> $elemMatch. One condition -> plain dot notation. Primitive " +
      "arrays split the same way: scores [95, 40] matches " +
      "{ scores: { $gte: 80, $lt: 90 } } — 95 passes $gte, 40 passes $lt, no " +
      "single score is in the band! { scores: { $elemMatch: { $gte: 80, " +
      "$lt: 90 } } } demands one number inside the band."
  );
});
