/**
 * LESSON 08-arrays-and-nested-documents/02-arrays-of-objects — Arrays: primitives, objects, positional updates
 *
 * Arrays are the document model's superpower and its sharpest edge. This
 * lesson covers the full daily toolkit: adding/removing PRIMITIVE values
 * (user.interests) with $push/$addToSet/$pull/$pop, then ARRAYS OF OBJECTS
 * (order.items) — querying them, updating one element with the positional
 * `$`, all elements with `$[]`, some elements with `$[id]` + arrayFilters,
 * and adding/removing whole items. It closes with Mongoose sub-schemas and
 * the question every schema author faces: when do subdocuments get _ids,
 * and what are those _ids FOR?
 *
 * SAFETY: mutations target only TEMPORARY docs — a practice user
 * (`@lesson.test`), a practice order (`ZZZ-...`), and a `tmp_wishlists`
 * collection. All are swept at the start and removed in a finally-block
 * cleanup. Seeded data is only ever read.
 *
 * Run it with:  npm run lesson 08-arrays-and-nested-documents/02-arrays-of-objects
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

const TEMP_EMAIL = /@lesson\.test$/i;
const TEMP_ORDER = /^ZZZ-/;
const ORDER_NO = "ZZZ-ARR-0001";

// ---------------------------------------------------------------------
// A lesson-local model bound to a TEMP collection (tmp_wishlists) — used
// in section 9 to demonstrate subdocument _ids without touching any real
// model. Note what is MISSING on wishlistEntrySchema: { _id: false }.
// That's the point — by DEFAULT every subdocument in an array gets its
// own ObjectId _id.
const wishlistEntrySchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  addedAt: { type: Date, default: Date.now },
});

const tmpWishlistSchema = new mongoose.Schema(
  { name: { type: String, required: true }, entries: [wishlistEntrySchema] },
  { collection: "tmp_wishlists", versionKey: false }
);

const TmpWishlist =
  mongoose.models.TmpWishlist || mongoose.model("TmpWishlist", tmpWishlistSchema);

/** DESTRUCTIVE — but only for docs carrying the temp markers / tmp_ collection. */
async function removeTempDocs() {
  const users = await User.deleteMany({ email: TEMP_EMAIL });
  const orders = await Order.deleteMany({ orderNumber: TEMP_ORDER });
  let wishlists = "did not exist";
  try {
    await mongoose.connection.dropCollection("tmp_wishlists");
    wishlists = "dropped";
  } catch {
    // NamespaceNotFound — the collection wasn't there; nothing to do.
  }
  return {
    tempUsersRemoved: users.deletedCount,
    tempOrdersRemoved: orders.deletedCount,
    tmp_wishlists: wishlists,
  };
}

/** Compact view of an order's line items for readable output. */
const itemsView = (order) =>
  order.items.map((it) => ({
    name: it.productName,
    unit: it.unitPrice,
    qty: it.quantity,
    subtotal: it.subtotal,
  }));

await runLesson("Arrays & nested docs 2/3 — Arrays of primitives & objects", async () => {
  section("0. Safety sweep + create the practice docs this lesson mutates");
  show("Leftovers removed (0/did-not-exist is normal)", await removeTempDocs());

  try {
    const rohan = await User.create({
      name: "Rohan Arraydemo",
      email: "arrays.one@lesson.test",
      age: 26,
      interests: ["reading", "music"],
    });

    // Four real seeded products — their _ids/names/prices become SNAPSHOTS
    // inside our practice order's items (see the Order model header for why
    // orders copy instead of only referencing).
    const products = await Product.find({ isActive: true }).sort({ price: -1 }).limit(4);
    if (products.length < 4) throw new Error("Seeded data missing — run: npm run db:seed");
    const [pA, pB, pC, pD] = products;

    const order = await Order.create({
      orderNumber: ORDER_NO,
      user: rohan._id,
      items: [
        { product: pA._id, productName: pA.name, unitPrice: pA.price, quantity: 1, subtotal: pA.price },
        { product: pB._id, productName: pB.name, unitPrice: pB.price, quantity: 2, subtotal: pB.price * 2 },
        { product: pC._id, productName: pC.name, unitPrice: pC.price, quantity: 1, subtotal: pC.price },
      ],
      totalAmount: pA.price + pB.price * 2 + pC.price,
      status: "pending",
    });
    show("Practice order ready", { orderNumber: order.orderNumber, items: itemsView(order), total: order.totalAmount });

    // ------------------------------------------------------------------
    section("1. Primitives: adding — $push vs $addToSet");
    // $push APPENDS, duplicates and all. Run it twice with the same value
    // and the array holds the value twice.
    await User.updateOne({ email: rohan.email }, { $push: { interests: "cricket" } });
    await User.updateOne({ email: rohan.email }, { $push: { interests: "cricket" } });
    let u = await User.findOne({ email: rohan.email });
    show("After $push 'cricket' twice", u.interests); // ...cricket, cricket

    // $addToSet adds ONLY if the value is not already present — the server
    // checks, atomically. Adding 'cricket' again changes nothing:
    const setResult = await User.updateOne(
      { email: rohan.email },
      { $addToSet: { interests: "cricket" } }
    );
    show("$addToSet 'cricket' result", setResult); // matched 1, modified 0

    // Several values at once need $each ($addToSet: { interests: [..] }
    // would try to add the ARRAY ITSELF as one element!):
    await User.updateOne(
      { email: rohan.email },
      { $addToSet: { interests: { $each: ["yoga", "reading"] } } }
    );
    u = await User.findOne({ email: rohan.email });
    show("After $addToSet $each ['yoga', 'reading']", u.interests);
    note(
      "'yoga' was added, 'reading' skipped (already there) — per value, not " +
        "all-or-nothing. WHY $addToSet matters: the read-check-write " +
        "alternative (load doc, includes()?, push, save) has a race window — " +
        "two simultaneous requests both check, both push, and you get a " +
        "duplicate anyway. $addToSet makes the check-and-insert one atomic " +
        "server-side step. Note modifiedCount: 0 on the no-op — matched but " +
        "nothing to change, same pattern as module 04."
    );

    // ------------------------------------------------------------------
    section("2. Primitives: removing — $pull and $pop");
    // $pull removes EVERY element matching the value/condition — which
    // conveniently wipes both duplicate 'cricket' entries at once:
    await User.updateOne({ email: rohan.email }, { $pull: { interests: "cricket" } });
    u = await User.findOne({ email: rohan.email });
    show("After $pull 'cricket' (both copies gone)", u.interests);

    // $pull also takes a CONDITION, not just a literal value:
    await User.updateOne(
      { email: rohan.email },
      { $pull: { interests: { $in: ["music", "yoga"] } } }
    );
    u = await User.findOne({ email: rohan.email });
    show("After $pull { $in: ['music', 'yoga'] }", u.interests); // ["reading"]

    // $pop removes from an END: 1 = last element, -1 = first. No filter —
    // pure position.
    await User.updateOne({ email: rohan.email }, { $pop: { interests: 1 } });
    u = await User.findOne({ email: rohan.email });
    show("After $pop: 1 (dropped the last element)", u.interests); // []
    note(
      "$pull = 'remove all matching', $pop = 'remove first/last'. There is " +
        "NO operator for 'remove the element at index 3' — array positions " +
        "shift, so MongoDB pushes you toward value- or condition-based " +
        "removal. (The old two-step workaround — $unset the slot to null, " +
        "then $pull nulls — is not atomic; avoid designs that need it.)"
    );

    // ------------------------------------------------------------------
    section("3. The document way — MongooseArray methods + change tracking");
    // Mongoose arrays carry helper methods (push, addToSet, pull...) that
    // RECORD the operation instead of rewriting the whole array on save().
    const rohanDoc = await User.findOne({ email: rohan.email });
    rohanDoc.interests.addToSet("gaming", "coding");
    show("getChanges() — what save() is about to send", rohanDoc.getChanges());
    await rohanDoc.save();
    show("Interests after save()", (await User.findOne({ email: rohan.email })).interests);
    note(
      "getChanges() shows a targeted atomic array operator, NOT " +
        "$set: { interests: [entire array] } — Mongoose queues array ops and " +
        "replays them on save. That keeps writes small and merge-friendly. " +
        "Prefer the direct updateOne operators when you don't otherwise need " +
        "the loaded document; use doc methods when you're already holding it."
    );

    // ------------------------------------------------------------------
    section("4. Arrays of OBJECTS: querying (containment + $elemMatch recap)");
    // Dot notation walks INTO array elements: this asks "does ANY line item
    // reference this product?" — the everyday 'which orders contain product
    // X' question, on live seeded data:
    const ordersWithA = await Order.countDocuments({ "items.product": pA._id });
    show(`Seeded+temp orders containing '${pA.name}'`, ordersWithA);

    // Two conditions about the SAME element need $elemMatch (module 05
    // lesson 04 proves why — separate dot conditions may match across
    // DIFFERENT elements):
    const bigLines = await Order.countDocuments({
      items: { $elemMatch: { quantity: { $gte: 2 }, subtotal: { $gt: 100000 } } },
    });
    show("Orders where ONE line item has qty >= 2 AND subtotal > 100000", bigLines);
    note(
      "Read-only recap — the querying rules from module 05 apply unchanged " +
        "to arrays of objects. New in THIS lesson is the update side, where " +
        "the question becomes: once the filter finds the order, WHICH array " +
        "element does the update touch?"
    );

    // ------------------------------------------------------------------
    section("5. Positional `$` — update THE element the filter matched");
    // Scenario: the customer bumps the first product from 1 unit to 2.
    // `items.$` means "the FIRST array element that matched the filter" —
    // which is why the filter MUST include a condition on the array field.
    // Note we maintain the derived fields ourselves: subtotal and
    // totalAmount don't recalculate magically — they're plain stored
    // numbers, and keeping them consistent is OUR job.
    await Order.updateOne(
      { orderNumber: ORDER_NO, "items.product": pA._id },
      {
        $set: { "items.$.quantity": 2, "items.$.subtotal": pA.price * 2 },
        $inc: { totalAmount: pA.price }, // one more unit's worth
      }
    );
    let o = await Order.findOne({ orderNumber: ORDER_NO });
    show("After bumping item A to qty 2 via items.$", { items: itemsView(o), total: o.totalAmount });
    note(
      "Rules of `$`: (1) the filter must query the array ('items.product' " +
        "here), or MongoDB cannot know which element you mean; (2) it " +
        "resolves to the FIRST matching element only — for 'all matches' " +
        "you want $[] or arrayFilters below; (3) one atomic command updated " +
        "two nested fields AND the order total together — no other request " +
        "can observe the order half-updated."
    );

    // ------------------------------------------------------------------
    section("6. All-positional `$[]` — update EVERY element");
    // Scenario: 10% off the whole order. `items.$[]` targets every element;
    // $mul scales unitPrice and subtotal by 0.9 — and totalAmount too, so
    // all three derived layers stay consistent in ONE atomic command.
    await Order.updateOne(
      { orderNumber: ORDER_NO },
      {
        $mul: {
          "items.$[].unitPrice": 0.9,
          "items.$[].subtotal": 0.9,
          totalAmount: 0.9,
        },
      }
    );
    o = await Order.findOne({ orderNumber: ORDER_NO });
    show("After 10% off everything via items.$[]", { items: itemsView(o), total: o.totalAmount });
    note(
      "Every line item changed, no filter on elements needed. Observe the " +
        "decimals: JS/BSON doubles make 53991.9-style prices — real money " +
        "code stores integer paise/cents or Decimal128 (module 01 covered " +
        "BSON types). $[] shines for order-wide repricing, bulk flag flips, " +
        "and data migrations across embedded arrays."
    );

    // ------------------------------------------------------------------
    section("7. Filtered positional `$[id]` + arrayFilters — update SOME elements");
    // Scenario: 'buy 2 get 1 free' — every line item with qty >= 2 gets one
    // free unit (quantity +1, price unchanged). `q` is an arbitrary name
    // you invent; arrayFilters defines which elements `$[q]` stands for.
    await Order.updateOne(
      { orderNumber: ORDER_NO },
      { $inc: { "items.$[q].quantity": 1 } },
      { arrayFilters: [{ "q.quantity": { $gte: 2 } }] }
    );
    o = await Order.findOne({ orderNumber: ORDER_NO });
    show("After buy-2-get-1-free via arrayFilters", { items: itemsView(o), total: o.totalAmount });
    note(
      "Both qty-2 items became qty 3; the single-unit item was untouched. " +
        "Subtotals deliberately did NOT change — the extra units are free, " +
        "and (again) derived numbers only move when YOU move them. " +
        "arrayFilters is the modern general tool: unlike `$` it doesn't need " +
        "the array in the filter, updates ALL matching elements, and (next " +
        "lesson) chains through NESTED arrays. `$` remains handy shorthand " +
        "for 'the one element my filter found'."
    );

    // ------------------------------------------------------------------
    section("8. Adding & removing WHOLE items — $push $each/$position, $pull");
    // Add a 4th product at the TOP of the list ($position needs $each, even
    // for one element), and keep the total honest in the same command:
    await Order.updateOne(
      { orderNumber: ORDER_NO },
      {
        $push: {
          items: {
            $each: [
              { product: pD._id, productName: pD.name, unitPrice: pD.price, quantity: 1, subtotal: pD.price },
            ],
            $position: 0,
          },
        },
        $inc: { totalAmount: pD.price },
      }
    );
    o = await Order.findOne({ orderNumber: ORDER_NO });
    show("After pushing a 4th item at position 0", { items: itemsView(o), total: o.totalAmount });

    // Remove it again: $pull with an OBJECT CONDITION removes every element
    // whose fields match it (partial match — this is element-level
    // filtering, NOT the exact-object-equality trap from queries):
    await Order.updateOne(
      { orderNumber: ORDER_NO },
      { $pull: { items: { product: pD._id } }, $inc: { totalAmount: -pD.price } }
    );
    o = await Order.findOne({ orderNumber: ORDER_NO });
    show("After $pull { product: pD._id }", { items: itemsView(o), total: o.totalAmount });
    note(
      "Two gotchas: (1) $pull removes ALL elements matching the condition — " +
        "had the product appeared on two lines, both would vanish; (2) " +
        "update operators skip Mongoose validators by default, so even the " +
        "Order schema's 'at least one item' rule would NOT stop a $pull that " +
        "empties the array. Guard business rules in code (or " +
        "runValidators: true where it applies)."
    );

    // ------------------------------------------------------------------
    section("9. Sub-schemas & subdocument _ids — the tmp_wishlists demo");
    // Order items are declared { _id: false } (never addressed one by one).
    // Our wishlist entries KEEP the default — watch every entry get its own
    // ObjectId, for free:
    const wl = await TmpWishlist.create({
      name: "Rohan's practice wishlist",
      entries: [
        { label: "for diwali", product: pA._id },
        { label: "maybe later", product: pB._id },
      ],
    });
    show(
      "Each entry has its own _id",
      wl.entries.map((e) => ({ _id: e._id, label: e.label }))
    );

    // WHY those _ids exist: they are STABLE HANDLES. An API can return
    // entry._id to the frontend, and edit/delete requests can target that
    // exact element forever — regardless of how the array is reordered.
    const targetId = wl.entries[0]._id;
    show("DocumentArray.id() lookup (Mongoose helper)", wl.entries.id(targetId).label);

    // Edit exactly that element (positional $ keyed by _id — THE standard
    // 'edit one subdocument' pattern in REST APIs):
    await TmpWishlist.updateOne(
      { _id: wl._id, "entries._id": targetId },
      { $set: { "entries.$.label": "buy this week" } }
    );
    // Delete exactly that element:
    await TmpWishlist.updateOne({ _id: wl._id }, { $pull: { entries: { _id: targetId } } });
    let wlNow = await TmpWishlist.findById(wl._id);
    show(
      "After editing then $pull-ing by _id",
      wlNow.entries.map((e) => ({ _id: e._id, label: e.label }))
    );

    // Bonus: the CAPPED ARRAY pattern — push with $slice keeps only the
    // last N elements ('recently viewed' lists, activity trails):
    await TmpWishlist.updateOne(
      { _id: wl._id },
      {
        $push: {
          entries: {
            $each: [
              { label: "idea 1", product: pB._id },
              { label: "idea 2", product: pC._id },
              { label: "idea 3", product: pD._id },
              { label: "idea 4", product: pA._id },
            ],
            $slice: -3, // after the push, keep ONLY the last 3 entries
          },
        },
      }
    );
    wlNow = await TmpWishlist.findById(wl._id);
    show(
      "Capped to the last 3 via $push + $slice",
      wlNow.entries.map((e) => e.label)
    );
    note(
      "Decision rule for subdocument _ids: will anything OUTSIDE the parent " +
        "document ever point at one element (an edit URL, a delete button, a " +
        "log line)? Keep the _id. Are elements only ever read/replaced with " +
        "their parent (order line items, address)? { _id: false } saves 12 " +
        "bytes per element and output noise. And $slice-on-push is how you " +
        "stop an embedded array from growing forever — remember it for " +
        "lesson 03, where unbounded growth is villain number one."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup — DESTRUCTIVE, but only for temp docs + tmp_wishlists");
    show("Removed", await removeTempDocs());
    note("The database is back to exactly its seeded state.");
  }
});
