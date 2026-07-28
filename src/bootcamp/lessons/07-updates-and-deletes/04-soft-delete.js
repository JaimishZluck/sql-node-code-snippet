/**
 * LESSON 07-updates-and-deletes/04-soft-delete — Soft delete vs hard delete
 *
 * Module 04 taught HOW to delete. This lesson asks the production question:
 * SHOULD you? We hard-delete a temp user and watch his order's reference
 * dangle; then soft-delete another (the deletedAt pattern the User schema
 * was built for), see her excluded by { deletedAt: null } filters while her
 * data and references stay intact, hit the unique-index gotcha, restore her
 * with one update, and confront soft delete's tax: EVERY query must
 * remember the filter — plus how real apps centralize it, and the cases
 * where hard delete is genuinely the right call.
 *
 * SAFETY: mutations target only TEMPORARY docs created below (emails
 * `...@lesson.test`, orderNumbers `ZZZ-...`). One seeded product is read —
 * never modified. Leftovers from crashed runs are swept at the start, and
 * a finally-block cleans everything at the end.
 *
 * Run it with:  npm run lesson 07-updates-and-deletes/04-soft-delete
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

const TEMP_EMAIL = /@lesson\.test$/i;
const TEMP_ORDER = /^ZZZ-/;
const SOFT_EMAIL = "henna.soft@lesson.test";
const HARD_EMAIL = "iqbal.hard@lesson.test";

/** DESTRUCTIVE — only for practice docs matching the temp markers. */
async function removeTempDocs() {
  const users = await User.deleteMany({ email: TEMP_EMAIL });
  const orders = await Order.deleteMany({ orderNumber: TEMP_ORDER });
  return {
    tempUsersRemoved: users.deletedCount,
    tempOrdersRemoved: orders.deletedCount,
  };
}

await runLesson("Updates & Deletes 4/4 — Soft delete vs hard delete", async () => {
  section("0. Safety sweep + create the practice docs this lesson will mutate");
  show("Leftovers removed (0 is normal)", await removeTempDocs());

  try {
    const [henna, iqbal] = await User.create([
      { name: "Henna Softdelete", email: SOFT_EMAIL, age: 31 },
      { name: "Iqbal Harddelete", email: HARD_EMAIL, age: 45 },
    ]);
    // A seeded product is referenced READ-ONLY for realistic order lines
    // (the snapshot fields copy its current name/price — nothing is written
    // to the product itself).
    const anyProduct = await Product.findOne({ isActive: true });
    if (!anyProduct) throw new Error("Seeded data missing — run: npm run db:seed");
    const line = {
      product: anyProduct._id,
      productName: anyProduct.name,
      unitPrice: anyProduct.price,
      quantity: 1,
      subtotal: anyProduct.price,
    };
    await Order.create([
      { orderNumber: "ZZZ-800001", user: iqbal._id, items: [line], totalAmount: line.subtotal, status: "delivered" },
      { orderNumber: "ZZZ-800002", user: henna._id, items: [line], totalAmount: line.subtotal, status: "delivered" },
    ]);
    show("Practice docs ready", {
      users: [SOFT_EMAIL, HARD_EMAIL],
      orders: ["ZZZ-800001", "ZZZ-800002"],
    });

    // ------------------------------------------------------------------
    section("1. Hard delete — and the dangling reference it leaves behind");
    // DESTRUCTIVE (temp doc): findOneAndDelete gives us one last look at
    // the document as it disappears forever.
    const gone = await User.findOneAndDelete({ email: HARD_EMAIL });
    show("Iqbal, at the moment of deletion", { _id: gone._id, name: gone.name });

    // His order still stores his ObjectId — but that id now points at nothing.
    const orphanOrder = await Order.findOne({ orderNumber: "ZZZ-800001" }).populate(
      "user",
      "name email"
    );
    show("His delivered order, populated afterwards", {
      orderNumber: orphanOrder.orderNumber,
      user: orphanOrder.user, // null — the reference dangles
      totalAmount: orphanOrder.totalAmount,
    });
    note(
      "user: null. MongoDB has NO foreign-key constraints — nothing warned " +
        "us that an order still referenced Iqbal, and nothing ever will. " +
        "From now on every populate(), every $lookup, every 'orders per " +
        "customer' report silently loses this order's owner. And that is " +
        "only problem #1. #2: no undo — the data is gone. #3: no audit " +
        "trail — 'who placed this order?' is now unanswerable, which " +
        "support, finance, and fraud teams will not appreciate."
    );

    // ------------------------------------------------------------------
    section("2. Soft delete — an UPDATE wearing a delete costume");
    // 'Deleting' Henna = stamping WHEN she was deleted. Nothing is removed.
    const softDeleted = await User.findOneAndUpdate(
      { email: SOFT_EMAIL },
      { $set: { deletedAt: new Date() } },
      { new: true }
    );
    show("Henna after soft delete", {
      name: softDeleted.name,
      deletedAt: softDeleted.deletedAt,
      isDeleted: softDeleted.isDeleted, // virtual: deletedAt !== null
    });
    note(
      "To MongoDB this was a plain $set — soft delete is a CONVENTION, not " +
        "a database feature. isDeleted is the User schema's Mongoose " +
        "VIRTUAL (computed in Node from deletedAt, never stored). Storing a " +
        "TIMESTAMP instead of a boolean flag costs nothing extra and " +
        "answers 'when was it deleted?' for free — audits and retention " +
        "purge jobs need exactly that."
    );

    // ------------------------------------------------------------------
    section("3. Alive-only queries exclude her — but she exists, and references hold");
    // The filter every 'normal' query must carry: deletedAt: null.
    const loginLookup = await User.findOne({ email: SOFT_EMAIL, deletedAt: null });
    show("Login-style lookup ({ email, deletedAt: null })", loginLookup); // null — 'account not found'
    show("Raw lookup (no filter)", (await User.findOne({ email: SOFT_EMAIL }))?.name); // still found

    // Her order's reference resolves perfectly — nothing dangles.
    const intactOrder = await Order.findOne({ orderNumber: "ZZZ-800002" }).populate(
      "user",
      "name deletedAt"
    );
    show("Her order, populated", {
      orderNumber: intactOrder.orderNumber,
      user: intactOrder.user, // the soft-deleted user document — not null
    });

    // Read-only peek at seeded data: the seeder soft-deleted ~10% of users.
    show(
      "Soft-deleted users already in the seeded data",
      await User.countDocuments({ deletedAt: { $ne: null } })
    );
    note(
      "The document is present; only queries that ADD { deletedAt: null } " +
        "treat her as gone. Orders, reviews, and reports keep working " +
        "because the ObjectId they store still resolves. This is the core " +
        "trade: hard delete forgets everything and breaks references; soft " +
        "delete remembers everything — and asks every query to be " +
        "disciplined in return."
    );

    // ------------------------------------------------------------------
    section("4. The unique-index gotcha — 'deleted' emails still occupy the index");
    // Henna is 'deleted'... so can a NEW user sign up with her email?
    try {
      await User.create({ name: "New Henna", email: SOFT_EMAIL });
      show("Unexpected: duplicate signup was accepted", "(should not happen)");
    } catch (error) {
      show("Sign-up with a soft-deleted user's email", {
        code: error.code, // 11000 — duplicate key, thrown by MongoDB itself
        message: error.message,
      });
    }
    note(
      "E11000: the unique index on email covers ALL documents — MongoDB has " +
        "no idea what deletedAt means. Real apps solve this with a PARTIAL " +
        "unique index that only indexes alive docs:  schema.index({ email: " +
        "1 }, { unique: true, partialFilterExpression: { deletedAt: null } " +
        "})  — or by rewriting the email at delete time " +
        "('deleted.1732535000.henna@...'). We never edit models inside a " +
        "lesson, so here the signup (correctly) fails."
    );

    // ------------------------------------------------------------------
    section("5. Restore — the superpower hard delete cannot offer");
    // The conditional filter makes restore IDEMPOTENT: restoring an
    // already-alive user matches nothing and is a harmless no-op.
    const restored = await User.findOneAndUpdate(
      { email: SOFT_EMAIL, deletedAt: { $ne: null } },
      { $set: { deletedAt: null } },
      { new: true }
    );
    show("Henna restored", {
      name: restored.name,
      deletedAt: restored.deletedAt, // null again
      isDeleted: restored.isDeleted, // false
    });
    show(
      "Login-style lookup works again",
      (await User.findOne({ email: SOFT_EMAIL, deletedAt: null }))?.name
    );
    note(
      "Undo was ONE update — account recovery, 'restore from trash', " +
        "oops-protection for admin tools. After a HARD delete, 'undo' means " +
        "locating last night's backup, restoring it somewhere, and " +
        "hand-copying one document back — if the backup even contains it."
    );

    // ------------------------------------------------------------------
    section("6. The tax — EVERY query must remember the filter");
    // The same business question, asked two ways — on seeded data, read-only:
    const naiveCount = await User.countDocuments({ role: "customer" });
    const disciplinedCount = await User.countDocuments({ role: "customer", deletedAt: null });
    show("countDocuments({ role: 'customer' })", naiveCount);
    show("countDocuments({ role: 'customer', deletedAt: null })", disciplinedCount);
    note(
      `The naive count includes ${naiveCount - disciplinedCount} soft-deleted ` +
        "customer(s). One forgotten filter and deleted users receive " +
        "marketing emails, show up in exports, or inflate the investor " +
        "dashboard. Hand-sprinkling { deletedAt: null } across 200 queries " +
        "WILL eventually miss one — so real apps centralize it."
    );

    // Centralizing, level 1: one helper function everyone calls.
    const findAliveUsers = (filter = {}) => User.find({ ...filter, deletedAt: null });
    show(
      "Helper in action — alive admins only",
      (await findAliveUsers({ role: "admin" })).map((u) => u.name)
    );
    note(
      "Level 2 is schema middleware that injects the filter into every find " +
        "automatically (module 13):  userSchema.pre(/^find/, function () { " +
        "this.where({ deletedAt: null }); })  — plus an explicit opt-out " +
        "for admin screens that MUST see deleted docs. Level 3 is a plugin " +
        "(e.g. mongoose-delete) adding delete()/restore() methods and the " +
        "filters for you. Pair with module 12: a PARTIAL index over alive " +
        "documents keeps these hot queries fast and the index small."
    );

    // ------------------------------------------------------------------
    section("7. When HARD delete is the right call");
    note(
      "(1) The law says so: erasure requests under GDPR or India's DPDP " +
        "Act mean personal data must actually cease to exist — a deletedAt " +
        "flag does not satisfy a 'right to erasure'. (2) Worthless-by-design " +
        "data: expired sessions, OTPs, abandoned carts, stale caches — " +
        "often removed automatically by a TTL index (module 12). (3) Cost " +
        "and privacy hygiene: keeping everything forever is storage you pay " +
        "for and liability you carry."
    );
    note(
      "The common HYBRID: soft delete on user action (instant, reversible), " +
        "then a scheduled purge job hard-deletes documents whose deletedAt " +
        "is older than the retention window (30-90 days). The cleanup block " +
        "below IS this lesson's purge job — watch it hard-delete the " +
        "practice docs for real."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup (the 'purge job') — DESTRUCTIVE, but only for @lesson.test / ZZZ- docs");
    show("Removed", await removeTempDocs());
    note("The database is back to exactly its seeded state.");
  }
});
