# Module 06 — Projection, Sorting & Pagination: shaping list results

The CRUD module answered "**which documents** match?". That is only half of a
real list endpoint. When your React app calls `GET /products?page=3`, the
backend has to decide three more things:

1. **Which fields** of each document to send back → **projection**
2. **In what order** to send them → **sorting**
3. **How many at a time** → **pagination**

Every production list endpoint — product listings, order history, review
feeds, admin tables, infinite scroll — is exactly this recipe:
**filter + projection + sort + pagination**. This module teaches the last
three knobs, and the traps hiding inside each one.

## The four knobs of every list query

| Knob | Mongoose (what you write) | MongoDB `find` command (what is sent) | Where the work happens |
| --- | --- | --- | --- |
| Which documents | `.find(filter)` | `filter` | server |
| Which fields | `.select("name price")` | `projection` | server |
| What order | `.sort({ price: 1 })` | `sort` | server |
| How many | `.skip(20).limit(10)` | `skip` / `limit` | server |

Three big ideas to burn in before the individual topics:

**Idea 1 — all four knobs run on the MongoDB server.** `.select()` is not
Mongoose deleting fields in Node.js after the fact: it becomes the
`projection` part of the wire command, and the **server** trims each document
before a single byte crosses the network. Same for sort, skip, and limit. The
lazy alternative — fetch everything and `.map()` / `.sort()` / `.slice()` in
JavaScript — transfers the entire collection over the network first, which is
exactly what these knobs exist to prevent.

**Idea 2 — a query is built first, executed later.** `Product.find(filter)`
does not talk to the database. It returns a **Query** object — a builder.
Each chained call (`.select()`, `.sort()`, `.skip()`, `.limit()`, `.lean()`)
just fills in one more slot of the command. Only when you `await` it does one
complete command go to the server. Two consequences: chaining **order does
not matter** (`.limit(5).sort("price")` is the same query as
`.sort("price").limit(5)` — the server always logically applies
filter → sort → skip → limit), and you can build queries conditionally
(add `.select()` only if the client asked for specific fields).

**Idea 3 — pagination is only correct on top of a deterministic sort.** If
two documents tie on your sort field, MongoDB may return them in either
order — and a different order on the next request. Page boundaries then
shift, and users see duplicated or missing rows. The fix is one rule you will
use for the rest of your career: **always append `_id` (unique) as the final
sort key when paginating.**

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-projection.js` | `npm run lesson 06-projection-sorting-pagination/01-projection` | include vs exclude mode, the `_id` exception, `.select()` string + object syntax, nested fields, `$slice`, virtual gotcha, payload + security |
| `02-sorting.js` | `npm run lesson 06-projection-sorting-pagination/02-sorting` | `sort()` object + string syntax, multi-field sort, nested fields, missing values, ties + the `_id` tiebreaker, collation, sort memory + indexes |
| `03-pagination-skip-limit.js` | `npm run lesson 06-projection-sorting-pagination/03-pagination-skip-limit` | page-number pagination, `Promise.all` count + page, full API response shape, edge cases, why deep `skip` gets slow |
| `04-pagination-cursor.js` | `npm run lesson 06-projection-sorting-pagination/04-pagination-cursor` | keyset/cursor pagination on `(placedAt, _id)`, the `$or` condition, opaque base64 cursors, stability under inserts, trade-offs |

**Safety:** this entire module is **100% read-only** on the seeded store
data. No documents are created, changed, or deleted, and no temp collections
are used. Run any file, in any order, as many times as you like, without
reseeding.

---

## Topic: Projection — choosing which fields come back

**What is it?** A projection is the part of a query that says which fields of
each matching document you want. In Mongoose you usually write it with
`.select()`:

```js
// Only name and price (plus _id, which tags along by default)
await Product.find({ isActive: true }).select("name price");

// Everything EXCEPT description
await Product.find({ isActive: true }).select("-description");
```

You can also pass it as the second argument to `find(filter, projection)` —
same thing, different spelling. The projection travels to the MongoDB server
inside the `find` command, and the server trims each document **before**
sending it back.

**Why does it exist?** (what problem it solves) Two problems:

1. **Payload size.** A product document carries a long description, specs,
   tags, timestamps... A listing page showing 24 product cards needs maybe 4
   of those fields. Without projection you ship the whole document 24 times —
   more bytes on the wire, more JSON to parse, slower pages. On big documents
   the difference is dramatic.
2. **Security.** Documents often contain fields the client must **never**
   see: password hashes, internal flags, other users' data, cost prices.
   Projection (plus the `select: false` schema option) is how you keep them
   on the server. "Send the whole user object to the browser" is one of the
   most common real-world data leaks.

**When should I use it?** On practically every read that feeds an API
response or a list. If a screen shows 4 fields, select 4 fields.

**When should I avoid it?** When you genuinely need the whole document — for
example, when you loaded a document in order to modify and `.save()` it. A
document loaded with an inclusion projection is **incomplete**; saving it is
asking for trouble (validators and logic that expect the missing fields
misbehave). Rule of thumb: **project for reads, load fully (or use update
operators — module 07) for writes.**

**Important terms**
- **Projection** — the field-selection part of a query, e.g.
  `{ name: 1, price: 1 }`.
- **Inclusion mode** — you list the fields you WANT (`{ name: 1 }` /
  `"name"`). Everything else is dropped.
- **Exclusion mode** — you list the fields you DON'T want (`{ name: 0 }` /
  `"-name"`). Everything else is kept.
- **The `_id` exception** — `_id` is included by default in both modes, and
  it is the only field allowed to break the "no mixing" rule:
  `{ name: 1, _id: 0 }` is legal.
- **`select: false`** — a schema-level default meaning "never return this
  field unless explicitly asked for with `.select('+field')`". The standard
  pattern for password hashes and tokens. (Our seeded models don't use it,
  but the lesson explains it.)
- **`$slice`** — a projection **operator** that limits how many elements of
  an array come back, e.g. `{ items: { $slice: 2 } }`.

**The one hard rule: you cannot mix modes.** A projection is either an
include-list or an exclude-list. `{ name: 1, stock: 0 }` is rejected by the
MongoDB server with an error like *"Cannot do exclusion on field stock in
inclusion projection"*. Why? Because a mixed list is ambiguous: what should
happen to the fields you didn't mention at all? The only exception is `_id`,
which has an unambiguous default (included), so turning it off inside an
inclusion list is allowed.

**Code example** — `01-projection.js`:

```js
// String syntax (most common): space-separated field names
await User.find().select("name email");            // include mode
await User.find().select("-email -address");       // exclude mode (- prefix)
await User.find().select("name email -_id");       // the _id exception

// Object syntax: 1 = include, 0 = exclude
await User.find().select({ name: 1, email: 1 });

// Nested fields use dot notation
await User.find().select("name address.city");
await Order.find().select("orderNumber items.productName items.quantity");
```

**Expected result** — documents that contain **only** the selected fields
(plus `_id`). Fields you projected away are simply `undefined` on the
returned documents — reading them does not throw, which is why forgetting a
field in `.select()` is a silent bug, not a loud one. The lesson also
measures the payload: selecting 3 fields of all 63 products shrinks the JSON
to a fraction of the full size.

**Common mistakes**
- **Mixing include and exclude** (`"name -stock"` / `{ name: 1, stock: 0 }`)
  — server error. Pick one mode. Only `-_id` may join an include list.
- **Assuming a projected-away field is there.** `doc.stock` is `undefined`,
  your math becomes `NaN`, nothing crashes until much later.
- **Breaking virtuals.** Virtuals compute from real fields. `finalPrice`
  needs `price` and `discountPercent` — project those out and the virtual
  returns `NaN`. Select every field your virtuals read.
- **`select("name, email")`** — commas are not separators. That string asks
  for the fields `"name,"` and `"email"`. Use spaces.
- **Doing projection in JavaScript** (`docs.map(d => ({ name: d.name }))`)
  — the full documents already crossed the network; you saved nothing.

**Real-world usage** — in a MERN backend nearly every route pairs a
projection with the response shape: the product listing selects
`name price discountPercent ratingSummary specs.brand`, the order-history
endpoint selects `orderNumber status totalAmount placedAt`, and the user
route excludes secrets. Sensitive fields (password hashes, reset tokens) get
`select: false` in the schema so no one can forget.

**Related concepts** — a projection that is fully answered by an index (a
"covered query") never touches the documents at all — module
12-indexes-and-performance. `.lean()` (plain objects instead of Mongoose
documents) is the usual companion of projections in read-only API code —
module 15.

---

## Topic: Sorting with `sort()`

**What is it?** `sort()` tells MongoDB in what order to return the matching
documents. Two spellings, identical meaning:

```js
await Product.find().sort({ price: 1 });    // object: 1 = ascending, -1 = descending
await Product.find().sort("-price");        // string: "-" prefix = descending
await Order.find().sort("status -placedAt"); // multi-field string syntax
```

**Why does it exist?** (what problem it solves) Without `sort()`, MongoDB
returns documents in **natural order** — roughly "however they lie on disk".
That order is not defined, not stable, and changes as data moves. Any screen
that shows "newest first", "cheapest first", "top rated" needs the database
to order results — and the database can often do it for free by walking an
index, while your Node process would have to fetch everything to sort it.

**When should I use it?** Any time result order matters to a human or to
code — which is almost always, and **non-negotiably always** before
`skip`/`limit` pagination.

**When should I avoid it?** Don't sort huge result sets by an unindexed
field "just in case" — an unsupported sort is real server work (see the
memory paragraph below). And don't sort in JavaScript what the database
could sort for you.

**Important terms**
- **Ascending / descending** — `1` = smallest first (A→Z, oldest→newest),
  `-1` = largest first (newest→oldest). For dates: **newest first = `-1`**.
- **Multi-field sort** — `{ status: 1, placedAt: -1 }` means: order by
  `status`; only where documents **tie** on status, order those by `placedAt`
  descending. Key order in the object matters.
- **Tie** — two documents with equal values in every sort field. Their
  relative order is **unspecified** unless you add another key.
- **Natural order** — the order without any sort; an implementation detail,
  never a guarantee.
- **BSON type ordering** — across types, MongoDB sorts by a fixed type
  ranking: missing/null sort **before** numbers, numbers before strings, and
  so on. Practical effect: ascending sort on `age` puts users with no `age`
  first; descending puts them last.
- **Collation** — language-aware string comparison rules. Default string
  sorting is **binary** (by UTF-8 code point): every uppercase letter sorts
  before every lowercase one (`"Zebra" < "apple"`). `.collation({ locale:
  "en", strength: 2 })` gives a case-insensitive, human sort.
- **Blocking (in-memory) sort** — a sort no index can serve: the server must
  gather **all** matches into memory, sort them, then start returning
  results.

**Sort memory and indexes.** An index stores keys already in order, so a
sort an index can serve simply **walks the index** — first result streams
back immediately, no matter how many match. A sort no index serves must
buffer everything, with a **~100 MB memory ceiling** per sort: older servers
abort with `QueryExceededMemoryLimitNoDiskUseAllowed`; MongoDB 6.0+ spills
to disk by default, which avoids the error but is slow. On 300 seeded orders
you will never notice; on 10 million you absolutely will. The real fix is an
index matching the sort — module 12-indexes-and-performance. Our seeded
indexes already serve the two most common sorts: `{ category: 1, price: -1 }`
(products in a category by price) and `{ user: 1, placedAt: -1 }` (one
user's orders, newest first).

**Code example** — `02-sorting.js`:

```js
// Best-rated first; among equal ratings, cheapest first
await Product.find({ "ratingSummary.count": { $gte: 2 } })
  .sort("-ratingSummary.average price")
  .select("name price ratingSummary");

// DETERMINISTIC sort for pagination: unique tiebreaker appended
await Order.find().sort({ status: 1, _id: 1 });
```

**Expected result** — the lesson prints cheapest/newest/top-rated lists, a
sort on `age` where users **missing** the field appear first, and the same
tie-heavy `status` sort twice — with a note explaining why the twice-printed
order is not guaranteed to repeat, and how appending `_id` fixes it.

**Common mistakes**
- **Paginating a sort with ties and no unique tiebreaker** — the classic
  cause of "I saw the same row on page 2 and page 3". Always append `_id`.
- **Expecting alphabetical order on mixed-case strings** — binary sort puts
  `"iPhone"` after `"Zebra"`. Use collation.
- **Sorting numeric strings** — `"9" > "10"` lexicographically. Store
  numbers as numbers (or use `numericOrdering: true` collation).
- **`sort("placedAt: -1")`** — that is string syntax with object syntax
  glued in. Either `sort("-placedAt")` or `sort({ placedAt: -1 })`.
- **Relying on natural order** — "it came back in insertion order on my
  machine" is a coincidence, not a contract.

**Real-world usage** — every `?sort=price_asc` dropdown maps to a whitelist
of allowed sort objects on the server (never pass user input straight into
`sort()` — that lets clients trigger expensive unindexed sorts). Product
listings sort by price/rating/newness; order dashboards by `placedAt`;
review lists by `helpfulVotes` then `createdAt`, with `_id` appended when
paginated.

**Related concepts** — sorting meets indexes in module
12-indexes-and-performance (index-served vs blocking sorts, why
`{ category: 1, price: -1 }` serves filter + sort together). Deterministic
sorting is the foundation both pagination lessons build on.

---

## Topic: Page-number pagination — `skip()` + `limit()`

**What is it?** The classic "page 1, 2, 3" pagination. The client sends a
page number and page size; the server converts them into how many sorted
documents to **skip** and how many to **return**:

```js
const skip = (page - 1) * pageSize;   // page 3, size 10 -> skip 20
await Order.find(filter)
  .sort({ placedAt: -1, _id: -1 })    // deterministic order first!
  .skip(skip)
  .limit(pageSize);
```

**Why does it exist?** (what problem it solves) You must never ship an
entire collection to a client: 300 orders is fine, 3 million is an outage.
Pagination bounds every response to a fixed, small size. The skip/limit
variant specifically exists because "numbered pages" is the UI humans expect
from tables and search results: page 7 of 42, jump to last page.

**When should I use it?** Admin tables, dashboards, search results — UIs
with visible page numbers and "jump to page N", where collections are
moderate in size and the data doesn't churn under the user's feet.

**When should I avoid it?** Very deep pages on very large collections (see
the cost paragraph), and feeds where new documents are inserted constantly
while users page (see the drift paragraph). Both are exactly what cursor
pagination fixes — next topic.

**Important terms**
- **`skip(n)`** — server-side: after sorting, **walk past** the first `n`
  matching documents and discard them.
- **`limit(n)`** — stop after returning `n` documents. Careful:
  **`limit(0)` means NO limit** in MongoDB — an unvalidated `pageSize=0`
  from a client returns the whole collection.
- **Page metadata** — what real APIs return next to the data:
  `totalItems`, `totalPages = Math.ceil(totalItems / pageSize)`,
  `hasNextPage`, `hasPrevPage`.
- **`Promise.all`** — runs the count query and the page query **in
  parallel** instead of one after the other; two round trips for the price
  of the slower one.

**The cost of deep skip.** `skip(100000)` is not a jump. The server still
has to **produce and walk 100,000 sorted documents (or index keys) just to
throw them away**, then return the 10 you asked for. Cost grows linearly
with the page number: page 1 touches 10 keys, page 10,001 touches 100,010.
Every page is slower than the page before it — fine for page 2, brutal for
page 10,000. This is a property of how skip works, not something an index
can remove (an index makes the walk cheaper per key, not shorter).

**The shifting-window problem.** Pages are defined by *position*
("rows 11–20"), and positions move when data changes. Suppose a user is
reading page 1 of newest-first orders and a new order arrives before they
click "next": every document shifts down one position, so page 2 now starts
with the document that was at the **bottom of page 1** — the user sees it
twice. Deletes cause the mirror bug: a document silently skipped. Nothing
errored; the data was just quietly wrong. This is inherent to
position-based pagination.

**Code example** — `03-pagination-skip-limit.js` builds the full
production-shaped helper:

```js
const [totalItems, data] = await Promise.all([
  Order.countDocuments(filter),
  Order.find(filter)
    .sort({ placedAt: -1, _id: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .select("orderNumber status totalAmount placedAt")
    .lean(),
]);
const totalPages = Math.ceil(totalItems / pageSize);
return {
  data,
  meta: { page, pageSize, totalItems, totalPages,
          hasPrevPage: page > 1, hasNextPage: page < totalPages },
};
```

**Expected result** — pages 1 and 2 of delivered orders with full `meta`
blocks, proof that consecutive pages don't overlap, a request past the last
page returning an **empty array** (not an error), and a deep-skip demo with
an explanation of what the server really did.

**Common mistakes**
- **Paginating without a deterministic sort** — duplicated/missing rows
  across pages. Sort first, append `_id`.
- **Off-by-one in the formula** — it is `(page - 1) * pageSize`. Page 1
  skips 0.
- **Not validating `page`/`pageSize`** — `pageSize=0` returns everything
  (`limit(0)` = no limit), `pageSize=100000` is a self-inflicted outage,
  negative values error. Clamp both (e.g. max 100).
- **Sequential `await` for count + page** — doubles latency for no reason;
  use `Promise.all`.
- **Recounting on every page** for slow counts on huge collections —
  consider caching the total or dropping it (cursor pagination doesn't need
  it).

**Real-world usage** — the standard REST shape:
`GET /api/orders?status=delivered&page=2&pageSize=10` →
`{ data: [...], meta: { page, pageSize, totalItems, totalPages, ... } }`.
The frontend renders pager buttons straight from `meta`. In aggregation
pipelines the same idea appears as `$skip`/`$limit`, and `$facet` can return
one page plus the total count in a single command.

**Related concepts** — deterministic sort (previous topic) is a
prerequisite; cursor pagination (next topic) removes both weaknesses;
`countDocuments` vs `estimatedDocumentCount` was covered in module 04;
index-backed sort makes the skip walk cheaper — module 12.

---

## Topic: Cursor (keyset) pagination

**What is it?** Pagination that remembers **where you stopped** instead of
**how far to skip**. Each response includes a *cursor* — an opaque token
encoding the sort-key values of the last returned document, here
`(placedAt, _id)`. The next request says "continue after this cursor", which
becomes a plain range filter:

```js
// sort: { placedAt: -1, _id: -1 }  (newest first, deterministic)
// "everything strictly AFTER the cursor position":
{
  $or: [
    { placedAt: { $lt: cursor.placedAt } },              // strictly older
    { placedAt: cursor.placedAt,                          // same instant...
      _id: { $lt: cursor.id } },                          // ...but later in tie order
  ]
}
```

**Why does it exist?** (what problem it solves) It fixes both structural
flaws of skip/limit at once:

1. **Cost.** The filter jumps straight to the cursor position (an index seek,
   not a walk), so **every page costs the same** — O(pageSize), whether it's
   page 2 or page 20,000.
2. **Stability.** The cursor names a fixed *position in sort order*, not a
   row number. Documents inserted above your position (new orders, in a
   newest-first feed) don't shift it — no duplicates, no skipped rows while
   users scroll.

**When should I use it?** Infinite scroll and "load more" feeds, mobile
APIs, exports/ETL jobs that walk a whole collection, any high-traffic list
on a large or fast-changing collection. If the UI never shows page numbers,
cursor pagination is almost always the right answer.

**When should I avoid it?** When the UI genuinely needs "jump to page 7" or
"page 3 of 42" — a cursor can only continue from where it is; random access
by page number is the one thing it cannot do (you may still show a total
via a separate count). It is also slightly more code and needs a
deterministic, ideally indexed, sort key.

**Important terms**
- **Keyset** — the tuple of sort-field values identifying a position; ours
  is `(placedAt, _id)`.
- **Compound cursor** — a keyset with more than one field. `placedAt` alone
  is not safe: two orders *can* share a timestamp, and a cursor sitting on
  the tie would either skip or repeat its twin. Adding unique `_id` makes
  every position unambiguous.
- **Opaque cursor** — the keyset serialized (JSON → base64url) into a token
  the client stores and echoes back but never parses. Keeps clients from
  depending on your internals; this is what GitHub's and Stripe's APIs hand
  out.
- **The `limit + 1` trick** — fetch one document more than the page size;
  if it arrives, there is a next page (then drop it from the response).
  Answers `hasNextPage` without any count query.
- **`pageInfo`** — the metadata block of a cursor API:
  `{ hasNextPage, nextCursor }` (naming borrowed from GraphQL/Relay).

**Reading the `$or` carefully** (the heart of the lesson): with sort
`placedAt: -1, _id: -1`, a document comes after the cursor position exactly
when it is **strictly older** (`placedAt < cursor.placedAt`) **or** it is at
the **same instant** but ranks later in the tie order (`placedAt ===
cursor.placedAt` and `_id < cursor.id` — `$lt` again because `_id` is also
descending). For an ascending sort, flip both `$lt` to `$gt`.

**Code example** — `04-pagination-cursor.js` builds page 2 by hand first,
then the production helper:

```js
const docs = await Order.find(cursor ? cursorFilter(cursor) : {})
  .sort({ placedAt: -1, _id: -1 })
  .limit(pageSize + 1)                       // +1 = hasNextPage probe
  .select("orderNumber status totalAmount placedAt")
  .lean();
const hasNextPage = docs.length > pageSize;
const data = hasNextPage ? docs.slice(0, pageSize) : docs;
const last = data[data.length - 1];
return {
  data,
  pageInfo: {
    hasNextPage,
    nextCursor: hasNextPage
      ? encodeCursor({ placedAt: last.placedAt, id: last._id })
      : null,
  },
};
```

**Expected result** — three consecutive pages of orders with **zero
overlap** (the lesson proves it with a Set of order numbers), an opaque
base64url cursor printed exactly as an API would return it, and a
cross-check showing cursor-page-2 equals skip/limit-page-2 while the data
stands still — the two schemes agree on static data; they only diverge (in
cursor pagination's favor) when writes happen mid-scroll.

**Common mistakes**
- **Cursor on a non-unique field alone** (`placedAt` only) — ties get
  skipped or duplicated. Always include `_id`.
- **Mismatched directions** — sort descending but filter with `$gt` (or
  vice versa): page 2 returns the documents *before* page 1, or nothing.
  Sort direction and comparison operator must agree, per field.
- **Losing date precision in the cursor** — serialize `placedAt` with
  `toISOString()` (keeps milliseconds) and revive it with `new Date(...)`;
  a truncated timestamp shifts the position.
- **Changing the sort between requests** while reusing an old cursor — a
  cursor is only meaningful for the exact sort it was minted under.
- **Trying to build "jump to page N"** on cursors — it cannot; if the UI
  needs it, that UI wants skip/limit.

**Real-world usage** — "load more" and infinite scroll everywhere; the
`GET /api/orders?cursor=eyJwIjoi...` → `{ data, pageInfo }` shape; per-user
order history paginating with `{ user, $or: [...] }`, which our seeded
`{ user: 1, placedAt: -1 }` index serves. A global newest-first feed would
add a `{ placedAt: -1, _id: -1 }` index in production — module 12.

**Related concepts** — deterministic sort (this module) is the load-bearing
wall; index design for cursor filters is module 12-indexes-and-performance;
the same keyset technique reappears inside aggregation pipelines and change
streams later in the bootcamp.

---

## Choosing: skip/limit vs cursor at a glance

| | `skip`/`limit` | cursor (keyset) |
| --- | --- | --- |
| Client sends | page number | opaque cursor token |
| Jump to page N | yes | **no** — sequential only |
| Cost of page N | O(N × pageSize) — grows with depth | O(pageSize) — constant |
| Stable while data changes | no — rows duplicate/vanish | yes — position is fixed |
| Total count / "page 3 of 42" | natural (`countDocuments`) | needs a separate count |
| Code complexity | trivial | moderate (`$or`, encode/decode) |
| Best for | admin tables, small/medium data, numbered pagers | feeds, infinite scroll, big or busy collections, exports |

Both start from the same foundation: **a deterministic sort ending in
`_id`**. Get that habit first; the rest of pagination is bookkeeping.

## What's next

- **Module 07 — updates & deletes:** writing data safely (projection's
  "reads only" warning becomes concrete there).
- **Module 12 — indexes & performance:** why `{ category: 1, price: -1 }`
  makes filter + sort free, when a sort blocks, and `explain()` to see which
  of your list queries walk indexes.
- **Module 15 — the Query object:** what `find()` really returns and how the
  chainable builder works under the hood.
