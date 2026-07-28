/**
 * LESSON 07-updates-and-deletes/03-atomic-updates — Atomicity & the race you must fear
 *
 * MongoDB's most important write guarantee: ONE document + ONE update
 * command = ATOMIC, always, with no transaction needed. This lesson makes
 * that concrete by actually RUNNING the bug it prevents: two concurrent
 * checkouts that both read stock=1, both decide "in stock!", and both sell
 * the last unit (the read-modify-write race). Then the fix — putting the
 * check INSIDE the atomic step with a conditional findOneAndUpdate — and
 * the same "claim pattern" applied to paying an order exactly once.
 *
 * SAFETY: every mutation targets TEMPORARY practice docs created below
 * (emails `...@lesson.test`, SKU `ZZ-...`, orderNumber `ZZZ-...`).
 * Leftovers from crashed runs are swept at the start, and a finally-block
 * cleans everything at the end. Seeded data is never modified.
 *
 * Run it with:  npm run lesson 07-updates-and-deletes/03-atomic-updates
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import Category from "../../../models/category.model.js";

const TEMP_EMAIL = /@lesson\.test$/i;
const TEMP_SKU = /^ZZ-/;
const TEMP_ORDER = /^ZZZ-/;
const RACE_SKU = "ZZ-RACE-0001";
const ORDER_NO = "ZZZ-750001";

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

await runLesson("Updates & Deletes 3/4 — Atomic updates vs the race condition", async () => {
  section("0. Safety sweep + create the practice docs this lesson will mutate");
  show("Leftovers removed (0 is normal)", await removeTempDocs());

  try {
    const laptops = await Category.findOne({ slug: "laptops" });
    if (!laptops) throw new Error("Seeded data missing — run: npm run db:seed");

    const nia = await User.create({ name: "Nia Racedemo", email: "race@lesson.test" });
    const limited = await Product.create({
      name: "ZZ Limited Edition Laptop",
      sku: RACE_SKU,
      price: 149999,
      stock: 40,
      category: laptops._id,
      specs: { brand: "Volt", color: "silver" },
    });
    await Order.create({
      orderNumber: ORDER_NO,
      user: nia._id,
      items: [
        {
          product: limited._id,
          productName: limited.name,
          unitPrice: limited.price,
          quantity: 1,
          subtotal: limited.price,
        },
      ],
      totalAmount: limited.price,
      status: "pending", // waiting for payment — section 5 races to pay it
      payment: { method: "upi", paidAt: null },
    });
    show("Practice docs ready", { product: RACE_SKU, order: ORDER_NO });

    // ------------------------------------------------------------------
    section("1. One command, many changes — all of it atomic");
    // Flash sale prep: three different changes, ONE update command.
    const flash = await Product.findOneAndUpdate(
      { sku: RACE_SKU },
      { $inc: { stock: -15 }, $set: { discountPercent: 20, "specs.color": "midnight" } },
      { new: true }
    );
    show("After one multi-operator update", {
      stock: flash.stock, // 25
      discountPercent: flash.discountPercent, // 20
      color: flash.specs.color, // "midnight"
    });
    note(
      "All three changes applied as ONE indivisible step on the server. No " +
        "other query — however unluckily timed — can ever observe this " +
        "document with the new stock but the old discount; and had any part " +
        "failed, NONE of it would have applied. The guarantee is per " +
        "DOCUMENT per COMMAND: two separate updateOne calls are two atomic " +
        "steps with a visible gap between them."
    );

    // ------------------------------------------------------------------
    section("2. The read-modify-write RACE — two buyers, one unit, both 'win'");
    // Stage it: flash sale, exactly ONE unit left.
    await Product.updateOne({ sku: RACE_SKU }, { $set: { stock: 1 } });

    // Simulate two API requests landing at the same moment. Each runs the
    // naive checkout logic: (1) READ the product, (2) CHECK stock in
    // JavaScript, (3) decrement in memory, (4) SAVE. Promise.all makes
    // both requests READ before either one WRITES — exactly the unlucky
    // interleaving that eventually happens in production.
    const [buyerA, buyerB] = await Promise.all([
      Product.findOne({ sku: RACE_SKU }),
      Product.findOne({ sku: RACE_SKU }),
    ]);
    show("What each buyer's code read", { buyerA: buyerA.stock, buyerB: buyerB.stock }); // 1 and 1

    const naiveCheckout = async (label, copy) => {
      if (copy.stock >= 1) {
        // The check passed... against a value that may already be stale.
        copy.stock -= 1; // 1 - 1 = 0, computed in THIS copy's memory
        await copy.save(); // sends { $set: { stock: 0 } } — a blind overwrite
        return `${label}: order CONFIRMED (read 1, wrote 0)`;
      }
      return `${label}: rejected — out of stock`;
    };
    show("Checkout outcomes", [
      await naiveCheckout("Buyer A", buyerA),
      await naiveCheckout("Buyer B", buyerB),
    ]);
    show("Stock in the database now", (await Product.findOne({ sku: RACE_SKU })).stock); // 0
    note(
      "TWO confirmations for ONE unit — we oversold. Each save() was " +
        "perfectly atomic; the bug lives in the GAP between the read and " +
        "the write, where the other buyer's write happened. Both copies " +
        "computed 1-1=0 from stale reads and blindly wrote 0. This bug " +
        "hides on your laptop (requests rarely collide in dev) and explodes " +
        "on launch day — the worst kind. Note: Product disables the __v " +
        "version key; Order keeps it, and module 14 shows how Mongoose can " +
        "use __v to at least DETECT stale saves (optimistic concurrency)."
    );

    // ------------------------------------------------------------------
    section("3. The FIX — put check and change into ONE atomic command");
    await Product.updateOne({ sku: RACE_SKU }, { $set: { stock: 1 } }); // restock the single unit

    const qty = 1;
    // filter + update travel to the server as ONE findAndModify command.
    // MongoDB evaluates 'is stock >= 1?' and applies the $inc under a
    // per-document write lock — nothing can sneak in between. This is the
    // database version of 'compare-and-set'.
    const atomicCheckout = () =>
      Product.findOneAndUpdate(
        { sku: RACE_SKU, stock: { $gte: qty } }, // the CHECK, now inside the atomic step
        { $inc: { stock: -qty } }, // the CHANGE, as a delta — not a blind overwrite
        { new: true }
      );
    const [buyerC, buyerD] = await Promise.all([atomicCheckout(), atomicCheckout()]);
    show("Buyer C", buyerC ? `CONFIRMED — stock now ${buyerC.stock}` : "rejected — out of stock");
    show("Buyer D", buyerD ? `CONFIRMED — stock now ${buyerD.stock}` : "rejected — out of stock");
    show("Exactly one winner?", [buyerC, buyerD].filter(Boolean).length === 1); // true — every run
    note(
      "MongoDB serialized the two writes to this document. The first found " +
        "stock 1 >= 1 and decremented to 0. When the second ran, the filter " +
        "matched NOTHING — so it changed nothing and returned null. null is " +
        "not an error here: it is your signal to answer 'out of stock'. " +
        "WHICH buyer wins depends on arrival order; THAT exactly one wins " +
        "does not. No transaction, no lock in your code — the filter did it."
    );

    // ------------------------------------------------------------------
    section("4. Why the FILTER is the guard — a bare $inc oversells too");
    await Product.updateOne({ sku: RACE_SKU }, { $set: { stock: 1 } }); // one unit again
    // Two blind decrements, NO condition this time:
    await Promise.all([
      Product.updateOne({ sku: RACE_SKU }, { $inc: { stock: -1 } }),
      Product.updateOne({ sku: RACE_SKU }, { $inc: { stock: -1 } }),
    ]);
    show("Stock after two unguarded $inc -1", (await Product.findOne({ sku: RACE_SKU })).stock); // -1 (!)
    note(
      "Each $inc was atomic, yet stock is now -1: ATOMIC does not mean " +
        "VALIDATED. The schema's min: 0 lives in Mongoose, and update " +
        "validators never run for $inc — the server just does the math. The " +
        "condition { stock: { $gte: qty } } from section 3 is what encodes " +
        "the business rule 'never sell below zero' — inside the atomic " +
        "step, where no other request can squeeze between check and change."
    );
    // Repair the practice product so its data reads sanely (temp doc anyway).
    await Product.updateOne({ sku: RACE_SKU }, { $set: { stock: 5 } });

    // ------------------------------------------------------------------
    section("5. The same trick everywhere — the CLAIM pattern (pay exactly once)");
    // A user double-clicks Pay, or a payment webhook is delivered twice —
    // two handlers race to mark the SAME order paid. The guard: only an
    // order still in 'pending' can be claimed.
    const confirmPayment = () =>
      Order.findOneAndUpdate(
        { orderNumber: ORDER_NO, status: "pending" }, // claimable only once
        { $set: { status: "paid", "payment.paidAt": new Date() } },
        { new: true }
      );
    const [firstClick, secondClick] = await Promise.all([confirmPayment(), confirmPayment()]);
    show("Handler 1", firstClick ? `marked ${firstClick.status}, charging customer once` : "no-op — already paid");
    show("Handler 2", secondClick ? `marked ${secondClick.status}, charging customer once` : "no-op — already paid");
    note(
      "One handler flipped pending -> paid; the other found no 'pending' " +
        "order left to claim and did nothing — the customer is charged " +
        "exactly once. The identical shape powers job queues (pending -> " +
        "processing, stamping a workerId so two workers never grab one " +
        "job), single-use coupons, and seat reservations. Any 'only one " +
        "request may do this' rule wants a conditional findOneAndUpdate — " +
        "never an if-statement in JavaScript."
    );

    // ------------------------------------------------------------------
    section("6. Where single-document atomicity ENDS");
    note(
      "The guarantee stops at the document boundary. updateMany applies " +
        "each document's change atomically but is NOT all-or-nothing as a " +
        "group — a crash mid-way leaves some documents updated and others " +
        "not. And 'move 500 loyalty points from user A to user B' is TWO " +
        "documents: two atomic steps with a gap an outage can fall into. " +
        "Cross-document all-or-nothing needs TRANSACTIONS — module 14, " +
        "together with Order's __v optimistic-concurrency version key."
    );
    note(
      "This boundary is also WHY MongoDB modeling (module 09) embeds " +
        "related data: our Order keeps its line items INSIDE the order " +
        "document, so lesson 02's 'discount every line AND fix the total' " +
        "was ONE atomic command. The same data split across a separate " +
        "order_items collection would need a transaction for every such " +
        "edit. Good schema design buys you atomicity for free."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup — DESTRUCTIVE, but only for @lesson.test / ZZ- / ZZZ- practice docs");
    show("Removed", await removeTempDocs());
    note("The database is back to exactly its seeded state.");
  }
});
