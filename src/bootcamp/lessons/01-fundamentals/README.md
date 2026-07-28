# Module 01 — Fundamentals: documents, BSON, and what makes MongoDB different

This is the "what am I even looking at?" chapter. Before a single query
operator, you need an accurate mental picture of what MongoDB stores and how
that differs from the tables you may already know. Almost every confusing
MongoDB behavior later in the course traces back to something in this module.

Three ideas carry the whole chapter:

**Idea 1 — a document is a whole object, not a flat row.** A row in SQL is a
list of scalar cells; anything nested needs another table and a join. A
MongoDB document is a JSON-shaped object that can contain nested objects and
arrays of objects, to any depth. An order and its line items are *one*
document. This single fact is why MongoDB schemas look so different.

**Idea 2 — MongoDB stores BSON, and BSON remembers types.** Every value
carries a type tag. The string `"40000"` and the number `40000` are different
kinds of thing, and MongoDB will never treat one as greater than the other.
Sorting, equality, and range queries are all type-aware. Most "why did my
query return nothing?" moments are type moments.

**Idea 3 — the server enforces almost nothing about shape.** Two documents in
the same collection may have completely different fields. There is no
`CREATE TABLE`, no `ALTER TABLE`, no `NOT NULL`, and no foreign key. Structure
comes from *your* layer (Mongoose schemas, and optionally a server-side
`$jsonSchema` validator). Knowing which layer enforces which rule is a theme
of the entire bootcamp.

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-explore-the-database.js` | `npm run lesson 01-fundamentals/01-explore-the-database` | the server → database → collection → document hierarchy, listing databases and collections, one raw document, documents with different shapes in one collection, embedded arrays of objects, collection storage stats |
| `02-bson-data-types.js` | `npm run lesson 01-fundamentals/02-bson-data-types` | JSON vs BSON, ObjectId anatomy byte by byte, `$type` as a query operator and as an expression, a document containing every BSON type worth knowing, `null` vs missing, type sort order |
| `03-databases-and-collections.js` | `npm run lesson 01-fundamentals/03-databases-and-collections` | the SQL→MongoDB vocabulary map, no CREATE/ALTER TABLE, embedding vs referencing, unenforced referential integrity, embedded vs `populate` vs `$lookup` timings, honest trade-offs |

**Safety:** lessons 01 and 03 are 100% read-only. Lesson 02 writes two
documents into a temporary collection called `tmp_bson_types` and drops it at
the end (and cleans up leftovers at the start, in case a previous run
crashed). No seeded document is ever created, changed, or deleted.

---

## Topic: The document model

**What is it?** MongoDB stores **documents** — objects that look like JSON —
inside **collections**, which live inside **databases**. A document is
self-contained: it can hold scalar values, nested objects, and arrays of
nested objects, all in one record.

```js
{
  _id: ObjectId("665f8a..."),
  orderNumber: "ORD-100042",
  user: ObjectId("665f8b..."),          // a reference to another document
  items: [                              // an ARRAY OF OBJECTS, inside this doc
    { product: ObjectId("..."), productName: "Volt Pro 14", unitPrice: 68999, quantity: 1 },
    { product: ObjectId("..."), productName: "Aura Mug",     unitPrice: 499,   quantity: 2 }
  ],
  shippingAddress: { city: "Pune", state: "Maharashtra", country: "India" },
  totalAmount: 69997,
  placedAt: ISODate("2025-11-02T09:14:00Z")
}
```

**Why does it exist?** (what problem it solves) Applications work with
objects. A relational database forces you to shred each object across several
tables on write and reassemble it with joins on every read — the "object
relational impedance mismatch". The document model removes the shredding
step: data that is used together is stored together, so the common read is a
single lookup of a single contiguous record.

**When should I use it?** When your access patterns are known and object-
shaped: fetch an order with its items, a product with its specs, a user with
their profile. Also when your shape genuinely varies (product attributes
differ per category) or evolves quickly.

**When should I avoid it?** When your data is deeply relational and queried
in unpredictable ad-hoc combinations (a reporting warehouse where analysts
join any table to any other), when you need multi-table constraints enforced
by the database itself, or when the same entity is written from many angles
and duplication would be unmanageable. "MongoDB is right for everything" is a
sales claim, not an engineering one.

**Important terms**
- **Document** — one record. Maximum size **16 MB**. Stored as BSON.
- **Collection** — a named group of documents. The rough equivalent of a
  table, but with no required shape.
- **Database** — a named group of collections.
- **Field** — a key inside a document (the rough equivalent of a column).
- **`_id`** — the primary key. Every document has one; MongoDB creates an
  ObjectId if you do not supply a value. It is unique and indexed
  automatically, and **immutable** once written.
- **Embedded document** (or *subdocument*) — an object stored inside another
  document, like `shippingAddress` above.
- **Schema-flexible** — the server does not require documents in a collection
  to share a shape. (Often called *schemaless*, which is misleading: there is
  almost always a schema, it just lives in your application.)

**Code example** — `01-explore-the-database.js`, sections 3–5:

```js
const db = mongoose.connection.db;                    // the raw driver
const rawUser = await db.collection("users").findOne();
// address is a nested object; interests is an array — both inside ONE record
```

**Expected result** — a user document printed in full, with `_id` as an
`ObjectId`, `address` as a nested object, and `interests` as an array of
strings. Then counts proving that ~15% of users have no `age` and no
`address` at all.

**Common mistakes**
- **Recreating a relational schema in MongoDB.** Five collections joined on
  every request, one field per collection. You get the drawbacks of both
  models and the benefits of neither.
- **Embedding an unbounded array.** Reviews inside a product looks tidy until
  a popular product has 40,000 of them and the document hits 16 MB. Bounded
  and owned → embed; unbounded → separate collection.
- **Assuming a typo'd collection name will error.** `db.collection("uesrs")`
  silently creates a new empty collection on first write.
- **Treating documents as free-form.** Flexible storage still needs a
  disciplined application-level schema, or your data becomes ten shapes that
  no query can handle.

**Real-world usage** — in a MERN backend this is the layer your Mongoose
models describe. Products with per-category specs, orders with line items,
users with embedded preferences, and audit logs with variable payloads are
all natural documents.

**Related concepts** — [module 03](../03-mongoose-basics/README.md) (adding a
schema on top), [module 08](../08-arrays-and-nested-documents/README.md)
(working with nesting day to day), and
[module 09](../09-data-modeling/README.md) (the full embed-vs-reference
decision framework).

---

## Topic: BSON and MongoDB data types

**What is it?** **BSON** ("Binary JSON") is the binary format MongoDB uses to
store and transmit documents. It keeps JSON's structure but adds real types
and stores each value with a **type tag** and a length prefix.

**Why does it exist?** (what problem it solves) JSON has only six types and
none of them are adequate for a database:
- no **date** — you would store timestamps as strings, which sort wrongly and
  cannot be compared numerically;
- no distinction between **integer** and **float**;
- no **binary** type for files or hashes;
- no **exact decimal**, so money arithmetic accumulates float error;
- no efficient way to **skip** a field while scanning (JSON must be parsed
  character by character; BSON's length prefixes let the server jump).

**When should I use it?** You always do — it is not optional. What *is* a
choice is which type you pick for each field, and that choice matters most
for money (`Decimal128`), large counters (`Long`), and anything you will sort
or range-query.

**When should I avoid it?** The one type to actively avoid is **`Mixed`** in
Mongoose (BSON `object` with no declared shape): Mongoose cannot track
changes inside it, so `doc.save()` silently skips your edits unless you call
`markModified()`.

**Important terms** — the types you will actually meet:

| BSON type | Alias for `$type` | JavaScript / Mongoose | Notes |
| --- | --- | --- | --- |
| Double | `"double"` (1) | `Number` | the default for every JS number |
| String | `"string"` (2) | `String` | UTF-8 |
| Object | `"object"` (3) | nested object | an embedded document |
| Array | `"array"` (4) | `Array` | elements may be mixed types |
| Binary | `"binData"` (5) | `Buffer` | files, hashes, UUIDs |
| ObjectId | `"objectId"` (7) | `mongoose.Types.ObjectId` | the default `_id` |
| Boolean | `"bool"` (8) | `Boolean` | |
| Date | `"date"` (9) | `Date` | **milliseconds since epoch, always UTC** |
| Null | `"null"` (10) | `null` | different from *missing* |
| Regex | `"regex"` (11) | `RegExp` | usable directly in a filter |
| Int32 | `"int"` (16) | `Int32` | must be requested explicitly |
| Int64 | `"long"` (18) | `Long` | for values beyond 2^53 |
| Decimal128 | `"decimal"` (19) | `Decimal128` | **exact** base-10 — use for money |
| MinKey / MaxKey | `"minKey"` / `"maxKey"` | | sort below/above everything |

Two more terms:
- **Type bracket** — the group a type belongs to for comparison purposes.
  Range operators (`$gt`, `$lt`) only compare *within* a bracket, which is
  why `{ price: { $gt: "100" } }` never matches numeric prices.
- **Type sort order** — when a field holds mixed types, MongoDB orders them:
  MinKey < Null < Numbers < String < Object < Array < Binary < ObjectId <
  Boolean < Date < Timestamp < Regex < MaxKey.

**Code example** — `02-bson-data-types.js`, sections 3–4:

```js
// $type as a QUERY operator — filter by stored type
await Product.countDocuments({ price: { $type: "double" } });   // 63
await Product.countDocuments({ price: { $type: "string" } });   // 0

// $type as an EXPRESSION — ask the server to report the type
await coll.aggregate([{ $project: { priceType: { $type: "$price" } } }]);
```

**Expected result** — all 63 products report `double` for `price` (Mongoose's
`Number` maps to BSON double, because JavaScript has only one number type).
The temp document round-trips `Decimal128("19.99")`, `Long`, `Int32`,
`Binary`, and `RegExp` intact, and the server reports each one's true type.

**Common mistakes**
- **Storing money as a `Number`.** `0.1 + 0.2 === 0.30000000000000004`.
  Either use `Decimal128` or store integer paise/cents. (This repo uses
  whole-rupee `Number` on purpose, and says so in `product.model.js` — a
  learning-project shortcut, not a production pattern.)
- **Storing dates as strings.** `"2025-3-9"` sorts before `"2025-11-02"`
  lexicographically. Always store a real `Date`.
- **Comparing a string to a number.** `req.query.minPrice` is *always* a
  string in Express. Through Mongoose the schema casts it for you; through
  the native driver it silently matches nothing.
- **Confusing `null` with missing.** `{ field: null }` matches both.

**Real-world usage** — the type decision shows up on day one of every
project: money, timestamps, external ids (keep them as strings if they are
not ObjectIds), and file blobs (usually a URL string rather than `Binary`,
with the file itself in S3).

**Related concepts** — [module 03](../03-mongoose-basics/README.md)
(Mongoose casting, which papers over most type mismatches),
[module 05](../05-querying/README.md) (`$type`, `$exists`, and the
missing-field traps), [module 15](../15-errors-and-query-behavior/README.md)
(`CastError`).

---

## Topic: ObjectId

**What is it?** A 12-byte identifier, displayed as 24 hexadecimal characters,
that MongoDB uses as the default `_id`. It is not random noise — it has
structure:

```
665f8a2c   9f3b1d4e07   00a1f2
└─┬────┘   └────┬────┘   └─┬──┘
  │             │          └─ 3 bytes: a counter, incremented per document
  │             └──────────── 5 bytes: random, unique per process
  └────────────────────────── 4 bytes: UNIX timestamp in seconds
```

**Why does it exist?** (what problem it solves) A distributed database cannot
route every insert through one central `AUTO_INCREMENT` sequence — that is a
bottleneck and a single point of failure. ObjectId lets **any** client on
**any** machine generate an id that is globally unique with no coordination:
the timestamp separates ids by second, the random block separates processes,
and the counter separates documents within one process in the same second.

**When should I use it?** As the default for essentially everything. The
useful bonuses: ids sort roughly by creation time, and `getTimestamp()`
recovers the creation moment without a separate field.

**When should I avoid it?** When a natural, stable, unique key already exists
and is what you look documents up by (an order number, a slug, a country
code) — then use that as `_id` and save an index. Also avoid exposing
ObjectIds in URLs if you care about leaking creation times and rough record
counts; use a slug or a UUID field for public identifiers.

**Important terms**
- **`_id`** — the primary key field. Always present, always unique, always
  indexed, and **immutable** after insert.
- **Hex string** — the 24-character text form. `String(objectId)` produces
  it; `new ObjectId(hexString)` parses it back.
- **`getTimestamp()`** — reads the embedded creation time out of the id.
- **`isValid()`** — checks whether a value *could* be an ObjectId. Necessary
  but **not sufficient**: any 12-character string passes, because 12 bytes is
  a legal id.
- **`CastError`** — what Mongoose throws when a value that is not a valid id
  reaches an ObjectId field (typically from `req.params.id`).

**Code example** — `02-bson-data-types.js`, section 2:

```js
const id = new mongoose.Types.ObjectId();
id.getTimestamp();                       // → Date, decoded from bytes 0-3

// Range-query by creation time with no createdAt field:
const since = mongoose.Types.ObjectId.createFromTime(Date.now() / 1000 - 86400);
await Order.find({ _id: { $gt: since } });
```

**Expected result** — the printed id splits cleanly into its three parts, and
`embeddedTimestamp` shows the current time. `isValid("123456789012")` prints
`true`, demonstrating the trap.

**Common mistakes**
- **Comparing an ObjectId to a string with `===`.** They are objects.
  `order.user === "665f..."` is always `false`; use
  `order.user.equals(id)` or compare `String(order.user)`.
- **Trusting `isValid()` alone.** Round-trip instead:
  `String(new ObjectId(v)) === v`.
- **Letting an unvalidated `req.params.id` reach the database.** That is a
  500 error from a `CastError`; validate and return 400 instead.
- **Assuming ObjectIds are perfectly time-ordered.** They are ordered to the
  *second*, and clocks on different machines drift. Good enough for rough
  sorting, not for an audit trail.

**Real-world usage** — every `ref` field in this repo (`order.user`,
`product.category`, `review.product`) stores one. Express routes validate
them before querying. Cursor pagination (module 06) uses `_id` as the
tie-breaker precisely because it is unique and roughly chronological.

**Related concepts** — [module 09](../09-data-modeling/README.md)
(references), [module 10](../10-populate-and-lean/README.md) (`populate`),
[module 06](../06-projection-sorting-pagination/README.md) (cursor
pagination), [module 15](../15-errors-and-query-behavior/README.md)
(`CastError` handling).

---

## Topic: Databases and collections (and implicit creation)

**What is it?** A **database** is a namespace holding collections; a
**collection** is a namespace holding documents. Both are created **lazily** —
the first write brings them into existence.

**Why does it exist?** (what problem it solves) It removes schema migration
from the deployment path. There is no `CREATE TABLE` to run before your code
works, and no `ALTER TABLE` to run when you add a field. New code writes new
fields; old documents simply lack them.

**When should I use it?** Always — you have no choice about laziness. What
you *should* do deliberately is create collections **explicitly** when you
need non-default options: a capped collection, a `$jsonSchema` validator, or
a specific collation. `db.createCollection(name, options)` (module 16).

**When should I avoid relying on it?** In production, do not rely on implicit
creation for collections that need indexes. Create the collection and its
indexes as part of deployment (`Model.syncIndexes()`, which our seeder calls),
so the first query is not a collection scan.

**Important terms**
- **Implicit creation** — a database/collection appearing on first write.
- **Namespace** — the full `database.collection` name, e.g.
  `mongo_bootcamp.products`.
- **`listCollections()`** — asks the database what it holds.
- **`collStats` / `dbStats`** — commands returning size, document count, and
  index size. The fastest way to see whether your indexes are bigger than
  your data (a real warning sign).
- **System databases** — `admin`, `config`, `local`. MongoDB's own; never put
  application data in them.

**Code example** — `01-explore-the-database.js`, sections 2 and 6:

```js
const collections = await db.listCollections().toArray();
const stats = await db.command({ collStats: "products" });
// stats.avgObjSize, stats.nindexes, stats.totalIndexSize
```

**Expected result** — five bootcamp collections with counts 30 / 10 / 63 /
300 / 200, and product stats showing several indexes (from
`product.model.js`) plus their combined size.

**Common mistakes**
- **Typos creating phantom collections.** `"prodcuts"` will not error.
- **Assuming a document count is free.** `countDocuments({})` scans (or uses
  an index); `estimatedDocumentCount()` reads metadata and is O(1) but
  ignores filters (module 04).
- **Forgetting that dropping a collection drops its indexes too.** That is
  precisely why `npm run db:reset` exists separately from `npm run db:seed`.

**Real-world usage** — collection naming (plural, lowercase — Mongoose
pluralizes your model name automatically), one database per environment, and
a deployment step that syncs indexes.

**Related concepts** — [module 16](../16-native-driver-and-utilities/README.md)
(collection admin operations), [module 12](../12-indexes-and-performance/README.md)
(index size and cost).

---

## Topic: MongoDB compared to a relational database

**What is it?** A concept-by-concept translation, and — more usefully — a map
of where the translation *breaks*.

| SQL | MongoDB | Where the analogy breaks |
| --- | --- | --- |
| table | collection | a collection has no required shape |
| row | document | a document nests; a row is flat |
| column | field | fields may be absent, and vary per document |
| `PRIMARY KEY` | `_id` | always present, always ObjectId by default, immutable |
| `AUTO_INCREMENT` | ObjectId | generated on the client, no central sequence |
| `FOREIGN KEY` | a stored ObjectId | **not enforced** — no constraint, no cascade |
| `JOIN` | `$lookup`, or embedding | embedding often removes the need entirely |
| `CREATE TABLE` | — | collections appear on first write |
| `ALTER TABLE` | — | just write the new field |
| `NOT NULL`, `CHECK` | Mongoose validators, `$jsonSchema` | enforcement moves to your layer (or is opt-in) |
| normalization (3NF) | query-driven design | duplication is sometimes *correct* |
| transaction | transaction | supported, but needed far less often |

**Why does the difference exist?** SQL optimizes for **storage-efficient,
duplication-free** data with maximum query flexibility, and pays for it with
joins. MongoDB optimizes for **read locality and horizontal scale**, and pays
for it by making you decide the shape up front based on your access patterns.
Neither is "better"; they are different bets.

**When should I use MongoDB?** Object-shaped domains with known access
patterns, variable or fast-evolving shapes, heavy read traffic on documents
that are naturally self-contained, and workloads that must scale out.

**When should I avoid it?** Heavy ad-hoc analytical joins, domains where
multi-entity constraints must be enforced by the database, or a team that
will not maintain the discipline that schema flexibility demands.

**Important terms**
- **Normalization** — the SQL practice of storing each fact exactly once.
- **Denormalization** — deliberately storing a fact more than once to avoid a
  join (module 09). In MongoDB this is a design tool, not a sin.
- **Referential integrity** — the guarantee that a reference points at a real
  document. SQL enforces it; **MongoDB does not**.
- **Impedance mismatch** — the friction between objects in code and rows in
  tables that the document model removes.
- **Query-driven design** — deciding the schema by listing the queries you
  must serve, then shaping documents so the hot ones need no join.

**Code example** — `03-databases-and-collections.js`, sections 5–6:

```js
// A reference pointing nowhere returns null. No error, no constraint.
await Product.findById(new mongoose.Types.ObjectId());   // → null

// Three ways to assemble related data, timed side by side:
await Order.find(...).lean();                                   // embedded: 1 query
await Order.find(...).populate("user").lean();                  // populate: 2 queries
await Order.aggregate([{ $lookup: { from: "users", ... } }]);   // $lookup: 1 query
```

**Expected result** — the orphan lookup prints `null`. The three timings are
all small on a local server; the point is the **query count**, not the
milliseconds — embedding needs one round trip and no join, `populate` needs
two, `$lookup` needs one but does real work on the server.

**Common mistakes**
- **Expecting `ON DELETE CASCADE`.** Deleting a user leaves their orders
  pointing at a ghost. Choose soft delete, manual cascade in middleware, or
  tolerant reads — but choose.
- **Normalizing out of habit.** Splitting an order's line items into their
  own collection because "that's the third normal form" throws away the main
  advantage of the model.
- **Denormalizing without a sync plan.** `product.ratingSummary` is a copy of
  data derived from reviews; something must keep it correct (our seeder does,
  and module 13 shows the middleware approach).
- **Judging MongoDB by SQL benchmarks.** A schema copied from a relational
  design will perform worse here — that is a modelling result, not a database
  result.

**Real-world usage** — this trade-off is the actual daily work of designing a
MERN backend. Every collection you add is a bet about how it will be read.

**Related concepts** — [module 09](../09-data-modeling/README.md) is the full
treatment; [module 10](../10-populate-and-lean/README.md) covers `populate`;
[module 11](../11-aggregation/README.md) covers `$lookup`;
[module 14](../14-transactions-and-concurrency/README.md) covers when you
still need a transaction.

---

## Check yourself

Before moving to module 02, you should be able to answer these without
looking:

1. What is the maximum size of a single document, and what design rule does
   that number imply?
2. Name three things BSON can store that JSON cannot.
3. What are the three parts of an ObjectId, and what does the first part let
   you do?
4. Why does `{ age: { $ne: 200 } }` match a user who has no `age` field?
5. What is the difference between `{ field: null }` and
   `{ field: { $exists: false } }`?
6. Your colleague deletes a user who has 12 orders. What happens to those
   orders, and what are your three options for handling it?
7. `populate()` and `$lookup` both "join". What is the actual difference?

**Next:** [module 02 — Connections](../02-connections/README.md), where you
learn what actually happens between Node.js and the MongoDB server.
