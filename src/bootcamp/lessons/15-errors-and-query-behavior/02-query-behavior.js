/**
 * LESSON 15-errors-and-query-behavior/02-query-behavior — When does it run?
 *
 * `User.find({ role: "admin" })` does not query the database. It builds a
 * Query OBJECT. Nothing is sent until you await it, call .then(), or call
 * .exec(). Understanding that one fact explains chaining, why you can build a
 * filter conditionally, why reusing a query throws, and why a forgotten
 * `await` returns something that looks almost right.
 *
 * This lesson makes the boundary visible: exactly when the round trip
 * happens, what a cursor is, and what Mongoose does to your input on the way
 * out and your documents on the way back.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 15-errors-and-query-behavior/02-query-behavior
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

await runLesson("Errors 2/2 — How queries actually execute", async () => {
  // --------------------------------------------------------------------
  section("1. find() returns a Query, not results");
  const query = User.find({ role: "admin" });
  show("What find() actually gave us", {
    constructor: query.constructor.name,
    isAPromise: query instanceof Promise,
    "has .then (thenable)": typeof query.then === "function",
    "has .exec": typeof query.exec === "function",
    op: query.op,
    filterSoFar: query.getFilter(),
  });
  note(
    "A Query is a BUILDER. It has a .then method, which is why `await` works " +
      "on it — JavaScript calls .then on any 'thenable'. But it is not a " +
      "Promise, and the difference matters: a Promise has already started " +
      "its work, while a Query has not sent anything yet."
  );

  // --------------------------------------------------------------------
  section("2. Chaining mutates the SAME query object");
  const chained = User.find({ role: "customer" });
  const returned = chained.where("isActive").equals(true).sort({ name: 1 }).limit(3);
  show("Every chained method returns the same object", {
    "chained === returned": chained === returned,
    filterAfterChaining: chained.getFilter(),
    options: chained.getOptions(),
  });
  note(
    "Chaining is not building a new query each time — it is mutating one " +
      "object and returning it. That is what makes conditional query " +
      "building so natural (section 3), and also why you cannot reuse a " +
      "query after it has run (section 5)."
  );

  // --------------------------------------------------------------------
  section("3. Building a filter conditionally");
  // The practical payoff: assemble a query from request parameters across
  // several lines, then execute once.
  const fakeReqQuery = { minPrice: "5000", tag: "premium", sort: "price-desc" };

  const builder = Product.find({ isActive: true });
  if (fakeReqQuery.minPrice) builder.where("price").gte(Number(fakeReqQuery.minPrice));
  if (fakeReqQuery.tag) builder.where("tags").equals(fakeReqQuery.tag);
  if (fakeReqQuery.sort === "price-desc") builder.sort({ price: -1 });
  builder.select("name price tags").limit(4).lean();

  show("Filter assembled before execution", {
    filter: builder.getFilter(),
    options: builder.getOptions(),
    hasRunYet: false,
  });
  const results = await builder; // ← THIS is the round trip
  show("Now it ran", results);

  // --------------------------------------------------------------------
  section("4. await vs .then() vs .exec()");
  const t0 = process.hrtime.bigint();
  const viaAwait = await User.countDocuments({ role: "admin" });
  const viaExec = await User.countDocuments({ role: "admin" }).exec();
  const viaThen = await new Promise((resolve) =>
    User.countDocuments({ role: "admin" }).then(resolve)
  );
  show("Three ways to execute the same query", {
    await: viaAwait,
    exec: viaExec,
    then: viaThen,
    identical: viaAwait === viaExec && viaExec === viaThen,
    totalMs: Number((Number(process.hrtime.bigint() - t0) / 1e6).toFixed(2)),
  });
  show("Which should you use?", {
    await: "the normal choice — concise and clear",
    "exec()": "returns a REAL Promise, and gives noticeably better stack traces on error",
    "then()": "you almost never need it directly; await calls it for you",
    "the real difference": "without exec(), an error's stack trace often points at Mongoose internals rather than your code",
  });

  // --------------------------------------------------------------------
  section("5. A query can only be executed ONCE");
  const once = User.findOne({ role: "admin" });
  await once;
  const reuseError = await (async () => {
    try {
      await once;
      return "no error (Mongoose returned the cached result)";
    } catch (error) {
      return { name: error.name, message: error.message.slice(0, 120) };
    }
  })();
  show("Awaiting the same query twice", { outcome: reuseError });

  // clone() gives you a fresh, independent copy of the built query.
  const template = User.find({ role: "seller" }).select("name");
  const first = await template.clone();
  const second = await template.clone().sort({ name: -1 });
  show("clone() lets you reuse a built query safely", {
    firstCount: first.length,
    secondCount: second.length,
    "different sort applied to the clone": second[0]?.name !== first[0]?.name,
  });
  note(
    "Reusing an executed query is a real source of confusing bugs, " +
      "especially in middleware that receives a query and wants to count it " +
      "as well as run it. Always clone() first."
  );

  // --------------------------------------------------------------------
  section("6. The forgotten await");
  const forgotten = User.findOne({ role: "admin" }); // no await!
  show("What you get without await", {
    typeofResult: typeof forgotten,
    constructor: forgotten.constructor.name,
    "truthy in an if()": Boolean(forgotten),
    "accessing .name": forgotten.name,
  });
  await forgotten; // execute it so we do not leak an unrun query
  note(
    "This is why the bug is so slippery: `if (user)` is TRUE even when no " +
      "user exists, because a Query object is always truthy. `user.name` is " +
      "undefined rather than an error. The symptom appears three lines later " +
      "as 'undefined is not a valid value'. ESLint's no-floating-promises " +
      "(with a thenable-aware config) or TypeScript catches this instantly."
  );

  // --------------------------------------------------------------------
  section("7. Cursors — streaming instead of loading everything");
  // find() materializes the whole result set in memory. For large exports
  // that is fatal. A cursor pulls documents in batches.
  let scanned = 0;
  let revenue = 0;
  const cursor = Order.find({ status: "delivered" })
    .select("totalAmount")
    .lean()
    .cursor({ batchSize: 50 });

  // for await...of over a cursor keeps memory flat regardless of result size.
  for await (const doc of cursor) {
    scanned += 1;
    revenue += doc.totalAmount;
  }
  show("Streamed with a cursor", {
    documentsProcessed: scanned,
    revenue,
    memoryHeldAtOnce: "one batch (50 docs), not the full result set",
  });
  note(
    "Use a cursor for exports, migrations, and any job whose result set " +
      "could grow unbounded. The equivalent Order.find(...) would build an " +
      "array of every matching document in Node's heap — fine for 150 " +
      "orders, an out-of-memory crash for 15 million."
  );

  // --------------------------------------------------------------------
  section("8. What Mongoose does on the way out and back");
  // OUT: casting. Express query params are strings; the schema fixes them.
  const casted = Product.find({ price: { $gte: "50000" }, isActive: "true" });
  show("Casting your filter values (Mongoose, in Node.js)", {
    whatYouWrote: { price: { $gte: "50000" }, isActive: "true" },
    whatIsSent: casted.getFilter(),
  });
  await casted.countDocuments();

  // BACK: hydration. Documents become Mongoose Documents unless you lean().
  const [hydrated] = await Product.find().limit(1);
  const [leaned] = await Product.find().limit(1).lean();
  show("Hydration on the way back", {
    "hydrated: has save()": typeof hydrated.save === "function",
    "hydrated: has virtuals": hydrated.finalPrice !== undefined,
    "hydrated: tracks changes": typeof hydrated.isModified === "function",
    "lean: has save()": typeof leaned.save === "function",
    "lean: has virtuals": leaned.finalPrice !== undefined,
    "lean: is a plain object": leaned.constructor === Object,
  });
  note(
    "Casting is why { price: '50000' } works in find() but silently matches " +
      "NOTHING in aggregate() — the pipeline is sent verbatim, with no " +
      "schema involved. Hydration is why .lean() is faster and why it drops " +
      "your virtuals."
  );

  // --------------------------------------------------------------------
  section("9. Query options worth knowing");
  const withOptions = await Product.find({ isActive: true })
    // Kill the query server-side if it exceeds this. A cheap, effective
    // guard against one pathological query taking down a service.
    .maxTimeMS(5000)
    .select("name price")
    .limit(3)
    .lean();
  show("maxTimeMS + select + limit + lean", withOptions);
  show("Other options you should know", {
    "maxTimeMS(ms)": "server-side timeout. Set it on user-facing queries.",
    "hint(index)": "force a specific index. For diagnostics; a smell in production code.",
    "collation({ locale, strength })": "case/accent-insensitive comparisons and sorting",
    "batchSize(n)": "how many documents per network round trip on a cursor",
    "allowDiskUse()": "let a blocking sort/group spill past its memory limit",
    "session(s)": "run inside a transaction",
    "setOptions({...})": "set several at once, e.g. in middleware",
  });

  // --------------------------------------------------------------------
  section("10. Parallel vs sequential");
  // Independent queries should run concurrently. Awaiting them one by one is
  // a very common, very easy performance loss.
  const sequentialStart = process.hrtime.bigint();
  await User.countDocuments();
  await Product.countDocuments();
  await Order.countDocuments();
  const sequentialMs = Number(process.hrtime.bigint() - sequentialStart) / 1e6;

  const parallelStart = process.hrtime.bigint();
  await Promise.all([User.countDocuments(), Product.countDocuments(), Order.countDocuments()]);
  const parallelMs = Number(process.hrtime.bigint() - parallelStart) / 1e6;

  show("Three independent counts", {
    "sequential (ms)": Number(sequentialMs.toFixed(2)),
    "Promise.all (ms)": Number(parallelMs.toFixed(2)),
    speedup: Number((sequentialMs / parallelMs).toFixed(2)),
  });
  note(
    "The pool (module 02) has multiple sockets, so independent queries " +
      "genuinely travel in parallel. Rule: await sequentially only when a " +
      "query DEPENDS on the previous result; otherwise Promise.all. This is " +
      "the same insight as the N+1 fix in module 12, applied to unrelated " +
      "queries."
  );
  note(
    "Module 15 complete. Next: module 16 — the native driver underneath " +
      "Mongoose, and the collection/database admin operations it exposes."
  );
});
