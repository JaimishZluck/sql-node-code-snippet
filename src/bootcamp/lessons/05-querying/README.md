# Module 05 — Querying & Filtering (+ Regular Expressions)

Module 04 taught you the verbs — `find`, `findOne`, `countDocuments`. This
module teaches the **language of the first argument**: the *filter document*.
That little object is a real query language with its own grammar, and it is
everywhere — the same filter language drives `find()`, `updateOne()`,
`deleteMany()`, `countDocuments()`, and the `$match` stage of aggregation
pipelines. Learn it once here and you will use it in every module that
follows.

Two ideas frame everything in this chapter:

**Idea 1 — the filter is data, not code.** A filter like
`{ price: { $gte: 1000 }, tags: "sale" }` is a plain object that Mongoose
sends to the MongoDB **server**, and the server does the matching. Nothing is
evaluated in Node.js. Operator names start with `$` (`$gte`, `$in`, `$regex`)
so MongoDB can tell "this is an instruction" apart from "this is a value".

**Idea 2 — know which layer does what.**

| Layer | What it contributes to a query |
| --- | --- |
| **Mongoose** (in Node.js) | *Casts* your filter values to the schema's types (the string `"40000"` becomes the number `40000`; a string id becomes an `ObjectId`), runs setters like `lowercase` on filter values, and throws `CastError` for impossible values. |
| **MongoDB** (on the server) | Does the actual matching, document by document, using indexes to narrow the candidates when it can. It has no idea your schema exists. |

That casting layer is a genuine safety net (Express query-string values are
*always* strings!) — but it also means the raw driver or the mongo shell can
behave differently from Mongoose for the *same* filter. Several lessons below
run the same query through both layers so you see the difference.

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-comparison-operators.js` | `npm run lesson 05-querying/01-comparison-operators` | equality/`$eq`, `$ne`, `$gt(e)`/`$lt(e)`, `$in`/`$nin`, date ranges, the missing-field surprise, casting vs raw BSON |
| `02-logical-operators.js` | `npm run lesson 05-querying/02-logical-operators` | implicit AND, when `$and` is truly required (duplicate JS keys!), `$or`, `$nor`, `$not` |
| `03-element-and-type-operators.js` | `npm run lesson 05-querying/03-element-and-type-operators` | `$exists`, missing vs null vs stored-null, `$type`, the int/double surprise, `$type` on arrays |
| `04-array-queries.js` | `npm run lesson 05-querying/04-array-queries` | containment, exact-array pitfall, `$all`, `$size`, dot notation into arrays, the `$elemMatch` cross-element **proof** |
| `05-nested-documents.js` | `npm run lesson 05-querying/05-nested-documents` | dot notation, the exact-subdocument pitfall (field order!), how MongoDB evaluates filters, `explain()` first look |
| `06-regex-and-strings.js` | `npm run lesson 05-querying/06-regex-and-strings` | `$regex`, prefix vs contains, `/i`, regex + indexes, escaping user input |

**Safety:** every lesson in this module is **100% read-only** on the seeded
store data. No documents are created, changed, or deleted. Run the lessons in
any order, as many times as you like, without reseeding.

---

## Topic: Equality and comparison operators (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`)

**What is it?** The basic vocabulary for saying *which* documents you want.
`{ role: "seller" }` means "role equals seller" — plain `{ field: value }` is
shorthand for `{ field: { $eq: value } }`. The other operators cover "not
equal" (`$ne`), ranges (`$gt` greater-than, `$gte` greater-or-equal, `$lt`,
`$lte`), and lists ("any of these" `$in`, "none of these" `$nin`).

**Why does it exist?** (what problem it solves) Without server-side filters
you would download whole collections and filter in JavaScript — slow, memory
hungry, and impossible at scale. Comparison operators let the *database*
answer "products between 1,000 and 5,000" by looking at data where it lives,
often via an index without touching most documents at all.

**When should I use it?** Constantly — nearly every real query has at least
one. Price bands, date windows (`placedAt: { $gte: monthStart, $lt:
nextMonthStart }`), status lists (`status: { $in: [...] }`), threshold checks
(`stock: { $gt: 0 }`).

**When should I avoid it?** Avoid `$ne`/`$nin` as the *only* condition on a
large collection — "everything except X" matches almost everything, so no
index can narrow it usefully. Avoid `$in` with enormous lists (thousands of
ids) — beyond a point, restructuring the query or the data works better.

**Important terms**
- **Filter document** — the object describing which documents match; the
  first argument of `find`/`updateOne`/`deleteMany`/`countDocuments`.
- **Operator** — a `$`-prefixed key giving an instruction (`$gte`) instead of
  a value to compare.
- **Inclusive / exclusive bound** — whether the boundary value itself matches:
  `$gte: 30` includes 30 (inclusive), `$gt: 30` does not (exclusive).
- **Half-open range** — the `[$gte start, $lt end)` pattern: start included,
  end excluded. It makes consecutive windows (days, months, price bands) meet
  without overlapping.
- **Type bracket** — MongoDB compares values only within the same type family:
  a *string* `"40000"` is never `$gt`, `$lt`, or equal to the *number*
  `40000`. Mongoose's casting usually hides this — the raw driver does not.

**Code example** — `01-comparison-operators.js`, sections 2–4:

```js
// Mid-range products — two operators on one field is an implicit AND:
await Product.find({ price: { $gte: 1000, $lte: 5000 } });

// Orders in a 60-day window — dates compare chronologically:
await Order.countDocuments({ placedAt: { $gte: start, $lt: end } });

// Staff — $in instead of a chain of ORs:
await User.find({ role: { $in: ["seller", "admin"] } });
```

**Expected result** — a sorted list of mid-range products; window counts near
25 orders per 30 days (300 orders over 365 days); exactly 5 staff users
(2 admins + 3 sellers). The `$gt: 30` vs `$gte: 30` discount demo shows two
different counts — the difference is exactly the "30% off" products.

**Common mistakes**
- Writing `$gt` when the boundary should match (or vice versa) — off-by-one
  price bands and date windows. Decide inclusivity *first*, then pick.
- Forgetting that `$ne`/`$nin` also match documents where the field is
  **missing entirely**: `{ age: { $ne: 200 } }` matches all 30 users,
  including the ~15% who have no `age` at all. Pair with
  `$exists: true` when you mean "has the field AND it differs".
- Comparing across types with the raw driver: `{ price: { $gt: "40000" } }`
  matches **nothing** natively (string vs number). Through Mongoose it works
  only because the schema casts the string first.
- Using `$or` for "same field, several values" — `$in` is cleaner and plans
  better.

**Real-world usage** — every listing endpoint you will ever write:
`GET /products?minPrice=1000&maxPrice=5000` becomes exactly the price-band
filter above (remember `req.query` values are strings — Mongoose casting or
explicit `Number()` conversion is what keeps it correct). Dashboards use date
windows; admin panels use `$in` on statuses.

**Related concepts** — logical combinations of these operators (next topic);
sorting/limiting the results (module 06); which comparisons can use an index
(module 12).

---

## Topic: Logical operators (implicit AND, `$and`, `$or`, `$nor`, `$not`)

**What is it?** The glue for combining conditions. Listing several keys in
one filter object means **all** must match (implicit AND). `$and`, `$or`,
`$nor` take arrays of sub-filters; `$not` negates one operator expression on
one field.

**Why does it exist?** Real questions are compound: "active customers with
3000+ points", "cheap **or** heavily discounted", "**neither** discounted
**nor** out of stock". And `$and` specifically exists because of a JavaScript
limitation — see the mistake below, it is the heart of this topic.

**When should I use it?** Implicit AND for everything by default. `$or` when
alternatives span **different** fields (for the same field, `$in`). `$nor`
for "none of these problems apply" clean-list queries. `$not` when you need
"does NOT match this operator/regex", especially when missing fields should
count as a match.

**When should I avoid it?** Don't write `$and` where implicit AND works — it
adds noise. Don't negate everything: `$not`/`$nor`/`$ne` filters are hard for
indexes to help with, and double negations are hard for *humans*. If a `$or`
has many arms hitting different unindexed fields, each arm is its own scan.

**Important terms**
- **Implicit AND** — several keys in one filter object; all must hold. Also
  works for one field with several *different* operators:
  `{ price: { $gte: 500, $lt: 2000 } }`.
- **`$and`** — explicit AND over an *array* of sub-filters. Required only
  when a key would repeat (same field + same operator, or two `$or` groups).
- **Silent overwrite** — the JavaScript behavior where a duplicate key in an
  object literal keeps only the last one. **No error.** Your first condition
  is discarded before MongoDB ever sees the filter.
- **`$nor`** — true when *every* sub-filter fails. An n-ary "none of the
  above".
- **`$not`** — wraps an **operator expression or a regex** — never a bare
  value (`{ role: { $not: "admin" } }` is invalid; that job belongs to
  `$ne`).

**Code example** — `02-logical-operators.js`, section 2 (the trap):

```js
// BROKEN — JavaScript keeps only the second `name` key; /Volt/ is LOST:
const broken = { name: { $regex: /Volt/ }, name: { $regex: /Ultrabook/ } };

// CORRECT — an array can hold the same field twice:
await Product.countDocuments({
  $and: [{ name: /Volt/ }, { name: /Ultrabook/ }],
});
```

**Expected result** — the lesson prints the broken filter's JSON so you can
*see* the vanished key, then shows its count equals the second-condition-only
count while `$and` gives the true (smaller) intersection. The `$not` section
shows `age $not $gte 30` counting **more** users than `age $lt 30` — the
extras are exactly the users with no `age` field — and the invalid
`{ $not: 500 }` being rejected with an error.

**Common mistakes**
- The silent overwrite: `{ $or: [...], $or: [...] }` or the same field key
  twice. Symptom: a filter that "ignores" one of your conditions. Fix:
  `$and`. (Note this is JavaScript's fault, not MongoDB's.)
- Thinking `NOT (age < 40)` equals `age >= 40`. With documents that can lack
  the field, they differ: `$not`/`$nor` count missing fields as a match,
  comparison operators never match missing fields.
- Using `$not` with a bare value. Value negation is `$ne`; `$not` wraps
  operators and regexes only.
- Building filters by merging objects (`{ ...filterA, ...filterB }`) — same
  silent-overwrite risk at runtime. Merge into `$and: [filterA, filterB]`
  instead.

**Real-world usage** — search endpoints that combine several optional
criteria usually *build* the filter dynamically: push each criterion into an
array and finish with `{ $and: conditions }` (safe against key collisions by
construction). Soft-delete systems put `$or: [{ deletedAt: null }, ...]`
into every read. Feature-flag rollouts use `$nor` to exclude several cohorts.

**Related concepts** — how missing fields behave (`$exists`, next topic);
`$elemMatch` (an AND scoped to one array element, topic 4); index planning
for `$or` (module 12).

---

## Topic: Element & type operators (`$exists`, `$type`) — the three flavors of "nothing"

**What is it?** Operators that ask about a field's *presence* and *storage
type* rather than its value. `{ age: { $exists: false } }` matches documents
with no `age` field at all; `{ sku: { $type: "string" } }` matches documents
whose `sku` is stored as a BSON string.

**Why does it exist?** MongoDB has no fixed columns — every document decides
which fields it carries, and a field can hold *any* BSON type. That
flexibility creates questions SQL never has to ask: *does* this document have
the field? Is the "nothing" a **missing field** or a **stored null**? Is that
number really a number, or did a bad import write it as a string? `$exists`
and `$type` are the audit tools.

**When should I use it?** Data-quality audits, migration checks
("which documents still lack the new field?"), incomplete-profile queries
(our seeded users: ~15% have no `age`/`address` — that is deliberate, for
these exact lessons), and any soft-delete style scheme built on `null`.

**When should I avoid it?** Don't lean on `$exists` for routine application
logic that Mongoose defaults could make unnecessary — a schema `default`
means new documents always carry the field, so presence checks become dead
code. `$exists: false` can't be answered by a normal index (missing fields
*are* indexed as null entries, but selectivity is usually poor) — don't build
hot-path queries on it.

**Important terms**
- **Missing field** — the key is simply not in the document. Costs zero bytes.
- **Stored null** — the key exists with the BSON value `null`. Costs bytes,
  and `$exists: true` matches it! Mongoose's `default: null` (as on
  `User.deletedAt`) *stores* nulls on every insert.
- **Null equality** — `{ field: null }` matches **both** flavors: missing OR
  stored null. Usually what you want ("no usable value").
- **`$type: "null"`** — matches *only* a stored null.
- **BSON type** — the concrete wire type of a value: `"string"`, `"int"`,
  `"double"`, `"date"`, `"array"`, `"objectId"`, `"null"`...
- **`"number"` alias** — a `$type` convenience matching `int`, `long`,
  `double`, and `decimal` at once.

**Code example** — `03-element-and-type-operators.js`, sections 1–2:

```js
await User.find({ age: { $exists: false } });        // truly missing (~15%)
await User.countDocuments({ deletedAt: null });        // missing OR null
await User.countDocuments({ deletedAt: { $type: "null" } }); // stored null only
await User.countDocuments({ deletedAt: { $ne: null } });     // soft-deleted
```

**Expected result** — the two comparison tables are the heart of the lesson:
for `age`, null-equality and `$exists: false` agree and `$type: "null"` is 0;
for `deletedAt`, `$exists: false` is **0** (the default wrote a null onto
every user) while null-equality finds the ~90% not soft-deleted. The `$type`
section shows `ratingSummary.average` split between BSON `int` and `double` —
and the `"number"` alias covering both.

**Common mistakes**
- Assuming `$exists: true` means "has a value". It also matches stored nulls.
  "Has a *real* value" is `{ $ne: null }` (which, because missing fields
  count as null-equal, excludes missing fields too).
- Auditing numbers with `$type: "int"`. The Node.js driver stores a
  whole-number JS value as int32 and a fractional one as double — the *same
  schema field* ends up with mixed BSON types. Query the `"number"` alias.
- Being surprised by `$type` on arrays: any non-`"array"` type is tested
  against the array's **elements** (`{ interests: { $type: "string" } }`
  matches users with at least one interest — not "interests is a string").
- Confusing Mongoose-level and MongoDB-level guarantees: Mongoose keeps types
  consistent **going in**; the database itself will happily hold a string
  `price` written by any other client. `$type` is how you find out.

**Real-world usage** — the classic soft-delete read filter
`{ deletedAt: null }` sits in almost every query of apps using that pattern
(often via middleware — module 13). Migrations run
`{ newField: { $exists: false } }` to find unconverted documents and measure
progress. Post-import sanity checks run `$type` audits before bad data
spreads.

**Related concepts** — `$ne`'s missing-field behavior (topic 1); schema
defaults and when they apply (module 03); partial indexes that skip
documents lacking a field (module 12).

---

## Topic: Array queries (containment, `$all`, `$size`, `$elemMatch`)

**What is it?** The query rules for array fields — `tags`, `interests`, and
the embedded `orders.items`. The core surprise: `{ tags: "wireless" }` does
not test equality, it tests **containment** ("the array contains this
value"). `$all` demands several values at once, `$size` matches exact length,
and `$elemMatch` groups conditions so they must hold on **one** element.

**Why does it exist?** Arrays inside documents are the document model's
biggest structural difference from SQL (where multi-values live in separate
join tables). MongoDB made the common case effortless — *any element may
match* — and added operators for the cases where that default is wrong.

**When should I use it?** Tag/label filtering (`tags: "sale"`), audience
targeting (`interests: { $all: [...] }`), and *always* `$elemMatch` when two
or more conditions describe **the same element** — "a line item with quantity
2 **and** price over 50,000" is `$elemMatch` territory, full stop.

**When should I avoid it?** Avoid `$size` for "at least/at most N" — it only
does exact length (workarounds: positional `$exists` trick, `$expr`, or a
maintained `itemCount` field). Avoid passing a raw array as a filter value
unless you truly mean exact, order-sensitive equality. And avoid `$elemMatch`
for single conditions — plain dot notation is identical there.

**Important terms**
- **Containment** — the array-field default: `{ field: v }` matches if the
  field equals `v` *or any element* equals `v`.
- **Multikey** — MongoDB's term for "this field holds arrays, index every
  element" — the mechanism behind fast containment queries.
- **Exact array equality** — `{ tags: ["a", "b"] }`: same elements, same
  **order**, nothing extra.
- **`$all`** — contains *all* listed values, any order — logically an AND of
  containments.
- **`$elemMatch`** — "at least one element satisfies ALL of these conditions
  *together*."
- **Cross-element match** — the trap: separate dot-notation conditions each
  independently ask "does ANY element satisfy me?", so two conditions can be
  satisfied by two *different* elements.
- **`$expr`** — runs an aggregation expression as a filter (used here for
  array-length ranges); flexible but unable to use a normal index.

**Code example** — `04-array-queries.js`, section 6 — the proof:

```js
// A: may match ACROSS different items (qty 2 from one, price from another)
await Order.find({ "items.quantity": 2, "items.unitPrice": { $gt: 50000 } });

// B: both conditions must hold on ONE item
await Order.find({
  items: { $elemMatch: { quantity: 2, unitPrice: { $gt: 50000 } } },
});
```

**Expected result** — set A is bigger than set B. The lesson computes
`A − B`, picks one of those orders, and prints its line items with two flag
columns (`qty === 2?`, `price > 50000?`): you will see each flag true on a
*different* row and **no row with both** — a concrete counterexample proving
filter A answered a different question than the one you meant to ask.

**Common mistakes**
- The cross-element bug above — it *returns plausible-looking data*, which is
  why it survives code review. Any time two conditions belong to one element,
  reach for `$elemMatch`.
- `{ tags: ["wireless"] }` when you meant `{ tags: "wireless" }` — exact
  equality vs containment. Typical source: forwarding `req.query.tags`
  (which Express may parse as an array) straight into the filter.
- Expecting `$in` to behave like `$all`: `$in` is "any overlap", `$all` is
  "contains all".
- `{ items: { $size: { $gte: 3 } } }` — invalid; `$size` takes a plain
  number only.

**Real-world usage** — product filtering by multiple tags (`$all`), user
segmentation by interests, and — most importantly — any query into embedded
line-item / event / history arrays (`$elemMatch`). The cross-element bug is a
real production incident pattern: revenue reports quietly overcounting
because a filter matched across items.

**Related concepts** — multikey indexes (module 12); `$elemMatch` also
exists as a *projection* operator, which is a different thing (module 06);
updating matched array elements with the positional `$` operator (module 07);
`$unwind` for per-element aggregation (module 10).

---

## Topic: Nested documents, dot notation, and how filters are evaluated

**What is it?** Querying fields inside embedded documents —
`"address.city"`, `"specs.brand"`, `"payment.method"` — by writing the full
path as a quoted key. Plus the mental model of what the server does with your
filter: test candidate documents one at a time, using an index to shrink the
candidate set when possible.

**Why does it exist?** Embedding is half the point of the document model
(module 09): the address lives *inside* the user. Dot notation is the
addressing scheme that makes one nested field filterable while ignoring its
siblings. The alternative — passing an object — exists too, but it means
something else entirely (exact equality), and that difference is one of
MongoDB's most infamous beginner traps.

**When should I use it?** Any time a filter touches an embedded field.
Always. There is no depth limit and no cost penalty for depth; operators and
indexes work on nested paths exactly as on top-level ones (`users` even has
an index on `address.city`).

**When should I avoid it?** Avoid the *object-value* form
`{ address: { city: "Mumbai" } }` unless you genuinely want byte-for-byte
sub-document equality (you almost never do). One legitimate niche: matching
tiny, fixed-shape objects you fully control — and even that breaks the day a
field is added.

**Important terms**
- **Embedded document / sub-document** — an object stored inside another
  document (`user.address`, `order.payment`).
- **Dot notation** — a quoted path key: `{ "address.city": "Mumbai" }`.
- **Exact sub-document match** — object as value: the stored sub-document
  must have exactly those fields, those values, **in that key order**,
  nothing more.
- **BSON key order** — BSON documents are ordered byte sequences; `{ a, b }`
  and `{ b, a }` are *different* BSON. Exact matching compares those bytes.
- **`COLLSCAN` / `IXSCAN`** — explain-plan stages: full collection scan vs
  index scan. Indexes change how many documents are *examined*, never what
  *matches*.
- **`explain()`** — the query's X-ray: ask MongoDB which plan it chose
  instead of guessing.

**Code example** — `05-nested-documents.js`, sections 2–3 (both run through
the **native driver**, so you see pure server semantics with no Mongoose
casting involved):

```js
db.collection("users").countDocuments({ address: { city: "Mumbai" } }); // 0 !
db.collection("users").countDocuments({ "address.city": "Mumbai" });    // many

// Field order matters in exact matches — same fields, reversed keys:
db.collection("orders").countDocuments({ payment: { method: "cod", paidAt: null } }); // > 0
db.collection("orders").countDocuments({ payment: { paidAt: null, method: "cod" } }); // 0 !
```

**Expected result** — the pitfall query returns **0** (every stored address
also carries street/state/country/zip, so nothing equals the two-field
literal), while dot notation finds the Mumbai users. The payment demo is the
kicker: identical fields and values match or fail on key order alone. The
explain() section prints `FETCH <- IXSCAN(address.city_1)` for the indexed
nested query and `COLLSCAN` for the unindexed `loyaltyPoints` one.

**Common mistakes**
- The exact-match pitfall itself — dangerous because it fails *silently*:
  empty results look like "no data", not like a bug. If a nested-field query
  returns nothing you know exists, check whether you passed an object instead
  of a dotted path.
- Forgetting the quotes: `{ address.city: "Mumbai" }` is a JavaScript syntax
  error; the dots force the key into quotes.
- Assuming nested queries are slower or that indexes can't reach them — both
  false; `{ "address.city": 1 }` is a perfectly normal index.
- Reading zero results as proof of zero matching *data* rather than a wrong
  *question* — the recurring theme of this module.

**Real-world usage** — everywhere embedding is used: filtering orders by
`"payment.method"`, users by `"address.city"`, products by `"specs.brand"`,
support tickets by `"meta.source"`. The denormalized
`"ratingSummary.average"` filter in the lesson is the standard trick behind
fast "top rated" listing pages — a nested-field filter on a maintained copy
instead of an aggregation over reviews on every page load.

**Related concepts** — when to embed vs reference (module 09); indexes on
nested paths and `explain()` in depth (module 12); `$elemMatch` — the
array-flavored cousin of this topic (topic 4 above).

---

## Topic: Regular expressions (`$regex`) — pattern matching, indexes, and safety

**What is it?** String pattern matching inside filters. MongoDB has no SQL
`LIKE`; instead a filter value can be a regular expression — as a JS literal
(`{ name: /Ultrabook/ }`) or via the operator form
(`{ name: { $regex: "^Volt", $options: "i" } }`) when the pattern is built
from a runtime string. Matching runs on the **server**.

**Why does it exist?** Exact equality cannot answer "starts with", "contains"
or "looks like". Regex is the general-purpose string matcher — search boxes,
SKU families (`/^LAP-/`), quick admin filters — without shipping every
document to Node.js to check in JavaScript.

**When should I use it?** Prefix searches (autocomplete, code/SKU families) —
ideally **anchored** (`^...`) and **case-sensitive** so the index helps.
Small, controlled patterns on modest collections. Negations via
`{ field: { $not: /^X/ } }` (`$not` is how you negate a regex).

**When should I avoid it?** Real full-text search — word stemming, relevance
ranking, multi-field search — wants a **text index** (`products` already has
one over `name`+`description`) or Atlas Search, not regex. Unanchored or
case-insensitive regex on large collections is a full scan of the index or
collection. And *never* interpolate raw user input into a pattern (see
mistakes).

**Important terms**
- **Anchor** — `^` (start of string) / `$` (end). `/^Volt/` = "starts with
  Volt"; unanchored `/Volt/` = "contains Volt anywhere".
- **Flag / `$options`** — matching modifiers; `i` = case-insensitive.
- **Index bounds** — the slice of a sorted index a query must read. A
  case-sensitive `^prefix` yields *tight* bounds (`["LAP-", "LAP.")`): jump
  to the block, stop after it. `/i` or contains-patterns yield the *full*
  range — every index entry gets tested. Reason: the index is sorted
  case-sensitively, so `lap-...` entries live nowhere near `LAP-...`, and a
  mid-string match can hide anywhere — no contiguous range exists. Only an
  **anchored, case-sensitive prefix** regex can use tight bounds.
- **Escaping** — backslashing regex metacharacters (`. * + ? ^ $ { } ( ) | [
  ] \`) so user input matches *literally*.
- **ReDoS** — "regular expression denial of service": patterns with
  catastrophic backtracking (e.g. nested quantifiers like `(a+)+`) that pin a
  CPU — on your *database* server, since that is where regex runs.
- **Normalize-on-write** — the better fix for case problems: store lowercase
  (Mongoose `lowercase: true`, as on `User.email`) and query with plain
  equality instead of `/i`.

**Code example** — `06-regex-and-strings.js`, sections 4–6:

```js
await Product.find({ sku: /^LAP-/ });   // tight index bounds — fast
await Product.find({ sku: /^lap-/i });  // full index range — every entry tested

// The safe search-box pattern: escape, anchor, then query
const escapeRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
await Product.find({ name: { $regex: `^${escapeRegex(req.query.q)}` } });
```

**Expected result** — the explain() comparison prints tight bounds
(`["LAP-", "LAP.")`) for the case-sensitive prefix and the full range
(`["", {})` plus the regex) for `/i` and contains versions. The escaping
demos show `new RegExp("Phone.")` matching every "Phone X"/"Phone Pro" (the
dot ate the space) while the escaped pattern correctly matches nothing, and
`new RegExp("Nexa (Pro")` throwing a `SyntaxError` that escaping prevents.
Plus a fun one: the contains-pattern `/bad/` on cities matches **Ahmedabad**.

**Common mistakes**
- Building `new RegExp(userInput)` without escaping. Three escalating
  failure modes: wrong results (`.` matches anything), crashed requests
  (invalid patterns throw), and ReDoS (hostile patterns hog the DB's CPU).
- Expecting `/i` to be free. It silently downgrades a millisecond prefix
  lookup into a full index sweep. Normalize on write instead, or use a
  case-insensitive collation index.
- Using regex for full-text search ("find laptops good for gaming") — wrong
  tool; that is `$text` / Atlas Search territory.
- Anchoring with `^` but leaving `/i` on and believing the index bounds are
  still tight — the case-insensitivity alone forfeits them.

**Real-world usage** — autocomplete endpoints use the
escape-anchor-limit trio (`^` + `escapeRegex` + `.limit(10)`); admin panels
use SKU/order-number prefix filters (`/^ORD-2025/`); login systems avoid the
whole problem by lowercasing emails at write time. Every serious codebase has
an `escapeRegex` helper — copy the one from this lesson.

**Related concepts** — `$text` search and the text index on products
(module 12); `$not` with regexes (topic 2); projections and `limit` to keep
search responses small (module 06); collations for locale/case-insensitive
comparison (module 12).

---

## Where to next

- **Module 06 — queries & cursors:** shaping *results* — projections, sort,
  skip/limit pagination, `lean()`, and chaining on the Query object.
- **Module 07 — updates & deletes:** the same filter language selecting
  documents to *change*.
- **Module 10 — aggregation:** `$match` reuses everything from this module as
  a pipeline stage.
- **Module 12 — indexes & performance:** `explain()` in depth — you saw
  `COLLSCAN` vs `IXSCAN` and index bounds here; that module teaches you to
  design indexes so your filters hit them.
