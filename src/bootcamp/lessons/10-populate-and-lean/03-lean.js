/**
 * LESSON 10-populate-and-lean/03-lean — Plain objects, skipping hydration
 *
 * Every document Mongoose returns is "hydrated" by default: wrapped in a
 * Document class instance carrying change tracking, virtuals, getters,
 * methods, and .save(). Priceless for writes — pure overhead for reads.
 * .lean() skips the wrapping and hands you the plain objects the driver
 * parsed from BSON. This lesson dissects what hydration builds, measures
 * what it costs on all 300 orders (process.hrtime + a rough heap note),
 * combines lean with populate, and draws the line between "always lean"
 * and "never lean".
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 10-populate-and-lean/03-lean
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Order from "../../../models/order.model.js";
import Product from "../../../models/product.model.js";

await runLesson("lean() — plain objects instead of documents", async () => {
  // --------------------------------------------------------------------
  section("1. Two shapes of the same data");
  // Same query twice: once hydrated (default), once lean. The DATABASE
  // work is identical — same command, same bytes over the wire. The
  // difference is what Mongoose builds in Node AFTER the reply arrives.
  const hydrated = await Product.findOne({ isActive: true });
  const lean = await Product.findOne({ isActive: true }).lean();

  show("Anatomy of the two results", {
    hydrated: {
      isMongooseDocument: hydrated instanceof mongoose.Document,
      hasSave: typeof hydrated.save, // "function"
      hasIsModified: typeof hydrated.isModified, // change tracking API
      prototype: hydrated.constructor.name, // "model" — a class instance
    },
    lean: {
      isMongooseDocument: lean instanceof mongoose.Document, // false
      hasSave: typeof lean.save, // "undefined"
      hasIsModified: typeof lean.isModified, // "undefined"
      prototype: Object.getPrototypeOf(lean) === Object.prototype
        ? "Object.prototype (a POJO)"
        : "something else",
    },
  });
  note(
    "HYDRATION is Mongoose wrapping the raw reply in a Document instance: " +
      "per-field change tracking (so .save() can send a minimal $set of " +
      "only what you touched), casting, getters, virtuals, your schema " +
      "methods. lean() returns what the driver decoded from BSON, as-is. " +
      "For a read-only response, all that machinery is built and never " +
      "used — that waste is the entire story of this lesson."
  );

  // --------------------------------------------------------------------
  section("2. What lean silently drops: virtuals, getters, methods");
  // Product declares the virtual `finalPrice` (price after discount). A
  // virtual is computed by the DOCUMENT wrapper — no wrapper, no virtual.
  show("The finalPrice virtual", {
    hydrated_finalPrice: hydrated.finalPrice, // computed in the getter
    lean_finalPrice: lean.finalPrice, // undefined — no error, just missing!
    rawIngredients: { price: lean.price, discountPercent: lean.discountPercent },
  });
  note(
    "undefined, not an error — the nasty kind of bug: res.json(lean) ships " +
      "a product WITHOUT finalPrice and nothing crashes until the UI shows " +
      "a blank price. Also skipped by lean: schema getters, instance " +
      "methods, and DEFAULTS for fields missing in the stored document " +
      "(a hydrated doc fills them in; a lean doc shows the field absent). " +
      "If you want lean AND virtuals, the mongoose-lean-virtuals plugin " +
      "re-applies them cheaply (community package — not installed here)."
  );

  // --------------------------------------------------------------------
  section("3. Measuring the cost: all 300 orders, hydrated vs lean");
  // process.hrtime.bigint() = nanosecond wall clock. We fetch the ENTIRE
  // orders collection (300 docs, each with 1-4 embedded items) both ways,
  // 3 rounds each, and keep the best time — a crude but honest way to
  // dampen JIT warm-up and one-off GC pauses. A warm-up query first, so
  // neither side pays connection/cache setup.
  await Order.find().lean(); // warm-up (also warms the server's cache)

  async function bestOfThree(makeQuery) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const start = process.hrtime.bigint();
      await makeQuery();
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (ms < best) best = ms;
    }
    return best;
  }

  const hydratedMs = await bestOfThree(() => Order.find());
  const leanMs = await bestOfThree(() => Order.find().lean());

  show("Fetching all 300 orders (best of 3 runs)", {
    hydrated: `${hydratedMs.toFixed(1)} ms`,
    lean: `${leanMs.toFixed(1)} ms`,
    speedup: `${(hydratedMs / leanMs).toFixed(1)}x`,
  });

  // Rough MEMORY note. heapUsed deltas are noisy (GC runs whenever it
  // likes), so treat these as an indication, not a benchmark.
  const heapBefore = process.memoryUsage().heapUsed;
  const hydratedDocs = await Order.find();
  const heapAfterHydrated = process.memoryUsage().heapUsed;
  const leanDocs = await Order.find().lean();
  const heapAfterLean = process.memoryUsage().heapUsed;

  show("Rough heap growth while holding the results", {
    holding300HydratedDocs: `~${((heapAfterHydrated - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
    holding300LeanDocs: `~${((heapAfterLean - heapAfterHydrated) / 1024 / 1024).toFixed(2)} MB`,
    caveat: "indicative only — GC timing makes single deltas noisy",
  });
  show("Sanity check: both fetched the same data", {
    hydratedCount: hydratedDocs.length,
    leanCount: leanDocs.length,
  });
  note(
    "Typical outcome: lean is severalfold faster and allocates a fraction " +
      "of the memory, because 300 Document instances (each item subdoc " +
      "gets wrapped too!) were never built. Exact numbers vary per " +
      "machine and run — what matters is the SHAPE of the result: the " +
      "database did identical work both times; the entire difference is " +
      "Node CPU + RAM. Now scale it: 300 docs per request, 100 concurrent " +
      "requests — hydration you never use becomes real latency and GC " +
      "pressure. And remember lean saves nothing on the network — pair it " +
      "with .select() (module 06) to cut those bytes too."
  );

  // --------------------------------------------------------------------
  section("4. populate + lean — the standard read-path combo");
  // lean applies to populated children as well: the stitched-in users are
  // plain objects too. This one line is modules 05, 06, and 10 combined —
  // the production shape of a list endpoint.
  const recent = await Order.find({ status: "delivered" })
    .sort({ placedAt: -1 })
    .limit(3)
    .select("orderNumber totalAmount user placedAt")
    .populate({ path: "user", select: "name email" })
    .lean();

  show("GET /api/orders?status=delivered — response rows", recent);
  show("The populated child is plain too", {
    userIsMongooseDocument: recent[0].user instanceof mongoose.Document, // false
    userHasSave: typeof recent[0].user?.save, // "undefined"
  });
  note(
    "populate still costs its second query — lean doesn't change WHAT is " +
      "fetched, only that nothing gets hydrated afterwards. (Populate " +
      "virtuals like product.reviews also work with lean: stitching just " +
      "writes the array onto the plain object.) This filter + select + " +
      "sort + limit + populate + lean chain is the single most common " +
      "query shape in production Mongoose code — worth memorizing."
  );

  // --------------------------------------------------------------------
  section("5. When lean is WRONG");
  // The trade-off, demonstrated: mutate a lean object and nothing can
  // persist it. (Read-only lesson — we mutate only our local copy, the
  // database is never touched.)
  const editable = await Order.findOne().select("orderNumber status").lean();
  editable.status = "cancelled"; // changes ONLY this local object
  show("Mutated lean object", {
    localStatus: editable.status,
    canSave: typeof editable.save, // "undefined" — no way to persist
  });

  const check = await Order.findOne({ orderNumber: editable.orderNumber })
    .select("status")
    .lean();
  show("Same order re-read from the database", { status: check.status });
  note(
    "The database never saw our edit — a lean object is a disconnected " +
      "copy. The dangerous version of this bug is subtler: code that " +
      "RECEIVES a document, mutates it, and assumes the caller will save " +
      "it — if the caller went lean, the write silently vanishes. " +
      "DECISION RULE: use lean for read-only paths (API lists, exports, " +
      "reports — any query that ends in res.json). Do NOT use lean when " +
      "you will .save(), when you need virtuals/getters/methods (unless " +
      "you add mongoose-lean-virtuals), or when middleware relies on " +
      "document state. Many teams codify it as: every find that doesn't " +
      "end in .save() gets .lean() — and module 12 (indexes) picks up the " +
      "other half of read performance: making the FINDING fast too."
  );
});
