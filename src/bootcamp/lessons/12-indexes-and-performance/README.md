# Module 12 — Indexes & performance: making queries fast

Everything so far taught you to get the **right** answer. This module is about
getting it **quickly** — and, more importantly, about being able to *prove*
why a query is slow instead of guessing.

The whole module rests on one idea:

> Without an index, MongoDB must open **every document in the collection** and
> check it. With the right index, it jumps straight to the matching entries.

That is the difference between reading a 900-page book cover to cover and
using its index. On 63 seeded products you will never feel it. On 63 million
it is the difference between an API that responds in 3 ms and one that times
out — and, worse, one slow query pulls the entire collection through RAM,
evicting the data every *other* query needed.

## What an index actually is

A **B-tree**: a sorted structure holding the values of one or more fields,
each paired with a pointer to the document. Sorted is the key word — it is why
MongoDB can binary-search to a value, walk a range, and read results *already
in order* without sorting them.

Three consequences follow, and they explain most of this module:

1. **Reads get faster** — jump instead of scan.
2. **Sorts can become free** — if the index order matches the requested order,
   there is no sort step at all.
3. **Writes get slower** — every insert, and every update touching an indexed
   field, must maintain every affected index. Indexes also consume RAM.

So indexing is a **trade**, not a free win. Index what you query; drop what you
do not.

## The two words you must recognise

| Plan stage | Meaning |
| --- | --- |
| **COLLSCAN** | Collection scan — every document was read. No index was usable. |
| **IXSCAN** | Index scan — the index was walked. Usually followed by `FETCH`. |
| **FETCH** | Documents were loaded from disk/cache after the index found them. |
| **SORT** | An **in-memory, blocking** sort. Capped at 32 MB — it *fails*, not degrades. |
| **PROJECTION_COVERED** | The query was answered from the index alone. `docsExamined: 0`. The best case. |

And the four numbers, from `explain("executionStats")`:

- **`nReturned`** — what you wanted.
- **`totalDocsExamined`** — what it cost. **Aim for this ≈ `nReturned`.**
- **`totalKeysExamined`** — index entries read (cheap).
- **`executionTimeMillis`** — wall clock (varies with cache state; use the
  ratio above as your real metric).

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-explain-basics.js` | `npm run lesson 12-indexes-and-performance/01-explain-basics` | why `explain()` exists, COLLSCAN vs IXSCAN, the four numbers, the SORT stage, the three verbosity levels, explaining an aggregation, a reading checklist |
| `02-index-types.js` | `npm run lesson 12-indexes-and-performance/02-index-types` | single-field, compound, multikey, unique (and E11000), sparse, partial, TTL, text, plus 2dsphere/hashed/wildcard in brief — and the measured write cost of having them |
| `03-compound-indexes-and-sort.js` | `npm run lesson 12-indexes-and-performance/03-compound-indexes-and-sort` | the prefix rule proved six ways, the **ESR** ordering rule, sort direction, covered queries, why one compound index beats several single-field ones, our store's real indexes explained |
| `04-text-search.js` | `npm run lesson 12-indexes-and-performance/04-text-search` | `$text`, relevance scoring with `$meta`, phrases and exclusion, stemming and stop words, `$text` vs regex, faceted search in one pipeline, and the honest list of limitations |
| `05-performance-patterns.js` | `npm run lesson 12-indexes-and-performance/05-performance-patterns` | projection, `lean()`, the N+1 anti-pattern, counting, deep `skip()`, aggregating server-side, denormalizing hot values, `bulkWrite`, the 32 MB sort wall, a diagnosis checklist, production monitoring |

**Safety:** lessons 01, 04, and 05 are 100% read-only. Lessons 02 and 03 build
their experiments in temporary collections (`tmp_index_lab`,
`tmp_compound_lab`) and drop them at the end. **No index on a seeded
collection is ever created, changed, or dropped** — they are only inspected.

---

## Topic: `explain()` and execution plans

**What is it?** A method that reports how MongoDB *would* run (or *did* run)
your query: which plan it chose, which index it used, and how many documents
and index entries it touched.

```js
await Product.find({ sku: "LAP-1042" }).explain("executionStats");
```

**Why does it exist?** (what problem it solves) Query performance is invisible
otherwise. Two queries returning identical results can differ by a factor of a
thousand, and nothing in the result hints at which one you got. `explain()` is
the only honest answer to "why is this slow?".

**When should I use it?** Whenever a query feels slow, whenever you add an
index (to confirm it is used), and — ideally — on every new query that will
run in a hot path, before it ships.

**When should I avoid it?** `executionStats` and `allPlansExecution`
**actually execute** the query. That is harmless for reads; be careful before
explaining a destructive operation. Use `queryPlanner` (which does not
execute) when you only need to know which index would be chosen.

**Important terms**
- **Query planner** — the component that generates candidate plans, races them
  on a sample of real data, picks a winner, and **caches** that choice.
- **Winning plan / rejected plans** — the chosen tree and the alternatives.
- **Plan cache** — why the same query can behave differently after data
  changes; the cache is invalidated on index changes and periodically.
- **`.hint({ field: 1 })`** — forces a specific index, overriding the planner.
  Useful for testing; a smell in production code.
- **Verbosity levels** — `queryPlanner` (no execution), `executionStats` (runs
  the winner), `allPlansExecution` (runs every candidate).
- **Covered query** — answered entirely from an index, `totalDocsExamined: 0`.

**Code example** — `01-explain-basics.js`, sections 2–3:

```js
await Product.find({ description: /wireless/i }).explain("executionStats");
// → COLLSCAN, docsExamined: 63, nReturned: a few

await Product.find({ sku: someSku }).explain("executionStats");
// → IXSCAN ← FETCH, docsExamined: 1, nReturned: 1
```

**Expected result** — the first prints `COLLSCAN` with `docsExamined` equal to
the whole collection; the second prints `FETCH <- IXSCAN` with a 1:1 ratio.

**Common mistakes**
- **Optimizing without measuring.** Adding indexes by intuition creates write
  overhead and rarely fixes the real problem.
- **Reading only `executionTimeMillis`.** It swings wildly with cache warmth.
  The `docsExamined / nReturned` ratio is stable and meaningful.
- **Testing on 50 documents.** Every plan looks fine at that size. Reason
  about the *plan shape*, not the milliseconds.
- **Leaving `.hint()` in production code.** You have frozen a decision that
  the planner would otherwise keep re-evaluating as data changes.

**Real-world usage** — a required step when adding any new list or search
endpoint, and the first tool you reach for when an alert fires.

**Related concepts** — [module 11](../11-aggregation/README.md) (only stages
before the first blocking stage can use an index),
[module 06](../06-projection-sorting-pagination/README.md) (pagination costs).

---

## Topic: Index types

**What is it?** Different index structures for different query shapes.

| Type | Declared as | Solves |
| --- | --- | --- |
| **Single-field** | `{ email: 1 }` | equality and range on one field |
| **Compound** | `{ category: 1, price: -1 }` | multi-field filters, and filter+sort together |
| **Multikey** | *automatic* on an array field | "array contains X" |
| **Unique** | `{ email: 1 }, { unique: true }` | a real database-level constraint |
| **Sparse** | `{ gst: 1 }, { sparse: true }` | skip documents lacking the field |
| **Partial** | `{ ... }, { partialFilterExpression: {...} }` | index only rows you actually query |
| **TTL** | `{ expiresAt: 1 }, { expireAfterSeconds: 0 }` | self-deleting documents |
| **Text** | `{ name: "text" }` | word search with relevance |
| **2dsphere** | `{ location: "2dsphere" }` | "within 5 km of this point" |
| **Hashed** | `{ userId: "hashed" }` | even shard-key distribution |
| **Wildcard** | `{ "$**": 1 }` | genuinely unpredictable document shapes |

**Why do they exist?** Each query shape needs a different ordering to be
answerable by a jump rather than a scan. An array field needs one entry per
element; a text search needs an inverted word index; a geo query needs
spatial ordering.

**When should I use each?** Follow your queries. If you filter by it, index
it. If you sort by it, get it into the index. If only 2% of documents have the
field, make it sparse or partial. If documents should expire, use TTL.

**When should I avoid indexing?** Fields you never query. Very low-cardinality
fields on their own (a boolean `isActive` index matches half the collection —
it is useful only as part of a compound index). Anything on a write-heavy
collection that no read path uses.

**Important terms**
- **Cardinality** — how many distinct values a field has. High cardinality
  (email) makes a selective index; low cardinality (boolean) does not.
- **Selectivity** — the fraction of documents a filter eliminates. More is
  better.
- **Multikey** — an index that has array-valued entries. **You never declare
  it**; MongoDB marks the index multikey the first time an array is indexed.
  You cannot compound two array fields.
- **`unique: true` in Mongoose is *not* a validator.** It asks Mongoose to
  build a unique index; enforcement happens in **MongoDB**, and violations
  surface as error **11000**, not a `ValidationError`.
- **`sparse` vs `partial`** — sparse skips missing fields; partial skips
  anything not matching a filter expression (strictly more powerful).
- **`expireAfterSeconds`** — TTL threshold. The background sweeper runs about
  once a minute, so deletion is *eventual*, not immediate.

**Code example** — `02-index-types.js`, sections 5 and 7:

```js
await lab.createIndex({ code: 1 }, { unique: true });
try { await lab.insertOne({ code: "SKU-00001" }); }
catch (e) { e.code; }                       // → 11000

await lab.createIndex({ score: -1 }, { partialFilterExpression: { score: { $gte: 90 } } });
// only usable by queries provably inside score >= 90
```

**Expected result** — the duplicate insert throws with `code: 11000` and a
`keyPattern`/`keyValue` showing exactly which field collided. The partial
index answers `score >= 95` but is ignored for `score >= 50`.

**Common mistakes**
- **Thinking `unique: true` validates.** It builds an index. A pre-existing
  duplicate makes the index build *fail*, and Mongoose reports it at
  `syncIndexes()` time, not at save time.
- **Indexing every field "just in case".** Each one slows every write and eats
  RAM. Check `$indexStats` and delete the ones with zero `ops`.
- **Expecting a partial index to serve a broader query.** MongoDB must be able
  to *prove* the query is a subset of the partial filter.
- **TTL on a non-Date field.** Silently never deletes anything.
- **Forgetting TTL is not instant.** Do not use it for security-critical
  expiry — always check the timestamp in your query too.
- **Compounding two array fields.** MongoDB refuses; the entry count would
  multiply.

**Real-world usage** — unique on `email` and `sku`; compound on
`{ user, placedAt }`; multikey on `tags`; TTL on sessions, OTPs, and password
reset tokens; partial on `{ deletedAt: null }` for soft-deleted collections.

**Related concepts** — [module 13](../13-validation-middleware-virtuals/README.md)
(validators vs constraints), [module 15](../15-errors-and-query-behavior/README.md)
(handling E11000 properly), [module 07](../07-updates-and-deletes/README.md)
(soft delete).

---

## Topic: Compound indexes, the prefix rule, and sorting

**What is it?** One index over several fields, sorted by the first, then the
second within each first value, and so on — exactly like a phone book sorted
by city, then surname, then first name.

**Why does it exist?** (what problem it solves) Real queries filter on more
than one field and then sort. Separate single-field indexes cannot serve that
in one pass — MongoDB would use one for the filter and then sort in memory. A
compound index in the right order does both at once.

**When should I use it?** Whenever a query filters on A and sorts by B. This
is the single highest-value index pattern in most applications.

**When should I avoid it?** When the field order does not match any real query
(then it is dead weight), or when you would need a separate compound index for
every permutation — that is a sign your access patterns need rethinking, not
more indexes.

**Important terms**
- **Prefix rule** — an index `{ a, b, c }` serves queries on `{a}`, `{a,b}`,
  and `{a,b,c}`. It does **not** serve `{b}`, `{c}`, or `{b,c}`. Always from
  the left.
- **ESR rule** — the field ordering that works: **E**quality fields first,
  then the **S**ort field, then **R**ange fields (`$gt`, `$lt`, `$in`). A
  range field placed before the sort field breaks the index's ordering for it.
- **Sort direction** — an index serves a sort if the directions match exactly
  **or** are exactly reversed (MongoDB walks the B-tree backwards). Anything
  mixed forces an in-memory `SORT`.
- **Covered query** — every field the query needs (filter *and* projection) is
  in the index, so no document is read. Requires excluding `_id` unless it is
  in the index.
- **Index intersection** — MongoDB *can* combine two indexes, but rarely
  chooses to; one good compound index almost always wins.

**Code example** — `03-compound-indexes-and-sort.js`, sections 2–3:

```js
await lab.createIndex({ city: 1, status: 1, amount: -1 });

lab.find({ city: "Pune" })                              // ✓ prefix
lab.find({ city: "Pune", status: "paid" })              // ✓ prefix
lab.find({ status: "paid" })                            // ✗ COLLSCAN
lab.find({ status: "paid", amount: { $gte: 5000 } })    // ✗ COLLSCAN — skips `city`
```

**Expected result** — the three prefix queries report `usedIndex: true` with
small `docsExamined`; the three non-prefix queries report `COLLSCAN` with
`docsExamined: 5000`.

**Common mistakes**
- **Assuming `{a, b}` helps a query on `b` alone.** It does not.
- **Putting a range field before the sort field.** The classic silent
  regression: the index is "used", but a `SORT` stage appears anyway.
- **Mixed sort directions on a compound index.** `{ a: 1, b: 1 }` cannot serve
  `sort({ a: 1, b: -1 })`.
- **Creating `{a}`, `{a,b}`, and `{a,b,c}` separately.** The last one already
  covers the other two by the prefix rule — the first two are pure write cost.
- **Ignoring `_id` in covered queries.** `_id` is returned by default and is
  usually not in your index, which breaks coverage.

**Real-world usage** — `{ user: 1, placedAt: -1 }` on orders ("my orders,
newest first"), `{ category: 1, price: -1 }` on products (the category page),
`{ product: 1, createdAt: -1 }` on reviews. All three are in this repo's
models, for exactly these reasons.

**Related concepts** — [module 06](../06-projection-sorting-pagination/README.md)
(sorting and pagination), [module 09](../09-data-modeling/README.md)
(designing around queries).

---

## Topic: Text search

**What is it?** A special index type that tokenizes text into words, applies
language-specific **stemming** and **stop-word** removal, and supports
relevance-ranked search with `$text` and `$meta: "textScore"`.

**Why does it exist?** (what problem it solves) Users type words into a search
box and expect word matching, tolerance for word forms ("running" matching
"run"), and the best result first. `find({ name: /wireless/i })` provides none
of that and scans the whole collection.

**When should I use it?** An admin search box, a modest product catalogue, or
any search where "good enough" beats "perfect" and you do not want another
piece of infrastructure.

**When should I avoid it?** When you need typo tolerance, autocomplete,
synonyms, per-field search, or fine relevance tuning. Then use **Atlas Search**
(Lucene-based, built in if you are on Atlas) or an external engine.

**Important terms**
- **`$text: { $search: "..." }`** — the query operator. Bare words are OR'd;
  `"quoted phrases"` must match exactly; `-term` excludes.
- **`$meta: "textScore"`** — exposes the relevance score. Needed in both the
  projection and the sort to rank results.
- **Weights** — per-field multipliers fixed at index-build time. Ours are
  `{ name: 5, description: 1 }`.
- **Stemming** — reducing words to a root so `lights`/`light` match. Language-
  specific.
- **Stop words** — very common words (`the`, `and`) dropped entirely.
- **One text index per collection** — it may cover many fields, but there can
  only be one.

**Code example** — `04-text-search.js`, section 3:

```js
await Product.find(
  { $text: { $search: "premium wireless headphones" } },
  { name: 1, score: { $meta: "textScore" } }
).sort({ score: { $meta: "textScore" } }).limit(8);
```

**Expected result** — products ranked by relevance, with name matches scoring
higher than description matches thanks to the 5× weight. Products matching
only one of the three terms still appear, lower down.

**Common mistakes**
- **Forgetting the sort.** Without `sort({ score: { $meta: "textScore" } })`
  results come back in index order, which looks random to a user.
- **Expecting substring matching.** `"head"` will not find `"headphones"`.
- **Expecting typo tolerance.** It has none.
- **Putting `$text` anywhere but the first `$match` of a pipeline.** Error.
- **Assuming `$text` combines with other indexes.** It cannot — additional
  filters are applied after fetching the text matches.

**Real-world usage** — internal search boxes and small catalogues. Most
production e-commerce search eventually moves to Atlas Search or
Elasticsearch, and that is a normal, expected graduation.

**Related concepts** — [module 05](../05-querying/README.md) (regex and its
index rules), [module 11](../11-aggregation/README.md) (`$facet` for faceted
search results).

---

## Topic: Performance patterns and anti-patterns

**What is it?** The handful of habits that account for most real-world MongoDB
performance, good and bad.

**The patterns**

| Do this | Why |
| --- | --- |
| `.select()` only the fields you return | fewer bytes over the wire, less JSON work |
| `.lean()` on read-only endpoints | skips hydration, change tracking, virtuals — often 2–5× faster |
| Batch with `$in` / `populate` / `$lookup` | one round trip instead of N |
| Aggregate on the server | do not ship 15,000 documents to sum a column |
| `bulkWrite` / `insertMany` | one command instead of a loop of commands |
| Cursor pagination for deep lists | constant cost regardless of page depth |
| Denormalize a hot aggregate | trade write complexity for cheap reads |
| Index every field you **sort** by | avoids the blocking, 32 MB-capped `SORT` |

**The anti-patterns**

| Avoid | Symptom |
| --- | --- |
| `await` inside a `for` over query results | **N+1** — 26 queries where 2 would do |
| `skip(20000)` | linear cost; page 1000 is 1000× page 1 |
| `countDocuments({})` on a hot path | use `estimatedDocumentCount()` when a filter is not needed |
| Unindexed sorts | works in staging, **fails** in production at 32 MB |
| Unanchored `/regex/i` on a large collection | always a `COLLSCAN` |
| Indexing everything | every write pays; RAM fills with indexes nobody uses |

**Important terms**
- **N+1 query problem** — one query for a list, then one per item. The
  give-away is an `await` inside a loop over results.
- **Working set** — the indexes and documents your queries actually touch. If
  it does not fit in RAM, everything slows down at once.
- **Blocking sort limit** — 32 MB for an in-memory sort (distinct from the
  100 MB per-stage aggregation limit).
- **`$indexStats`** — reports how many times each index has been used. Zero
  `ops` over weeks means delete it.
- **Slow query log** — `db.setProfilingLevel(1, { slowms: 100 })` records slow
  operations into `system.profile`.

**Code example** — `05-performance-patterns.js`, section 3:

```js
// N+1 — 26 round trips
for (const order of orders) {
  const user = await User.findById(order.user).select("name").lean();
}

// Batched — 2 round trips
const ids   = [...new Set(orders.map(o => String(o.user)))];
const users = await User.find({ _id: { $in: ids } }).select("name").lean();
const byId  = new Map(users.map(u => [String(u._id), u]));
```

**Expected result** — the batched version is several times faster even on 25
orders against a local database; over a network the gap widens with every
round trip saved.

**Common mistakes**
- **Optimizing the wrong thing.** Measure first; the bottleneck is rarely
  where it feels like it is.
- **Adding an index without re-running `explain()`.** Confirm it is actually
  used — a mixed sort direction or a range field in the wrong position will
  quietly ignore it.
- **Caching to hide a missing index.** The cache expires and the problem
  returns, now with staleness bugs attached.
- **Assuming staging performance predicts production.** Different data volume,
  different plans.

**Real-world usage** — this checklist is what you run when an endpoint gets
slow: reproduce with `explain()`, look for COLLSCAN and SORT, check the
examined-to-returned ratio, hunt for N+1, then trim the payload.

**Related concepts** — [module 10](../10-populate-and-lean/README.md)
(`lean()` in depth), [module 06](../06-projection-sorting-pagination/README.md)
(cursor pagination), [module 17](../17-api-patterns/README.md) (these patterns
in a real API), [module 18](../18-production-and-security/README.md)
(production operations).

---

## Check yourself

1. What do `COLLSCAN` and `IXSCAN` mean, and which one do you want?
2. Which ratio tells you an index is doing its job, and what value is ideal?
3. You see a `SORT` stage in your plan. What does it cost you, and what is the
   hard limit it can hit?
4. An index is `{ city: 1, status: 1, amount: -1 }`. Which of these use it:
   `{city}`, `{status}`, `{city, amount}`, `{city, status}`?
5. State the ESR rule and explain why a range field before the sort field
   breaks it.
6. `unique: true` in a Mongoose schema — what does it actually do, and what
   error do you catch?
7. When would you choose a partial index over a sparse one?
8. What is an N+1 query, how do you spot it in code, and how do you fix it?
9. Why is `estimatedDocumentCount()` faster than `countDocuments({})`, and
   when can you not use it?
10. Your query returns `docsExamined: 0` and still returns documents. What
    happened?

**Next:** [module 13 — Validation, middleware, virtuals](../13-validation-middleware-virtuals/README.md),
where the work moves back into Node.js and Mongoose's own machinery.
