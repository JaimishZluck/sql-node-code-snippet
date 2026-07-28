# Module 09 — Data Modeling: Embedding, Referencing & Deliberate Duplication

This is the **thinking module**. Modules 01–08 taught you the verbs — insert,
find, update, project, paginate, dig into arrays. This module teaches the
decision that comes *before* any verb: **what shape should the data have?**

Nothing you configure later — not indexes, not hardware, not caching — affects
a MongoDB application's performance and correctness as much as its data model.
A well-shaped model makes the common operations trivial (one document read, one
indexed query); a badly-shaped one fights you on every single request forever.

If you come from SQL, this module will feel upside-down at first. In SQL,
schema design is almost mechanical: identify your entities, put each in its
own table, normalize to third normal form, and let JOINs reassemble whatever
any query needs. The shape follows the *entities*; the queries adapt. MongoDB
inverts this completely:

> **The golden rule: model around your QUERIES, not around abstract entities.**

You start from the screens and operations your application actually performs,
how often each one runs, and you pick document shapes that make the most
frequent ones cheap — even when that means nesting one "entity" inside another
or storing the same fact in two places on purpose.

**Which layer does what in this module:**

| Layer | What it contributes to data modeling |
| --- | --- |
| **Mongoose** (in Node.js) | Sub-schemas that give embedded documents casting/defaults/validation; `ref` metadata; `populate()` — the app-side join that swaps stored ObjectIds for real documents via a second query; virtuals (`finalPrice`) and virtual populate (`product.reviews`). |
| **MongoDB** (on the server) | The physics your model must live within: the document as the unit of storage, atomicity, and I/O; the hard 16 MB per-document cap; server-side joins (`$lookup`, `$graphLookup`); indexes that make references affordable. And crucially what it does **not** provide: no foreign-key constraints, no cascading deletes, no cross-document integrity. A stored ObjectId is just a value — nothing stops it from pointing at a document that no longer exists. |

That last cell deserves repeating: **every relationship in MongoDB is a
convention maintained by your application code**, not a rule enforced by the
database. Modeling well is how you keep those conventions cheap to maintain.

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-embedding-vs-referencing.js` | `npm run lesson 09-data-modeling/01-embedding-vs-referencing` | the same blog data built twice (embedded vs referenced) in `tmp_` collections; the 1-query-vs-2 read pattern; the "comments grow forever" problem measured in real BSON bytes; the shared-data update problem |
| `02-relationships-tour.js` | `npm run lesson 09-data-modeling/02-relationships-tour` | a guided, (almost) read-only tour of the five seeded models proving every relationship type with real queries — one-to-one, one-to-few, one-to-many, one-to-squillions, many-to-many, self-referencing tree, and the order-item price snapshot |
| `03-denormalization-in-action.js` | `npm run lesson 09-data-modeling/03-denormalization-in-action` | the full lifecycle of the denormalized `ratingSummary`: why it exists, how it drifts, what a new review does to it, and the resync job that repairs it — on a temp product with temp reviews |

**Safety:** lesson 01 works entirely inside temp collections
(`tmp_blog_embedded`, `tmp_blog_posts`, `tmp_blog_comments`,
`tmp_blog_authors`) which it drops when done. Lesson 03 creates one `ZZ-`
product and a few `ZZ practice` reviews and deletes them in a `finally`
block. Lesson 02 is read-only except for one price change on one product that
is reverted moments later (with a crash-safe revert in `finally`). You can run
these lessons in any order, repeatedly, without reseeding.

---

## Topic: The golden rule — model around your queries

**What is it?** The core design principle of document databases: choose your
document shapes by starting from your application's *access patterns* — the
concrete queries and updates it will run, and how often — not from a diagram
of abstract entities. The best MongoDB schema for a blog read by millions is
different from the best schema for the *same blog data* in a writing tool used
by one author, because the queries differ.

**Why does it exist?** (what problem it solves) SQL gives you a recipe:
normalize to third normal form and you are done — the shape is derived from
the entities, and JOINs let any future query reassemble anything. MongoDB
deliberately removed that recipe. Documents can nest, arrays can hold
anything, and there are no enforced relationships — total freedom. Freedom
without a rule produces chaos, so the document world adopted this one: since
the database will not reassemble your data for you on every read (joins are
possible but are not the default path), **store data the way you want to read
it**. Data that is read together should live together.

**When should I use it?** Every time you design or extend a schema. The
practical method: before writing any schema, write down the top five
operations of your app ("show product page", "list a user's orders newest
first", "add item to cart") with a rough frequency for each. Then shape
documents so the most frequent operations touch **one document** or **one
indexed query**. Our store's models all pass this test — see the case study
at the bottom of this chapter.

**When should I avoid it?** Don't over-fit to a single query when you *know*
other access patterns are coming — a shape that makes one screen instant and
five others impossible is a bad trade. And when you genuinely cannot predict
the access patterns yet (early prototype, requirements in flux), lean toward
**references**: separate collections are easy to denormalize later, but
prying apart data that was embedded everywhere is a painful migration.

**Important terms**
- **Access pattern** — one concrete way the app touches data: a specific
  query, update, or aggregation, with its expected frequency ("product page:
  ~1,000/min", "price edit: ~5/day").
- **Entity** — a "thing" in your domain (user, product, order). SQL modeling
  starts here; MongoDB modeling starts at access patterns and lets entities
  share documents when the queries justify it.
- **Normal form / 3NF** — SQL's design discipline: every fact stored exactly
  once, tables split until no redundancy remains. Third normal form (3NF) is
  the everyday standard. MongoDB has no equivalent rule — redundancy is a
  tool, not a sin (see the denormalization topic below).
- **Join** — reassembling data that is stored apart. SQL does it in the
  server on every query (`JOIN`); MongoDB can (`$lookup`) but the idiomatic
  default is to not need one.

**Code example** — the whole of `02-relationships-tour.js` is this rule made
visible: every section names a real store query first, then shows the shape
that serves it. The one-liner version:

```js
// The most common query in any shop: "this user's orders, newest first".
// The MODEL answered it before the query ran: orders reference the user
// (not vice versa) and the { user: 1, placedAt: -1 } index matches this
// exact filter + sort.
await Order.find({ user: userId }).sort({ placedAt: -1 }).limit(10);
```

**Expected result** — you'll see every relationship in the seeded store
answer its "home" query in one or two cheap operations, and the tour's notes
explain which access pattern each shape was chosen for.

**Common mistakes**
- **Modeling like SQL**: one collection per entity, ObjectId references
  everywhere, every read needs three `populate()` calls. You get all of
  MongoDB's weaknesses (no join enforcement, no transactions by default)
  with none of its strengths (locality, one-read pages).
- **Modeling like a JSON blob**: embedding everything reachable into one
  giant document "so it's all in one place". You hit unbounded growth, the
  16 MB cap, and write contention (module 08, lesson 03 measured this).
- **Designing without a query list**: if you can't name the top five
  operations, you are not ready to design the schema — you're guessing.

**Real-world usage** — MongoDB schema-design reviews literally begin with a
workload table: each row is an operation, its frequency, and the data it
touches. The shape falls out of that table. Teams that skip this step usually
rediscover it during their first performance incident.

**Related concepts** — everything below is this rule applied to specific
relationship types. Module 12 (indexes) is the same rule applied to lookups;
the aggregation module shows what reads look like when data is *not* stored
the way you read it.

---

## Topic: Embedding vs referencing — the five questions

**What is it?** The fundamental modeling choice for any two related pieces of
data A and B (user & address, post & comments, product & category):

- **EMBED** — store B *inside* A's document, as a nested object or an array
  of objects. One document; one read; updated atomically together.

```js
// user document — the address lives INSIDE
{ name: "Asha", address: { street: "12 MG Road", city: "Pune", zip: "411001" } }
```

- **REFERENCE** — store B in its own collection and keep only B's `_id` (or
  A's `_id` on B's side) as a link. Two documents; related by convention;
  reassembled by a second query when needed.

```js
// product document — only the category's ObjectId is stored
{ name: "Volt ProBook 14", category: ObjectId("665f1a...") }
```

**Why does it exist?** (what problem it solves) Because the two shapes buy
opposite things. Embedding buys **read locality** (everything arrives in one
read — no join, no latency for a second round trip) and **atomicity** (a
single document write is atomic, so parent and children can never be observed
half-updated). Referencing buys **independence**: each piece has its own
size budget, its own write path, its own indexes, and can be shared by many
parents without duplication. No single shape provides both; you must choose
per relationship.

**When should I use it?** Ask these five questions about B (the candidate for
embedding into A). The more "embed" answers, the stronger the case:

| # | Question | Points to EMBED when... | Points to REFERENCE when... |
| --- | --- | --- | --- |
| 1 | **Owned?** Does B belong to exactly one A, and is it meaningless alone? | yes — an order's line items exist only within that order | no — a category is not "owned" by any single product |
| 2 | **Bounded?** Can you name a small, hard maximum count of B per A? | yes — items per order: a few dozen at the very most | no — comments/reviews/orders "grow with usage" (that phrase is the red flag) |
| 3 | **Read together?** Does the common read fetch A and B as one unit? | yes — an invoice always shows its lines | no — you often want B without A (all products regardless of category) |
| 4 | **Shared?** Is B referenced by many different A's? | no — this address belongs to this user only | yes — one category is linked from 9 products; embedding would copy it 9 times |
| 5 | **Updated independently?** Does B change on its own schedule, by its own actors? | no — line items change only while editing this order | yes — a product's price changes with no order in sight |

Embed when the answers line up in the left column — that is, B is owned,
bounded, read together, not shared, and not independently updated. **Any
single strong "reference" answer is usually enough to force a reference**:
unbounded growth alone rules out embedding (16 MB is a hard wall), and shared
data alone rules it out too (copies drift — lesson 01 demonstrates this).

**When should I avoid it?** Avoid dogmatism in either direction. "Always
reference" turns MongoDB into a worse SQL. "Always embed" hits the wall
module 08 measured. Also know the **hybrid** patterns: embed a bounded
*subset* (the 5 newest comments for preview) while the full set lives
referenced in its own collection — the *subset pattern*, common on
high-traffic product and post pages.

**Important terms**
- **Embedded document / sub-document** — an object stored inside another
  document. In Mongoose, described by a sub-schema (like `addressSchema`),
  which adds casting, defaults, and validation for the nested part.
- **Reference** — a stored ObjectId pointing at a document in another (or the
  same) collection. `ref: "Category"` in a schema is *Mongoose-only
  metadata* telling `populate()` which model to query — MongoDB stores just
  the plain ObjectId and enforces nothing about it.
- **`populate()`** — Mongoose's application-side join: it collects the stored
  ids, runs a second query (`$in`) against the referenced collection, and
  merges the results into the parent documents in memory. Convenient, but it
  is real extra queries — never free.
- **`$lookup`** — MongoDB's server-side join, available in aggregation
  pipelines. Same purpose as populate, executed in the database.
- **Bounded / unbounded** — whether the number of related items has a hard
  maximum you can name at design time. "Average is small" is *not* bounded;
  outliers (the viral post, the power user) are exactly the documents that
  will hurt.
- **Document-level atomicity** — MongoDB guarantees a write to ONE document
  is all-or-nothing. Embedded data inherits this for free; referenced data
  spread over documents does not (that's what transactions are for —
  module 14).
- **16 MB limit** — the hard, non-configurable maximum BSON size of a single
  document. Every embedding decision lives under this ceiling.

**Code example** — `01-embedding-vs-referencing.js` builds the *same* blog
data both ways in temp collections and runs the same workload against each:

```js
// Design A: comments EMBEDDED in the post — the post page is ONE query
const page = await TmpPostEmbedded.findOne({ title });

// Design B: comments REFERENCED — the post page is TWO queries
const post = await TmpPost.findOne({ title });
const comments = await TmpComment.find({ post: post._id }).sort({ at: -1 });
```

**Expected result** — Design A wins the read benchmark (one round trip, data
arrives pre-assembled). Then Design A loses everything else: after a
simulated viral thread its post document balloons (the lesson prints real
BSON byte counts and a "comments until 16 MB" countdown), and renaming one
author requires array surgery across every post document, while Design B
fixes it with one flat `updateMany` — or one single-document update if the
name isn't duplicated at all.

**Common mistakes**
- Embedding because the data is *conceptually* "part of" the parent
  ("comments belong to the post!") without checking **bounded** and
  **shared**. Ownership alone is not enough — it's one question of five.
- Referencing everything out of SQL habit, then wondering why every endpoint
  fires four queries and the app feels slow under latency.
- Forgetting that `populate()` is queries: populating three paths on a list
  of 50 documents can quietly issue several extra database round trips.
- Believing `ref` creates a foreign key. It does not — deleting a category
  leaves every product's `category` id dangling unless *your code* handles it.

**Real-world usage** — real production schemas are hybrids, exactly like our
Order model: `user` referenced (shared, independent), `items` embedded
(owned, bounded, read together), with snapshot fields inside the embedded
items (deliberate duplication — its own topic below). Pure-embed and
pure-reference schemas are both design smells.

**Related concepts** — every topic below is a named special case of this
choice. Module 08 lesson 03 ("deep nesting") shows what happens when
embedding is pushed past its limits and how to *promote* an embedded level to
a collection.

---

## Topic: One-to-one — `user.address`, embedded

**What is it?** One A has at most one B: one user, one home address. In our
store: `user.address` and `order.shippingAddress` (both use the shared
`addressSchema` sub-schema), plus `product.specs` and `order.payment` — all
embedded objects.

**Why does it exist?** (what problem it solves) In SQL a one-to-one pair
often becomes two tables joined by a foreign key — the address row is
meaningless alone, yet it lives apart and every profile read pays a JOIN.
Embedding removes the seam: the address travels inside the user document, one
read returns both, and one atomic write can update both.

**When should I use it?** One-to-one is the easiest call in this whole
chapter: **embed, almost always.** Run the five questions: owned (yes),
bounded (trivially — there's one), read together (yes — profile page, shipping
form), shared (no), independently updated (no — the user edits their own
address). Five for five.

**When should I avoid it?** Two real exceptions. (1) The one-to-one data is
**huge and rarely read** — a user's résumé text or an image blob would bloat
every fetch of the user document; move it to its own collection and load it
on demand (sometimes called vertical partitioning or the *subset pattern*).
(2) The data has a **different access-control or lifecycle story** — e.g.
medical details that most services must never even receive; a separate
collection makes "don't fetch it" the default.

**Important terms**
- **Sub-schema reuse** — one schema object (`addressSchema`) embedded by two
  different parents (User and Order). Same shape, zero duplication of
  *definition* — while each document still holds its own *copy* of the data.
- **Absent field** — an embedded one-to-one can simply not exist: ~15% of our
  seeded users have no `address` field at all. There is no NULL row, no
  failed join — the key just isn't there. Read with `user.address?.city`.

**Code example** — `02-relationships-tour.js`, section 1:

```js
// ONE read returns the user AND the address — no join, no second query.
const user = await User.findOne({ "address.city": "Mumbai", deletedAt: null })
  .select("name email address");
```

**Expected result** — a single document with the address nested inside it,
plus a note reminding you that some users legitimately have no address —
which your code must survive.

**Common mistakes**
- Creating an `addresses` collection out of SQL reflex and referencing it —
  every profile read now needs a populate for data that is never used alone.
- `user.address.city` without optional chaining — throws for the ~15% of
  users with no address (module 08's most common runtime error).
- Confusing `user.address` (the user's *current* address, mutable) with
  `order.shippingAddress` (a *snapshot* of where that order shipped —
  deliberately frozen; see the duplication topic).

**Real-world usage** — profile sub-objects (address, preferences,
notification settings), payment metadata on an order, spec sheets on a
product. Any "settings blob" that belongs to exactly one owner and rides
along on every read.

**Related concepts** — module 08 lesson 01 covers *updating* embedded objects
safely (dot-path `$set` vs whole-object replacement). The snapshot variant of
one-to-one is covered in "Deliberate duplication" below.

---

## Topic: One-to-few and one-to-many — `order.items` vs `category -> products`

**What is it?** One A relates to several B's. The count is what splits the
pattern in two:
- **One-to-FEW** — the count has a small hard ceiling. An order has 1–4 items
  in our seed (real checkouts cap at a few dozen). Modeled by **embedding an
  array of objects**: `order.items`.
- **One-to-MANY** — the count is real but unbounded-ish (tens to thousands).
  A category has 9 products today, could have 10,000. Modeled by a
  **reference on the child**: each product stores `category: ObjectId`.

**Why does it exist?** (what problem it solves) These are the same five
questions answering differently. Line items: owned by exactly one order,
bounded by checkout rules, always displayed with the order, shared by nobody,
never edited outside the order → textbook embed. Products in a category: not
owned (the category is a label, not a container), unbounded, frequently
queried *without* the category (search, tag pages), and each product changes
independently → textbook reference.

The crucial detail is **which side holds the reference**. The child does:
`product.category`, not `category.productIds[]`. A `productIds` array on the
category would (1) grow without bound, (2) force a write to the category
document on every product created/deleted — making one hot document a
write bottleneck, and (3) still not carry any useful per-product data. A
child→parent ObjectId is constant-size forever, no matter how many children
exist.

**When should I use it?** Embed the array when all five questions say embed
*and* you can put a number on "few". Reference from the child the moment the
count is open-ended or the children have independent lives. When in doubt,
reference — a referenced child can always be denormalized later; an embedded
array that outgrew its parent is a migration (module 08 lesson 03 walks
through exactly that promotion).

**When should I avoid it?** Don't embed arrays that grow with *usage* rather
than with a *structural* limit. "Items per order" is structural (a human
checks out a cart). "Reviews per product" is usage (a popular product never
stops collecting them) — that's why Review is a collection. Also avoid
parent-side id arrays (`category.productIds`) except for genuinely tiny,
stable sets.

**Important terms**
- **Array of sub-documents** — `items: [orderItemSchema]`. Each element is a
  full embedded object; Mongoose casts and validates each one. Ours sets
  `_id: false` because line items are never addressed individually.
- **Child-side reference** — the foreign-key-shaped field lives on the many
  side (`product.category`), exactly like SQL puts the FK on the many table.
  Unlike SQL, nothing enforces it.
- **Reverse lookup** — answering "all products in category X" from the child
  side: `Product.find({ category: x._id })`. Affordable **only because of
  the index** on `{ category: 1, price: -1 }` — an unindexed reference field
  means a collection scan per lookup. References are only as good as their
  indexes.
- **Virtual populate** — Mongoose's trick for navigating a child-side
  reference *from the parent* without storing anything on the parent (see
  the many-to-many topic; Product uses it for reviews).

**Code example** — `02-relationships-tour.js`, sections 2–3:

```js
// One-to-few, embedded: the whole order — items included — in ONE read,
// and the invoice math is self-contained inside the document.
const order = await Order.findOne({ status: "delivered" });
const sum = order.items.reduce((s, i) => s + i.subtotal, 0); // === order.totalAmount

// One-to-many, referenced: the child holds the link; the compound index
// { category: 1, price: -1 } serves this exact filter + sort.
const laptops = await Category.findOne({ slug: "laptops" });
const top = await Product.find({ category: laptops._id }).sort({ price: -1 }).limit(3);
```

**Expected result** — the order prints with its full `items` array in place
(no second query), and its `totalAmount` provably equals the sum of embedded
subtotals. The category lookup returns products via one indexed query, and
`populate("category")` shows the ObjectId swap for the real category doc.

**Common mistakes**
- Embedding order items *without* snapshots — storing only `product:
  ObjectId` per line, so invoices silently change when the catalog does (see
  the duplication topic; this is a real-money bug).
- Storing `category.productIds[]` and pushing on every product create — the
  unbounded-parent-array anti-pattern.
- Forgetting the index on the child's reference field, then blaming
  MongoDB when "products in category" gets slower with catalog size.

**Real-world usage** — line items, addresses on an order, ticket line
entries: embedded. Products→category, posts→author, tickets→assignee:
child-side references. This exact split appears in virtually every commerce
codebase.

**Related concepts** — the one-to-squillions topic below is one-to-many taken
to its limit; module 12 explains why `{ category: 1, price: -1 }` serves
filter+sort in one index walk.

---

## Topic: One-to-squillions — `user -> orders`, child references parent

**What is it?** One-to-many where "many" has no meaningful ceiling at all — a
busy customer might place thousands of orders; a platform account might own
millions of log events. The name comes from MongoDB's classic schema-design
literature ("6 Rules of Thumb for MongoDB Schema Design"), and it labels the
scale at which even *an array of ObjectIds on the parent* is a bug.

**Why does it exist?** (what problem it solves) At squillions scale the
parent document must know **nothing** about its children. Not embedded
children (16 MB, instantly), not an array of child ids (an id is small, but a
million of them is ~12 MB and every child insert rewrites the parent — a
hot-document write bottleneck). The only shape that survives is the leanest
one: **each child stores its parent's ObjectId, and an index on that field
*is* the relationship** for all practical query purposes. Our Order does
exactly this: `order.user` + the `{ user: 1, placedAt: -1 }` index.

**When should I use it?** Whenever the child count grows with time or
activity and has no structural cap: orders per user, events per device,
messages per channel, logs per service. Ask: "could an outlier parent have
100,000 of these?" If plausible — model for squillions even if the average is
twelve, because outliers are where systems break.

**When should I avoid it?** Don't reach for it when the set really is small
and stable — a user's 3 saved addresses don't need their own collection. The
cost of squillions-shape is that *every* parent→children read is a query;
that's a bad price for data you could have embedded legally.

**Important terms**
- **Hot document** — a single document that many concurrent writers must
  update (like a parent holding a growing id array). Document-level locking
  makes it a serialization point.
- **The relationship-as-index idea** — with only a child-side ref, "this
  user's orders newest first" is *entirely* answered by the compound index
  `{ user: 1, placedAt: -1 }` — the filter walks to the user's slice of the
  index, already sorted by date. No parent participation at all.

**Code example** — `02-relationships-tour.js`, section 4:

```js
// The user document contains NO trace of orders — go ask the orders.
const orders = await Order.find({ user: heavyUser._id })
  .sort({ placedAt: -1 })   // served by { user: 1, placedAt: -1 }
  .limit(3);
```

**Expected result** — the tour finds the seeded store's busiest customer via
aggregation, prints their user document (note: no order ids anywhere on it),
then lists their newest orders from the child side, paginated and cheap.

**Common mistakes**
- `user.orderIds.push(newOrder._id)` "for convenience" — reintroduces
  unbounded parent growth plus a second fact to keep in sync (the reference
  now exists in two places and they *will* disagree one day).
- No index on the child's parent-ref field — every "orders of user X" is a
  full collection scan across all 300 (or 3 million) orders.
- Fetching *all* children at once. Squillions data must always be paginated
  (module 06) — the model made unbounded reads possible; don't perform them.

**Real-world usage** — orders, sessions, audit logs, sensor readings,
notifications: any per-user/per-device stream. This shape plus a compound
`{ parentRef: 1, timeField: -1 }` index is one of the most-typed patterns in
production MongoDB.

**Related concepts** — module 06 (cursor pagination is built for exactly
these streams), module 12 (compound indexes), and the aggregation module
(rolling squillions of children up into per-parent summaries).

---

## Topic: Many-to-many — reviews as a rich join collection

**What is it?** A's relate to many B's *and* B's relate to many A's: many
users review many products. Our Review collection models it: each document
holds one `(product, user)` pair **plus data about the pair itself** —
rating, title, comment, helpful votes.

**Why does it exist?** (what problem it solves) Neither side can embed the
other (both directions are unbounded, and both sides are shared — the five
questions fail in every direction). SQL solves many-to-many with a *junction
table* (two foreign keys, composite primary key). MongoDB has two honest
options:

1. **Array of ObjectIds on one side** — e.g. a book storing
   `authorIds: [...]`. Legitimate **only** when that side is bounded (a book
   has 1–5 authors, fine) and there is **no data about the pair itself** to
   store. Its limits are exactly cardinality limits: put the array on a side
   that would grow unboundedly (an author's 10,000 books — or worse, arrays
   on *both* sides) and you're back to unbounded parent growth, hot
   documents, and two copies of every link to keep in sync. And an id inside
   an array can never carry a rating or a timestamp for *that* link.
2. **A join collection** — one document per pair. Unbounded on both sides by
   construction (documents just accumulate in their own collection), indexed
   from either direction, and — the part SQL junction tables only later
   bolt columns onto — the pair document is a first-class place for **rich
   pair data**. A review isn't really a "link"; it's a thing in its own
   right that happens to connect a user and a product.

**When should I use it?** Join collection whenever either side is unbounded
or the relationship itself has attributes (rating, role, joined-at,
quantity). Array-of-ids only for small, capped, attribute-less link sets
(tags-by-id, a document's 3 editors).

**When should I avoid it?** Don't build a join collection for trivial
bounded links — `editors: [ObjectId]` on a doc beats a three-collection
ceremony. And don't duplicate the relationship on both sides (array on A
*and* array on B, or arrays *and* a join collection) unless you accept the
sync burden deliberately.

**Important terms**
- **Junction (join) table** — SQL's many-to-many table: `(product_id,
  user_id)` as a composite primary key. Our MongoDB equivalent is the unique
  compound index `{ product: 1, user: 1 }` on reviews — same guarantee (one
  link per pair), enforced by MongoDB itself with an E11000 duplicate-key
  error, because two simultaneous requests would slip past any app-level
  check.
- **Rich join** — a pair document carrying its own payload. `rating`,
  `title`, `helpfulVotes` are facts about *the pair*, not about either side.
- **Navigating both directions** — "reviews by this user" is
  `Review.find({ user })`; "reviews of this product" is
  `Review.find({ product })` served by `{ product: 1, createdAt: -1 }`.
  Each direction needs its own index — a join collection without indexes on
  both refs is half a relationship.
- **Virtual populate** — Product stores no review ids, yet
  `Product.findById(id).populate("reviews")` works: the virtual declares
  `localField: "_id"`, `foreignField: "product"`, and Mongoose runs the
  child-side query for you. Pure Mongoose sugar — nothing extra is stored.

**Code example** — `02-relationships-tour.js`, section 5:

```js
// Direction 1: one user's reviews (with product names populated in).
await Review.find({ user: reviewer._id }).populate("product", "name");

// Direction 2: one product's reviews, newest first — indexed.
await Review.find({ product: prod._id }).sort({ createdAt: -1 }).limit(3)
  .populate("user", "name");
```

**Expected result** — the same collection answers both directions; the tour
also demonstrates virtual populate and points out the unique compound index
doing junction-table duty.

**Common mistakes**
- `product.reviewIds[]` and `user.reviewIds[]` arrays — three copies of every
  relationship (both arrays + the review doc itself), guaranteed drift.
- Forgetting the second-direction index and only noticing when the "my
  reviews" page becomes a collection scan.
- Expecting the unique pair rule to be enforceable in app code. It isn't —
  only the database can serialize two simultaneous "has this user already
  reviewed this?" checks. That's why `unique: true` on the compound index
  matters (it's a MongoDB-level rule, not a Mongoose validation).

**Real-world usage** — reviews, likes, follows, enrollments, cart-item ↔
wishlist links, project memberships (with `role` on the pair). Almost every
social or commerce feature is a rich join collection wearing a costume.

**Related concepts** — the aggregation module turns this collection into
`ratingSummary` (see denormalization below); module 12 covers why the unique
index must be compound and ordered.

---

## Topic: Trees and self-references — the categories hierarchy

**What is it?** A relationship from a collection *to itself*: each Category
document may point at another Category through `parent` (`ObjectId`,
`ref: "Category"`, `null` for roots). Our seed has a two-level tree: 5 roots
(Electronics, Fashion, Home & Kitchen, Sports & Fitness, Books) and 5
children (Laptops, Smartphones, Headphones, Cookware, Fitness Equipment).

**Why does it exist?** (what problem it solves) Hierarchies (categories, org
charts, folders, comment threads) have unbounded depth and shared ancestors —
embedding fails immediately (embedding the parent in every child duplicates
it; embedding children in parents nests without bound). A self-reference
keeps every node a small flat document while still encoding the tree. It is
the *parent-reference pattern* — one of several standard MongoDB tree
patterns:

| Pattern | Stored per node | Great at | Weak at |
| --- | --- | --- | --- |
| **Parent reference** (ours) | `parent: ObjectId` | simple writes; "children of X" (`find({ parent: x })`); small trees loaded whole | deep "all descendants" needs recursion (`$graphLookup` or app loops) |
| **Child references** | `children: [ObjectId]` | ordered children; top-down walks | moving a node touches two parents; arrays to maintain |
| **Materialized path** | `path: "electronics/laptops"` (or ids) | whole subtree in one indexed regex query (`^electronics/`); breadcrumbs are the path itself | renames/moves rewrite every descendant's path string |
| **Ancestors array** | `ancestors: [rootId, ..., parentId]` | "all descendants of X" is `find({ ancestors: x })` — one multikey-indexed query; instant breadcrumbs | moves rewrite descendants' arrays; each node stores its whole ancestry |

**When should I use it?** Parent reference is the right default for shallow,
small, read-mostly trees — like a store's category tree (ours is 10 documents;
the tour fetches *all* of them in one query and assembles the tree in
memory, which beats any clever pattern at this size). Reach for materialized
path or ancestors array when the tree is deep and the hot query is "the whole
subtree under X" (catalog filters over nested categories, threaded comments).

**When should I avoid it?** Avoid recursive per-level queries in application
loops on deep trees (N queries for N levels). Avoid materialized path when
nodes move often. And remember `parent` is an unenforced convention: deleting
a parent orphans its children unless your code re-parents them — MongoDB has
no `ON DELETE CASCADE`.

**Important terms**
- **Self-reference** — a ref whose target model is the same model
  (`ref: "Category"` inside `categorySchema`).
- **Root** — a node with `parent: null`. Query: `find({ parent: null })`.
- **`$graphLookup`** — the aggregation stage that follows references
  *recursively* server-side ("this category and everything under it, any
  depth"). MongoDB-side; nothing in Mongoose needs to know.
- **Materialized path** — storing the full route from root as a single
  indexed string, so subtree = prefix match.
- **Ancestors array** — storing every ancestor id in an array; a multikey
  index makes "descendants of X" a single equality query.

**Code example** — `02-relationships-tour.js`, section 6:

```js
// The whole 10-node tree in ONE query, assembled in memory.
const all = await Category.find().select("name slug parent").lean();
const children = Map.groupBy(all.filter((c) => c.parent), (c) => String(c.parent));

// The self-reference resolving: laptops -> its parent Electronics.
await Category.findOne({ slug: "laptops" }).populate("parent", "name slug");
```

**Expected result** — an indented tree printed from a single query, and a
laptops document whose `parent` field became the full Electronics document
after populate.

**Common mistakes**
- Firing one query per tree level in a loop when the whole tree fits in one
  `find()` — tiny trees should be loaded whole.
- Choosing a fancy tree pattern before having a deep tree. Patterns with
  redundancy (path, ancestors) buy read speed with move/rename cost —
  classic denormalization; don't pay it early.
- Assuming the database prevents cycles or orphans. It doesn't — a bug can
  set a category's parent to its own descendant and only your code will
  notice.

**Real-world usage** — category trees, org charts, nested comment threads,
file/folder systems, menu structures. E-commerce catalogs at scale usually
end up with an ancestors array precisely for "everything under Electronics"
filter queries.

**Related concepts** — `$graphLookup` in the aggregation module; multikey
indexes (module 12) are what make the ancestors-array pattern fast.

---

## Topic: Normalization vs denormalization

**What is it?**
- **Normalization** — every fact stored exactly once; everything else refers
  to it. The product's name exists only on the product; anyone who needs it
  follows the reference. SQL's normal forms are this idea made into law.
- **Denormalization** — deliberately storing a *copy* of a fact where it is
  read, so the read doesn't have to go fetch it. Product carries
  `ratingSummary` (a copy of what the reviews collection knows); order items
  carry `productName` and `unitPrice` (copies of what the product knew at
  purchase time).

**Why does it exist?** (what problem it solves) Normalization optimizes
*writes and consistency*: one place to update, nothing can disagree. Its cost
is paid on every read (joins/lookups/extra queries). Denormalization inverts
the trade: reads become one cheap document fetch, and the cost moves to
writes — every copy must be maintained (or deliberately frozen). Neither is
"correct"; they price the same work differently, and the golden rule tells
you which price to pay: **the frequent operation should be the cheap one.**
Product listings render thousands of times per hour; ratings change a few
times a day — so the summary is denormalized onto the product and the few
writes pay a small extra cost.

**When should I use it?** Denormalize when (all together): the read is hot,
the copied data changes rarely (or must intentionally never change —
snapshots), and you can name *exactly where* the resync happens (which
service function, hook, or job). That last condition is the discipline that
separates denormalization from data corruption.

**When should I avoid it?** Don't denormalize hot-changing data (a live
stock count copied into ten places will be wrong in ten places), don't
duplicate without an owner ("who updates this copy?" must have an answer in
code), and don't bother for reads that aren't actually hot — a copy nobody
needed is pure liability.

**Important terms**
- **Source of truth** — the collection that holds the authoritative version
  of a fact (reviews, for ratings). Every copy is derived and disposable;
  when they disagree, the source wins by definition.
- **Drift** — a copy silently disagreeing with its source, because some code
  path wrote the source without maintaining the copy. Not an "if" — a
  "when"; design the repair before you need it.
- **Resync** — recomputing the copy from the source (aggregate + update).
  Cheap to write, safe to run repeatedly — the universal repair tool.
- **Update anomaly** — the SQL-textbook name for what drift *is*: redundancy
  plus a missed update. Normal forms were invented to make it impossible;
  MongoDB instead makes it *manageable* (bounded, repairable duplication).

**Code example** — `03-denormalization-in-action.js` runs the whole
lifecycle. The two sides of the trade in four lines:

```js
// Read side (hot): the precomputed answer, free with the document.
product.ratingSummary                       // { average: 4.2, count: 12 }

// Truth side: what that copy is a cache OF.
await Review.aggregate([
  { $match: { product: product._id } },
  { $group: { _id: "$product", average: { $avg: "$rating" }, count: { $sum: 1 } } },
]);
```

**Expected result** — for seeded products the two agree (the seeder ran the
resync as its final step — `seed.js` step 7; note the stored average is
rounded to 1 decimal, so tiny decimal differences vs the live aggregate are
rounding policy, not drift). Then the lesson *manufactures* drift on a temp
product — reviews written without maintaining the copy — shows the lie, and
repairs it with the aggregate-and-`$set` resync.

**Common mistakes**
- Denormalizing with no resync plan — the copy is now a time bomb.
- Resyncing with read-modify-write in app code instead of `$set`-ing computed
  values (or letting the server compute) — races corrupt the copy further.
- Treating drift as impossible because "all writes go through one function".
  Imports, migrations, admin scripts, and next year's second service all
  bypass today's one function.

**Real-world usage** — rating summaries, follower counts, "last message
preview" on chat lists, order counts on customer dashboards, search-page
snippets. Any number a list page shows for every row is almost certainly
denormalized.

**Related concepts** — the next topic (deliberate duplication) splits copies
into two species with opposite rules; the aggregation module is where resync
computations live; Mongoose middleware (hooks) is one place resync code runs.

---

## Topic: Deliberate duplication — snapshots vs caches

**What is it?** The recognition that denormalized copies come in **two
species with opposite maintenance rules**:

- **CACHE** — a copy that must *track* its source. `product.ratingSummary`
  mirrors the reviews; when reviews change, the copy is stale until resynced.
  Drift here is a **bug to repair**.
- **SNAPSHOT** — a copy that must *never* track its source.
  `order.items[].productName` and `unitPrice` record what the customer
  actually saw and paid *at that moment*. When the product's price changes
  next week, the difference between snapshot and live is not drift — it is
  **history working correctly**. "Repairing" it would falsify an invoice.

**Why does it exist?** (what problem it solves) A pure reference stores no
data — it always resolves to the *current* version of the target. But some
questions are about the *past*: "what did this order cost?" must answer with
the price at purchase time, forever, even if the product is renamed,
discounted, or deleted. References alone would rewrite history on every
catalog edit — a correctness bug with legal and accounting consequences, not
a performance nit. The snapshot copies the load-bearing facts into the order
at write time, freezing them. (Our orders keep the `product` ObjectId *too* —
so you can still populate the live product for "buy again" links — reference
for the present, snapshot for the past, side by side in the same line item.)
`order.shippingAddress` is the same move applied to the user's address.

**When should I use it?** Snapshot every fact that a past event was *about*:
prices, names, addresses, tax rates, terms — anything printed on an invoice
or shown in an audit trail. Cache every hot-read derived value whose source
keeps changing. Decide the species **at design time** and write it in a
comment on the field, because the two demand opposite code: caches need
resync jobs; snapshots need *protection from* resync jobs.

**When should I avoid it?** Don't snapshot what must stay live (order
`status` is the order's own live state, not a snapshot); don't cache what
must stay frozen. Mislabeling the species is the deep bug here: a
well-meaning "data cleanup" that refreshes order item prices from the catalog
corrupts every historical invoice while looking like maintenance.

**Important terms**
- **Snapshot** — a point-in-time copy, frozen on purpose. Write once at
  event time; never resync.
- **Cache (denormalized copy)** — a current-value copy, tracked on purpose.
  Resync whenever the source changes (or on a schedule).
- **Immutable history** — the property that recorded events never change.
  Documents are good at this: the order document *is* the receipt.

**Code example** — `02-relationships-tour.js`, section 7. On freshly seeded
data every snapshot still equals the live price (the seeder computed
`unitPrice` with the same formula as today's `finalPrice` virtual, and
nothing has changed since), so the lesson makes time pass: it changes one
product's discount, proves the order item did **not** move while the
product's `finalPrice` did, then reverts the product immediately:

```js
// The drift AUDIT (pure read): join each order item to its live product and
// keep items whose frozen unitPrice no longer matches the current price.
// finalPrice is a Mongoose virtual (Node-side!) — the server never heard of
// it, so the pipeline must rebuild the formula with $multiply/$round.
{ $match: { $expr: { $ne: ["$items.unitPrice", "$liveFinalPrice"] } } }
```

**Expected result** — the audit finds 0 mismatches on fresh seed data (and
the note explains why); after the temporary discount change the same audit
finds the order item, showing `paidThen` differing from `currentPrice` — the
snapshot holding still while the world moved. Then the change is reverted.

**Common mistakes**
- No snapshot at all (line items store only a product ref) — invoices
  retroactively change; the classic junior-commerce-schema bug.
- The "helpful" resync that refreshes snapshots — history falsified.
- Snapshotting the *whole* product into the order. Copy only the
  load-bearing facts (name, unit price); a full copy bloats every order and
  freezes fields nobody needs frozen.

**Real-world usage** — invoices, payslips, contracts, shipping labels,
bank-statement lines, event tickets. Every serious commerce or fintech schema
is full of snapshots; auditors expect them.

**Related concepts** — the cache species' lifecycle is lesson 03 in full;
`order.shippingAddress` connects back to the one-to-one topic.

---

## Topic: Read-heavy vs write-heavy — who pays?

**What is it?** The workload lens over every choice above. Each relationship
shape fixes *who does the assembly work*: embedding and denormalization do it
at **write time** (writes fan out to keep copies ready), referencing and
normalization do it at **read time** (reads fan out to assemble the answer).
Your read:write ratio decides which side can afford the bill.

**Why does it exist?** (what problem it solves) The work of connecting
related data never disappears — it only moves. A product page read 10,000
times a day with prices edited 5 times a day should do *zero* assembly on
read: precompute, embed, denormalize — 5 writes happily pay so 10,000 reads
are free. An IoT ingest pipeline writing 10,000 points a minute that analysts
query hourly must keep *writes* at exactly one cheap insert — flat referenced
documents, no copies to maintain, and the rare read runs a big aggregation.

**When should I use it?** Estimate the ratio per collection (even roughly:
"reads dominate 1000:1") before choosing shapes. Catalog-like data
(read-heavy): embed and denormalize confidently. Stream-like data
(write-heavy): keep documents lean and self-contained, never let one insert
trigger updates elsewhere. Mixed (orders: written once, read many times,
almost never modified): write-once documents with snapshots — which is
exactly what our Order is.

**When should I avoid it?** Don't optimize for a ratio you haven't observed
or reasoned about — and remember every denormalized copy is a write
*multiplier* (1 logical change = N physical writes). A "read optimization"
added to a write-hot path is how databases fall over.

**Important terms**
- **Read/write amplification** — one logical operation becoming several
  physical ones: a price change that must also touch 3 caches (write
  amplification); a page render that needs 4 queries (read amplification).
- **Write fan-out** — one source write triggering updates to every copy.
  The price of denormalization, paid at write time.
- **Write-once data** — documents created and then (almost) never modified —
  orders, events, logs. The friendliest data there is: snapshots are natural
  and caches of it can't drift.

**Code example** — no separate file; this lens runs through all three
lessons. Lesson 01 section 2 *is* the read-side argument (1 query vs 2);
lesson 01 section 4 *is* the write-side bill (renaming an author fans out
into every embedded copy); lesson 03 prices both sides of `ratingSummary`.

**Expected result** — after the three lessons you can articulate, for any
shape, who pays: reader or writer — and check that against which one your
app can afford.

**Common mistakes**
- Optimizing reads on a write-hot collection (denormalizing live stock
  counts into every cart).
- Optimizing writes on a read-hot collection (normalizing the catalog into
  six collections and joining on every page view).
- Forgetting that "read-heavy" is per-*collection*, not per-app: the same
  store has read-heavy products and write-heavy orders at the same time.

**Real-world usage** — capacity planning conversations are exactly this
topic: "that field is read a million times a day and written twice — cache
it on the document" is a sentence you will hear (and say) in real design
reviews.

**Related concepts** — module 12 (indexes are also paid for at write time);
the aggregation module (what expensive reads look like when you chose the
write-cheap shape).

---

## Topic: Cardinality — the number that decides everything

**What is it?** The *count* of related items on each side of a relationship:
one-to-1, one-to-few (a handful, hard-capped), one-to-many (dozens to
thousands), one-to-squillions (unbounded), many-to-many. Not the average
count — the **realistic maximum**.

**Why does it exist?** (what problem it solves) Look back over this chapter:
cardinality was the decisive question nearly every time. One address →
embed. Four line items → embed. Nine (someday 10,000) products → child-side
reference. Unbounded orders → squillions shape, parent knows nothing.
Unbounded × unbounded → join collection. The five questions matter, but when
answers conflict, cardinality usually casts the deciding vote — because it is
the one factor with a hard physical wall behind it (16 MB, hot-document
contention, unpaginatable arrays).

**When should I use it?** Estimate it for every relationship *before*
choosing a shape, using the outlier, not the mean: "orders per customer —
average 4, but a reseller could have 10,000." Design for the reseller. If you
cannot name a maximum, the cardinality is unbounded, and unbounded means
**reference** — no exceptions that survive contact with production.

**When should I avoid it?** Don't let cardinality *alone* pick embedding
when the other questions object: 3 items that are shared across parents
(reference — copies drift), or 3 items each 2 MB in size (reference — the cap
is bytes, not count), or 3 items a dashboard must query across all parents
(reference — embedded data is awkward to query "across").

**Important terms**
- **Cardinality** — how many B's per A (and A's per B). The ladder:
  1 / few / many / squillions.
- **Bounded** — a *structural* maximum you can defend in a sentence
  ("checkout caps carts at 50"). "Usually small" is unbounded wearing
  makeup.
- **Outlier sizing** — designing for the realistic worst-case parent, since
  that's the document that will actually hit the wall.

**Code example** — the seeded store is a cardinality ladder you can query
(`02-relationships-tour.js` climbs it top to bottom):

```js
user.address                 // 1        -> embedded object
order.items                  // 1–4      -> embedded array (bounded)
Product.find({ category })   // ~9+      -> child-side reference
Order.find({ user })         // unbounded-> squillions: ref + index only
Review (product × user)      // M × N    -> join collection
```

**Expected result** — each rung answers its home query with the cheapest
shape that survives its count.

**Common mistakes**
- Sizing by the average ("users average 1.2 addresses") and being destroyed
  by the outlier (the logistics company account with 4,000).
- Treating today's count as permanent — 9 products per category is a seed
  artifact, not a law; the model (reference) was chosen for the real
  cardinality, not the current one.
- Confusing cardinality with importance: a one-to-one can be the wrong embed
  (huge blob) and a one-to-thousands the right reference — count is the
  first filter, not the whole decision.

**Real-world usage** — "what's the cardinality?" is usually the first
question an experienced reviewer asks about any proposed schema, because it
eliminates most wrong designs before subtler questions are needed.

**Related concepts** — every topic above; module 08 lesson 03 shows the wall
you hit when you get it wrong, and how to migrate out.

---

## Case study: how the five seeded models embody these choices

Read the model files (`src/models/*.model.js`) with this chapter in mind —
every field placement is one of this chapter's decisions:

**User** — one-to-one `address` **embedded** (owned, bounded, read together;
sub-schema reused by Order). `interests` — an embedded array of primitives:
bounded-ish, owned, never shared — no one makes a collection for hobby
strings. No trace of orders or reviews on the user: those are squillions-side
children that reference *it*.

**Category** — the **self-referencing tree** (parent-reference pattern):
`parent: ObjectId | null` into its own collection. Small and shallow, so
whole-tree reads are one query. No `productIds` array — children reference it
instead (unbounded parent-array anti-pattern avoided).

**Product** — the busy intersection. Child-side **reference** to Category
(shared, independent parent). `specs` **embedded** (one-to-one). `tags`
embedded primitive array. `ratingSummary` — a **denormalized cache** of the
reviews collection, kept honest by resync code (lesson 03). `finalPrice` — a
**virtual**: derived data that is *never stored at all*, the third option
beyond normalize/denormalize, correct because it's cheap to compute and its
inputs live on the same document. Virtual populate `reviews` — navigating a
child-side reference from the parent without storing anything.

**Order** — the hybrid masterpiece. `user` **referenced** (squillions).
`items` **embedded** (owned, bounded, read together) with **snapshot** fields
(`productName`, `unitPrice`) *and* a live `product` ref side by side —
reference for the present, snapshot for the past. `shippingAddress` — a
snapshot of a one-to-one. `totalAmount` — a within-document denormalization
(derivable from items, stored for query-ability and index-ability).
Write-once data, so its copies can't drift.

**Review** — the **rich join collection**: one document per (product, user)
pair, pair-payload fields (rating, title, votes), the unique compound index
`{ product: 1, user: 1 }` playing SQL-composite-primary-key, and a
`{ product: 1, createdAt: -1 }` index paying for the second navigation
direction. It exists as a collection *because* embedding failed the bounded
and shared questions — the Review model's header comment says exactly this.

## What's next

- **Aggregation** — the read patterns you sign up for when you (correctly)
  reference: `$lookup` joins, `$group` rollups, computing `ratingSummary`
  server-side.
- **Module 12 — indexes & performance** — references are only viable because
  indexes make reverse lookups cheap; that module shows the machinery.
- **Module 14 — transactions** — what document-level atomicity does *not*
  cover: multi-document invariants (order + stock decrement), and why good
  modeling (embedding what must change together) reduces how often you need
  them.
