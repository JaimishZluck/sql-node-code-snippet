/**
 * LESSON 04-crud/03-update — Updating documents
 *
 * The whole update family, and — more importantly — the DIFFERENCES between
 * near-identical methods: `updateOne`/`updateMany` (return counts),
 * `findOneAndUpdate`/`findByIdAndUpdate` (return the DOCUMENT — the old one
 * unless you say `new: true`), why validators are OFF for updates unless you
 * pass `runValidators: true`, and how `replaceOne`/`findOneAndReplace` differ
 * from updates by swapping the ENTIRE document (losing fields you omit).
 *
 * SAFETY: every mutation targets TEMPORARY practice docs created at the top
 * of this lesson (emails `...@lesson.test`, SKU `ZZ-...`). They are removed
 * in a finally-block cleanup, and leftovers from crashed runs are swept
 * first. Seeded data is never modified.
 *
 * Run it with:  npm run lesson 04-crud/03-update
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Category from "../../../models/category.model.js";

const TEMP_EMAIL = /@lesson\.test$/i;
const TEMP_SKU = /^ZZ-/;

/** DESTRUCTIVE — only for practice docs matching the temp markers. */
async function removeTempDocs() {
  const users = await User.deleteMany({ email: TEMP_EMAIL });
  const products = await Product.deleteMany({ sku: TEMP_SKU });
  return {
    tempUsersRemoved: users.deletedCount,
    tempProductsRemoved: products.deletedCount,
  };
}

await runLesson("CRUD 3/4 — Updating documents", async () => {
  section("0. Safety sweep + create the practice docs this lesson will mutate");
  show("Leftovers removed (0 is normal)", await removeTempDocs());

  try {
    // Three practice users and one practice product — everything below
    // mutates ONLY these. (We keep a handle on Vikram's original document
    // to compare _ids after replacing him in section 6.)
    const [, vikram] = await User.create([
      {
        name: "Uma Updatedemo",
        email: "updater.one@lesson.test",
        age: 31,
        loyaltyPoints: 500,
        address: { street: "8 FC Road", city: "Pune", state: "Maharashtra", zip: "411004" },
      },
      {
        name: "Vikram Replacedemo",
        email: "updater.two@lesson.test",
        age: 42,
        loyaltyPoints: 900,
        address: { street: "3 Ring Road", city: "Surat", state: "Gujarat", zip: "395002" },
        lastLoginAt: new Date(),
      },
      { name: "Wafa Swapdemo", email: "updater.three@lesson.test", age: 27 },
    ]);
    const laptops = await Category.findOne({ slug: "laptops" });
    if (!laptops) throw new Error("Seeded data missing — run: npm run db:seed");
    const zzStand = await Product.create({
      name: "ZZ Practice Laptop Stand",
      sku: "ZZ-UPD-0001",
      price: 2499,
      discountPercent: 10,
      stock: 25,
      category: laptops._id,
      specs: { brand: "Volt", color: "silver" },
    });
    show("Practice docs ready", {
      users: ["updater.one", "updater.two", "updater.three"].map((u) => `${u}@lesson.test`),
      product: zzStand.sku,
    });

    // ------------------------------------------------------------------
    section("1. updateOne(filter, update) — fire the change, get back COUNTS");
    // updateOne finds the first match and applies atomic operators ($set,
    // $inc, ...) ON THE SERVER. It does NOT return the document — only a
    // result summary.
    const first = await User.updateOne(
      { email: "updater.one@lesson.test" },
      { $set: { loyaltyPoints: 750 } }
    );
    show("updateOne result", first);

    // Run the IDENTICAL update again: the filter still matches (matched: 1)
    // but the value is already 750, so nothing changes (modified: 0).
    const second = await User.updateOne(
      { email: "updater.one@lesson.test" },
      { $set: { loyaltyPoints: 750 } }
    );
    show("The very same update, run again", second);
    note(
      "matchedCount = docs the filter found; modifiedCount = docs actually " +
        "CHANGED. matched:1 modified:0 means 'found it, it already looked like " +
        "that' — not a failure! Also note what is missing: the document. If " +
        "you need the doc afterwards, use findOneAndUpdate instead of an " +
        "extra find()."
    );
    note(
      "Mongoose convenience: passing a bare object like { loyaltyPoints: 750 } " +
        "is silently wrapped into { $set: ... }. Write the $set yourself — " +
        "explicit is safer, and the raw MongoDB shell would reject the bare form."
    );

    // ------------------------------------------------------------------
    section("2. updateMany(filter, update) — the same change for EVERY match");
    // A '+100 points' promotion for all three practice users at once. $inc
    // is atomic per document, executed by MongoDB itself.
    const promo = await User.updateMany({ email: TEMP_EMAIL }, { $inc: { loyaltyPoints: 100 } });
    show("updateMany result", promo);
    note(
      "Expect matchedCount: 3, modifiedCount: 3. The filter is the ONLY " +
        "thing standing between you and updating the whole collection — " +
        "updateMany({}, ...) would hit every document. Scope it carefully."
    );

    // ------------------------------------------------------------------
    section("3. findOneAndUpdate — update AND get the document (old by default!)");
    // One atomic server-side command (findAndModify) that updates the doc
    // and returns it. THE trap: by default you get the document as it was
    // BEFORE the update.
    const beforeDoc = await User.findOneAndUpdate(
      { email: "updater.one@lesson.test" },
      { $inc: { loyaltyPoints: 50 } }
    );
    show("Returned WITHOUT new:true", {
      name: beforeDoc.name,
      loyaltyPoints: beforeDoc.loyaltyPoints, // 850 — the PRE-update value
    });

    const afterDoc = await User.findOneAndUpdate(
      { email: "updater.one@lesson.test" },
      { $inc: { loyaltyPoints: 50 } },
      { new: true } // "give me the doc AFTER applying the update"
    );
    show("Returned WITH new:true", {
      name: afterDoc.name,
      loyaltyPoints: afterDoc.loyaltyPoints, // 950 — the POST-update value
    });
    note(
      "Uma's points went 750 -> 850 -> 900 -> 950 across sections 1-3, but " +
        "the first call above PRINTED 850 (her value before its own $inc). " +
        "Returning the old doc is deliberate — 'claim' patterns need to see " +
        "what they claimed — but 95% of app code wants { new: true }. " +
        "No match? findOneAndUpdate returns null (no error)."
    );

    // ------------------------------------------------------------------
    section("4. findByIdAndUpdate — the same thing, keyed by _id");
    // findByIdAndUpdate(id, update, opts) === findOneAndUpdate({_id: id}, ...).
    // Real store move: sell one unit — an atomic decrement, immune to the
    // read-then-save race condition (module 07 goes deep on this).
    const afterSale = await Product.findByIdAndUpdate(
      zzStand._id,
      { $inc: { stock: -1 } },
      { new: true }
    );
    show("Sold one unit", { sku: afterSale.sku, stock: afterSale.stock }); // 24
    note(
      "Because $inc runs on the SERVER, two simultaneous sales can never " +
        "both read stock=25 and both write 24 — MongoDB applies each " +
        "decrement atomically. Doing get -> doc.stock-- -> save() instead " +
        "would have exactly that overselling race."
    );

    // ------------------------------------------------------------------
    section("5. Update validators are OFF by default — runValidators: true");
    // The schema says age must be >= 13. Watch an update ignore that rule:
    const sneaky = await User.updateOne(
      { email: "updater.three@lesson.test" },
      { $set: { age: 5 } } // violates min: 13 — and succeeds!
    );
    show("Invalid update WITHOUT runValidators", sneaky);
    const wafaNow = await User.findOne({ email: "updater.three@lesson.test" });
    show("Wafa's age in the database is now", wafaNow.age); // 5 — bad data!

    // Same invalid update, now WITH validators switched on:
    try {
      await User.updateOne(
        { email: "updater.three@lesson.test" },
        { $set: { age: 4 } },
        { runValidators: true }
      );
    } catch (error) {
      show("With runValidators: true", error.errors?.age?.message ?? error.message);
    }

    // Repair the practice doc (it gets deleted in cleanup anyway, but tidy
    // data makes the remaining sections read sanely).
    await User.updateOne({ email: "updater.three@lesson.test" }, { $set: { age: 27 } });
    note(
      "WHY are they off? save() validates the WHOLE document it holds in " +
        "memory. An update is just instructions sent to the server — Mongoose " +
        "never sees the full doc, so it can only validate the PATHS in your " +
        "update, and only if you ask (runValidators: true). Caveats: only " +
        "$set/$inc/$push-style paths are checked, and custom validators that " +
        "use `this` need { runValidators: true, context: 'query' }."
    );

    // ------------------------------------------------------------------
    section("6. replaceOne — swap the WHOLE document (omitted fields are LOST)");
    // The replacement is a full document body, not operators. Note
    // everything we are NOT sending: age, address, lastLoginAt...
    const replaceResult = await User.replaceOne(
      { email: "updater.two@lesson.test" },
      { name: "Vikram Rebuilt", email: "updater.two@lesson.test" }
    );
    show("replaceOne result (counts, like updateOne)", replaceResult);

    const vikramNow = await User.findOne({ email: "updater.two@lesson.test" });
    show("Vikram AFTER the replace", vikramNow.toObject());
    show("Same _id as before?", vikramNow._id.equals(vikram._id)); // true
    note(
      "Vikram's age, address, and lastLoginAt are GONE — replace does not " +
        "merge, it swaps the entire body and keeps only _id. Any other fields " +
        "you can still see (role, isActive, timestamps...) were re-added by " +
        "Mongoose from schema defaults while casting the replacement — " +
        "factory settings, NOT Vikram's old data. This is why PATCH-style " +
        "endpoints must use $set updates; replace is for 'overwrite " +
        "everything on purpose' flows only."
    );

    // A replacement must be a plain document — atomic operators are illegal.
    try {
      await User.replaceOne(
        { email: "updater.two@lesson.test" },
        { $set: { name: "Nope" } } // operators do not belong in a replacement
      );
    } catch (error) {
      show("Replacement containing $ operators throws", error.message);
    }

    // ------------------------------------------------------------------
    section("7. findOneAndReplace — replace AND get a document back");
    // Same swap semantics as replaceOne, but it returns a doc — and just
    // like findOneAndUpdate, the OLD one unless you pass new:true.
    const beforeSwap = await User.findOneAndReplace(
      { email: "updater.three@lesson.test" },
      { name: "Wafa 2.0", email: "updater.three@lesson.test" }
    );
    show("Returned doc (the OLD Wafa — age still visible)", {
      name: beforeSwap.name,
      age: beforeSwap.age, // 27 — from the doc that no longer exists in this form
    });

    const afterSwap = await User.findOneAndReplace(
      { email: "updater.three@lesson.test" },
      { name: "Wafa 3.0", email: "updater.three@lesson.test" },
      { new: true }
    );
    show("Returned doc with new:true (the replacement)", {
      name: afterSwap.name,
      age: afterSwap.age, // undefined — the replacement never had an age
    });
    note(
      "The old-unless-new:true rule is identical across findOneAndUpdate, " +
        "findByIdAndUpdate, and findOneAndReplace. The returned OLD doc is a " +
        "snapshot — handy as an audit trail of what you overwrote."
    );

    // ------------------------------------------------------------------
    section("8. Bonus: upsert — update it, or create it if it is missing");
    // upsert = UPdate + inSERT. No match -> MongoDB builds a new doc from
    // the filter's equality fields + $set + $setOnInsert (+ schema defaults,
    // which Mongoose applies on upserted docs by default).
    const upserted = await User.findOneAndUpdate(
      { email: "upserted.user@lesson.test" }, // no such user -> insert path
      { $set: { name: "Upsert Uma" }, $setOnInsert: { age: 33 } },
      { upsert: true, new: true }
    );
    show("Upserted document", {
      name: upserted.name,
      email: upserted.email, // came from the FILTER
      age: upserted.age, // came from $setOnInsert (insert path only)
      role: upserted.role, // came from schema defaults
    });
    note(
      "$setOnInsert fields apply ONLY when the upsert inserts — on a later " +
        "matching run they are ignored. Classic real-world use: 'create the " +
        "cart if this user has none, otherwise update it' in one atomic call. " +
        "(This upserted doc carries the @lesson.test marker, so cleanup " +
        "removes it too.)"
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup — DESTRUCTIVE, but only for @lesson.test / ZZ- practice docs");
    show("Removed", await removeTempDocs());
    note("The database is back to exactly its seeded state.");
  }
});
