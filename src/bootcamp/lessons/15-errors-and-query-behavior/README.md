# Module 15 — Errors & query behavior

Two topics that look unrelated and are not. Both are about the **boundary**
between your Node.js code and MongoDB: what crosses it, when it crosses, and
what comes back when something goes wrong.

The quality of an API is largely decided here. A `500 Internal Server Error`
because someone hit `/api/users/undefined` is a bug. A `400 Invalid id` is a
feature — and the difference is about fifteen lines of error handling.

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-common-errors.js` | `npm run lesson 15-errors-and-query-behavior/01-common-errors` | every error triggered on purpose and printed: `ValidationError`, `CastError`, E11000 (single and compound), null vs `DocumentNotFoundError`, strict-mode behavior, server-side operation errors, `VersionError`, connection/timeout errors — then one Express error handler mapping all of them |
| `02-query-behavior.js` | `npm run lesson 15-errors-and-query-behavior/02-query-behavior` | `find()` returns a **Query**, not results; chaining mutates one object; conditional filter building; `await` vs `.then()` vs `.exec()`; single execution and `clone()`; the forgotten `await`; cursors for streaming; casting out and hydration back; query options; parallel vs sequential |

**Safety:** lesson 02 is 100% read-only. Lesson 01 creates and deletes
temporary documents (`@lesson.test` emails, `ZZ-` SKUs) and briefly modifies
one seeded order's `notes` field to demonstrate `VersionError` — **restoring
it immediately**. Everything is cleaned up at both ends.

---

## Topic: Error types and what they mean

**What is it?** A small, finite set of error shapes. Learn these and you can
handle essentially anything MongoDB or Mongoose throws.

| Error | Thrown when | HTTP | Key fields |
| --- | --- | --- | --- |
| `ValidationError` | a schema rule failed | **400** | `error.errors` (keyed by field path) |
| `CastError` | a value cannot be converted to the schema type | **400** | `error.path`, `error.value` |
| `MongoServerError` code **11000** | a unique index rejected the write | **409** | `error.keyPattern`, `error.keyValue` |
| `DocumentNotFoundError` | `.orFail()` matched nothing | **404** | — |
| `VersionError` | the document changed since you loaded it | **409** | — |
| `StrictModeError` | a field outside the schema, with strict throwing | **400** | — |
| `MongoServerError` (other codes) | a bad stage, operator, or hint | **500** | `error.code` |
| `MongooseServerSelectionError` | cannot reach any server | **503** | — |
| `MongoNetworkError` | the connection dropped mid-operation | **503** | — |
| *"buffering timed out after 10000ms"* | you queried before `connect()` succeeded | **503** | — |

**Why do they exist?** (what problem they solve) Different failures need
different responses. A malformed id is the client's fault (400); a duplicate
email is a conflict the user can resolve (409); an unreachable database is
your fault and temporary (503); an invalid aggregation stage is your fault and
permanent (500). Collapsing them all to 500 destroys that information.

**When should I handle each?** All of them, once, in a central Express error
middleware. Handling errors per-controller means every new controller is a
chance to forget.

**When should I avoid catching?** Never swallow an error just to keep the
process alive. And never send `error.message` to the client for *unknown*
errors — it leaks index names, schema paths, and occasionally connection
strings.

**Important terms**
- **`error.errors`** — the per-field map on a `ValidationError`. Each entry
  has `kind` (which rule failed), `value`, and `message`. This is your
  response body.
- **`error.keyPattern` / `error.keyValue`** — on E11000, exactly which index
  and which value collided. Use them to say "that email is taken" instead of
  leaking `email_1 dup key`.
- **`.orFail()`** — turns a `null` result into a thrown
  `DocumentNotFoundError`, so 404 handling moves to your central handler.
  Accepts a custom error: `.orFail(new NotFoundError("User not found"))`.
- **Buffering timeout** — Mongoose queued your query while disconnected and
  gave up after 10s. **The real error is the failed connection** — look
  earlier in your logs.
- **Strict mode** — Mongoose silently drops unknown fields on save (which
  prevents mass-assignment attacks) but sends unknown fields in *filters*
  (which silently matches nothing). `strictQuery: "throw"` makes typos loud.

**Code example** — `01-common-errors.js`, section 9:

```js
if (error.name === "ValidationError") {
  return res.status(400).json({
    errors: Object.fromEntries(
      Object.entries(error.errors).map(([path, e]) => [path, e.message])
    ),
  });
}
if (error.code === 11000) {
  const field = Object.keys(error.keyPattern ?? {})[0] ?? "field";
  return res.status(409).json({ message: `That ${field} is already in use` });
}
```

**Expected result** — the lesson prints each error's real `name`, `code`,
`keyPattern`, and per-field detail, so you can see exactly what your handler
will be matching on.

**Common mistakes**
- **Letting a `CastError` from `findById` become a 500.** The single most
  common uncaught error in Express + Mongoose apps. Validate ids with
  `mongoose.Types.ObjectId.isValid()` or catch `CastError` centrally.
- **Treating E11000 as a `ValidationError`.** Different shape entirely — no
  `error.errors`, and `error.code === 11000` instead.
- **Forgetting that `findOne` returns `null` rather than throwing.** Every
  controller must check, or use `.orFail()`.
- **Sending raw error messages to clients.** Information disclosure.
- **Not logging the full error server-side.** You have then traded a bad user
  experience for no debugging information at all.
- **Chasing a "buffering timed out" error as if it were a slow query.** It is
  a connection failure.

**Real-world usage** — `src/middlewares/` in this repo, and in every
production Express app. Pair it with a request id in the log line so a user
reporting "it failed at 3pm" is traceable.

**Related concepts** — [module 13](../13-validation-middleware-virtuals/README.md)
(where `ValidationError` comes from, and error-handling middleware in the
model layer), [module 12](../12-indexes-and-performance/README.md) (unique
indexes producing E11000),
[module 14](../14-transactions-and-concurrency/README.md) (`VersionError` and
retrying), [module 02](../02-connections/README.md) (connection errors).

---

## Topic: How Mongoose queries actually execute

**What is it?** `Model.find(...)` returns a **`Query` object** — a builder.
Nothing reaches MongoDB until you `await` it, call `.then()`, or call
`.exec()`.

```js
const q = User.find({ role: "admin" });   // nothing sent
q.where("isActive").equals(true);          // still nothing sent
q.sort({ name: 1 }).limit(10);             // still nothing
const users = await q;                     // ← NOW the round trip happens
```

**Why does it exist?** (what problem it solves) Deferred execution is what
makes conditional query building possible. Request parameters arrive
piecemeal; you want to accumulate filters across several `if` statements and
then run once. If `find()` executed immediately, you would have to build a
plain filter object by hand and lose the fluent API.

**When should I care?** Whenever you build a query in pieces, pass a query to
another function, or wonder why something returned "almost right".

**When does it bite?** When you forget `await`. A `Query` is always truthy and
its properties are `undefined`, so `if (user) { … user.name … }` runs happily
and fails three lines later.

**Important terms**
- **Thenable** — an object with a `.then` method. `await` works on any
  thenable, which is why a `Query` can be awaited without being a Promise.
- **`.exec()`** — executes and returns a **real Promise**. Its main practical
  benefit is much better stack traces when the query errors.
- **`.clone()`** — a fresh copy of a built query. Required if you want to run
  the same built query more than once.
- **Cursor** — `.cursor()` streams documents in batches instead of
  materializing the whole result set. Use `for await (const doc of cursor)`.
- **Casting** — Mongoose converting your filter values to schema types on the
  way *out*. Why `{ price: { $gte: "50000" } }` works in `find()` and matches
  nothing in `aggregate()`.
- **Hydration** — turning raw BSON into Mongoose Documents on the way *back*.
  `.lean()` skips it.
- **`maxTimeMS(ms)`** — a server-side kill switch for a query that runs too
  long. Set it on user-facing queries.

**Code example** — `02-query-behavior.js`, sections 3 and 6:

```js
// Conditional building — the point of deferred execution
const q = Product.find({ isActive: true });
if (req.query.minPrice) q.where("price").gte(Number(req.query.minPrice));
if (req.query.tag)      q.where("tags").equals(req.query.tag);
const results = await q.select("name price").limit(20).lean();

// ⚠️ The forgotten await — always truthy, properties always undefined
const user = User.findOne({ email });   // no await
if (user) console.log(user.name);       // → undefined, no error
```

**Expected result** — the lesson prints `getFilter()` and `getOptions()` at
each build step *before* execution, then shows the results, making the
boundary unmistakable. The forgotten-`await` section prints
`constructor: "Query"` and `truthy: true`.

**Common mistakes**
- **Forgetting `await`.** Silent, and the symptom appears elsewhere. ESLint's
  `no-floating-promises` (thenable-aware) or TypeScript catches it instantly.
- **Reusing an executed query.** Use `.clone()`.
- **`find()` on an unbounded result set.** Use `.cursor()` for exports and
  migrations, or you will OOM.
- **Awaiting independent queries one at a time.** Use `Promise.all` — the
  connection pool has multiple sockets and they genuinely run in parallel.
- **Expecting casting in `aggregate()`.** It does not happen. Wrap ids in
  `new mongoose.Types.ObjectId(...)`.
- **Leaving `.hint()` in production code.** You have frozen a planner decision
  that should keep being re-evaluated.

**Real-world usage** — every list endpoint with optional filters; export jobs
using cursors; `Promise.all` in dashboard controllers; `maxTimeMS` as a
service-wide guard.

**Related concepts** — [module 05](../05-querying/README.md) (building
filters), [module 10](../10-populate-and-lean/README.md) (`lean()` and
hydration), [module 11](../11-aggregation/README.md) (no casting in
pipelines), [module 12](../12-indexes-and-performance/README.md) (N+1 and
parallelism).

---

## Check yourself

1. A user requests `/api/users/undefined`. Which error is thrown, and what
   status should you return?
2. What is on `error.keyPattern`, and which error carries it?
3. Why does `User.findOne({ email })` return `null` rather than throwing, and
   what is the one-word fix if you want a 404?
4. `if (user) { … }` is true even though no user exists. What did the code
   forget?
5. Why does `{ price: { $gte: "5000" } }` work in `find()` but match nothing
   in `aggregate()`?
6. When must you call `.clone()`?
7. You need to export 5 million orders to CSV. What must you *not* use, and
   what should you use instead?
8. "Operation `users.find()` buffering timed out after 10000ms." What is the
   actual problem?

**Next:** [module 16 — Native driver & utilities](../16-native-driver-and-utilities/README.md),
where you meet the driver Mongoose has been sitting on top of all along.
