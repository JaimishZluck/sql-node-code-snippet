# Module 16 — Native driver & utilities

Mongoose is not a database client. It is a layer **on top of** one: the
official `mongodb` Node.js driver. Every query in this bootcamp was eventually
translated into a driver call, and the driver is always right there under your
feet:

```js
mongoose.connection.getClient()      // MongoClient — the connection pool
mongoose.connection.db               // Db          — the database
mongoose.connection.db.collection()  // Collection  — where operations live
Model.collection                     // the same Collection, via a model
```

Knowing where that seam is matters for three reasons:

1. **Some capabilities are driver-only** — admin commands, `db.command()`,
   change streams, collection creation with server-side validators.
2. **The driver bypasses every Mongoose feature** — no validation, no casting,
   no defaults, no middleware, no virtuals. Sometimes that is exactly the
   point (a migration that must write data your current schema would reject);
   usually it is a bug waiting to happen.
3. **Driver documentation stops being confusing** once you can map it onto
   what Mongoose has been doing for you.

| | Mongoose | Native driver |
| --- | --- | --- |
| Returns | `Query` (deferred), Documents | `Cursor` → `.toArray()`, plain objects |
| Validation | yes | **no** |
| Casting (`"5000"` → `5000`) | yes | **no** |
| Defaults, setters, timestamps | yes | **no** |
| Middleware / hooks | yes | **no** |
| Virtuals, `toJSON` transforms | yes | **no** |
| Admin commands, change streams | limited | **yes** |
| Overhead | some | minimal |

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-native-vs-mongoose.js` | `npm run lesson 16-native-driver-and-utilities/01-native-vs-mongoose` | finding the driver under Mongoose, the same query both ways, what the driver skips (validation/defaults/setters/hooks), no casting, `bulkWrite` with five operation types, `db.command()`, a decision guide, and change streams |
| `02-utility-operations.js` | `npm run lesson 16-native-driver-and-utilities/02-utility-operations` | listing collections, `dbStats`/`collStats`, `createCollection` with `$jsonSchema`, capped/timeseries/clustered options, index create/list/drop, `$indexStats`, Mongoose's `autoIndex`/`syncIndexes`, renaming, and a hard look at destructive operations |

**Safety:** all writes go into temporary collections (`tmp_native_lab`,
`tmp_utils_lab`) which are dropped at the end. The five seeded collections are
**only inspected** — never written, never re-indexed, never dropped.

---

## Topic: The native driver

**What is it?** The official MongoDB client for Node.js. Mongoose depends on
it and exposes its objects through the connection you already have.

**Why does it exist?** (what problem it solves) It speaks MongoDB's wire
protocol, manages the connection pool, handles server discovery and failover,
and exposes every server capability. Mongoose adds schemas and ergonomics on
top; it does not replace any of that.

**When should I use it directly?**
- **Migrations and one-off data fixes** — you often *need* to bypass current
  validation to fix data written under an older schema.
- **Admin and diagnostics** — `collStats`, `serverStatus`, profiling controls,
  `currentOp`.
- **Collection/index management scripts.**
- **Change streams.**
- **Bulk paths** where hydration is measurable overhead.
- **Collections with no Mongoose model** (a legacy table, an audit log).

**When should I avoid it?** In ordinary application code. Anything touching
user input should go through a model so that casting and validation happen.
"I'll just use the driver here, it's simpler" is how invalid documents get in.

**Important terms**
- **`MongoClient`** — owns the connection pool. Reach it with
  `mongoose.connection.getClient()`; **never** construct a second one when a
  Mongoose connection exists, or you double your sockets and leak a pool.
- **`Db` / `Collection`** — the database and collection handles.
- **Cursor** — what driver reads return. Call `.toArray()`, or iterate with
  `for await`.
- **`db.command(doc)`** — the escape hatch. Anything mongosh can run, this can
  run.
- **`bulkWrite(ops, { ordered })`** — many operations in one round trip.
  `ordered: false` runs them in parallel and continues past failures;
  `ordered: true` (default) stops at the first error.
- **Upsert** — update if it exists, insert if it does not
  (`{ upsert: true }`).
- **Change stream** — a live feed of changes (`Model.watch()`). Requires a
  replica set; resumable via the `_id` resume token.

**Code example** — `01-native-vs-mongoose.js`, sections 3–5:

```js
// The driver stores this happily — no required, no enum, no min, no setters:
await db.collection("tmp_native_lab").insertOne({
  age: -50, role: "definitely-not-a-real-role", randomField: "the driver does not care",
});

// One round trip, five operations:
await coll.bulkWrite([
  { updateOne: { filter: { code: "B-1" }, update: { $set: { tier: "gold" } } } },
  { updateMany: { filter: { qty: { $gte: 7 } }, update: { $set: { tier: "silver" } } } },
  { insertOne: { document: { code: "B-99" } } },
  { deleteOne:  { filter: { code: "B-0" } } },
  { updateOne: { filter: { code: "B-100" }, update: { $set: { qty: 100 } }, upsert: true } },
], { ordered: false });
```

**Expected result** — the invalid document is stored intact, with `age: -50`
and the unknown field preserved. The `bulkWrite` reports
`insertedCount`, `matchedCount`, `modifiedCount`, `deletedCount`, and
`upsertedCount` from a single command.

**Common mistakes**
- **`new MongoClient(uri)` alongside Mongoose.** A second pool, and
  `disconnectDB()` will not close it.
- **Forgetting to cast ids.** `{ _id: "665f…" }` matches nothing through the
  driver. Wrap it: `new mongoose.Types.ObjectId(id)`.
- **Using the driver "just for this one query"** in a controller, and losing
  validation on a write path.
- **Expecting hooks to fire.** `bulkWrite` and every driver call skip
  middleware entirely — including your soft-delete filter and password
  hashing.
- **Forgetting `.toArray()`.** A cursor is not an array.

**Real-world usage** — migration scripts, admin dashboards showing server
health, index management in a deploy step, and change streams feeding a search
index or a websocket.

**Related concepts** — [module 02](../02-connections/README.md) (the pool you
are reaching into), [module 13](../13-validation-middleware-virtuals/README.md)
(everything the driver skips), [module 11](../11-aggregation/README.md) (the
same no-casting rule).

---

## Topic: Utility and administrative operations

**What is it?** Operations that manage the database rather than the data:
creating collections with options, managing indexes, reading statistics,
renaming, and dropping.

**Why do they exist?** (what problem they solve) Collections normally appear
implicitly on first write, which is convenient and gives you no control. When
you need a server-side validator, a capped collection, a specific collation,
or indexes that exist *before* the first query, you must create things
explicitly. And when something is slow or oversized, `collStats` and
`$indexStats` are how you find out why.

**When should I use them?** In deploy/migration scripts (`createCollection`,
`createIndexes`), in admin endpoints (`collStats`, `dbStats`), and in
diagnostics (`$indexStats`, profiling).

**When should I avoid them?** In request handlers. Creating an index on a
large collection can stall an application; dropping anything from a controller
is how outages happen.

**Important terms**
- **`$jsonSchema` validator** — a **server-side** schema attached to a
  collection. Unlike Mongoose validation this cannot be bypassed — the third
  and strongest validation layer from module 13.
- **`validationAction`** — `"error"` rejects invalid writes; `"warn"` only
  logs (useful when introducing validation to existing data).
- **`validationLevel`** — `"strict"` checks all writes; `"moderate"` only
  checks documents that already conform.
- **Capped collection** — fixed size, oldest documents overwritten. Logs and
  ring buffers.
- **Time-series collection** — optimized storage for metrics with a `timeField`.
- **`autoIndex`** — Mongoose's default of building declared indexes at
  startup. **Set `autoIndex: false` in production** — an index build on a
  large collection at boot can stall your app.
- **`syncIndexes()`** — creates declared indexes **and drops undeclared
  ones**. Powerful, and it will happily remove an index someone added by hand
  during an incident.
- **`ensureIndexes()` / `createIndexes()`** — creates missing indexes without
  dropping anything. The safer deploy step.
- **`$indexStats`** — how many times each index has been used since server
  start. The tool for finding dead indexes.
- **`rename(target, { dropTarget })`** — atomic, preserves documents and
  indexes, does not cross databases. The zero-downtime rebuild trick.

**Code example** — `02-utility-operations.js`, sections 2 and 5:

```js
await db.createCollection("tmp_utils_lab", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["code", "qty"],
    properties: { qty: { bsonType: "int", minimum: 0 } },
  } },
  validationAction: "error",
});

// Which indexes is anyone actually using?
await Product.aggregate([{ $indexStats: {} }]);
```

**Expected result** — the invalid insert is rejected by the **server**, not by
Mongoose. `$indexStats` lists each index on `products` with an `accesses.ops`
count — several will be `0` in a fresh session, which is exactly the signal
you would investigate in production.

**Common mistakes**
- **Leaving `autoIndex: true` in production.** A schema change triggers an
  index build at startup on a live collection.
- **Running `syncIndexes()` casually.** It drops indexes not declared in the
  schema — including the emergency one someone added last week.
- **Trying to modify an index's options.** You cannot; you must drop and
  recreate, which leaves a window with no index at all. Plan it.
- **`deleteMany({})` when you meant `deleteMany(filter)`.** Always run
  `countDocuments(filter)` first.
- **Putting destructive operations in application code.** They belong in named
  scripts — in this repo, `src/seeders/reset.js` and nowhere else.
- **Assuming `drop()` and `deleteMany({})` are equivalent.** `drop()` removes
  indexes too and is instant; `deleteMany` keeps indexes, is per-document, and
  fires middleware.

**Real-world usage** — a deploy step that runs `createIndexes()`; an admin
health endpoint surfacing `dbStats`; a quarterly index audit with
`$indexStats`; the rename-over trick for rebuilding a derived collection.

**Related concepts** — [module 12](../12-indexes-and-performance/README.md)
(what to index and why), [module 13](../13-validation-middleware-virtuals/README.md)
(the three validation layers),
[module 18](../18-production-and-security/README.md) (operating this safely).

---

## Check yourself

1. How do you reach the native driver from an existing Mongoose connection,
   and why must you not create a `new MongoClient`?
2. Name four things a driver write skips that a model write would do.
3. `db.collection("products").countDocuments({ _id: someIdString })` returns
   0 but the product exists. Why?
4. When is bypassing Mongoose validation the *correct* choice?
5. What is the difference between `drop()` and `deleteMany({})`?
6. Why should `autoIndex` be `false` in production, and what should run
   instead?
7. What does `syncIndexes()` do that `createIndexes()` does not, and when is
   that dangerous?
8. Your indexes are larger than your data. What do you check next?

**Next:** [module 17 — API patterns](../17-api-patterns/README.md), where all
of this becomes a runnable Express API.
