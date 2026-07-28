# Module 11 — Aggregation: from documents to answers

Everything up to now answered *"which documents match?"*. This module answers
everything else: **totals, averages, rankings, joins, reshaping, bucketing,
dashboards**. If `find()` is the SELECT of MongoDB, aggregation is the rest of
SQL — GROUP BY, HAVING, JOIN, CASE, window functions — plus things SQL has no
comfortable equivalent for, like exploding an embedded array.

It is also the module where MongoDB stops feeling like a place to *store*
objects and starts feeling like a place to *compute* with them. That shift
matters for performance: work done in a pipeline happens on the server, next
to the data. The alternative — fetching 300 orders into Node and summing them
in JavaScript — ships every byte over the network to do arithmetic that the
database could have done in one pass.

## The one mental model

A pipeline is an **assembly line**. Documents enter at one end. Each **stage**
is a station that transforms the stream and hands it to the next. Whatever
leaves the last station is your result.

```js
await Order.aggregate([
  { $match:  { status: "delivered" } },      // station 1: drop non-matching docs
  { $unwind: "$items" },                     // station 2: one doc per line item
  { $group:  { _id: "$items.product",        // station 3: collapse into totals
               units: { $sum: "$items.quantity" } } },
  { $sort:   { units: -1 } },                // station 4: order them
  { $limit:  10 },                           // station 5: keep the top 10
]);
```

Three consequences follow from "assembly line", and they explain almost every
aggregation bug:

1. **Order changes the answer.** `$limit` then `$sort` sorts an arbitrary
   handful. `$sort` then `$limit` gives you a real top-N.
2. **Order changes the speed.** Only a `$match` at the *front* of a pipeline
   can use an index. Once any stage has reshaped the documents, they are
   intermediate results and no index applies. **Filter early.**
3. **After a reshaping stage, your documents are gone.** What flows on is
   whatever that stage produced — not your model, not your schema.

## `aggregate()` is not `find()`

| | `find()` | `aggregate()` |
| --- | --- | --- |
| Returns | Mongoose **Documents** | **plain objects** |
| Virtuals (`finalPrice`) | yes | **no** |
| Getters, `select: false`, defaults | applied | **not applied** |
| Casting of your input values | yes (schema-aware) | **no — cast ObjectIds yourself** |
| Where the work happens | server filters, Mongoose hydrates | entirely on the server |

The casting row is the one that bites. `find({ user: "665f…" })` works because
Mongoose casts the string against the schema. `aggregate([{ $match: { user:
"665f…" } }])` silently matches **nothing** — the pipeline is sent to the
server verbatim. Any id from `req.params` must be wrapped:
`new mongoose.Types.ObjectId(id)`.

## Streaming vs blocking stages

| Behavior | Stages | Memory |
| --- | --- | --- |
| **Streaming** — handle one doc, pass it on | `$match`, `$project`, `$addFields`/`$set`, `$unset`, `$limit`, `$skip`, `$unwind`, `$lookup` | flat |
| **Blocking** — must see everything first | `$sort`, `$group`, `$facet`, `$bucket`, `$bucketAuto`, `$sortByCount`, `$count` | grows |

Each blocking stage is capped at **100 MB**. Exceed it and the pipeline errors
with `Sort exceeded memory limit` (or the `$group` equivalent) unless you pass
`{ allowDiskUse: true }`, which spills to disk — correct, but much slower.
Two mitigations that usually work better: put an indexed `$match` first, and
pair `$sort` with `$limit` (the optimizer then keeps only the top N in memory).

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-pipeline-basics.js` | `npm run lesson 11-aggregation/01-pipeline-basics` | stage-by-stage stream shaping, `$match`/`$project`/`$sort`/`$limit`, how stage order changes both answer and speed, streaming vs blocking, plain objects vs documents, a complete revenue-by-month pipeline |
| `02-group.js` | `npm run lesson 11-aggregation/02-group` | `_id` as the grouping key, every accumulator (`$sum` `$avg` `$min` `$max` `$push` `$addToSet` `$first` `$last` `$stdDevPop`), compound keys, computed keys, `$match` before vs after `$group` (WHERE vs HAVING), double grouping |
| `03-unwind.js` | `npm run lesson 11-aggregation/03-unwind` | exploding arrays, the double-counting trap and its fix, `preserveNullAndEmptyArrays`, `includeArrayIndex`, `$map`/`$filter`/`$reduce` as the cheaper alternative, multikey indexes and stage order |
| `04-lookup.js` | `npm run lesson 11-aggregation/04-lookup` | the simple and pipeline forms, the always-an-array result, filtering parents by child fields (what `populate` cannot do), `let`/`$expr`, non-equality joins, self-joins, joining through an array, ObjectId casting |
| `05-expressions.js` | `npm run lesson 11-aggregation/05-expressions` | field paths and `$$` variables, arithmetic, `$cond`/`$switch`/`$ifNull`, query syntax vs expression syntax, `$expr`, string/date/array/type operators, `$addFields` vs `$project` |
| `06-facet-bucket-sample.js` | `npm run lesson 11-aggregation/06-facet-bucket-sample` | `$count`, `$sortByCount`, `$bucket`, `$bucketAuto`, `$facet` for dashboards and for paginate-with-total, `$sample`, `$replaceRoot`/`$mergeObjects`, a map of stages beyond this module |

**Safety:** this entire module is **100% read-only**. Nothing is created,
changed, or deleted. Run any file, any number of times, in any order.

---

## Topic: The aggregation pipeline

**What is it?** An array of **stages** passed to `Model.aggregate([...])`.
Each stage is an object with exactly one key — the stage name — and the
documents flow through them in order.

**Why does it exist?** (what problem it solves) `find()` can filter, project,
sort, and paginate. It cannot compute a total, group by a field, join, or
reshape a document. Without aggregation, every report means downloading the
raw documents and computing in Node.js — which burns network bandwidth,
memory, and event-loop time, and does not scale past a few thousand rows.

**When should I use it?** Any time the answer is *derived* rather than
*stored*: revenue by month, top-selling products, per-customer lifetime value,
rating distributions, dashboards, or joins where you filter on the joined side.

**When should I avoid it?** When `find()` does the job. A pipeline that is
just `[{ $match }, { $sort }, { $limit }]` is `find().sort().limit()` written
the hard way — and `find()` gives you real Mongoose documents with virtuals.
Also avoid it for very hot single-document reads: aggregation has slightly
more overhead and cannot use the schema's conveniences.

**Important terms**
- **Stage** — one step. `$match`, `$group`, `$sort`, …
- **Expression** — a computation used *inside* a stage, written as nested
  objects: `{ $multiply: ["$price", 2] }`.
- **Field path** — `"$price"`, meaning "the value of `price` in the current
  document". One `$` = field path; two `$$` = variable; no `$` = literal.
- **Accumulator** — an operator that folds many values into one inside
  `$group`: `$sum`, `$avg`, `$push`, …
- **Blocking stage** — one that must buffer the whole stream (`$sort`,
  `$group`, `$facet`).
- **`allowDiskUse`** — option letting blocking stages spill past 100 MB onto
  disk.
- **`$$ROOT`** — the entire current document, as a value.
- **`$$NOW`** — the server's clock at pipeline start.

**Code example** — `01-pipeline-basics.js`, section 7:

```js
await Order.aggregate([
  { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
  { $group: { _id: { $dateTrunc: { date: "$placedAt", unit: "month" } },
              revenue: { $sum: "$totalAmount" },
              orders:  { $sum: 1 } } },
  { $sort: { revenue: -1 } },
]);
```

**Expected result** — up to 13 rows (the seeded orders span 365 days), each a
month with its revenue and order count, best month first. Revenue figures land
in the low millions of rupees.

**Common mistakes**
- **`$limit` before `$sort`** when you meant top-N. Silent and wrong.
- **`$match` late in the pipeline.** Correct, but the index never gets used.
- **Expecting virtuals.** `agg[0].finalPrice` is `undefined`; compute it in
  the pipeline instead.
- **Passing a string where an ObjectId is required.** Matches nothing.
- **Writing `"price"` instead of `"$price"`.** You get the literal string in
  every output document, which looks like a data bug rather than a typo.

**Real-world usage** — admin dashboards, analytics endpoints, scheduled
reports, recommendation inputs, and any list endpoint that needs a total count
alongside a page of results.

**Related concepts** — [module 12](../12-indexes-and-performance/README.md)
(making pipelines fast, and reading their `explain()`),
[module 10](../10-populate-and-lean/README.md) (`populate` as the alternative
to `$lookup`), [module 17](../17-api-patterns/README.md) (aggregation behind
real HTTP endpoints).

---

## Topic: `$match` and `$project` (and `$addFields` / `$set` / `$unset`)

**What is it?** `$match` filters the stream using ordinary query syntax —
exactly what you would put in `find()`. `$project` reshapes each document:
include fields, exclude fields, rename them, or compute new ones.
`$addFields` (alias `$set`) adds computed fields while **keeping** everything
else; `$unset` removes fields.

**Why do they exist?** (what problem they solve) `$match` shrinks the stream
as early as possible — the single biggest performance lever in any pipeline.
`$project` shapes the output so your API returns exactly what the client needs
and nothing more (smaller payloads, no accidental leaking of internal fields).

**When should I use them?**
- `$match` **first**, always, whenever a filter is possible.
- `$addFields`/`$set` in the middle, when you need a computed value for a
  later stage.
- One `$project` at the **end**, to shape the response.

**When should I avoid them?** Avoid an early `$project` that lists only a few
fields — a later stage will need something you dropped, and the failure shows
up as a confusing `null`. Avoid a `$match` that uses `$expr` as the *first*
stage if a plain indexed filter could go there instead.

**Important terms**
- **Inclusion projection** — `{ name: 1, price: 1 }`: only these (plus `_id`).
- **Exclusion projection** — `{ description: 0 }`: everything except these.
  You cannot mix inclusion and exclusion in one `$project` (except for `_id`).
- **`$$REMOVE`** — a sentinel that conditionally drops a field:
  `{ discount: { $cond: [cond, "$discount", "$$REMOVE"] } }`.
- **`$expr`** — lets expression syntax (and therefore field-to-field
  comparison) be used inside `$match`.

**Code example** — `05-expressions.js`, section 10:

```js
{ $addFields: { finalPrice: { $round: [{ $multiply: ["$price", 0.8] }, 0] } } },
{ $unset:     ["description", "specs", "createdAt", "updatedAt"] },
```

**Expected result** — the full product document plus `finalPrice`, minus the
noisy fields. Compare with `$project`, which would have required you to list
every field you wanted to keep.

**Common mistakes**
- **Mixing `1` and `0` in one `$project`.** MongoDB errors.
- **`$match` on a computed field before it exists.** Field paths only see what
  earlier stages produced.
- **Comparing two fields with query syntax.** `{ $match: { a: "$b" } }` looks
  for the literal string `"$b"`. Use `{ $match: { $expr: { $eq: ["$a", "$b"] } } }`.

**Real-world usage** — every list endpoint: `$match` from query params,
`$project` down to the response shape.

**Related concepts** — [module 05](../05-querying/README.md) (query syntax),
[module 06](../06-projection-sorting-pagination/README.md) (projection in
`find`).

---

## Topic: `$group` and accumulators

**What is it?** The stage that collapses many documents into one per distinct
key.

```js
{ $group: {
    _id: "$status",                       // the GROUPING KEY
    orders:  { $sum: 1 },                 // count
    revenue: { $sum: "$totalAmount" },    // total
    biggest: { $max: "$totalAmount" },
} }
```

**Why does it exist?** (what problem it solves) Summaries. Without it, "what
is our revenue?" means downloading every order. `$group` computes it in one
server-side pass.

**When should I use it?** Whenever the answer has fewer rows than the input:
per-status counts, per-month revenue, per-product sales, per-customer totals,
distinct values with counts.

**When should I avoid it?** When you need the original documents back —
`$group` throws away every field that no accumulator captured. If you want
"the whole best document per group", capture `{ $first: "$$ROOT" }` and use
`$replaceRoot` (lesson 06).

**Important terms**
- **`_id` (inside `$group`)** — the grouping key, *not* a document id. Use
  `null` for a single global bucket, a field path for one bucket per value, or
  an object for a compound key.
- **Accumulator** — `$sum`, `$avg`, `$min`, `$max`, `$push`, `$addToSet`,
  `$first`, `$last`, `$count`, `$stdDevPop`, `$stdDevSamp`, and (MongoDB 5.2+)
  `$top`, `$topN`, `$firstN`, `$lastN`, `$maxN`.
- **`{ $sum: 1 }`** — the counting idiom (`COUNT(*)`).
- **`{ $sum: "$field" }`** — the totalling idiom (`SUM(field)`).
- **HAVING** — a `$match` placed **after** `$group` filters groups, not
  documents. Same operator, different meaning by position.

**Code example** — `02-group.js`, section 9:

```js
await Review.aggregate([
  { $group: { _id: "$product", avgRating: { $avg: "$rating" }, reviews: { $sum: 1 } } },
  { $match: { reviews: { $gte: 3 } } },              // ← HAVING: filters GROUPS
  { $group: { _id: { $round: ["$avgRating", 0] }, productsInThisBand: { $sum: 1 } } },
]);
```

**Expected result** — a small table showing how many well-reviewed products
sit at each star level, weighted toward 4 and 5 (the seeder's ratings lean
positive).

**Common mistakes**
- **`{ $sum: 1 }` vs `{ $sum: "$field" }`** confusion — one counts, one totals.
- **`$first`/`$last` without a preceding `$sort`.** Arrival order is arbitrary,
  so "most recent order" becomes random. No warning is given.
- **`$push`-ing whole documents from a large group.** The output document is
  still capped at 16 MB.
- **Forgetting that everything not accumulated is discarded.**
- **Assuming `$group` output is sorted.** It is not — add an explicit `$sort`.

**Real-world usage** — every analytics endpoint, plus derived data that gets
written back (our seeder computes `product.ratingSummary` with exactly this
kind of pipeline).

**Related concepts** — [module 09](../09-data-modeling/README.md)
(denormalizing a computed summary onto a document),
[module 13](../13-validation-middleware-virtuals/README.md) (keeping such a
summary in sync with middleware).

---

## Topic: `$unwind`

**What is it?** The stage that turns one document containing an N-element
array into **N documents**, each carrying one element. Everything outside the
array is copied onto each output document.

**Why does it exist?** (what problem it solves) Embedded arrays are great for
reads and useless for cross-document grouping. Our orders embed their line
items, so "which product sold the most units?" has to reach inside 300 arrays
and group elements from *different* orders together. `$unwind` flattens the
stream so ordinary stages can do that.

**When should I use it?** When array elements from different documents must
meet — grouping, sorting, or joining across the array.

**When should I avoid it?** When the question stays within one document.
"How many items in this order?" is `{ $size: "$items" }`. "What is the largest
line?" is `$max` over `$map`. `$unwind` multiplies your stream; use `$map`,
`$filter`, `$reduce`, `$size`, and `$sum` when you do not need the expansion.

**Important terms**
- **`preserveNullAndEmptyArrays`** — `false` (default) drops documents whose
  array is empty or missing (INNER JOIN behavior); `true` keeps them with the
  field set to `null` (LEFT JOIN behavior).
- **`includeArrayIndex`** — adds a field with the element's 0-based position.
- **Fan-out** — the multiplication of documents. 300 orders × ~2.5 items ≈ 750.
- **Double counting** — summing a *parent* field after `$unwind`, so each
  order's total is added once per line item.

**Code example** — `03-unwind.js`, section 4:

```js
// WRONG — totalAmount is counted once per line item (~2.5x too high)
[{ $unwind: "$items" }, { $group: { _id: null, revenue: { $sum: "$totalAmount" } } }]

// RIGHT — group back to one row per order first
[{ $unwind: "$items" },
 { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" },
                          units: { $sum: "$items.quantity" } } },
 { $group: { _id: null, revenue: { $sum: "$totalAmount" }, units: { $sum: "$units" } } }]
```

**Expected result** — the wrong pipeline reports roughly 2.5× the true
revenue; the corrected one matches the no-unwind figure exactly. The lesson
prints the inflation factor so you can see it.

**Common mistakes**
- **Double counting parent fields** (above). The most expensive aggregation
  bug there is, because the output looks plausible.
- **Losing documents with empty arrays.** "Why is this customer missing from
  the report?" — because their `interests` array was empty.
- **`$unwind` before `$match`.** Filter first; never expand rows you are about
  to discard.
- **`$lookup` after `$unwind`.** 750 line items means 750 join probes.

**Real-world usage** — sales-per-product reports from embedded order items,
tag clouds, per-element analytics on any embedded array.

**Related concepts** — [module 08](../08-arrays-and-nested-documents/README.md)
(arrays generally), [module 12](../12-indexes-and-performance/README.md)
(multikey indexes).

---

## Topic: `$lookup` — the server-side join

**What is it?** A stage that joins another collection into the pipeline. Two
forms:

```js
// simple: equality on one field pair
{ $lookup: { from: "users", localField: "user", foreignField: "_id", as: "customer" } }

// pipeline: any condition, and you can shape/limit the joined docs
{ $lookup: {
    from: "reviews",
    let: { productId: "$_id" },
    pipeline: [
      { $match: { $expr: { $eq: ["$product", "$$productId"] } } },
      { $sort: { helpfulVotes: -1 } },
      { $limit: 2 },
    ],
    as: "topReviews",
} }
```

**Why does it exist?** (what problem it solves) `populate()` runs a second
query in Node and stitches results in memory, so it can never filter, sort, or
group *parents* by a *child's* field. `$lookup` joins on the server, inside the
pipeline, so all of that becomes possible in one round trip.

**When should I use it?** When the filter/sort/group key lives on the joined
side ("orders from Mumbai customers"), when you are already aggregating, or
when you need a non-equality join condition.

**When should I avoid it?** For simple "attach the related document" reads in
a normal endpoint — `populate()` is more ergonomic and returns real Mongoose
documents. Also avoid joining two large collections without a hard `$match`
first, and never `$lookup` after an unfiltered `$unwind`.

**Important terms**
- **`from`** — the **collection** name (`"users"`), *not* the model name
  (`"User"`). Getting this wrong returns empty arrays silently.
- **`as`** — the output field. **Always an array**, even for one-to-one joins,
  even when nothing matched (then `[]`).
- **`let`** — declares variables from the outer document, available in the
  sub-pipeline as `$$name`.
- **`$expr`** — required in the sub-pipeline to compare a field against a
  `$$variable`.
- **`$graphLookup`** — the recursive cousin, for trees of unknown depth.

**Code example** — `04-lookup.js`, section 3:

```js
await Order.aggregate([
  { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
  { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "customer" } },
  { $unwind: "$customer" },
  { $match: { "customer.address.city": "Mumbai" } },   // ← populate() cannot do this
  { $group: { _id: "$customer.name", spend: { $sum: "$totalAmount" } } },
]);
```

**Expected result** — a handful of Mumbai customers with their total spend,
highest first.

**Common mistakes**
- **Using the model name in `from`.** Silent empty results.
- **Forgetting the result is an array.** `doc.customer.name` is `undefined`;
  you need `$unwind` or `$arrayElemAt`.
- **`$unwind` after `$lookup` without `preserveNullAndEmptyArrays`.** Orders
  whose user was deleted vanish from the report.
- **Passing a string id into `$match`.** No casting happens in aggregation.
- **Joining on an unindexed `foreignField`.** That is a collection scan *per
  input document*.

**Real-world usage** — admin reports that cross entities, "customers who
bought X", enriched exports, and any list where the sort key lives on a
related document.

**Related concepts** — [module 10](../10-populate-and-lean/README.md)
(`populate` mechanics and when it is enough),
[module 09](../09-data-modeling/README.md) (embedding to avoid the join
entirely).

---

## Topic: Expressions

**What is it?** The computation language used inside stages. Written as nested
objects — `{ $operator: [args] }` — which is a function call turned inside
out: read `{ $multiply: ["$price", 2] }` as `multiply(price, 2)`.

**Why does it exist?** (what problem it solves) It lets computation happen on
the server, close to the data, without shipping documents to Node. It is also
the only way to compare two fields of the same document, format dates for
reports, or transform arrays in place.

**When should I use it?** Everywhere inside a pipeline: `$project`,
`$addFields`, `$group` accumulators, `$match`'s `$expr`, and `$lookup`
sub-pipelines.

**When should I avoid it?** Do not rebuild complex business logic in
expressions just to avoid a few lines of JavaScript — pipelines are hard to
read, hard to unit-test, and hard to debug. Use them for data-shaped work
(sums, dates, conditionals), and keep genuinely intricate rules in code.

**Important terms**
- **`$` vs `$$` vs nothing** — field path / variable / literal.
- **Query syntax vs expression syntax** — `{ price: { $gt: 100 } }` is a
  *filter*; `{ $gt: ["$price", 100] }` is a *boolean computation*. `$match`
  takes the first, `$project`/`$group` take the second, and `$expr` bridges
  them.
- **`$cond`** — if/else. **`$switch`** — a case chain (always give it a
  `default`). **`$ifNull`** — fallback for null *or* missing.
- **`$let`** — declares local variables inside an expression.
- **`$map` / `$filter` / `$reduce`** — array transforms without `$unwind`;
  `$$this` is the current element, `$$value` the accumulator in `$reduce`.
- **`$convert`** — the safe cast, with `onError` and `onNull`. The short forms
  (`$toInt`, `$toDouble`) **throw** and abort the pipeline.
- **`$dateTrunc` / `$dateToString` / `$dateDiff` / `$dateAdd`** — the modern
  date toolkit. Dates are stored in UTC; pass `timezone` when formatting.

**Code example** — `05-expressions.js`, section 5:

```js
// Compare two fields of the SAME document — impossible in query syntax
{ $match: { $expr: { $gt: ["$totalAmount", { $multiply: [3000, { $size: "$items" }] }] } } }
```

**Expected result** — the orders whose total exceeds ₹3,000 per line item,
largest first.

**Common mistakes**
- **Using query syntax where an expression is expected** (and vice versa).
- **`$switch` with no `default`.** The first unmatched document errors the
  whole pipeline.
- **Arithmetic on a possibly-missing field.** `{ $add: [5, null] }` is `null`,
  and the null then propagates through everything downstream. Wrap optional
  fields in `$ifNull`.
- **`$toInt` on dirty data.** One bad value kills the report; use `$convert`.
- **`$substr` on non-ASCII text.** It works on bytes; use `$substrCP`.

**Real-world usage** — computed response fields, report labels, date bucketing,
safe handling of optional fields, and every `$expr` filter.

**Related concepts** — [module 12](../12-indexes-and-performance/README.md)
(`$expr` and index usage), [module 15](../15-errors-and-query-behavior/README.md)
(what a pipeline error looks like).

---

## Topic: `$facet`, `$bucket`, `$sample`

**What is it?**
- **`$facet`** runs several sub-pipelines over the *same* input and returns
  all their results in one document.
- **`$bucket`** groups a numeric field into ranges you specify;
  **`$bucketAuto`** picks the boundaries for you.
- **`$sample`** returns N pseudo-random documents.

**Why do they exist?** (what problem they solve) A dashboard needs five
different numbers from the same filtered set — that is five round trips and
five passes over the data unless `$facet` does it once. A price-filter sidebar
needs counts per price band, which is exactly `$bucket`. A "you might also
like" row needs randomness, which is `$sample`.

**When should I use them?**
- `$facet` for dashboards, and for **paginated results with a total count** in
  one query.
- `$bucket` for business-defined bands; `$bucketAuto` for histograms.
- `$sample` for previews, spot checks, and lightweight recommendations.

**When should I avoid them?** `$facet` is blocking and its sub-pipelines
cannot use indexes after the split — for very large collections, two separate
queries (a `find` and a `countDocuments`) can beat the one-query version.
`$sample` is only efficient as the **first** stage taking under 5% of the
collection; otherwise it sorts the entire stream by a random value.

**Important terms**
- **Facet** — one named sub-pipeline. Its result is **always an array**.
- **`boundaries`** — lower-inclusive, upper-exclusive edges for `$bucket`.
- **`default`** — the catch-all bucket. **Omitting it makes an out-of-range
  value abort the pipeline.**
- **`$replaceRoot` / `$replaceWith`** — promotes a nested object to be the
  document.
- **`$mergeObjects`** — combines objects; later keys win.
- **`$sortByCount`** — shorthand for group-by-expression + sort descending.

**Code example** — `06-facet-bucket-sample.js`, section 5:

```js
{ $facet: {
    data: [{ $sort: { price: -1 } }, { $skip: 5 }, { $limit: 5 }],
    meta: [{ $count: "total" }],
} },
{ $project: { data: 1, total: { $arrayElemAt: ["$meta.total", 0] } } }
```

**Expected result** — a page of five products plus `total`, `page`, `perPage`,
and `totalPages` — everything a paginated API response needs, from one query,
with the filter written exactly once.

**Common mistakes**
- **`$bucket` without `default`.** Works until someone adds an expensive
  product, then errors in production.
- **Forgetting facet results are arrays.** `result.totals.revenue` is
  `undefined`; you need `result.totals[0].revenue` or `$arrayElemAt`.
- **`$sample` for security-sensitive randomness.** It is not cryptographic.
- **`$count` mid-pipeline.** It replaces the entire stream with one document;
  nothing else survives it.

**Real-world usage** — admin dashboards, e-commerce faceted search (price
bands, brand counts), paginated list endpoints, and "featured" carousels.

**Related concepts** — [module 06](../06-projection-sorting-pagination/README.md)
(pagination without `$facet`), [module 17](../17-api-patterns/README.md) (these
stages behind real endpoints).

---

## Check yourself

1. Why does `$limit` before `$sort` give a different answer than `$sort`
   before `$limit`?
2. Which stages are blocking, and what happens when one exceeds 100 MB?
3. `Order.find({ user: "665f…" })` works but
   `Order.aggregate([{ $match: { user: "665f…" } }])` returns nothing. Why?
4. What is the difference between `{ $sum: 1 }` and `{ $sum: "$amount" }`?
5. Your revenue report is 2.5× too high and you used `$unwind`. What happened,
   and what are two ways to fix it?
6. Why is a `$lookup` result always an array, and what are the two ways to
   flatten it?
7. When is `{ $match: { a: "$b" } }` wrong, and what should you write instead?
8. Name one case where `$facet` pagination is *slower* than two queries.

**Next:** [module 12 — Indexes & performance](../12-indexes-and-performance/README.md),
where you learn to read `explain()` and make all of this fast.
