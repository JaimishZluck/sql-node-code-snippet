/**
 * LESSON 07-updates-and-deletes/01-field-update-operators — Field update operators
 *
 * Module 04 covered WHICH update methods exist (updateOne, findOneAndUpdate,
 * ...). This lesson is about what goes INSIDE an update. An update document
 * like { $inc: { stock: -1 } } is not data — it is an INSTRUCTION that the
 * MongoDB server executes against the CURRENT value, atomically. We tour
 * every field operator — $set, $unset, $inc, $mul, $min, $max, $rename,
 * $currentDate, and $setOnInsert (with upsert: true) — and close by
 * contrasting operator updates with whole-document replacement.
 *
 * SAFETY: every mutation targets TEMPORARY practice docs created below
 * (emails `...@lesson.test`, SKU `ZZ-...`, and a throwaway `tmp_`
 * collection). Leftovers from crashed runs are swept at the start, and a
 * finally-block cleans everything at the end. Seeded data is never modified.
 *
 * Run it with:  npm run lesson 07-updates-and-deletes/01-field-update-operators
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Category from "../../../models/category.model.js";

const TEMP_EMAIL = /@lesson\.test$/i;
const TEMP_SKU = /^ZZ-/;
const TMP_COLLECTION = "tmp_field_migration"; // tmp_ prefix = disposable
const OPS_EMAIL = "operators@lesson.test";
const SKU = "ZZ-OPS-0001";

/** DESTRUCTIVE — only for practice docs matching the temp markers. */
async function removeTempDocs() {
  const users = await User.deleteMany({ email: TEMP_EMAIL });
  const products = await Product.deleteMany({ sku: TEMP_SKU });
  // Dropping a collection that does not exist can throw — ignore that case.
  await mongoose.connection.db.collection(TMP_COLLECTION).drop().catch(() => {});
  return {
    tempUsersRemoved: users.deletedCount,
    tempProductsRemoved: products.deletedCount,
  };
}

/**
 * Read the raw BSON document with the native driver — no Mongoose hydration,
 * no schema defaults filled in. What you see is EXACTLY what is stored.
 * (Mongoose can quietly apply schema defaults to missing fields when it
 * loads a document, which would hide some effects we want to observe.)
 */
const rawUser = (email) => mongoose.connection.db.collection("users").findOne({ email });
const rawProduct = (sku) => mongoose.connection.db.collection("products").findOne({ sku });

await runLesson("Updates & Deletes 1/4 — Field update operators", async () => {
  section("0. Safety sweep + create the practice docs this lesson will mutate");
  show("Leftovers removed (0 is normal)", await removeTempDocs());

  try {
    const headphones = await Category.findOne({ slug: "headphones" });
    if (!headphones) throw new Error("Seeded data missing — run: npm run db:seed");

    await User.create({
      name: "Omi Operatordemo",
      email: OPS_EMAIL,
      age: 29,
      loyaltyPoints: 100,
    });
    await Product.create({
      name: "ZZ Practice Speaker",
      sku: SKU,
      price: 2000,
      stock: 40,
      category: headphones._id,
      tags: ["new-arrival"],
      specs: { brand: "EchoBeat", color: "silver", warrantyMonths: 12 },
    });
    show("Practice docs ready", { user: OPS_EMAIL, product: SKU });

    // ------------------------------------------------------------------
    section("1. $set — change exactly the fields you name, nothing else");
    // $set is the workhorse: it writes the listed paths and leaves every
    // other field alone. This is what a PATCH endpoint should send.
    await Product.updateOne(
      { sku: SKU },
      { $set: { discountPercent: 15, "specs.color": "graphite" } }
    );
    const afterDotSet = await rawProduct(SKU);
    show("After $set with DOT NOTATION", {
      discountPercent: afterDotSet.discountPercent,
      specs: afterDotSet.specs, // color changed; brand + warrantyMonths untouched
    });
    note(
      '"specs.color" (dot notation) surgically replaced ONE nested field — ' +
        "the rest of specs survived. Now watch the classic beginner mistake: " +
        "$set-ing the whole nested object instead."
    );

    // MISTAKE DEMO: $set with a whole object REPLACES the whole object.
    await Product.updateOne({ sku: SKU }, { $set: { specs: { color: "crimson" } } });
    show("After $set of the WHOLE specs object (raw)", (await rawProduct(SKU)).specs);
    note(
      "brand and warrantyMonths are GONE — { specs: {...} } means 'specs is " +
        "now exactly this object'. We read the raw document via the native " +
        "driver on purpose: Mongoose may fill schema defaults back in when " +
        "loading, which would MASK the data loss. Rule: to edit inside a " +
        'nested object, always use dot notation ("specs.color").'
    );

    // ------------------------------------------------------------------
    section("2. $unset — REMOVE a field (vs $set: null, which stores null)");
    // $unset deletes the key from the stored BSON document itself. Its value
    // ("" by convention) is ignored — only the path matters. One update can
    // carry several operators at once:
    await User.updateOne(
      { email: OPS_EMAIL },
      { $unset: { age: "" }, $set: { lastLoginAt: null } }
    );
    const rawOmi = await rawUser(OPS_EMAIL);
    show("Raw stored document (driver view)", {
      hasAgeKey: "age" in rawOmi, // false — the key itself is gone
      lastLoginAt: rawOmi.lastLoginAt, // null — the key EXISTS, holding null
    });
    show(
      "Who matches { age: { $exists: false } }?",
      await User.find({ email: TEMP_EMAIL, age: { $exists: false } }, "name email")
    );
    note(
      "Missing and null are DIFFERENT stored states: missing = 'never " +
        "recorded', null = 'recorded as empty'. Filters treat them " +
        "differently too — { lastLoginAt: null } matches BOTH, while " +
        "{ age: { $exists: false } } matches only true absence (module 05, " +
        "element operators). Use $unset to truly remove; $set: null to " +
        "explicitly store 'no value'."
    );

    // ------------------------------------------------------------------
    section("3. $inc and $mul — arithmetic ON THE SERVER");
    // The command carries the DELTA (+250), never the result (350): MongoDB
    // computes 'current + 250' itself, atomically. Two concurrent $inc +250
    // commands can never overwrite each other — both land.
    const earned = await User.findOneAndUpdate(
      { email: OPS_EMAIL },
      { $inc: { loyaltyPoints: 250 } },
      { new: true }
    );
    show("Points after earning 250 (100 + 250)", earned.loyaltyPoints); // 350

    // Negative delta = subtract. There is no $dec operator — $inc does both.
    const spent = await User.findOneAndUpdate(
      { email: OPS_EMAIL },
      { $inc: { loyaltyPoints: -50 } },
      { new: true }
    );
    show("Points after spending 50", spent.loyaltyPoints); // 300

    // $mul multiplies in place: a 10% price cut is 'multiply by 0.9'.
    const cheaper = await Product.findOneAndUpdate(
      { sku: SKU },
      { $mul: { price: 0.9 } },
      { new: true }
    );
    show("Price after $mul 0.9 (2000 -> 1800)", cheaper.price);
    note(
      "Missing-field behavior: $inc creates the field holding the delta; " +
        "$mul creates it holding 0 (anything times nothing...). Two cautions: " +
        "floats — 1999 * 0.9 = 1799.1, so real money code stores integer " +
        "paise/cents; and validation — schema rules like min: 0 do NOT guard " +
        "$inc/$mul (update validators never run on them). Lesson 03 shows " +
        "the guard that actually works."
    );

    // ------------------------------------------------------------------
    section("4. $min / $max — write only if the new value is lower / higher");
    // $min: 'set price to 1500 — but only if 1500 is LESS than what is
    // stored'. A conditional write in a single operator.
    const priceDrop = await Product.updateOne({ sku: SKU }, { $min: { price: 1500 } });
    show("$min 1500 vs current 1800", priceDrop); // matched 1, modified 1

    const noDrop = await Product.updateOne({ sku: SKU }, { $min: { price: 1700 } });
    show("$min 1700 vs current 1500", noDrop); // matched 1, modified 0 — a no-op
    note(
      "modifiedCount tells you whether the write happened. $min/$max shine " +
        "for 'record the extreme': lowest-price-ever trackers, high scores, " +
        "peak traffic counters."
    );

    // $max on a DATE: keep the LATEST login even if events arrive late or
    // out of order (think: retried queue messages, multiple app servers).
    await User.updateOne(
      { email: OPS_EMAIL },
      { $max: { lastLoginAt: new Date("2026-01-15T10:00:00Z") } }
    );
    const staleEvent = await User.updateOne(
      { email: OPS_EMAIL },
      { $max: { lastLoginAt: new Date("2025-06-01T08:00:00Z") } } // OLDER — ignored
    );
    show("An older login event arrives late", staleEvent); // modified 0
    show("lastLoginAt kept the newest value", (await User.findOne({ email: OPS_EMAIL })).lastLoginAt);
    note(
      "With plain $set, the late 2025 event would have DRAGGED lastLoginAt " +
        "backwards. $max makes the field move only forward. (It worked over " +
        "the stored null because BSON orders null below every Date; on a " +
        "missing field, $min/$max simply set the value.)"
    );

    // ------------------------------------------------------------------
    section("5. $rename — field migrations (on a throwaway tmp_ collection)");
    // Scenario: app v1 stored `fullname`; v2's schema calls it `name`. Old
    // documents must be migrated. Migrations run as raw-driver scripts —
    // the CURRENT schema knows nothing about the OLD field, so we use
    // mongoose.connection.db (same open connection, no Mongoose layer).
    const tmp = mongoose.connection.db.collection(TMP_COLLECTION);
    await tmp.insertMany([
      { fullname: "Asha (v1 shape)", pts: 120 },
      { fullname: "Binod (v1 shape)", pts: 40 },
    ]);
    show("A v1 document BEFORE", await tmp.findOne({ fullname: "Asha (v1 shape)" }));

    const renamed = await tmp.updateMany({}, { $rename: { fullname: "name" } });
    show("updateMany + $rename result", renamed); // matched 2, modified 2
    show("The same document AFTER", await tmp.findOne({ name: "Asha (v1 shape)" }));
    note(
      "Internally $rename is a $unset of the old path plus a $set of the " +
        "new one — the field may move to the end of the document, and any " +
        "index on the OLD name stops covering it (create the new index " +
        "BEFORE migrating). Limits: $rename cannot move values into or out " +
        "of arrays. Renaming only some documents leaves a mixed collection — " +
        "run migrations to completion."
    );

    // ------------------------------------------------------------------
    section("6. $currentDate — let the SERVER stamp the time");
    const beforeStamp = await User.findOne({ email: OPS_EMAIL }, "lastLoginAt updatedAt");
    // true = store a BSON Date. The rare { $type: "timestamp" } form stores
    // an internal BSON timestamp (oplog-style bookkeeping — you rarely want it).
    await User.updateOne({ email: OPS_EMAIL }, { $currentDate: { lastLoginAt: true } });
    const afterStamp = await User.findOne({ email: OPS_EMAIL }, "lastLoginAt updatedAt");
    show("Before", { lastLoginAt: beforeStamp.lastLoginAt, updatedAt: beforeStamp.updatedAt });
    show("After $currentDate", { lastLoginAt: afterStamp.lastLoginAt, updatedAt: afterStamp.updatedAt });
    note(
      "WHY not $set: { lastLoginAt: new Date() }? new Date() reads YOUR app " +
        "server's clock. With several app servers whose clocks drift, " +
        "'last activity' can jump backwards depending on which server " +
        "handled the request. $currentDate uses the ONE clock everyone " +
        "shares — the database's. Also notice updatedAt changed after every " +
        "update in this lesson: Mongoose's timestamps option maintains it " +
        "for you on updates, so you rarely write $currentDate for that."
    );

    // ------------------------------------------------------------------
    section("7. upsert + $setOnInsert — 'update it, or create it' in ONE command");
    // upsert = UPdate or inSERT. $setOnInsert lists fields applied ONLY when
    // the insert path runs — 'birth certificate' fields.
    const upsertLoyalty = (points) =>
      User.findOneAndUpdate(
        { email: "ops.upsert@lesson.test" }, // no such user on the first call
        {
          $set: { loyaltyPoints: points }, // applied on BOTH paths
          $setOnInsert: { name: "Upsert Omi", age: 30 }, // INSERT path only
        },
        { upsert: true, new: true }
      );

    const born = await upsertLoyalty(100);
    show("First call — the INSERT path", {
      name: born.name, // from $setOnInsert
      email: born.email, // copied from the FILTER's equality condition
      age: born.age, // 30 — from $setOnInsert
      loyaltyPoints: born.loyaltyPoints, // 100 — from $set
      role: born.role, // "customer" — Mongoose applied schema defaults on insert
    });

    const met = await upsertLoyalty(900);
    show("Second call — the UPDATE path", {
      age: met.age, // STILL 30 — $setOnInsert is ignored when a doc matched
      loyaltyPoints: met.loyaltyPoints, // 900 — $set applied again
    });
    note(
      "$setOnInsert is for values written once at creation and never touched " +
        "by later upserts (signup source, initial status, createdBy). Traps: " +
        "the same path may not appear in both $set and $setOnInsert (the " +
        "server rejects the conflict), and TWO simultaneous upserts with the " +
        "same filter can BOTH take the insert path — only a unique index " +
        "(like the one on email) turns that into a clean duplicate-key error " +
        "instead of two documents. Upserts and unique indexes travel together."
    );

    // ------------------------------------------------------------------
    section("8. Operator update vs REPLACING the whole document");
    const beforeReplace = await rawProduct(SKU);
    show("Product before (raw, selected fields)", {
      name: beforeReplace.name,
      price: beforeReplace.price,
      stock: beforeReplace.stock,
      tags: beforeReplace.tags,
      specs: beforeReplace.specs,
      discountPercent: beforeReplace.discountPercent,
    });

    // A replacement contains NO operators — it IS the entire new body.
    // Everything you do not send is gone. (Full replace family: module 04.)
    await Product.replaceOne(
      { sku: SKU },
      { name: "ZZ Rebuilt Speaker", sku: SKU, price: 999, category: headphones._id }
    );
    const rebuilt = await rawProduct(SKU);
    show("Product after replaceOne (raw)", rebuilt);
    note(
      "tags, specs, and the discount are gone; stock/isActive you may still " +
        "see came back as schema DEFAULTS Mongoose added while casting the " +
        "replacement — factory settings, not the old data. Operators EDIT in " +
        "place (HTTP PATCH thinking); replacement REBUILDS from scratch " +
        "(HTTP PUT thinking). In app code, reach for operators first — " +
        "replacement is for deliberate 'overwrite everything' flows only."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup — DESTRUCTIVE, but only for @lesson.test / ZZ- docs and tmp_ collections");
    show("Removed", await removeTempDocs());
    note("The database is back to exactly its seeded state.");
  }
});
