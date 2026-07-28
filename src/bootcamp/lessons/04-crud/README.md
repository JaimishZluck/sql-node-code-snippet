# Module 04 — CRUD: every way to Create, Read, Update, and Delete

Almost everything a backend ever does is one of four moves: **C**reate new data,
**R**ead it back, **U**pdate it, or **D**elete it — CRUD. Registering a user is
a create. A product page is a read. "Mark order as shipped" is an update.
"Remove from cart" is a delete. This module walks through **every** CRUD method
Mongoose gives you, one by one, and — just as important — the differences
between methods that look almost identical.

Before the individual topics, burn in the two big ideas of this module:

**Idea 1 — every Mongoose method becomes a MongoDB command.** Mongoose runs in
your Node.js process. When you call `User.updateOne(...)`, Mongoose casts and
prepares your input, then sends a plain MongoDB command over the wire. The
server does the actual work:

| You call (Mongoose, in Node) | MongoDB runs (on the server) |
| --- | --- |
| `create()` / `save()` | `insert` (one document at a time) |
| `insertMany()` | `insert` (whole batch, one command) |
| `find()` / `findOne()` / `findById()` | `find` |
| `updateOne()` / `updateMany()` / `replaceOne()` | `update` |
| `findOneAndUpdate()` / `findOneAndReplace()` / `findOneAndDelete()` | `findAndModify` (read + write as ONE atomic command) |
| `deleteOne()` / `deleteMany()` | `delete` |
| `countDocuments()` / `estimatedDocumentCount()` | `aggregate` / `count` |
| `distinct()` | `distinct` |

Everything Mongoose adds — type casting, defaults, validators, middleware —
happens **before** the command is sent. MongoDB itself enforces almost none of
your schema (only real indexes, like the unique index on `email`).

**Idea 2 — know your return shape.** Most CRUD bugs come from assuming the
wrong return value. Every operation in this module belongs to one of three
families:

| Family | Operations | You get back |
| --- | --- | --- |
| **Documents** | `create`, `insertMany`, `find`, `findOne`, `findById`, `findOneAndUpdate`, `findByIdAndUpdate`, `findOneAndReplace`, `findOneAndDelete`, `findByIdAndDelete` | the document(s) themselves (`[]` or `null` when nothing matches) |
| **Result summaries** | `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany` | a small stats object: `{ matchedCount, modifiedCount }` or `{ deletedCount }` — never the document |
| **Plain values** | `countDocuments`, `estimatedDocumentCount` (number), `distinct` (array of values), `exists` (`{ _id }` or `null`) | a primitive-ish value, not documents |

If you remember nothing else from this chapter, remember this table.

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-create.js` | `npm run lesson 04-crud/01-create` | `create()` (one + array), `insertMany()` (+ `ordered:false`), native `insertOne` |
| `02-read.js` | `npm run lesson 04-crud/02-read` | `find`, `findOne`, `findById` (+ the `undefined` pitfall), counting, `distinct`, `exists` |
| `03-update.js` | `npm run lesson 04-crud/03-update` | `updateOne/Many`, `findOneAndUpdate` vs counts, `runValidators`, `replaceOne`, `findOneAndReplace`, upsert |
| `04-delete.js` | `npm run lesson 04-crud/04-delete` | `deleteOne/Many`, `findOneAndDelete`, `findByIdAndDelete`, `doc.deleteOne()`, the `deleteMany({})` danger |

**Safety:** `02-read.js` is purely read-only. The other three lessons mutate
**only temporary practice documents** they create themselves — users with
emails ending `@lesson.test`, products with SKUs starting `ZZ-`, and a
throwaway `tmp_` collection. Each lesson sweeps leftovers at the start and
cleans up after itself in a `finally` block, so you can run them in any order,
as many times as you like, without reseeding.

> **Mongoose 8 warning for tutorial readers:** many older blog posts use
> methods that **no longer exist**: `Model.count()`, `Model.update()`,
> `Model.remove()`, `doc.remove()`, `findOneAndRemove()`, `findByIdAndRemove()`,
> and callback-style calls (`User.find({}, (err, docs) => ...)`). In Mongoose 8
> you use the methods in this module, always with `await`.

---

## Topic: `Model.create()` — one document or several

**What is it?** The standard way to insert documents through Mongoose.
`User.create(doc)` builds a document from your object, runs the **full**
Mongoose pipeline on it — casting, setters (`trim`, `lowercase`), defaults,
validators, and `save` middleware — and then sends one `insertOne` to MongoDB.
Passing an array (`User.create([a, b])`) does all of that **per element** and
returns an array.

**Why does it exist?** (what problem it solves) Without it you would write
`const doc = new User(data); await doc.save();` every time. `create()` is
exactly that, in one call. More importantly, it is the "safe path": nothing
reaches the database without passing every rule in your schema.

**When should I use it?** For normal application writes — user signup, adding
a product, posting a review. Any time a single (or a few) documents are being
created because something happened in your app.

**When should I avoid it?** For bulk loads. `create([a, b, c, ...])` issues
one insert **per document** — importing 10,000 rows means 10,000 round trips.
Use `insertMany()` for that (next topic).

**Parameters** — `create(docOrArray, options?)`. The first argument is a plain
object (or array of them) matching your schema shape. You will rarely need the
options here.

**Return value** — the saved **document** (a full Mongoose document with
`_id`, defaults, timestamps, and methods like `.save()`), or an **array of
documents** when you passed an array. Array in → array out; one in → one out.

**Important terms**
- **Casting** — Mongoose converting your input to the schema's types (the
  string `"28"` becomes the number `28`) before anything else happens.
- **Setter** — a transform that runs on assignment: `lowercase: true` on
  `email` turns `"A@B.COM"` into `"a@b.com"` before saving.
- **Default** — a value filled in for fields you did not provide (`role`
  becomes `"customer"`).
- **Validator** — a rule checked before saving (`age` must be ≥ 13). Fails →
  `ValidationError`, and **nothing is sent to the server**.
- **Middleware (hooks)** — functions registered to run before/after `save`
  (module 13). `create()` triggers them; that matters when hooks hash
  passwords or send emails.

**Code example** — `01-create.js`, sections 1–3:

```js
const asha = await User.create({
  name: "  Asha Lessondemo  ",          // will be trimmed
  email: "Asha.Creator@LESSON.TEST",    // will be lowercased
  age: 28,
});
// asha.role === "customer" (default), asha.createdAt exists (timestamps)
```

**Expected result** — the printed document shows trimmed/lowercased values,
all defaults filled, `createdAt`/`updatedAt` set, and an `_id` — which Mongoose
generated **client-side** in Node (ObjectIds do not require a database round
trip; that is part of their design — see module 01).

**Common mistakes**
- Expecting MongoDB to reject invalid data. It won't — validation is
  **Mongoose-only**, running in Node. The server checks nothing but real
  indexes (like unique `email`).
- Assuming `create([...])` is atomic. If element 3 fails validation, elements
  1–2 that were already saved **stay saved**. Multi-document atomicity needs
  transactions (module 14).
- Forgetting that a *duplicate email* error is **not** a `ValidationError` —
  it is an `E11000` duplicate-key error thrown by the **database** (module 15).

**Real-world usage** — the body of nearly every `POST` route:
`const user = await User.create(req.body)` (after input sanitizing), then
`res.status(201).json(user)`.

**Related concepts** — `insertMany()` (below) for bulk speed; module 13 for
validation and middleware in depth; module 15 for telling apart
`ValidationError` vs `E11000`.

---

## Topic: `Model.insertMany()` — one bulk insert (and `ordered: false`)

**What is it?** A bulk insert: `Product.insertMany([a, b, c])` casts and
validates every document in Node, then sends the **whole batch as one
`insert` command**. One round trip, no matter how many documents.

**Why does it exist?** (what problem it solves) Speed. `create([...])` does N
network round trips and runs full middleware N times. For imports, seeders,
and migrations that is painfully slow. `insertMany` trades a little Mongoose
machinery for a big performance win.

**When should I use it?** Bulk situations: importing a product catalog,
seeding test data (this repo's seeder uses it), migrating records, writing
many log entries at once.

**When should I avoid it?** When your schema relies on `save` middleware
(e.g. a `pre('save')` hook that hashes passwords). `insertMany` does **not**
run document `save` hooks — only `pre('insertMany')` hooks. Casting,
validation, and timestamps still happen; per-document `save` middleware does
not.

**Parameters** — `insertMany(docs, options?)`. Options that matter:
- `ordered` (default `true`) — insert in order and **stop at the first
  error**, or (`false`) attempt every document and report all failures at the
  end.
- `lean: true` — skip hydrating (and validating) the docs in Mongoose;
  fastest possible path, use only for trusted data.
- `rawResult: true` — return the raw driver result instead of documents.

**Return value** — an array of the inserted **documents** (hydrated, with
`_id` and timestamps). On partial failure it **throws** a
`MongoBulkWriteError`; with `ordered: false` Mongoose attaches
`error.insertedDocs` (what made it in) and `error.writeErrors` (what failed
and why).

**Important terms**
- **Bulk write** — many write operations shipped to the server in one
  command.
- **Ordered / unordered** — whether the server stops at the first failure
  (ordered) or keeps going and reports all failures afterwards (unordered).
- **Partial failure** — some documents inserted, some rejected. There is **no
  rollback**: an insert batch is not a transaction.

**Code example** — `01-create.js`, sections 4–6:

```js
try {
  await Product.insertMany(batch, { ordered: false });
} catch (error) {
  console.log(error.insertedDocs.length); // docs that DID land
  console.log(error.writeErrors.length);  // docs that failed, with reasons
}
```

**Expected result** — in the lesson, a 3-doc ordered batch with a duplicate
SKU in position 2 leaves exactly **1** document behind (doc 1 inserted, doc 2
rejected by the unique index, doc 3 never attempted). The same shape with
`ordered: false` leaves **3 of 4** (only the duplicate is skipped).

**Common mistakes**
- Believing "it threw, so nothing was inserted." **False.** With
  `ordered: true`, everything before the bad doc is already in the database.
  Check the database (or `error.insertedDocs`) — never assume.
- Using `insertMany` for user signups on a schema whose `pre('save')` hook
  hashes passwords — the hook silently never runs and you store plaintext.
- Re-running a failed import from the top and creating duplicates of the docs
  that had succeeded the first time.

**Real-world usage** — data import endpoints and scripts almost always use
`insertMany(rows, { ordered: false })`, then log `error.writeErrors` so one
bad row does not abort a 50,000-row import.

**Related concepts** — `create()` for the full-middleware path; module 14
(transactions) when all-or-nothing batches are genuinely required; module 15
for `E11000` duplicate-key errors.

---

## Topic: under the hood — the native driver's `insertOne`

**What is it?** The raw MongoDB way to insert, with Mongoose completely out of
the picture. Through the already-open connection:
`mongoose.connection.db.collection("users").insertOne({...})`.

**Why does it exist?** (what problem it solves) The `mongodb` driver is what
actually talks to the server — Mongoose is a layer on top of it. Seeing a raw
insert once makes it obvious **which** safety rails are Mongoose's: a raw
insert skips casting, setters, defaults, validators, timestamps, and
middleware. MongoDB stores exactly the bytes you send and asks no questions.

**When should I use it?** Rarely, and deliberately: admin scripts, migrations
touching fields outside the schema, or performance-critical paths where you
have measured Mongoose overhead and accepted the risk. Module 16 covers the
native driver properly.

**When should I avoid it?** In application code. A collection written by both
raw driver calls and Mongoose ends up with documents of inconsistent shape —
the worst of both worlds.

**Parameters** — `insertOne(doc, options?)`: a plain object; no schema is
consulted.

**Return value** — **not** a document: an acknowledgement,
`{ acknowledged: true, insertedId: ObjectId(...) }`.

**Important terms**
- **Driver** — the official low-level `mongodb` npm package. Mongoose wraps
  it; `mongoose.connection.db` exposes it on the same open connection pool.
- **ODM (Object-Document Mapper)** — what Mongoose is: schemas, casting,
  validation, middleware layered on top of the driver.

**Code example** — `01-create.js`, section 7:

```js
const raw = mongoose.connection.db.collection("users");
await raw.insertOne({ name: "Raw Driverdemo", email: "raw.driver@lesson.test" });
```

**Expected result** — reading the doc back **with the raw driver** shows what
was stored: no `isActive`, no `loyaltyPoints`, no `interests`, no timestamps —
none of the schema's defaults exist. The schema lives in Node, not in MongoDB.

**Common mistakes**
- Verifying a raw insert by reading it back **through the model** — Mongoose
  fills defaults in memory while hydrating, hiding the missing fields and
  making the doc look healthier than it is.
- Assuming MongoDB will reject a doc that violates the schema. It cannot — it
  has never seen your schema.

**Real-world usage** — one-off maintenance scripts (`renameField.js`,
backfills) often go raw on purpose to touch documents exactly as stored.

**Related concepts** — module 16 (native driver vs Mongoose, side by side);
module 03 (which rules are Mongoose's vs the database's).

---

## Topic: `Model.find()` — many documents

**What is it?** The workhorse read: `User.find(filter)` returns **every**
document matching the filter, as an array.

**Why does it exist?** (what problem it solves) Nearly every list in every UI
— products in a category, a user's orders, all pending shipments — is a
filtered subset of one collection. `find()` is that operation.

**When should I use it?** Whenever you expect **zero or more** documents.

**When should I avoid it?** When you want exactly one (use `findOne` /
`findById` — clearer intent, less data on the wire), or when the collection is
large and you have no filter/limit — `find({})` on millions of docs will
happily try to hand you millions of docs.

**Parameters** — `find(filter, projection?, options?)`:
- `filter` — which docs to match. `{}` matches all. Dot notation reaches into
  embedded docs: `{ "address.city": "Mumbai" }`. Rich operators (`$gt`, `$in`,
  `$or`...) are module 05's whole subject.
- `projection` — which **fields** to return (module 06).
- `options` — `sort`, `limit`, `skip`, etc. — usually written as chained
  calls: `.sort(...).limit(...)` (module 06).

**Return value** — always an **array** of documents. Zero matches → `[]`,
**never** `null`, and never an error.

**Important terms**
- **Filter (query object)** — the "WHERE clause" of MongoDB, itself written as
  a document.
- **Dot notation** — `"address.city"` — the path syntax for fields inside
  embedded documents.
- **Query object / thenable** — `find()` does not hit the database
  immediately; it returns a `Query` you can keep chaining. It executes when
  you `await` it (module 15 digs into this).
- **Hydration** — turning raw BSON from the server into full Mongoose
  documents with methods and virtuals.

**Code example** — `02-read.js`, section 1:

```js
const mumbaiCustomers = await User.find({
  role: "customer",
  isActive: true,
  "address.city": "Mumbai",
});
```

**Expected result** — an array of user documents; the lesson also shows that a
no-match query prints `[]` and that `find({})` returns all ~30 users.

**Common mistakes**
- `if (!users) return 404` — **never fires**, because `[]` is truthy in
  JavaScript. Test `users.length === 0`.
- Listing endpoints without `limit` — fine on seed data, an outage in
  production.
- Multiple conditions on the same field the wrong way:
  `{ price: { $gt: 100 }, price: { $lt: 500 } }` — the second key silently
  overwrites the first in JavaScript. Combine them:
  `{ price: { $gt: 100, $lt: 500 } }`.

**Real-world usage** — every `GET /products?category=...&sort=...` style
endpoint is a `find()` with filter + sort + pagination glued on.

**Related concepts** — module 05 (query operators), module 06
(projection/sort/pagination), module 10 (`lean()` for fast read-only lists).

---

## Topic: `Model.findOne()` — the first match

**What is it?** `findOne(filter)` returns a **single** matching document, or
`null`.

**Why does it exist?** (what problem it solves) "Get the user with this
email" should not return an array you then unwrap. `findOne` asks the server
for one doc, transfers one doc, and gives you one doc.

**When should I use it?** When the filter identifies (at most) one document —
lookups by unique fields like `email`, `sku`, `orderNumber` — or when any one
example of a kind is fine.

**When should I avoid it?** When several docs can match **and you care which
one you get**. MongoDB returns the first in *natural order* (roughly: whatever
it encounters first) — effectively arbitrary. Add `.sort()` to define "first",
or use `find()`.

**Parameters** — `findOne(filter, projection?, options?)` — same shape as
`find`.

**Return value** — a **document or `null`**. Contrast with `find`: empty
result is `null` here, `[]` there.

**Important terms**
- **Natural order** — the order documents happen to be scanned in when no
  sort is given. Not insertion order, not `_id` order — **unspecified**. Never
  rely on it.

**Code example** — `02-read.js`, section 2:

```js
const anAdmin = await User.findOne({ role: "admin" });        // one of the 2
const outOfStock = await Product.findOne({ stock: 0, isActive: true });
```

**Expected result** — one admin (which of the two is unspecified), one
out-of-stock product, and `null` for an email that matches nobody.

**Common mistakes**
- Treating "which doc came back" as stable when the filter matches several.
- Forgetting the `null` check and crashing on `user.name` (`TypeError:
  Cannot read properties of null`).
- Using `findOne` to test existence — `exists()` (below) is cheaper and says
  what you mean.

**Real-world usage** — login flows:
`const user = await User.findOne({ email: req.body.email })`, then verify the
password, then `if (!user) return 401`.

**Related concepts** — `findById` for `_id` lookups; `exists()` for pure
existence checks; module 06 for sorting when "first" must mean something.

---

## Topic: `Model.findById()` — and the `undefined` pitfall

**What is it?** `findById(id)` is sugar for `findOne({ _id: id })` — the
primary-key lookup. Mongoose casts an id **string** to an `ObjectId` for you.

**Why does it exist?** (what problem it solves) `_id` lookups are the single
most common query in any REST API (`GET /users/:id`), so they get a
dedicated, intention-revealing method — with one extra safety behavior that
`findOne` lacks (see the pitfall).

**When should I use it?** Every time you fetch by `_id`. Prefer it over
`findOne({ _id })` — same query, safer edge case.

**When should I avoid it?** When you are looking up by anything else
(`email`, `sku`, `slug`) — that is `findOne`'s job.

**Parameters** — `findById(id, projection?, options?)`; `id` may be an
`ObjectId` or a 24-character hex string.

**Return value** — a **document or `null`**. Three outcomes to handle:
1. Valid id, match → the document.
2. Valid-**shape** id, no match → `null` (typically your 404).
3. Malformed string (`"abc"`) → **`CastError` thrown by Mongoose in Node**,
   before any query is sent (typically your 400).

**The `undefined` pitfall (read this twice).** Mongoose **strips keys whose
value is `undefined`** from query filters. So if a variable you expected to
hold an id is `undefined`:

```js
await User.findOne({ _id: someUndefinedVar }); // becomes findOne({})
// → returns an ARBITRARY REAL USER. In a profile route, that is a data leak.

await User.findById(someUndefinedVar);         // special-cased by Mongoose
// → treated as { _id: null } → safely returns null
```

`findById(undefined)` is guarded; `findOne({ _id: undefined })` is a trap.
This exact bug ships to production regularly — a missing request field, and
suddenly the endpoint serves someone else's data.

**Important terms**
- **`CastError`** — Mongoose's "this value cannot become the schema type"
  error. Client-side, thrown before the server is contacted.
- **`ObjectId`** — MongoDB's 12-byte id type (module 01). Generate a fresh
  one with `new mongoose.Types.ObjectId()`.

**Code example** — `02-read.js`, sections 3–4 demonstrate all three outcomes
plus both sides of the pitfall.

**Expected result** — the same admin fetched again by `_id`; a `CastError` for
`"definitely-not-an-objectid"`; `null` for a fresh random ObjectId; a **real
user leaked** by `findOne({ _id: undefined })`; `null` from
`findById(undefined)`.

**Common mistakes**
- Mapping `CastError` and "not found" to the same HTTP status. They are
  different problems: 400 (bad input shape) vs 404 (absent).
- Building filters straight from request data without checking for
  `undefined` — the pitfall above.
- Comparing ObjectIds with `===`. They are objects: use
  `a._id.equals(b._id)`, or compare `String(a._id) === String(b._id)`.

**Real-world usage** — `GET /:id` handlers everywhere:
`const doc = await Product.findById(req.params.id); if (!doc) return res.status(404)...`.

**Related concepts** — module 01 (ObjectId internals), module 15 (error
taxonomy), `findByIdAndUpdate` / `findByIdAndDelete` below (same sugar for
writes).

---

## Topic: counting — `countDocuments()` vs `estimatedDocumentCount()`

**What is it?** Two ways to ask "how many?":
- `countDocuments(filter?)` — **counts matching documents for real**, by
  running the query machinery server-side. Accurate; accepts any filter.
- `estimatedDocumentCount()` — reads the document count the server already
  keeps in **collection metadata**. Near-instant, **no filter possible**.

**Why does it exist?** (what problem it solves) Counting by fetching all docs
into Node (`(await find()).length`) transfers the entire collection to count
it — absurd at scale. Counting server-side sends back a single number. The
*two* methods exist because accuracy and speed pull in opposite directions on
huge collections: exact counts do real work; the metadata number is free but
unfiltered (and can drift slightly after an unclean server shutdown).

**When should I use it?** `countDocuments` for anything filtered or
user-facing: "showing 1–20 of 143 results", "you have 3 pending orders".
`estimatedDocumentCount` for whole-collection dashboard numbers on big
collections ("~2.1M events logged").

**When should I avoid it?** Avoid `countDocuments({})` on a huge collection
when the estimate would do. Avoid `estimatedDocumentCount` whenever a filter
is involved — it cannot take one.

**Parameters** — `countDocuments(filter?, options?)`;
`estimatedDocumentCount(options?)` — note: **no filter parameter exists** on
the estimated version.

**Return value** — both: a plain **number**.

**Important terms**
- **Collection metadata** — bookkeeping the server stores about a collection
  (including an approximate document count), readable without scanning data.

**Code example** — `02-read.js`, section 5:

```js
const softDeleted = await User.countDocuments({ deletedAt: { $ne: null } });
const orderEstimate = await Order.estimatedDocumentCount(); // ~300
```

**Expected result** — `totalUsers: 30`-ish, a small `softDeleted` number
(~10% of users), an out-of-stock product count, and `300` orders.

**Common mistakes**
- Using `Model.count()` — **removed**; it does not exist in Mongoose 8.
- Fetching documents just to `.length` them.
- Passing a filter to `estimatedDocumentCount` and assuming it was applied —
  there is no filter parameter; don't expect one to work.
- Running an exact `countDocuments({})` on a giant collection for a dashboard
  widget that refreshes every second.

**Real-world usage** — pagination headers
(`X-Total-Count: await countDocuments(filter)`), badge counts, admin
dashboards (estimated for totals, exact for filtered views).

**Related concepts** — module 06 (pagination needs the total), module 11
(`$count` inside aggregation pipelines), module 12 (how indexes make counts
cheap).

---

## Topic: `Model.distinct()` — unique values of one field

**What is it?** `distinct(field, filter?)` returns every **unique value** of
one field across matching documents — computed by the server, delivered as a
plain array.

**Why does it exist?** (what problem it solves) "Which cities do our users
live in?" without `distinct` means fetching all users and de-duplicating in
JavaScript — all the data on the wire for a handful of values. `distinct`
does it server-side.

**When should I use it?** Building filter dropdowns (brands, cities, order
statuses), sanity-checking data ("what values does this field actually
hold?"), quick exploration.

**When should I avoid it?** When you also need counts per value ("how many
users per city") — that is `$group` in an aggregation (module 11). Also on
very high-cardinality fields (distinct emails = every email).

**Parameters** — `distinct(field, filter?)`. The field supports dot notation
(`"address.city"`, `"specs.brand"`). The optional filter restricts **which
documents** contribute values.

**Return value** — an **array of values** (not documents), de-duplicated.
For **array fields** it returns the distinct *elements* across all documents
— multikey behavior: `User.distinct("interests")` lists every interest anyone
has. Documents missing the field contribute nothing.

**Important terms**
- **Cardinality** — how many different values a field has. Low (status: 5
  values) is `distinct`-friendly; high (email: one per doc) is not.
- **Multikey** — MongoDB treating each array element as its own value for
  matching/indexing.

**Code example** — `02-read.js`, section 6:

```js
const cities = await User.distinct("address.city");
const statusesThisYear = await Order.distinct("status", {
  placedAt: { $gte: startOfYear },
});
```

**Expected result** — the seven seeded cities, the catalog's brands, the full
interest list, and the statuses actually used this year.

**Common mistakes**
- Expecting documents back and reading `result[0].name` — you get bare
  values: `["Mumbai", "Pune", ...]`.
- Reaching for `distinct` when the real question is "values **with counts**"
  — that's `$group`.

**Real-world usage** — the filter sidebar of any store ("Brand: Volt, Nexa,
Orbit...") is a `distinct` (often cached) over the products collection.

**Related concepts** — module 11 (`$group` for value+count), module 05 (array
queries), module 12 (covered `distinct` via indexes).

---

## Topic: `Model.exists()` — the cheapest "is there one?"

**What is it?** `exists(filter)` checks whether **at least one** document
matches. Under the hood it is a `findOne` that fetches only `_id` — the
server can stop at the first match.

**Why does it exist?** (what problem it solves) `countDocuments` counts *all*
matches even though you only asked "any?", and `findOne` drags a whole
document over the network just to be truth-tested. `exists` does the minimum
possible work and states your intent.

**When should I use it?** Pure existence questions: "is this email taken?",
"has this user already reviewed this product?", "does the referenced category
exist?"

**When should I avoid it?** When you need the document's data anyway — then
`findOne` is one call instead of two. And do not use it as a pre-check to
"prevent" duplicates — two simultaneous requests both pass the check; only a
**unique index** (a database guarantee) truly prevents duplicates.

**Parameters** — `exists(filter)`.

**Return value** — **`{ _id: ObjectId }` when a match exists, `null` when
none does. NOT a boolean.** Truthiness works (`if (await User.exists(f))`),
strict comparison does not (`=== true` is always false).

**Important terms**
- **Truthy / falsy** — JavaScript's rules for what counts as true in an `if`.
  An object (even `{ _id }`) is truthy; `null` is falsy — which is why
  `exists()`'s odd return type still works in conditions.

**Code example** — `02-read.js`, section 7:

```js
if (await User.exists({ email: candidateEmail })) {
  return res.status(409).json({ error: "Email already registered" });
}
```

**Expected result** — `{ _id: ... }` printed for `{ role: "admin" }`, `null`
for an email nobody has.

**Common mistakes**
- `(await User.exists(f)) === true` — always false. Compare truthily or
  against `null`.
- Using it as a race-prone duplicate guard instead of a unique index (the
  check-then-insert gap is real; module 14).

**Real-world usage** — signup availability checks, and referential-integrity
guards before writes: `if (!(await Category.exists({ _id: categoryId })))
return 400` — remember MongoDB has **no foreign-key constraints** (module 09).

**Related concepts** — unique indexes (modules 03/12) for true uniqueness;
`countDocuments` when the number itself matters.

---

## Topic: `updateOne()` and `updateMany()` — fire the change, get back counts

**What is it?** Server-side updates. `updateOne(filter, update)` applies
**update operators** (`$set`, `$inc`, `$unset`, `$push`, ...) to the first
matching document; `updateMany` applies them to **every** match. The document
is modified **on the server** — your Node process never sees it.

**Why does it exist?** (what problem it solves) The load-modify-save cycle
(`findOne` → change fields → `save()`) is two round trips and, worse, a race
window: two requests can both read the same stock value and both write back
the same decrement. A server-side `$inc` is one round trip and **atomic per
document** — MongoDB applies each operator without interleaving.

**When should I use it?** When you know *what to change* without needing the
document first: mark an order shipped, increment stock, add a tag, flip a
flag on everything matching a filter.

**When should I avoid it?** When you need the resulting document (use
`findOneAndUpdate`), or when complex business logic must inspect the doc
before deciding (load it, decide, then still write with an atomic update).

**Parameters** — `updateOne(filter, update, options?)` / `updateMany(...)`:
- `update` — an object of **update operators**: `{ $set: {...}, $inc: {...} }`.
  Mongoose silently wraps a bare object (`{ x: 1 }`) into `$set` — write the
  `$set` yourself; the raw shell/driver would reject the bare form.
- Key options: `runValidators` (next topic), `upsert`, `timestamps: false`
  (skip the automatic `updatedAt` bump).

**Return value** — a result summary, **never the document**:
`{ acknowledged, matchedCount, modifiedCount, upsertedCount, upsertedId }`.
- `matchedCount` — docs the filter found.
- `modifiedCount` — docs actually changed. `matched: 1, modified: 0` means
  "found it, it already had those values" — **not a failure**.

**Important terms**
- **Update operator** — a server-side instruction: `$set` (assign), `$inc`
  (add to a number), `$unset` (remove a field), `$push` (append to array —
  module 07 covers the full set).
- **Atomic (per document)** — a single-document update is applied entirely or
  not at all, with no interleaving between concurrent writers. This is a
  **MongoDB** guarantee, independent of Mongoose.

**Code example** — `03-update.js`, sections 1–2:

```js
const res1 = await User.updateOne(
  { email: "updater.one@lesson.test" },
  { $set: { loyaltyPoints: 750 } }
);
// res1 → { matchedCount: 1, modifiedCount: 1, ... }
// Run it again → { matchedCount: 1, modifiedCount: 0 } — already 750.
```

**Expected result** — the lesson shows the identical update run twice
(`modified: 1` then `modified: 0`), then a `$inc` promotion hitting all three
practice users (`matchedCount: 3`).

**Common mistakes**
- Expecting the updated document back. You get counts; that is the defining
  difference from `findOneAndUpdate`.
- Treating `modifiedCount: 0` as an error — often the data was already in the
  desired state.
- Loading a doc, mutating in JS, and saving — reintroducing the race that
  `$inc` exists to prevent (module 07 shows the overselling scenario).
- An accidentally-broad filter on `updateMany` — the filter is the only thing
  scoping the blast radius.

**Real-world usage** — status transitions (`updateOne({ _id },
{ $set: { status: "shipped" } })`), counters, feature-flag rollouts
(`updateMany({}, { $set: { flags.newUi: true } })` — deliberately global).

**Related concepts** — module 07 (every update operator, atomicity in depth),
`findOneAndUpdate` (below) when you need the doc, `runValidators` (next).

---

## Topic: `findOneAndUpdate()` / `findByIdAndUpdate()` — update AND get the document

**What is it?** An atomic read-and-write: one `findAndModify` command updates
the document **and returns it**. `findByIdAndUpdate(id, ...)` is sugar for
`findOneAndUpdate({ _id: id }, ...)`.

**The trap that names this module:** by default it returns the document **as
it was BEFORE the update**. Pass `{ new: true }` to get the post-update
document. This is probably the most-hit gotcha in all of Mongoose.

**Why does it exist?** (what problem it solves) `updateOne` gives counts;
getting the resulting doc would need a second query — and between those two
queries, someone else may have changed the doc again. `findAndModify` does
find + update + return as **one atomic server-side step**. Returning the
*old* doc by default is deliberate: "claim" patterns need to see exactly what
they claimed.

**When should I use it?** Whenever you want to update and then use/return the
document — the classic `PATCH /resource/:id` handler. Or atomic
claim/consume patterns (grab the next unprocessed job and see which one you
got).

**When should I avoid it?** When you don't need the doc (`updateOne` is
lighter) or when many docs must change (`updateMany` — there is no
"findManyAndUpdate").

**Parameters** — `findOneAndUpdate(filter, update, options?)`. Options that
matter: `new` (return post-update doc; equivalently
`returnDocument: "after"`), `runValidators`, `upsert`, `sort` (choose WHICH
match when several — e.g. oldest first), `select`/`projection`.

**Return value** — a **document or `null`** (no match, no error). Old doc by
default; updated doc with `{ new: true }`.

**Important terms**
- **`findAndModify`** — the underlying MongoDB command that reads and writes
  in one atomic step.
- **Upsert** — "update, or insert if missing" (`upsert: true`). On the insert
  path MongoDB builds the doc from the filter's equality fields + the update;
  `$setOnInsert` fields apply **only** when inserting. Mongoose also applies
  schema defaults to upserted docs (`setDefaultsOnInsert`, on by default).

**Code example** — `03-update.js`, sections 3–4 and 8:

```js
const doc = await Product.findByIdAndUpdate(
  id,
  { $inc: { stock: -1 } },   // sell one unit — atomic on the server
  { new: true }              // give me the doc AFTER the decrement
);
```

**Expected result** — the lesson prints the same user updated twice: without
`new: true` the returned `loyaltyPoints` is the **pre**-update value; with it,
the **post**-update value. Then a product's stock goes 25 → 24 atomically,
and section 8 upserts a brand-new practice user in one call.

**Common mistakes**
- Forgetting `{ new: true }` and rendering stale data — *the* classic.
- Assuming validators run — they don't, unless `runValidators: true` (next
  topic).
- Expecting `save` middleware to fire. `findOneAndUpdate` is a **query**
  operation: document `pre('save')` hooks do not run (query middleware
  exists; module 13).
- Not handling `null` when the filter matched nothing.

**Real-world usage** — `PATCH` handlers:
`const updated = await Product.findByIdAndUpdate(req.params.id, { $set: changes }, { new: true, runValidators: true }); if (!updated) return 404; res.json(updated);`

**Related concepts** — `updateOne` (counts instead of docs),
`findOneAndReplace` / `findOneAndDelete` (same old-doc-by-default contract),
module 14 (when one atomic doc update is not enough).

---

## Topic: update validators — `runValidators: true`

**What is it?** Schema validation for **update** operations. Off by default:
`updateOne`, `updateMany`, `findOneAndUpdate`, and friends will happily write
values that violate your schema unless you pass `{ runValidators: true }`.

**Why does it exist?** (what problem it solves) — and why off by default?
`save()` validates the **whole document** sitting in Node's memory. An update
is different: it is a set of instructions sent to the server; Mongoose never
sees the full document, so it *cannot* run whole-document validation. What it
can do — validate the specific **paths** in your update object — it only does
when asked, partly for history (older Mongoose never did it) and partly
because path-validation has real limits (below) that make it a weaker
guarantee than `save()` validation.

**When should I use it?** On **every** update whose values came from user
input. Make `{ runValidators: true }` a reflex in PATCH handlers.

**When should I avoid it?** Internal writes you fully control (a `$inc` on a
counter) don't strictly need it — but it rarely hurts.

**Parameters** — an option on the update methods:
`{ runValidators: true }`; custom validators that read `this` also need
`{ context: "query" }`.

**Return value** — unchanged from the host method; on violation the call
rejects with a `ValidationError` and **nothing is written**.

**Important terms**
- **Update validators** — the path-level validation Mongoose runs on
  `$set`/`$inc`/`$push`-style updates when `runValidators` is on.
- **Path** — one field address in a document (`age`, `"address.city"`).

**The limits (why `save()` is still king):** update validators check **only
the paths present in the update** — cross-field rules and `required` checks on
untouched fields cannot run; custom validators execute with query context, not
a document as `this`.

**Code example** — `03-update.js`, section 5:

```js
await User.updateOne({ email }, { $set: { age: 5 } });
// succeeds! age: 5 is now in the DB despite min: 13

await User.updateOne({ email }, { $set: { age: 4 } }, { runValidators: true });
// → ValidationError: Users must be at least 13 — nothing written
```

**Expected result** — the lesson first *shows the bad data landing* (the
practice user's age really becomes 5), then the same update rejected once
validators are on, then repairs the doc.

**Common mistakes**
- Believing the schema protects all writes. It fully protects
  `create()`/`save()` only; updates need the flag.
- Expecting `required` on an *untouched* field to block an update — it can't;
  the field isn't in the update.
- Custom validators using `this` breaking under update — add
  `context: "query"`.

**Real-world usage** — a shared helper or plugin that forces
`runValidators: true` on every update, so no handler can forget it.

**Related concepts** — module 13 (validation in full), module 15
(`ValidationError` handling and 400 responses).

---

## Topic: `replaceOne()` / `findOneAndReplace()` — swap the whole document

**What is it?** Replacement, not update. The second argument is a **complete
new document body**; MongoDB throws away everything under that `_id` (the
`_id` itself is kept) and stores your object instead. `replaceOne` returns
counts; `findOneAndReplace` returns a document — the **old** one unless
`{ new: true }`.

**Why does it exist?** (what problem it solves) Some flows genuinely hold the
full intended state: an "import overwrites the record" pipeline, a document
editor whose save button submits the entire object, syncing a doc from an
external source of truth. Replace expresses "make it exactly this" in one
step, without unsetting old fields one by one.

**When should I use it?** Only in those whole-object flows, where omitting a
field **means** "delete that field".

**When should I avoid it?** Everywhere else — especially PATCH-style partial
edits. **Replace does not merge.** Any field missing from your replacement is
**gone** from the database. This is the number-one way to silently destroy
data while "just updating a name".

**Parameters** — `replaceOne(filter, replacement, options?)` /
`findOneAndReplace(filter, replacement, options?)`. The replacement must be a
**plain document** — update operators (`$set` etc.) in it are an error.
`findOneAndReplace` honors `new: true` like its update sibling.

**Return value** — `replaceOne`: `{ matchedCount, modifiedCount, ... }` (the
`updateOne` family shape). `findOneAndReplace`: the old document (or the
replacement with `new: true`), or `null` on no match.

**Important terms**
- **Replacement document** — a full body with no `$` operators; the doc's
  new complete state.
- **Merge vs swap** — `$set` merges changes into the existing doc; replace
  swaps the entire doc for yours.

**Code example** — `03-update.js`, sections 6–7:

```js
await User.replaceOne(
  { email: "updater.two@lesson.test" },
  { name: "Vikram Rebuilt", email: "updater.two@lesson.test" }
);
// Vikram's age, address, and lastLoginAt are now GONE.
```

**Expected result** — the printed post-replace document has lost `age`,
`address`, and `lastLoginAt`; the `_id` is unchanged (the lesson proves it
with `.equals()`). Fields with schema defaults may reappear with factory
values — Mongoose re-applies them while casting the replacement — but the
original *data* is gone. Section 7 shows `findOneAndReplace` returning the
old doc (age still visible on the snapshot!) and then, with `new: true`, the
ageless replacement.

**Common mistakes**
- Using replace for partial edits — the silent-data-loss classic. PATCH means
  `$set`.
- Putting `$set` inside a replacement — throws; operators and replacement
  bodies don't mix.
- Assuming `createdAt` survives. Timestamps-wise Mongoose treats a
  replacement like a new document body — don't count on the original creation
  time unless you copy it into the replacement yourself.

**Real-world usage** — import/sync jobs ("upsert the supplier's full product
record"), and honest `PUT` endpoints in the strict REST sense (PUT = replace
entire resource; PATCH = partial update).

**Related concepts** — `$set` updates (above) for merging; module 09 (why
document shape drifting matters); module 13 (middleware differences between
save and query operations).

---

## Topic: `deleteOne()` and `deleteMany()` — and the empty-filter danger

**What is it?** Hard deletes. `deleteOne(filter)` removes the **first**
matching document; `deleteMany(filter)` removes **every** match. Both return a
count — never the document.

**Why does it exist?** (what problem it solves) Data must sometimes truly go:
expired sessions, GDPR erasure requests, cleaning practice docs (these
lessons!), pruning logs. `deleteMany` does in one command what a loop of
`deleteOne`s would do in thousands.

**When should I use it?** When permanent removal is genuinely the
requirement, and the filter is precise. `deleteOne` should target a unique
key; `deleteMany` should have a filter you have double-checked.

**When should I avoid it?** For business data users might ask about later —
orders, accounts, reviews. Production systems overwhelmingly prefer **soft
delete**: set a `deletedAt` timestamp (this repo's User model has exactly
that field) and filter it out of queries. Deleted-by-mistake then has an
undo; module 07 builds the full pattern.

**Parameters** — `deleteOne(filter, options?)` / `deleteMany(filter, options?)`.

**Return value** — `{ acknowledged, deletedCount }`. Deleting something
already gone is **not an error** — you get `deletedCount: 0`. If "it must
have existed" matters, check the count.

**The `deleteMany({})` danger.** An empty filter matches **everything**. One
line — `await User.deleteMany({})` — and the whole collection is gone: no
confirmation, no undo, no recycle bin. The realistic version of this accident
is not typing `{}` on purpose; it is `deleteMany(filter)` where `filter` was
built from request data and ended up empty (an `undefined` spread, a missing
query param). Defenses: validate filters before destructive calls, make
shared helpers refuse empty filters, prefer soft delete, keep backups.
`deleteMany({})` empties the collection but keeps it (and its indexes);
`collection.drop()` removes the collection entirely — both belong only in
clearly-marked scripts, like this repo's `db:reset`.

**Important terms**
- **Hard delete** — the document ceases to exist. **Soft delete** — a flag
  (`deletedAt`) marks it deleted while the data survives.
- **Natural order** — with a multi-match filter, `deleteOne` removes an
  unspecified first match, like `findOne` without a sort.

**Code example** — `04-delete.js`, sections 1, 5, 6:

```js
const res = await User.deleteOne({ email: "delete.one@lesson.test" });
// → { acknowledged: true, deletedCount: 1 }; run again → deletedCount: 0
```

**Expected result** — `deletedCount: 1` then `0` for the repeat;
`deletedCount: 4` for the bulk practice-user sweep; and in section 6 a
**throwaway `tmp_` collection** goes from 5 docs to 0 via `deleteMany({})` —
the danger demonstrated where it cannot hurt anything.

**Common mistakes**
- Expecting the deleted doc back (that's `findOneAndDelete`).
- Ignoring `deletedCount` and reporting success for a delete that matched
  nothing (APIs usually want a 404 there).
- `deleteOne` with a broad filter — an arbitrary victim is chosen.
- The empty-filter accident described above — the most expensive one-liner in
  MongoDB.

**Real-world usage** — TTL-style cleanup jobs (`deleteMany({ expiresAt:
{ $lt: new Date() } })`), GDPR erasure, test teardown. User-facing "delete"
buttons usually soft delete instead.

**Related concepts** — module 07 (soft delete pattern), `findOneAndDelete`
(below), module 16 (drop and other admin operations, safely isolated).

---

## Topic: `findOneAndDelete()` / `findByIdAndDelete()` — delete AND get the document

**What is it?** Atomic fetch-and-remove via `findAndModify`: the document is
returned to you **and** deleted, as one server-side step.
`findByIdAndDelete(id)` is sugar for `findOneAndDelete({ _id: id })`.

**Why does it exist?** (what problem it solves) Two problems. (1) `deleteOne`
never shows you what died — for auditing, archiving, or telling the user what
was removed, you want the doc's last state. (2) A separate `findOne` **then**
`deleteOne` has a gap between the two commands — two workers can both fetch
the same doc before either deletes it. The atomic form closes that gap:
whoever's delete lands first gets the doc; the other caller gets `null`.

**When should I use it?** Delete endpoints that respond with or log the
removed resource; archive-then-delete flows; and the queue-worker pattern —
atomically "pop" the next job so no two workers process the same one.

**When should I avoid it?** Bulk deletion (no "findManyAndDelete" exists —
that's `deleteMany`), or when you truly don't care what was deleted
(`deleteOne` is lighter).

**Parameters** — `findOneAndDelete(filter, options?)` (options include `sort`
— pick WHICH match dies when several match, e.g. oldest first — and
`select`); `findByIdAndDelete(id, options?)`.

**Return value** — the deleted **document**, or `null` if nothing matched.
The same doc-or-null contract as `findOne` — and your last chance ever to see
this data.

**Important terms**
- **Atomicity of `findAndModify`** — read + write happen as one indivisible
  server-side operation; no other command can slip between them.

**Code example** — `04-delete.js`, sections 2–3:

```js
const removed = await User.findOneAndDelete({ email: "delete.two@lesson.test" });
// removed = the full document — archive it, log it, return it
// call again → null (already gone)
```

**Expected result** — the deleted user's name/email/_id printed from the
return value; `null` on the second attempt; then the same flow keyed by `_id`
with `findByIdAndDelete`.

**Common mistakes**
- Reading properties off the result without a `null` check.
- Using old method names: `findOneAndRemove` / `findByIdAndRemove` **do not
  exist** in Mongoose 8 — only the `...AndDelete` forms.
- Doing `findOne` + `deleteOne` separately when the atomic form was the
  point.

**Real-world usage** — `DELETE /orders/:id` returning the removed order in
the response body; a moderation service moving a deleted review into an
`archived_reviews` collection; simple job queues.

**Related concepts** — `findOneAndUpdate` (same atomic command, updating
instead), module 14 (multi-document atomicity), module 07 (soft delete — the
usual production alternative).

---

## Cheat sheet — pin this above your desk

| Operation | Awaited result | Empty/no match | Validators by default | `save` middleware |
| --- | --- | --- | --- | --- |
| `create(doc)` | the document | — (throws on invalid) | **yes, full** | **yes** |
| `create([docs])` | array of documents | — | yes, per doc | yes, per doc |
| `insertMany(docs)` | array of documents | — | yes (casting + validation) | **no** (only `insertMany` hooks) |
| `find(f)` | **array** of docs | `[]` — never null | n/a | n/a |
| `findOne(f)` | doc | `null` | n/a | n/a |
| `findById(id)` | doc | `null` (CastError if malformed; safe on `undefined`) | n/a | n/a |
| `countDocuments(f)` | number | `0` | n/a | n/a |
| `estimatedDocumentCount()` | number (no filter possible) | `0` | n/a | n/a |
| `distinct(field, f?)` | array of **values** | `[]` | n/a | n/a |
| `exists(f)` | `{ _id }` — **not a boolean** | `null` | n/a | n/a |
| `updateOne/updateMany(f, u)` | `{ matchedCount, modifiedCount, ... }` | `matchedCount: 0` — no error | **OFF** (`runValidators: true`) | no (query middleware only) |
| `findOneAndUpdate` / `findByIdAndUpdate` | **document — OLD unless `new: true`** | `null` | **OFF** | no (query middleware only) |
| `replaceOne(f, doc)` | `{ matchedCount, modifiedCount, ... }` | `matchedCount: 0` | treat as OFF | no |
| `findOneAndReplace(f, doc)` | document — old unless `new: true` | `null` | treat as OFF | no |
| `deleteOne/deleteMany(f)` | `{ acknowledged, deletedCount }` | `deletedCount: 0` — no error | n/a | no (query middleware only) |
| `findOneAndDelete` / `findByIdAndDelete` | the deleted document | `null` | n/a | no (query middleware only) |

Three rules that prevent 90% of CRUD bugs:

1. **Know your return shape** (document vs counts vs value) before writing
   the `if` that follows the call.
2. **`new: true` and `runValidators: true`** on any `findOneAndUpdate` that
   feeds user input back to users.
3. **Never let a filter be built from possibly-`undefined` request data** —
   it bites reads (`findOne({ _id: undefined })` leaks a random doc) and
   kills on writes (`deleteMany({})`).

## Where to go next

- **Module 05 — querying**: everything that can go inside a `filter`.
- **Module 06 — projection, sorting, pagination**: shaping what `find`
  returns.
- **Module 07 — updates & deletes in depth**: every update operator, array
  updates, atomicity vs races, soft delete.
- **Module 13 — validation & middleware**: what exactly runs on `save` vs
  queries.
- **Module 15 — errors & query behavior**: `ValidationError` vs `CastError`
  vs `E11000`, and what a `Query` object really is.
