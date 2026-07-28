/**
 * LESSON 07-updates-and-deletes/02-array-update-operators — Array update operators
 *
 * Arrays are where documents beat rows — and where updates get interesting.
 * This lesson covers growing arrays ($push with $each/$position/$slice,
 * $addToSet), shrinking them ($pop, $pull, $pullAll), and the three
 * positional operators that edit elements IN PLACE: `$` (first match),
 * `$[elem]` with arrayFilters (all matching), and `$[]` (all elements).
 * Along the way we keep a real-world invariant honest: an order's line
 * subtotals and totalAmount must stay in sync with every array edit.
 *
 * SAFETY: every mutation targets TEMPORARY practice docs created below
 * (emails `...@lesson.test`, SKUs `ZZ-...`, orderNumbers `ZZZ-...`).
 * Leftovers from crashed runs are swept at the start, and a finally-block
 * cleans everything at the end. Seeded data is never modified.
 *
 * Run it with:  npm run lesson 07-updates-and-deletes/02-array-update-operators
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import Category from "../../../models/category.model.js";

const TEMP_EMAIL = /@lesson\.test$/i;
const TEMP_SKU = /^ZZ-/;
const TEMP_ORDER = /^ZZZ-/;
const ARR_EMAIL = "arrays@lesson.test";
const ORDER_NO = "ZZZ-700001";
const PRICE_A = 500; // earbuds unit price (snapshot)
const PRICE_B = 1200; // headset unit price (snapshot)

/** DESTRUCTIVE — only for practice docs matching the temp markers. */
async function removeTempDocs() {
  const users = await User.deleteMany({ email: TEMP_EMAIL });
  const products = await Product.deleteMany({ sku: TEMP_SKU });
  const orders = await Order.deleteMany({ orderNumber: TEMP_ORDER });
  return {
    tempUsersRemoved: users.deletedCount,
    tempProductsRemoved: products.deletedCount,
    tempOrdersRemoved: orders.deletedCount,
  };
}

/** Compact view of order line items for readable output. */
const lines = (order) =>
  order.items.map((i) => ({
    productName: i.productName,
    unitPrice: i.unitPrice,
    quantity: i.quantity,
    subtotal: i.subtotal,
  }));

await runLesson("Updates & Deletes 2/4 — Array update operators", async () => {
  section("0. Safety sweep + create the practice docs this lesson will mutate");
  show("Leftovers removed (0 is normal)", await removeTempDocs());

  try {
    const headphones = await Category.findOne({ slug: "headphones" });
    if (!headphones) throw new Error("Seeded data missing — run: npm run db:seed");

    const ria = await User.create({
      name: "Ria Arraydemo",
      email: ARR_EMAIL,
      interests: ["reading"],
    });
    const [earbuds, headset] = await Product.create([
      {
        name: "ZZ Practice Earbuds",
        sku: "ZZ-ARR-0001",
        price: PRICE_A,
        stock: 60,
        category: headphones._id,
        tags: ["new-arrival", "budget", "sale"],
      },
      {
        name: "ZZ Practice Headset",
        sku: "ZZ-ARR-0002",
        price: PRICE_B,
        stock: 40,
        category: headphones._id,
        tags: ["premium", "wireless", "sale", "gift-idea"],
      },
    ]);
    // The order deliberately has TWO lines for the same earbuds product
    // (one gift-wrapped as its own line) — that lets us see exactly WHICH
    // element each positional operator touches.
    await Order.create({
      orderNumber: ORDER_NO,
      user: ria._id,
      items: [
        { product: earbuds._id, productName: earbuds.name, unitPrice: PRICE_A, quantity: 1, subtotal: PRICE_A * 1 },
        { product: headset._id, productName: headset.name, unitPrice: PRICE_B, quantity: 2, subtotal: PRICE_B * 2 },
        { product: earbuds._id, productName: `${earbuds.name} (gift wrap)`, unitPrice: PRICE_A, quantity: 3, subtotal: PRICE_A * 3 },
      ],
      totalAmount: PRICE_A * 1 + PRICE_B * 2 + PRICE_A * 3, // 4400
    });
    show("Practice docs ready", { user: ARR_EMAIL, products: ["ZZ-ARR-0001", "ZZ-ARR-0002"], order: ORDER_NO });

    // ------------------------------------------------------------------
    section("1. $push appends blindly — $addToSet keeps the array a SET");
    // $push appends to the end, no questions asked — including duplicates.
    await User.updateOne({ email: ARR_EMAIL }, { $push: { interests: "cooking" } });
    await User.updateOne({ email: ARR_EMAIL }, { $push: { interests: "cooking" } });
    let interests = (await User.findOne({ email: ARR_EMAIL }, "interests")).interests;
    show('interests after pushing "cooking" TWICE', interests); // [reading, cooking, cooking]

    // $addToSet only adds a value that is not already in the array.
    const dupTry = await User.updateOne(
      { email: ARR_EMAIL },
      { $addToSet: { interests: "cooking" } }
    );
    show('$addToSet "cooking" (already present)', dupTry); // matched 1, modified 0

    // $addToSet with $each: several candidates, each individually deduped.
    await User.updateOne(
      { email: ARR_EMAIL },
      { $addToSet: { interests: { $each: ["yoga", "fitness", "reading"] } } }
    );
    interests = (await User.findOne({ email: ARR_EMAIL }, "interests")).interests;
    show("interests after $addToSet $each", interests);
    // [reading, cooking, cooking, yoga, fitness] — "reading" was skipped
    note(
      "Two lessons: (1) $addToSet PREVENTS new duplicates but never cleans " +
        "existing ones — the double 'cooking' is still there. (2) 'already " +
        "present' compares the WHOLE value exactly; for embedded objects, " +
        "{a:1,b:2} and {b:2,a:1} count as DIFFERENT (BSON key order " +
        "matters). Use $push when repeats are meaningful (a log of events); " +
        "$addToSet when the array is a set (tags, follower ids, interests)."
    );

    // ------------------------------------------------------------------
    section("2. $each + $position + $slice — the capped 'recent items' pattern");
    // Newest-first list capped at 5: insert at the FRONT ($position: 0),
    // then keep only the first 5 elements ($slice: 5). One atomic command —
    // the array can never grow past 5, so the document cannot bloat.
    await User.updateOne(
      { email: ARR_EMAIL },
      { $push: { interests: { $each: ["gaming", "music"], $position: 0, $slice: 5 } } }
    );
    interests = (await User.findOne({ email: ARR_EMAIL }, "interests")).interests;
    show("interests (newest first, capped at 5)", interests);
    // [gaming, music, reading, cooking, cooking] — yoga & fitness fell off the end
    note(
      "This exact shape powers 'recently viewed products', 'last 10 " +
        "notifications', activity feeds. $slice: 5 keeps the FIRST five; " +
        "$slice: -5 keeps the LAST five (use that when appending to the " +
        "end). Gotchas: $position and $slice only work INSIDE $push and " +
        "REQUIRE $each — even one value must be wrapped: { $each: [v] }. " +
        "$each also fixes plain multi-push: $push: { interests: [1,2] } " +
        "would push the ARRAY ITSELF as a single nested element."
    );

    // ------------------------------------------------------------------
    section("3. $pop — chop one element off either end");
    await User.updateOne({ email: ARR_EMAIL }, { $pop: { interests: 1 } }); // 1 = last
    await User.updateOne({ email: ARR_EMAIL }, { $pop: { interests: -1 } }); // -1 = first
    interests = (await User.findOne({ email: ARR_EMAIL }, "interests")).interests;
    show("after $pop 1 (last) then $pop -1 (first)", interests); // [music, reading, cooking]
    note(
      "Unlike JavaScript's array.pop(), $pop does NOT return the removed " +
        "element — updateOne only reports counts. Need to know what fell " +
        "off? findOneAndUpdate WITHOUT { new: true } hands you the " +
        "PRE-update document, so you can read the element you just removed."
    );

    // ------------------------------------------------------------------
    section("4. $pull and $pullAll — remove BY VALUE or BY CONDITION");
    // $pull with a plain value removes EVERY element equal to it.
    await Product.updateOne({ sku: "ZZ-ARR-0001" }, { $pull: { tags: "sale" } });
    show(
      "earbuds tags after $pull 'sale'",
      (await Product.findOne({ sku: "ZZ-ARR-0001" }, "tags")).tags // [new-arrival, budget]
    );

    // $pull with a CONDITION — remove every blacklisted tag, across BOTH
    // practice products, in one updateMany. The condition is a per-element
    // query: any element matching it is pulled.
    const blacklist = await Product.updateMany(
      { sku: /^ZZ-ARR-/ },
      { $pull: { tags: { $in: ["budget", "gift-idea"] } } }
    );
    show("updateMany + conditional $pull result", blacklist); // matched 2, modified 2

    // $pullAll — a literal list of exact values. Nothing is interpreted:
    // operators inside $pullAll are treated as plain (weird) values.
    await Product.updateOne(
      { sku: "ZZ-ARR-0002" },
      { $pullAll: { tags: ["premium", "wireless"] } }
    );
    show(
      "headset tags after $pullAll",
      (await Product.findOne({ sku: "ZZ-ARR-0002" }, "tags")).tags // [sale]
    );
    note(
      "$pull's argument is a QUERY evaluated against each element ($in, " +
        "$gte, regexes all work); $pullAll's is a plain value list. Both " +
        "remove ALL matching elements, and removing a value that is not " +
        "there is a quiet no-op (modifiedCount 0) — check counts if you " +
        "care. Conditional $pull on SUBDOCUMENT arrays is the finale below."
    );

    // ------------------------------------------------------------------
    section("5. Positional $ — update the FIRST array element the filter matched");
    // The rule first: `$` only means something if the FILTER queried the
    // array. Without that, the server cannot know which position you meant:
    try {
      await Order.updateOne({ orderNumber: ORDER_NO }, { $set: { "items.$.quantity": 9 } });
      show("Unexpected: the invalid update was accepted", "(should not happen)");
    } catch (error) {
      show("$ without the array in the filter -> server error", error.message);
    }

    // Correct: the filter locates an element; $ stands for ITS index.
    // NOTE we update quantity AND subtotal together — line items carry
    // snapshot prices, so a quantity change must keep the line's math true.
    await Order.updateOne(
      { orderNumber: ORDER_NO, "items.product": earbuds._id },
      { $set: { "items.$.quantity": 2, "items.$.subtotal": PRICE_A * 2 } }
    );
    const afterFirstMatch = await Order.findOne({ orderNumber: ORDER_NO }, "items totalAmount");
    show("items after the 'items.$' update", lines(afterFirstMatch));
    note(
      "BOTH lines reference the earbuds product, but only the FIRST " +
        "matching element changed (quantity 1 -> 2). The gift-wrap line " +
        "still says 3. `$` literally means 'the index of the first element " +
        "matched by the filter' — one element, per document, per update. " +
        `Also: totalAmount (${afterFirstMatch.totalAmount}) is now WRONG — ` +
        "a denormalized total does not maintain itself. We fix it in " +
        "section 7."
    );

    // ------------------------------------------------------------------
    section("6. arrayFilters + $[elem] — update EVERY element matching a condition");
    // Promotion: '+1 free unit on every earbuds line'. $[line] is a NAMED
    // placeholder; the arrayFilters OPTION defines which elements it means.
    await Order.updateOne(
      { orderNumber: ORDER_NO },
      { $inc: { "items.$[line].quantity": 1 } },
      { arrayFilters: [{ "line.product": earbuds._id }] }
    );
    const afterArrayFilters = await Order.findOne({ orderNumber: ORDER_NO }, "items");
    show("items after $[line] $inc", lines(afterArrayFilters));
    note(
      "BOTH earbuds lines got +1 (2 -> 3 and 3 -> 4); the headset line was " +
        "untouched. Differences from `$`: the condition lives in the " +
        "OPTIONS (the filter need not mention the array at all), it can " +
        "update MANY elements (or zero), and several conditions can be " +
        "combined. Placeholder names must start with a lowercase letter, " +
        "and every placeholder used in a path needs a matching arrayFilters " +
        "entry — or the server rejects the command. Subtotals are stale " +
        "again, on purpose. Fix incoming."
    );

    // ------------------------------------------------------------------
    section("7. Recomputing derived values — when load-modify-save earns its keep");
    // Per-element math (subtotal = unitPrice * quantity) is clumsy with
    // plain operators. For an admin-style fix-up, loading the document,
    // recomputing in JavaScript, and saving is the pragmatic tool:
    const doc = await Order.findOne({ orderNumber: ORDER_NO });
    for (const line of doc.items) line.subtotal = line.unitPrice * line.quantity;
    doc.totalAmount = doc.items.reduce((sum, line) => sum + line.subtotal, 0);
    await doc.save();
    show("lines + total after recompute", {
      items: lines(doc),
      totalAmount: doc.totalAmount, // 1500 + 2400 + 2000 = 5900
    });
    note(
      "The trade-off: between our findOne and save(), ANOTHER process could " +
        "have edited the order — load-modify-save is a read-modify-write " +
        "race (lesson 03 dissects it). Fine for one-off admin repairs; on " +
        "hot concurrent paths prefer operators, a conditional filter, or an " +
        "aggregation-pipeline update ( updateOne(filter, [{ $set: ... }]) ) " +
        "that recomputes on the server. Note save() sent only the CHANGED " +
        "paths — not the whole document."
    );

    // ------------------------------------------------------------------
    section("8. $[] — the ALL-positional operator: every element at once");
    // Order-wide 10% goodwill discount. ONE command multiplies every line's
    // unitPrice and subtotal AND the totalAmount by 0.9 — and because a
    // single-document update is atomic, no reader can ever see a
    // half-discounted order.
    await Order.updateOne(
      { orderNumber: ORDER_NO },
      { $mul: { "items.$[].unitPrice": 0.9, "items.$[].subtotal": 0.9, totalAmount: 0.9 } }
    );
    const discounted = await Order.findOne({ orderNumber: ORDER_NO }, "items totalAmount");
    show("after the $[] discount", { items: lines(discounted), totalAmount: discounted.totalAmount });
    note(
      "$[] needs no arrayFilters entry — it simply means 'every element'. " +
        "Expect totalAmount around 5310 — possibly with floating-point dust " +
        "(5310.000000000001): the usual 64-bit float story, and the reason " +
        "production money lives in integer paise/cents or Decimal128."
    );

    // ------------------------------------------------------------------
    section("9. Conditional $pull on subdocuments — cancel every bulk line");
    // Remove every line whose quantity is 3 or more. The condition object
    // is matched field-by-field against EACH subdocument element.
    await Order.updateOne(
      { orderNumber: ORDER_NO },
      { $pull: { items: { quantity: { $gte: 3 } } } }
    );
    const trimmed = await Order.findOne({ orderNumber: ORDER_NO }, "items totalAmount");
    show("items after conditional $pull", lines(trimmed));

    // One last honesty pass for the denormalized total.
    const newTotal = trimmed.items.reduce((sum, line) => sum + line.subtotal, 0);
    await Order.updateOne({ orderNumber: ORDER_NO }, { $set: { totalAmount: newTotal } });
    show("totalAmount after resync", newTotal);
    note(
      "Both earbuds lines (quantities 3 and 4) vanished; only the headset " +
        "line (quantity 2) survived. Notice the pattern of this whole " +
        "lesson: every array edit that touches money forced us to re-sync " +
        "subtotal/totalAmount. That is the running cost of denormalized " +
        "totals — and why the atomic habits of lesson 03 matter so much."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup — DESTRUCTIVE, but only for @lesson.test / ZZ- / ZZZ- practice docs");
    show("Removed", await removeTempDocs());
    note("The database is back to exactly its seeded state.");
  }
});
