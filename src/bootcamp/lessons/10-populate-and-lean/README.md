# Module 10 — Populate & Lean: following references, and skipping the overhead

Module 09 taught you to **model** relationships: embed what belongs together,
reference what lives its own life. This module teaches you to **use** those
references — and then to make your read queries as cheap as possible.

Two halves, one theme ("what does Mongoose do for me, and what does it cost?"):

1. **`populate()`** — how Mongoose follows an ObjectId reference and swaps it
   for the actual document. What it *really* does under the hood matters more
   than the syntax, because the mechanics explain every one of its limits.
2. **`.lean()`** — how to tell Mongoose "skip the fancy document wrapper, just
   give me plain JavaScript objects", and why that is the default choice for
   read-only API responses.

Three big ideas to burn in before the individual topics:

**Idea 1 — `ref` is Mongoose-only metadata.** In the database, `order.user`
is a plain ObjectId. Nothing more. MongoDB has **no foreign keys**: it does
not know the id points at the `users` collection, does not check that the
user exists, and will not stop you from deleting a user who has 40 orders.
The `ref: "User"` option in the schema lives entirely in Node.js — its only
job is to tell `populate()` **which model to query**.

**Idea 2 — `populate()` is NOT a join.** When you write
`Order.find().populate("user")`, Mongoose sends **two separate queries**:
first the orders, then `users.find({ _id: { $in: [...all the ids] } })` —
and stitches the results together **in memory, in your Node process**. The
MongoDB server never sees a join. (The server-side join is `$lookup`, an
aggregation stage — a different tool covered at the end of lesson 02 and in
module 11.) Once you know this, everything about populate makes sense: why it
can't filter parents by child fields, why a `match` leaves `null` holes, why
populating in a loop is a disaster, and why it costs one extra round trip
per populated path.

**Idea 3 — every document Mongoose returns is "hydrated" by default.** A
hydrated document is not a plain object: it is a full Mongoose `Document`
class instance carrying change tracking, virtuals, getters, instance methods,
and `.save()`. That machinery is what makes writes pleasant — and it is pure
overhead when all you do is `res.json(docs)`. `.lean()` skips it.

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-populate-basics.js` | `npm run lesson 10-populate-and-lean/01-populate-basics` | a reference is just an ObjectId, one-to-one populate, the two-query mechanics (seen live with debug mode, then rebuilt by hand), populate + `select`, populating refs inside a subdocument array, multiple populates, document-level populate |
| `02-populate-advanced.js` | `npm run lesson 10-populate-and-lean/02-populate-advanced` | nested/deep populate (Review → Product → Category), virtual populate (`Product.reviews`), the `match` option and its traps, common mistakes (typo'd paths, missing `ref`, N+1 loops, over-populating), when `$lookup` beats populate |
| `03-lean.js` | `npm run lesson 10-populate-and-lean/03-lean` | what hydration actually builds, what `.lean()` skips, a `process.hrtime` benchmark on all 300 orders, populate + lean together, when lean is right and when it bites |

**Safety:** this entire module is **100% read-only** on the seeded store
data. No documents are created, changed, or deleted, and no temp collections
are used. Run any file, in any order, as many times as you like, without
reseeding.

---

## Topic: ObjectId references & the `ref` option

**What is it?** A reference is a field that stores another document's `_id`.
In our store, every order stores the id of the user who placed it:

```js
// order.model.js (already written — do not edit)
user: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",          // Mongoose metadata: "populate() should query User"
  required: true,
},
```

**Why does it exist?** (what problem it solves) Some relationships must not
be embedded. A user changes independently of their orders, and one user has
*many* orders — embedding a copy of the user in every order would duplicate
data 300 times and let the copies drift apart. Storing only the id keeps one
source of truth (the `users` collection) and keeps each order small.

**When should I use it?** When the related data lives its own life (users,
products, categories), when the "many" side is unbounded (reviews per
product), or when many documents share the same related document.

**When should I avoid it?** When the data belongs to exactly one parent and
is always read with it — then embed (an order's line items). And remember the
hybrid: `order.items[].product` is a reference **plus** snapshot copies
(`productName`, `unitPrice`), because an invoice must show what the customer
actually paid, even if the product is renamed or repriced later.

**Important terms**
- **ObjectId** — MongoDB's 12-byte document id type. A reference field's
  stored value is just one of these.
- **`ref`** — a schema option naming the Mongoose **model** (not the
  collection) that `populate()` should query for this path. Pure Node.js
  metadata. MongoDB never sees it.
- **Foreign key** — the SQL concept a reference *resembles*. The crucial
  difference: SQL databases **enforce** foreign keys (you cannot insert a row
  pointing at a missing parent). MongoDB enforces **nothing** — a reference
  is a promise your application makes to itself.
- **Dangling reference** — an ObjectId pointing at a document that no longer
  exists (e.g. the user was hard-deleted). MongoDB happily keeps it;
  `populate()` turns it into `null`. This is one reason soft-delete
  (module 07) is popular.

**Code example** — `01-populate-basics.js`, section 1:

```js
const order = await Order.findOne().select("orderNumber user");
// order.user is an ObjectId — NOT a user document
console.log(order.user instanceof mongoose.Types.ObjectId); // true
```

**Expected result** — the raw order shows `user` as a bare ObjectId like
`new ObjectId('665f...')`. No name, no email — those live in another
collection until you populate.

**Common mistakes**
- Assuming MongoDB validates the reference. It does not. Wrong id, deleted
  target, id from a completely different collection — all stored silently.
- Storing the whole related document instead of its id ("accidental embed"),
  then wondering why updates to the user don't show up in orders.
- Writing `ref: "users"` (collection name) instead of `ref: "User"` (model
  name). `ref` must match the string given to `mongoose.model(...)`.

**Real-world usage** — every MERN backend is full of these: `post.author`,
`comment.post`, `orderItem.product`, `ticket.assignee`. The id is what you
store; populate (or `$lookup`) is how you turn it back into data when a
screen needs it.

**Related concepts** — module 09 (embed vs reference decision), the
`populate()` topic below, module 07 (soft delete — avoiding dangling refs).

---

## Topic: `populate()` — the two-query stitch

**What is it?** A Mongoose method that replaces reference ids with the actual
referenced documents:

```js
const order = await Order.findOne()
  .populate({ path: "user", select: "name email" });
// order.user is now a User document (or null if the ref dangles)
```

**Why does it exist?** (what problem it solves) Without it, every screen that
shows "order + customer name" would need hand-written second queries and
manual matching of ids to documents. Populate automates exactly that — and
*only* that.

**What it ACTUALLY does — this is the heart of the module.** For
`Order.find().populate("user")`, Mongoose:

1. Runs query #1: `orders.find(...)` — gets the orders.
2. Walks the results in Node, collecting every distinct `user` id.
3. Runs query #2: `users.find({ _id: { $in: [id1, id2, ...] } })`.
4. Builds an id → document map and **stitches** each user into its order —
   in your Node process's memory.

Two queries. Two round trips. Zero server-side joining. It is **not** a join
and **not** `$lookup` (which runs *inside* the MongoDB server as an
aggregation stage). Lesson 01 proves this twice: once by switching on
`mongoose.set("debug", true)` so you can watch both commands go out, and once
by rebuilding populate by hand with `$in` and a `Map`.

Consequences you can now predict instead of memorize:
- One extra query **per populated path** (not per parent document — ids are
  batched and de-duplicated into a single `$in`).
- Populate **cannot filter or sort the parents** by fields of the child —
  the parents were already fetched before the child query ran.
- The two queries are not one atomic snapshot: data can change between them.
- A dangling or non-matching reference becomes `null` — no error.

**When should I use it?** Reads where you need related display data for
documents you were fetching anyway: order details + customer, review list +
product names. One or two paths, with a `select` on each.

**When should I avoid it?** When the *server* should do the relational work:
filtering parents by child fields, grouping/aggregating across the join, or
joining large sets — use aggregation with `$lookup` (see that topic below).
Also avoid populating fields your screen never shows — that is just a slower
way to over-fetch.

**Important terms**
- **Path** — the schema field being populated (`"user"`, `"items.product"`).
- **`$in`** — the query operator populate uses: "match documents whose `_id`
  is any of these values."
- **Stitching / hydration of refs** — the in-memory step where Mongoose
  assigns each fetched child onto its parent(s).
- **Round trip** — one request→response cycle to the database. Populate adds
  one per path; on a network with 20 ms latency, round trips — not CPU — are
  usually what makes an endpoint slow.

**Code example** — `01-populate-basics.js`, sections 2–5. The by-hand
version, so you never forget what populate is:

```js
const orders = await Order.find().limit(5).select("orderNumber user").lean();
const ids = [...new Set(orders.map((o) => String(o.user)))];
const users = await User.find({ _id: { $in: ids } }).select("name").lean();
const byId = new Map(users.map((u) => [String(u._id), u]));
const stitched = orders.map((o) => ({ ...o, user: byId.get(String(o.user)) ?? null }));
```

**Expected result** — with debug mode on you will see exactly two commands
printed: the `orders.find` and then a `users.find` whose filter is
`{ _id: { $in: [ ...ObjectIds... ] } }`. The hand-stitched result looks
identical to populate's output.

**Common mistakes**
- Populating without `select` — shipping whole user documents (address,
  loyalty points, timestamps) to render a name. Always
  `populate({ path, select: "name email" })`; the projection runs on the
  server in query #2, so the extra fields never cross the network.
- Calling populate inside a loop (the N+1 problem — see the `match`/mistakes
  topic below).
- Expecting `populate` to make the query "relational". It stays two
  independent queries; all join semantics you know from SQL are absent.

**Real-world usage** — `GET /api/orders/:id` populating
`user (name email)` and `items.product (name sku)`; an admin review list
populating `product (name)` and `user (name)`. Almost always paired with
`.lean()` (lesson 03) because these are read-only responses.

**Related concepts** — projection (module 06) — populate's `select` is the
same idea applied to query #2; `$lookup` (below + module 11); `lean()`
(below).

---

## Topic: Deep & multiple populate

**What is it?** Two extensions of the same mechanic:

- **Multiple populates** — populate several paths of the same result:

  ```js
  await Order.findOne()
    .populate({ path: "user", select: "name email" })
    .populate({ path: "items.product", select: "name sku" });
  ```

- **Deep (nested) populate** — populate a path *inside* an already-populated
  document. A review references a product; the product references a
  category:

  ```js
  await Review.find().limit(3).populate({
    path: "product",
    select: "name price category",       // ← must include `category`!
    populate: { path: "category", select: "name slug" },
  });
  ```

**Why does it exist?** Screens rarely need exactly one relationship. An
order page needs the customer *and* the live products; a review card wants
the product *and* its category for a breadcrumb.

**When should I use it?** When the screen genuinely shows data from each
populated level. Depth 2 (parent → child → grandchild) is common and fine.

**When should I avoid it?** Depth 3+ or many paths at once is a smell: you
are paying one extra query per path *per level*, and probably assembling a
"give me everything" mega-response. Consider `$lookup`, a redesigned
endpoint, or denormalized snapshot fields instead.

**Important terms**
- **Nested populate** — the `populate` option *inside* a populate object.
  Each level triggers its own `$in` query (Review→products is query #2,
  products→categories is query #3).
- **Subdocument-array ref** — a reference stored inside embedded array items
  (`order.items[].product`). Populate handles the path `"items.product"` by
  collecting ids across **all** items of **all** fetched orders into one
  `$in` — still just one extra query.

**Code example** — `01-populate-basics.js` sections 6–7 (arrays + multiple),
`02-populate-advanced.js` section 1 (deep).

**Expected result** — a review prints with a full product object inside it,
and a full category object inside *that*. The lesson also compares each
order item's snapshot (`productName`, `unitPrice` frozen at purchase time)
with the live populated product — prices may differ, which is exactly why
the snapshot exists.

**Common mistakes**
- **Projecting away the inner reference.** In the deep example above, if the
  product-level `select` omits `category`, the nested populate has no id to
  follow and the category silently comes back missing. Rule: *every level's
  `select` must include the reference field the next level needs.*
- Populating both `"items.product"` and `"user"` when the screen shows only
  the user — every populated path is a query you pay for.

**Real-world usage** — order-detail endpoints (user + items.product),
breadcrumbs (product → category → parent category), admin dashboards.

**Related concepts** — the `$lookup` topic below (the server-side way to do
multi-level joins in one round trip).

---

## Topic: Virtual populate

**What is it?** Populating a relationship where the reference lives on the
**other side**. Products do not store review ids — each *review* stores a
product id. A **populate virtual** teaches Mongoose to follow the
relationship backwards:

```js
// product.model.js (already written)
productSchema.virtual("reviews", {
  ref: "Review",          // which model to query
  localField: "_id",      // value on THIS document (the product's id)...
  foreignField: "product" // ...matched against this field on Review
});

const p = await Product.findOne().populate({ path: "reviews", select: "rating title" });
p.reviews; // array of Review docs — never stored on the product
```

**Why does it exist?** (what problem it solves) An unbounded one-to-many
must keep its ids on the *many* side (module 09): a popular product could
have thousands of reviews, and storing that ever-growing id array on the
product would bloat it toward the 16 MB document cap. But then how does the
product "see" its reviews? Virtual populate: nothing stored, the reverse
query (`reviews.find({ product: { $in: [...] } })`) is described once in the
schema and run only when you ask.

**When should I use it?** Whenever the "one" side needs its "many" children
occasionally, and the reference is (correctly) stored on the many side.

**When should I avoid it?** When the child list is huge and you need paging
or stats — populate would fetch *all* matching reviews into memory. Query
the Review model directly with `.limit()`, or aggregate. Also note our
denormalized `ratingSummary` exists precisely so listing pages need **no**
review fetch at all.

**Important terms**
- **Virtual** — a schema property computed in Node, never stored in MongoDB.
- **`localField` / `foreignField`** — the wiring: "take `localField` from
  this document, find foreign documents whose `foreignField` equals it."
  Mongoose builds `Review.find({ product: { $in: [productIds] } })` from it.
- **`justOne`** — virtual-populate option; `false` (default) yields an
  array, `true` yields a single doc (e.g. a `user.profile` stored on
  Profile).

**Code example** — `02-populate-advanced.js`, section 2.

**Expected result** — the product prints with a `reviews` array whose length
matches `ratingSummary.count` (the denormalized copy — if the seeder kept it
in sync, the two numbers agree; that check *is* the lesson's point).

**Common mistakes**
- Expecting `product.reviews` to exist without populating — a populate
  virtual is `undefined` until you ask for it.
- Forgetting `toJSON: { virtuals: true }` and wondering why the populated
  array vanishes from `res.json(...)` (our Product model opts in already).
- Confusing virtual populate (a described query) with an embedded array
  (stored data).

**Real-world usage** — `product.reviews`, `user.orders`, `post.comments` —
any reverse lookup where the FK sits on the child.

**Related concepts** — module 09 (why the ref lives on the many side),
`ratingSummary` denormalization, `mongoose-lean-virtuals` (lesson 03).

---

## Topic: The `match` option — and the parent-filtering trap

**What is it?** An extra filter applied to populate's **second** query:

```js
await Order.find().limit(30)
  .populate({ path: "user", match: { isActive: true }, select: "name" });
```

Only active users are fetched in query #2.

**Why does it exist?** Sometimes you only want *qualifying* children
attached: only 4-star-and-up reviews, only active users, only in-stock
products.

**The trap — read this twice.** `match` filters the **children**, never the
**parents**. The orders above were already fetched by query #1; an order
whose user is inactive still comes back — with `user: null`. And what
happens to non-matching refs depends on the *shape* of the path:

| Shape of the populated path | Non-matching ref becomes |
| --- | --- |
| single ref (`order.user`) | `null` |
| ref inside subdocument array (`order.items[].product`) | subdocument stays, its `product` field is `null` — the array length does **not** shrink |
| direct array of refs / populate virtual (`product.reviews`) | dropped from the array — the array **does** shrink |

So "how many items does this array have after a matched populate?" has no
single answer — it depends where the ref lives. Never treat post-match array
lengths as counts.

**When should I use it?** Cosmetic child filtering where `null` holes are
acceptable and handled (e.g. hide reviews below 4 stars on a card).

**When should I avoid it?** When you actually want to **select parents** by
child data ("orders placed by Mumbai customers"). Populate cannot do that —
by design, per Idea 2. Your options: query the child side first
(`User.find({ "address.city": "Mumbai" }).select("_id")`, then
`Order.find({ user: { $in: ids } })`) — or `$lookup` (next topic).

**Important terms**
- **`match`** — a normal MongoDB filter object merged into populate's `$in`
  query.
- **Parent / child** — the document holding the results (parent) vs the
  referenced documents populate fetches (children).

**Code example** — `02-populate-advanced.js`, sections 3–5 demonstrate all
three shapes from the table above with real counts.

**Expected result** — out of 30 populated orders, a handful print
`user: null` (≈12% of seeded users are inactive) while the order count stays
30. The items.product demo shows unchanged `items.length` with `null`
products inside; the virtual-populate demo shows `reviews.length` genuinely
shrinking below `ratingSummary.count`.

**Common mistakes**
- `orders.filter(o => o.user)` *after* populate as a "filter" — it works,
  but you paid to fetch (and possibly paginate!) parents you then threw
  away. Page 1 of 10 orders might render 7. Filter parents in query #1 or
  use `$lookup`.
- Forgetting the `null` check and crashing on `order.user.name`.
- Assuming array lengths after a matched populate are meaningful counts.

**Real-world usage** — mostly as the bug in a support ticket:
"why do some orders show 'Unknown customer'?" Because a populate with
`match` (or a dangling ref) left `null` and the frontend didn't check.

**Related concepts** — `$lookup` (below), dangling references (topic 1 —
they produce the same `null`).

---

## Topic: populate vs aggregation `$lookup`

**What is it?** `$lookup` is MongoDB's real, server-side join — an
aggregation pipeline stage:

```js
await Order.aggregate([
  { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "customer" } },
  { $unwind: "$customer" },
  { $match: { "customer.address.city": "Mumbai" } },   // filter PARENTS by child data!
  { $project: { orderNumber: 1, totalAmount: 1, "customer.name": 1 } },
]);
```

**Why does it exist?** Some questions need the join to happen *where the
data lives*. "Orders placed by Mumbai customers" filters orders by a field
of the joined user — impossible for populate (parents are fetched before
children exist). `$lookup` joins on the server, so later stages can filter,
group, and sort across the joined data, and only the final result crosses
the network — **one** round trip.

**When should I use it?** Server-side filtering on joined data, grouping /
aggregating across collections (revenue per category), large joins where
shipping both sides to Node would be wasteful, and any time round trips
matter.

**When should I avoid it?** Simple display reads. Populate is easier to
read, composes with your schema (`select`, virtuals, defaults), and two fast
queries are perfectly fine for "order + customer name". Also note `$lookup`
output is plain data — no Mongoose documents, no casting, no virtuals.

**Important terms**
- **Aggregation pipeline** — a list of stages documents flow through on the
  **server** (module 11 is all about it).
- **`from`** — the raw **collection** name (`"users"`), not the model name
  (`"User"`). Aggregation is pure MongoDB; models and `ref` don't exist
  there.
- **`$unwind`** — turns the array `$lookup` produces (`as` is always an
  array) into one document per element.

**Code example** — `02-populate-advanced.js`, section 8.

**Expected result** — top delivered orders from Mumbai customers, joined,
filtered, sorted and trimmed entirely by the server, arriving in one round
trip.

**Common mistakes**
- Writing the model name in `from`. Silent empty joins — no error, just
  `[]` in `as`.
- Reaching for `$lookup` for everything. It is more powerful *and* more
  code; populate remains the right default for simple display joins.

**Related concepts** — module 11 (aggregation), module 12 (indexes —
`foreignField` needs one, and `_id` always has one).

---

## Topic: `lean()` — plain objects instead of documents

**What is it?** A query modifier that returns **plain JavaScript objects**
instead of Mongoose Document instances:

```js
const orders = await Order.find().lean();   // plain objects, straight from BSON
```

**Why does it exist?** (what problem it solves) By default Mongoose
**hydrates** every result: it wraps the raw data in a `Document` class
instance with per-field change tracking, casting, getters, virtuals,
instance methods, and `.save()`. Building that machinery costs CPU and
memory *per document*. For a read-only response none of it is ever used —
you paid to build 300 little state machines and then serialized them to
JSON. `.lean()` skips the wrapping: what the driver parsed from BSON is what
you get.

**What lean documents do NOT have** (this is the whole trade):
- no `.save()`, no change tracking (`isModified`), no instance methods
- no virtuals — `product.finalPrice` is `undefined` on a lean product
- no getters, and defaults are **not** applied for fields missing in the DB
- not `instanceof mongoose.Document` — just `Object.prototype`

**When should I use it?** Read-only paths: list endpoints, exports, reports,
anything ending in `res.json(...)`. Rule of thumb many teams adopt: *every
`find` that doesn't end in `.save()` gets `.lean()`.*

**When should I avoid it?**
- You will modify and `.save()` the document — lean objects can't.
  (Mutating a lean object changes only your local copy; nothing persists.)
- You rely on virtuals, getters or instance methods in the code that
  consumes the result (our Product's `finalPrice` is the in-repo example).
  If you want lean *and* virtuals, the community plugin
  **`mongoose-lean-virtuals`** re-applies them cheaply — worth knowing, not
  installed here.

**Important terms**
- **Hydration** — wrapping raw driver output into tracked `Document`
  instances.
- **POJO** — "plain old JavaScript object"; what lean returns.
- **Change tracking** — the per-field bookkeeping that lets `.save()` send a
  minimal `$set` with only what you touched. Useless on reads.

**Code example** — `03-lean.js`. The headline benchmark:

```js
const t0 = process.hrtime.bigint();
await Order.find();          // 300 hydrated documents
const t1 = process.hrtime.bigint();
await Order.find().lean();   // 300 plain objects
const t2 = process.hrtime.bigint();
```

**Expected result** — same 300 orders, but the lean fetch is measurably
faster (commonly several times, exact numbers vary by machine/run) and
allocates noticeably less heap; the lesson prints both timings plus a rough
heap-delta comparison, with honest caveats about GC noise.

**Common mistakes**
- Editing a lean object and expecting persistence — the classic silent bug.
- `res.json(product)` after `.lean()` and losing `finalPrice` — the virtual
  was computed by hydration you just skipped.
- Sprinkling `.lean()` onto a query whose document is later `.save()`d —
  crashes with "save is not a function" (the *lucky* outcome; silently lost
  writes are worse).
- Assuming lean changes what the **server** does. It doesn't — same query,
  same network bytes. Lean only skips work in *Node*. Combine it with
  `select` (module 06) to also cut server/network cost.

**Real-world usage** — production list endpoints are almost always
`Model.find(filter).select(fields).sort(...).limit(n).populate({ path, select }).lean()`
— every knob from modules 05–10 in one line. Populate works fine with lean:
the stitched children are plain objects too.

**Related concepts** — projection (module 06) cuts server + network cost;
lean cuts Node cost; module 12 (indexes) cuts the server's *finding* cost.
The three together are the standard read-path optimization stack.
