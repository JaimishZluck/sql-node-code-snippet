/**
 * LESSON 08-arrays-and-nested-documents/01-embedded-documents — Embedded documents
 *
 * A document field can hold a whole object: `user.address`, `product.specs`,
 * `order.payment`. This lesson is about LIVING with those embedded objects
 * day-to-day: reading them safely, filtering on them, and — the heart of it —
 * the difference between updating ONE nested field ($set on a dot path) and
 * replacing the WHOLE sub-object (which silently throws away every field you
 * did not mention). It also shows the two kinds of "nested object" Mongoose
 * has (sub-schema subdocument vs plain nested path) — they look identical in
 * the database but behave differently in Node.js.
 *
 * SAFETY: every mutation targets TEMPORARY practice users (emails ending
 * `@lesson.test`), created at the top and deleted in a finally-block cleanup.
 * Seeded data is only ever read.
 *
 * Run it with:  npm run lesson 08-arrays-and-nested-documents/01-embedded-documents
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";

const TEMP_EMAIL = /@lesson\.test$/i;

/** DESTRUCTIVE — but only for practice users carrying the @lesson.test marker. */
async function removeTempUsers() {
  const res = await User.deleteMany({ email: TEMP_EMAIL });
  return { tempUsersRemoved: res.deletedCount };
}

await runLesson("Arrays & nested docs 1/3 — Embedded documents", async () => {
  section("0. Safety sweep + create the practice users this lesson mutates");
  show("Leftovers removed (0 is normal)", await removeTempUsers());

  try {
    // Two practice users: Meera has a complete address, Tarun has NONE —
    // we need both shapes to demonstrate every behavior below.
    const [meera, tarun] = await User.create([
      {
        name: "Meera Nestdemo",
        email: "embedded.one@lesson.test",
        age: 29,
        address: {
          street: "14 MG Road",
          city: "Bengaluru",
          state: "Karnataka",
          zip: "560001",
        },
      },
      { name: "Tarun Nestdemo", email: "embedded.two@lesson.test", age: 35 },
    ]);
    show("Practice users ready", {
      meera: { email: meera.email, address: meera.address?.toObject() },
      tarun: { email: tarun.email, address: tarun.address }, // undefined
    });

    // ------------------------------------------------------------------
    section("1. Reading embedded documents — and surviving the missing ones");
    // Reading a nested field is plain JavaScript property access. The catch:
    // ~15% of seeded users have NO address at all (MongoDB documents are not
    // rows — a field can simply not exist). `user.address.city` on such a
    // user throws "Cannot read properties of undefined". Optional chaining
    // (?.) is the everyday defense.
    const someUsers = await User.find({ deletedAt: null }).limit(5);
    show(
      "First 5 active users — note ?. handles the address-less ones",
      someUsers.map((u) => ({
        name: u.name,
        city: u.address?.city ?? "(no address on file)",
      }))
    );

    const noAddressCount = await User.countDocuments({ address: { $exists: false } });
    show("Seeded users with NO address field at all", noAddressCount);
    note(
      "That count is server-side: { $exists: false } asks MongoDB which " +
        "documents lack the field entirely. In app code, ALWAYS read nested " +
        "fields defensively (u.address?.city) — the one crash every MERN " +
        "beginner hits is dotting into an embedded object that isn't there."
    );

    // ------------------------------------------------------------------
    section("2. Two kinds of 'nested object': sub-schema vs nested path");
    // User.address is defined with a SUB-SCHEMA (addressSchema) — Mongoose
    // wraps it in a real subdocument: its own casting, defaults, validation,
    // and document methods. Product.specs is defined INLINE as an object of
    // paths (a "nested path") — just grouped fields, no document machinery.
    // In MongoDB both are stored identically as a plain nested BSON object;
    // the difference exists only in Node.js.
    const anyProduct = await Product.findOne({ "specs.brand": { $exists: true } });
    show("user.address (defined via addressSchema)", {
      isMongooseDocument: meera.address instanceof mongoose.Document,
      singleNestedSubdoc: meera.address.$isSingleNested === true,
      canFindItsParent: typeof meera.address.ownerDocument === "function",
      _id: meera.address._id, // undefined — addressSchema says { _id: false }
    });
    show("product.specs (defined inline as a nested path)", {
      isMongooseDocument: anyProduct.specs instanceof mongoose.Document,
      singleNestedSubdoc: anyProduct.specs?.$isSingleNested === true,
      canFindItsParent: typeof anyProduct.specs?.ownerDocument === "function",
    });
    note(
      "When does the difference matter? A sub-schema is reusable (this same " +
        "addressSchema shapes BOTH user.address and order.shippingAddress), " +
        "carries its own defaults (country: 'India') and validators, and can " +
        "have middleware. A nested path is lighter — fine for small grouped " +
        "fields like specs. One more subdocument fact: subdocuments get their " +
        "own _id by DEFAULT; addressSchema opts out with { _id: false } " +
        "because an address is never addressed (!) individually. Lesson 02 " +
        "shows where subdocument _ids genuinely earn their keep: arrays."
    );

    // ------------------------------------------------------------------
    section("3. Filtering on nested fields — dot notation (quick recap)");
    // Module 05 covered this in depth; one refresher because everything
    // below builds on it. The quoted path "address.city" reaches inside the
    // embedded object; the users collection even has an index on it.
    const puneCount = await User.countDocuments({ "address.city": "Pune" });
    show("Seeded users in Pune via { 'address.city': 'Pune' }", puneCount);
    note(
      "Remember the module-05 trap: { address: { city: 'Pune' } } is EXACT " +
        "whole-object equality (field-order sensitive, no extra fields " +
        "allowed) and silently matches nothing here. Filter nested fields " +
        "with dot notation, always."
    );

    // ------------------------------------------------------------------
    section("4. Updating ONE nested field — $set on a dot path");
    // The same dot notation works on the UPDATE side. This is the surgical
    // tool: change exactly one nested field, touch nothing else. The $set
    // runs on the SERVER — no read-modify-write, no race window.
    await User.updateOne(
      { email: "embedded.one@lesson.test" },
      { $set: { "address.zip": "560002" } } // Meera's zip changed — that's ALL
    );
    const meeraAfterZip = await User.findOne({ email: "embedded.one@lesson.test" });
    show("Meera's address after $set on 'address.zip'", meeraAfterZip.address.toObject());
    note(
      "street/city/state/country all survived — a dot-path $set edits one " +
        "leaf and leaves its siblings alone. This is the form 95% of real " +
        "profile-edit endpoints should use."
    );

    // Bonus behavior: a dot-path $set on a user with NO address at all.
    // MongoDB creates the intermediate object on the fly.
    await User.updateOne(
      { email: "embedded.two@lesson.test" },
      { $set: { "address.zip": "395001" } }
    );
    const tarunAfterZip = await User.findOne({ email: "embedded.two@lesson.test" });
    show("Tarun (who had NO address) after $set on 'address.zip'", tarunAfterZip.address?.toObject());
    note(
      "MongoDB happily built { zip: '395001' } from nothing — intermediate " +
        "objects are created as needed. Look closely at what is MISSING: " +
        "country. The sub-schema default (country: 'India') did NOT apply, " +
        "because Mongoose only runs subdocument defaults when it casts a " +
        "WHOLE subdocument — a dot-path update casts just the one leaf " +
        "value. Partial objects like this are legal in MongoDB; your read " +
        "code must tolerate them (another job for ?.)."
    );

    // ------------------------------------------------------------------
    section("5. THE TRAP — $set with a whole object REPLACES the subdocument");
    show("Meera's address BEFORE", meeraAfterZip.address.toObject());
    // Passing an OBJECT as the $set value does not merge — it swaps the
    // entire embedded document for your literal. Every field you do not
    // mention is gone.
    await User.updateOne(
      { email: "embedded.one@lesson.test" },
      { $set: { address: { city: "New Delhi" } } } // looks innocent...
    );
    const meeraReplaced = await User.findOne({ email: "embedded.one@lesson.test" });
    show("Meera's address AFTER $set: { address: { city: 'New Delhi' } }", meeraReplaced.address?.toObject());
    note(
      "street, state, and zip are GONE — $set assigned a brand-new object " +
        "to `address`, it did not merge fields into the old one. If you see " +
        "country: 'India' in the result, that came from the sub-schema " +
        "DEFAULT applied while Mongoose cast your replacement object — " +
        "factory settings, not Meera's old data. This is the exact same " +
        "lose-fields shape as replaceOne in module 04, one level down. " +
        "Classic real-world cause: a PATCH endpoint doing " +
        "$set: { address: req.body.address } with a partial body. Fix: " +
        "translate each provided field into its own dot path " +
        "('address.city', 'address.zip', ...) and $set those."
    );

    // ------------------------------------------------------------------
    section("6. The document way — assign, track, save()");
    // The load -> mutate -> save() style works on nested fields too, and
    // Mongoose's change tracking is smart about it: it records WHICH nested
    // paths you touched and sends a targeted update, not the whole document.
    const doc = await User.findOne({ email: "embedded.one@lesson.test" });
    doc.address.street = "7 Janpath"; // plain assignment on the subdocument
    show("modifiedPaths() after the assignment", doc.modifiedPaths());
    show("getChanges() — the update save() is ABOUT to send", doc.getChanges());
    await doc.save();
    note(
      "getChanges() revealed { $set: { 'address.street': ... } } — save() " +
        "translated your assignment into the same surgical dot-path $set as " +
        "section 4. Two warnings: (1) assigning a whole object " +
        "(doc.address = { city: 'X' }) replaces the subdocument exactly like " +
        "section 5's trap — same rule, document flavor; (2) save() validates " +
        "the whole document, while updateOne() skips validators unless you " +
        "pass runValidators: true (module 04, section 5)."
    );

    // ------------------------------------------------------------------
    section("7. Removing an embedded document — $unset");
    // $unset deletes the field itself (not "sets it to null"). After this,
    // { address: { $exists: false } } matches Meera again.
    await User.updateOne(
      { email: "embedded.one@lesson.test" },
      { $unset: { address: "" } } // the "" value is ignored; the KEY matters
    );
    const meeraNoAddress = await User.findOne({ email: "embedded.one@lesson.test" });
    show("Meera's address after $unset", meeraNoAddress.address); // undefined
    show(
      "Does { address: { $exists: false } } match her now?",
      (await User.countDocuments({
        email: "embedded.one@lesson.test",
        address: { $exists: false },
      })) === 1
    );
    note(
      "$unset removes the key entirely, reclaiming its bytes — different " +
        "from $set: { address: null }, which stores a null. Module 05 lesson " +
        "03 covered why that distinction matters when you query."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup — DESTRUCTIVE, but only for @lesson.test practice users");
    show("Removed", await removeTempUsers());
    note("The database is back to exactly its seeded state.");
  }
});
