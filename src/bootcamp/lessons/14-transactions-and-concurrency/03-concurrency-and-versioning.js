/**
 * LESSON 14-transactions-and-concurrency/03-concurrency-and-versioning
 *
 * Most data-corruption bugs in web applications are not database bugs. They
 * are RACE CONDITIONS: two requests read the same value, both compute a new
 * one from what they read, and both write — so one update silently vanishes.
 *
 * This lesson reproduces a lost update for real, then shows the three ways to
 * prevent it, from cheapest to most expensive:
 *
 *   1. ATOMIC OPERATORS   — let the server do the arithmetic ($inc)
 *   2. CONDITIONAL UPDATE — put the precondition in the filter
 *   3. OPTIMISTIC CONCURRENCY — version the document (__v) and retry
 *
 * None of these need a replica set, so this lesson runs everywhere.
 *
 * SAFE TO RE-RUN: temporary products (ZZ- SKUs) only, cleaned up at both
 * ends. Seeded data is never modified.
 *
 * Run it with:  npm run lesson 14-transactions-and-concurrency/03-concurrency-and-versioning
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";

const cleanup = () => Product.deleteMany({ sku: /^ZZ-/ });

/** Create (or recreate) a temp product with a known stock level. */
const freshProduct = async (sku, stock) => {
  const category = (await Product.findOne({ sku: { $not: /^ZZ-/ } }).select("category").lean()).category;
  await Product.deleteOne({ sku });
  return Product.create({
    name: `ZZ Race Test ${sku}`,
    sku,
    price: 1000,
    stock,
    category,
  });
};

await runLesson("Transactions 3/4 — Concurrency and versioning", async () => {
  await cleanup();

  // --------------------------------------------------------------------
  section("1. The lost update, reproduced");
  const racy = await freshProduct("ZZ-RACE-1", 100);

  // This is the WRONG pattern, and it is everywhere in real codebases:
  // read the document, compute in JavaScript, write the result back.
  const readModifyWrite = async () => {
    const doc = await Product.findById(racy._id).select("stock").lean();
    // Between this read and the write below, ANOTHER request can do the same
    // thing. Both computed from the same starting value, so one decrement is
    // lost. A tiny delay makes the window reliable enough to demonstrate.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Product.updateOne({ _id: racy._id }, { $set: { stock: doc.stock - 1 } });
  };

  await Promise.all(Array.from({ length: 20 }, () => readModifyWrite()));
  const afterRace = await Product.findById(racy._id).select("stock").lean();
  show("20 concurrent 'sell one unit' operations, read-modify-write", {
    startingStock: 100,
    operations: 20,
    expectedStock: 80,
    actualStock: afterRace.stock,
    unitsLost: afterRace.stock - 80,
  });
  note(
    "Stock is far higher than 80 — most of the decrements were lost. Every " +
      "operation read (say) 100, computed 99, and wrote 99. Twenty writes, " +
      "one unit sold. In a real shop this is the opposite failure of " +
      "overselling: you have sold 20 items and your inventory says you sold " +
      "one. Nothing errored. Nothing logged. The data is simply wrong."
  );
  note(
    "Crucially, this is NOT a MongoDB flaw. Each individual write was atomic. " +
      "The race is in YOUR code: the gap between reading and writing is where " +
      "another request slipped in. The same bug exists in Postgres, MySQL, " +
      "and every other database if you write it this way."
  );

  // --------------------------------------------------------------------
  section("2. Fix 1 — atomic operators ($inc)");
  const atomic = await freshProduct("ZZ-RACE-2", 100);

  // No read at all. The SERVER reads the current value and adds -1 to it, in
  // one indivisible operation. There is no window for anyone to slip into.
  const atomicDecrement = () => Product.updateOne({ _id: atomic._id }, { $inc: { stock: -1 } });

  await Promise.all(Array.from({ length: 20 }, () => atomicDecrement()));
  const afterAtomic = await Product.findById(atomic._id).select("stock").lean();
  show("The same 20 operations using $inc", {
    startingStock: 100,
    operations: 20,
    expectedStock: 80,
    actualStock: afterAtomic.stock,
    correct: afterAtomic.stock === 80,
  });
  note(
    "Exactly right, every time, with no locks, no transactions, and no " +
      "retries. RULE: never compute a new value in JavaScript from a value " +
      "you just read. Express the CHANGE ($inc, $push, $addToSet, $min, $max) " +
      "and let the server apply it. This one habit prevents the majority of " +
      "concurrency bugs you will ever meet."
  );

  // --------------------------------------------------------------------
  section("3. Fix 2 — conditional updates (the precondition goes in the filter)");
  // $inc alone would happily take stock negative. Putting the precondition
  // into the FILTER makes the check and the change one atomic operation.
  const guarded = await freshProduct("ZZ-RACE-3", 5);

  const sellOne = async () => {
    const result = await Product.updateOne(
      // "only if there is at least 1 left"
      { _id: guarded._id, stock: { $gte: 1 } },
      { $inc: { stock: -1 } }
    );
    // matchedCount tells you whether the precondition held.
    return result.matchedCount === 1;
  };

  const sales = await Promise.all(Array.from({ length: 12 }, () => sellOne()));
  const afterGuarded = await Product.findById(guarded._id).select("stock").lean();
  show("12 buyers, only 5 units in stock", {
    startingStock: 5,
    attempts: 12,
    succeeded: sales.filter(Boolean).length,
    rejected: sales.filter((s) => !s).length,
    finalStock: afterGuarded.stock,
    oversold: afterGuarded.stock < 0,
  });
  note(
    "Exactly 5 sales, 7 rejections, and stock lands on 0 — never negative. " +
      "The check-and-change happened inside ONE atomic server operation, so " +
      "no two buyers could both pass the check. Compare with the naive " +
      "version: `if (product.stock > 0) await decrement()` — where twelve " +
      "requests can all pass the `if` before any of them decrements."
  );
  note(
    "This pattern generalises well beyond stock: 'cancel only if still " +
      "pending' -> { _id, status: 'pending' }; 'claim a job only if " +
      "unclaimed' -> { _id, claimedBy: null }. Always check matchedCount to " +
      "learn whether you won."
  );

  // --------------------------------------------------------------------
  section("4. Fix 3 — optimistic concurrency with the version key");
  // Some updates genuinely cannot be expressed as an operator: reordering an
  // array, or recomputing several fields from each other. For those, version
  // the document.
  //
  // Our Order model KEEPS __v for exactly this purpose. Here we demonstrate
  // the mechanism on a temp product using the same idea manually.
  const versioned = await freshProduct("ZZ-RACE-4", 50);
  await Product.updateOne({ _id: versioned._id }, { $set: { discountPercent: 0 } });

  /**
   * Read, compute freely in JavaScript, then write ONLY if nobody else has
   * changed the document since we read it. If they have, re-read and retry.
   */
  const optimisticUpdate = async (compute, maxAttempts = 5) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const doc = await Product.findById(versioned._id).select("stock discountPercent").lean();
      const next = compute(doc);

      // The filter includes the values we based our computation on. If they
      // have changed, matchedCount is 0 and we know we lost the race.
      const result = await Product.updateOne(
        { _id: versioned._id, stock: doc.stock, discountPercent: doc.discountPercent },
        { $set: next }
      );
      if (result.matchedCount === 1) return { ok: true, attempts: attempt };

      // Someone else won. Back off briefly and read the fresh state.
      await new Promise((resolve) => setTimeout(resolve, 2 * attempt));
    }
    return { ok: false, attempts: maxAttempts };
  };

  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      optimisticUpdate((doc) => ({
        stock: doc.stock - 1,
        discountPercent: Math.min(90, doc.discountPercent + 1),
      }))
    )
  );
  const afterOptimistic = await Product.findById(versioned._id)
    .select("stock discountPercent")
    .lean();
  show("8 concurrent compare-and-set updates", {
    succeeded: attempts.filter((a) => a.ok).length,
    gaveUp: attempts.filter((a) => !a.ok).length,
    retriesNeeded: attempts.map((a) => a.attempts),
    startingStock: 50,
    finalStock: afterOptimistic.stock,
    finalDiscount: afterOptimistic.discountPercent,
    "no updates lost": afterOptimistic.stock === 50 - attempts.filter((a) => a.ok).length,
  });
  note(
    "Every successful update is accounted for, and the losers RETRIED " +
      "against fresh data instead of silently overwriting. This is " +
      "OPTIMISTIC concurrency: assume conflicts are rare, detect them, retry. " +
      "It costs nothing when there is no contention — unlike a lock, which " +
      "costs on every single operation."
  );

  // --------------------------------------------------------------------
  section("5. Mongoose's built-in versioning (__v)");
  // Mongoose maintains __v automatically and uses it for array-modifying
  // saves. optimisticConcurrency: true extends it to ALL saves.
  show("How __v works", {
    "what it is": "a counter Mongoose increments when a save modifies an array",
    "why arrays": "positional array updates are ambiguous if the array shifted underneath you",
    "default behaviour": "doc.save() includes __v in its filter when arrays changed; a mismatch throws VersionError",
    "optimisticConcurrency: true": "schema option — EVERY save checks __v, not just array saves",
    "our models": "Order keeps __v (versionKey enabled); User/Product/Category/Review disable it",
    "why Order keeps it": "orders have an items array and are the natural place to teach this",
  });
  show("Enabling full optimistic concurrency", {
    code: `const schema = new mongoose.Schema({ ... }, {
  optimisticConcurrency: true,   // every save() checks __v
});

// then:
const doc = await Model.findById(id);       // __v is 3
doc.title = "new";
await doc.save();                            // filter includes __v: 3 -> now 4
// a concurrent save that also read __v: 3 throws VersionError`,
    catching: "error.name === 'VersionError' -> re-read the document and retry",
  });
  note(
    "VersionError is Mongoose's way of saying 'the document changed under " +
      "you'. The correct response is almost never to show the user an error " +
      "— it is to re-read, re-apply their intent, and save again (or, for a " +
      "form, to tell them the record was updated and show the new values)."
  );

  // --------------------------------------------------------------------
  section("6. Optimistic vs pessimistic");
  show("Two strategies", {
    "OPTIMISTIC (versions, conditional updates)": {
      assumes: "conflicts are rare",
      cost: "free when uncontended; a retry when it loses",
      "good for": "web apps, high read/write ratio, short operations",
      failureMode: "retries — occasionally many, under heavy contention",
    },
    "PESSIMISTIC (transactions, locks)": {
      assumes: "conflicts are likely, or correctness across documents is mandatory",
      cost: "paid on every operation, contended or not",
      "good for": "money movement, multi-document invariants",
      failureMode: "waiting, and deadlock/timeout risk",
    },
    "the practical order to try": [
      "1. Can it be one atomic operator on one document? Do that.",
      "2. Can the precondition go in the filter? Do that.",
      "3. Does it span documents with a real invariant? Transaction.",
      "4. Otherwise: optimistic versioning with retry.",
    ],
  });

  // --------------------------------------------------------------------
  section("7. Idempotency — the other half of the problem");
  note(
    "Retries are not only a database concern. If a client's HTTP request " +
      "times out and it retries, your server may place TWO orders. The fix " +
      "is an IDEMPOTENCY KEY: the client sends a unique key with the request, " +
      "you store it on a unique index, and a duplicate key (error 11000) " +
      "means 'this request already ran — return the original result'. Our " +
      "orderNumber unique index is a simple version of the same idea."
  );

  // --------------------------------------------------------------------
  section("8. Cleanup");
  await cleanup();
  show("Cleanup", { tempProducts: await Product.countDocuments({ sku: /^ZZ-/ }) });
  note("Next: 04-write-read-concerns — durability and consistency guarantees.");
});
