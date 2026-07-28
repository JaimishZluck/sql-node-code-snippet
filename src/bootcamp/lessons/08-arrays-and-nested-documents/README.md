# Module 08 — Arrays & Nested Documents

Modules 04–07 treated documents mostly as flat bags of fields. Real MongoDB
documents are not flat: a user carries an `address` object, a product carries
`specs` and `tags`, an order carries an `items` array of objects. This module
is about **living with that structure day-to-day** — reading it without
crashing, filtering on it, and above all *changing* it precisely: one nested
field, one array element, some elements, all elements, or the whole thing.

Two ideas frame everything in this chapter:

**Idea 1 — a path is an address, and MongoDB only does what the address
says.** `"address.zip"` addresses one leaf; `$set` on it touches one leaf.
`address` addresses the whole object; `$set` on it *replaces* the whole
object — nothing merges, ever. `"items.$.quantity"` addresses "the element my
filter matched". Most bugs in this module's territory are not syntax errors —
they are correct operations applied to the **wrong address**, and they fail
*silently* with plausible-looking data.

**Idea 2 — know which layer does what.**

| Layer | What it contributes here |
| --- | --- |
| **Mongoose** (in Node.js) | Sub-schemas: casting, defaults, and validation for embedded objects and array elements; subdocument `_id`s; `MongooseArray` helpers (`.addToSet()`, `.pull()`, `.id()`); change tracking that turns `doc.address.street = x` into a targeted `$set`. |
| **MongoDB** (on the server) | The actual atomic operators — `$set` on dot paths, `$push`/`$addToSet`/`$pull`/`$pop`, the positional `$`, `$[]`, `$[id]` + `arrayFilters` — plus the hard physics: BSON layout, multikey indexes, and the 16 MB per-document limit. |

The distinction matters: a schema default appearing "out of nowhere" after a
subdocument replacement is Mongoose casting at work; the 16 MB wall and the
"`$` may appear only once" rule are the server and cannot be configured away.

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-embedded-documents.js` | `npm run lesson 08-arrays-and-nested-documents/01-embedded-documents` | reading embedded objects safely, dot-path `$set` vs whole-object replacement (the field-loss trap), sub-schema vs nested path, `$unset` |
| `02-arrays-of-objects.js` | `npm run lesson 08-arrays-and-nested-documents/02-arrays-of-objects` | `$push`/`$addToSet`/`$pull`/`$pop` on primitives; positional `$`, `$[]`, `arrayFilters` on `order.items`; adding/removing whole items; subdocument `_id`s; capped arrays |
| `03-deep-nesting.js` | `npm run lesson 08-arrays-and-nested-documents/03-deep-nesting` | 3-level nesting on a `tmp_` collection: deep queries/updates, measured BSON sizes and the 16 MB cap, promoting an inner level to its own collection, the embed checklist |

**Safety:** every mutation in this module targets **temporary practice
documents** — users with `@lesson.test` emails, one `ZZZ-...` order, and the
temp collections `tmp_wishlists` / `tmp_warehouses` / `tmp_bins`. Each lesson
sweeps leftovers at the start and cleans up in a `finally` block, so you can
run the lessons in any order, repeatedly, without reseeding. Seeded store
data is only ever read.

---

## Topic: Embedded documents — reading them and updating them precisely

**What is it?** An embedded document (sub-document) is an object stored as
the value of a field: `user.address`, `order.payment`, `product.specs`.
Working with it means three verbs: *read* it (`user.address?.city`), *filter*
on it (`{ "address.city": "Pune" }` — module 05), and *update* it — where the
critical choice is `$set` on a **dot path** (`"address.zip"` — changes one
leaf) versus `$set` of the **whole object** (`address: {...}` — replaces
everything).

**Why does it exist?** (what problem it solves) Embedding is the document
model's answer to one-to-one relationships: the address lives *inside* the
user, so one read returns both — no join, no second query. But once data
lives inside an object, you need a way to change *part* of it without
shipping the rest back and forth. Dot-path `$set` is that way: the client
sends "set `address.zip` to `560002`", and the **server** applies it
atomically — no read-modify-write cycle, no race window.

**When should I use it?** Dot-path `$set` for virtually every partial edit —
profile forms, admin corrections, PATCH endpoints. Whole-object `$set` only
when you genuinely mean "discard the old object and store this complete new
one" (e.g. the user submitted a full replacement address through a form that
always sends every field).

**When should I avoid it?** Never `$set` a whole sub-object built from a
*partial* payload (`$set: { address: req.body.address }`) — every field the
payload omits is destroyed. And avoid reading nested fields without optional
chaining: in our seeded data ~15% of users have **no** `address` at all, and
`user.address.city` on them throws.

**Important terms**
- **Embedded document / sub-document** — an object stored inside a document.
  Stored by MongoDB as a plain nested BSON object.
- **Dot path** — a quoted key giving the full route to a leaf:
  `"address.zip"`. Works in filters *and* updates.
- **Replacement semantics** — `$set: { address: X }` assigns `X` as the new
  value of `address`. Objects do not merge; unmentioned fields are gone.
- **Intermediate creation** — `$set` on `"address.zip"` when no `address`
  exists makes MongoDB create `{ zip: ... }` on the fly. Note what does
  *not* happen: sub-schema defaults (like `country: "India"`) are **not**
  applied — Mongoose only runs subdocument defaults when it casts a *whole*
  object, not a single leaf. Partial objects are legal; read defensively.
- **`$unset`** — removes the field (key and bytes) entirely; different from
  storing `null` (module 05, lesson 03).
- **Change tracking** — Mongoose records which paths you assigned on a loaded
  document; `doc.getChanges()` shows the minimal `$set` that `save()` will
  send.

**Code example** — `01-embedded-documents.js`, sections 4–5:

```js
// Surgical: one leaf changes, siblings survive
await User.updateOne({ email }, { $set: { "address.zip": "560002" } });

// THE TRAP: whole-object $set REPLACES — street/state/zip are destroyed
await User.updateOne({ email }, { $set: { address: { city: "New Delhi" } } });
```

**Expected result** — after the dot-path `$set`, the printed address shows
street/city/state intact with only the zip changed. After the whole-object
`$set`, the address is just `{ city: "New Delhi", country: "India" }` — the
`country` came back from the *sub-schema default* during Mongoose's cast
(factory settings, not old data), everything else is gone. The `getChanges()`
demo prints `{ $set: { 'address.street': ... } }`, proving `save()` sends
targeted updates for nested assignments.

**Common mistakes**
- The PATCH-endpoint bug: forwarding a partial body as a whole-object `$set`.
  Fix: translate each provided field to its own dot path
  (`"address.city"`, `"address.zip"`, ...) and `$set` those.
- `user.address.city` without `?.` — crashes on the ~15% of users with no
  address. This is the single most common beginner runtime error with
  embedded data.
- Assuming defaults "protect" you during replacement — the `country: "India"`
  that reappears is *new* data from the schema default, not preservation of
  the old value. Fields without defaults are simply lost.
- Confusing `$unset: { address: "" }` (field removed) with
  `$set: { address: null }` (null stored) — they query differently.

**Real-world usage** — every "edit profile" / "update settings" endpoint in a
MERN backend is dot-path `$set` territory. A typical safe pattern: build the
update object dynamically — `for (const k of ["city","zip"]) if (body[k])
update["address." + k] = body[k]` — then one `updateOne` with
`{ $set: update }`. Payment gateways, shipping metadata, and feature-settings
blobs all follow the same rules.

**Related concepts** — querying nested fields and the exact-object-equality
pitfall (module 05, lesson 05); `replaceOne` — the same lose-what-you-omit
semantics at document level (module 04); when to embed at all (module 09).

---

## Topic: Sub-schemas vs nested paths — and when subdocuments get `_id`s

**What is it?** Mongoose has **two** ways to declare a nested object, and
they behave differently in Node.js while looking identical in the database.
A **sub-schema** (`address: addressSchema`) creates a real *subdocument* —
its own casting, defaults, validators, middleware, and (by default) its own
`_id`. A **nested path** (`specs: { brand: String, ... }` declared inline)
is just grouped fields — no document machinery, never an `_id`.

**Why does it exist?** Reuse and rigor. Our `addressSchema` shapes *both*
`user.address` and `order.shippingAddress` from one definition — one place to
add a validator or default. Array elements declared with a sub-schema
(`items: [orderItemSchema]`) get per-element casting and validation. The
automatic `_id` on subdocuments exists because array elements often need a
**stable handle**: positions shift when the array is reordered, but an
ObjectId identifies "this exact element" forever.

**When should I use it?** Sub-schema: whenever the object is reused across
models, needs its own defaults/validation, or lives in an array whose
elements are addressed individually (keep the `_id`!). Nested path: small,
one-off field groups like `specs` or `ratingSummary` — lighter and perfectly
fine.

**When should I avoid it?** Don't keep subdocument `_id`s that nothing will
ever reference — they cost 12 bytes per element and clutter every response.
Our models opt out deliberately: `addressSchema` sets `{ _id: false }` (an
address is never addressed individually) and so does `orderItemSchema` (line
items are only ever read with their order).

**Important terms**
- **Sub-schema** — a `mongoose.Schema` used as a field's type (or an array's
  element type) instead of being compiled into a model. No collection of its
  own.
- **Single nested subdocument** — a sub-schema used for one object
  (`user.address`). It is a real Mongoose document: `instanceof
  mongoose.Document`, has `ownerDocument()`, `$isSingleNested === true`.
- **Nested path** — inline object syntax; produces plain grouped paths. In
  the lesson, `product.specs` fails all the subdocument checks.
- **`DocumentArray`** — the Mongoose array type for `[subSchema]` fields;
  its `.id(someId)` helper finds the element with that `_id`.
- **Subdocument `_id`** — an ObjectId Mongoose adds to each sub-schema
  element **by default**; disable per-schema with `{ _id: false }`.

**Code example** — `02-arrays-of-objects.js`, section 9 (the wishlist demo
keeps default `_id`s on purpose):

```js
const targetId = wishlist.entries[0]._id;          // free, automatic handle
wishlist.entries.id(targetId);                      // Mongoose lookup helper

// Edit exactly that element — THE standard REST pattern:
await TmpWishlist.updateOne(
  { _id: wishlist._id, "entries._id": targetId },
  { $set: { "entries.$.label": "buy this week" } }
);
await TmpWishlist.updateOne({ _id: wishlist._id },
  { $pull: { entries: { _id: targetId } } });       // delete exactly it
```

**Expected result** — the lesson prints each wishlist entry with its own
ObjectId, then edits and deletes one entry *by* that id. Lesson 01's
comparison table shows `user.address` passing the subdocument checks
(`isMongooseDocument: true`, `_id: undefined` because the schema disabled it)
while `product.specs` fails them all.

**Common mistakes**
- Being surprised by `_id`s inside array elements in API responses — that's
  the default; decide consciously whether to keep them.
- Disabling `_id` on elements your frontend later needs to edit/delete
  individually — you end up matching by fragile field combinations or array
  indexes instead.
- Expecting `ratingSummary`/`specs` (nested paths) to run their own
  middleware or appear as documents — they are just grouped fields.
- Building a "one element" URL around array *indexes* (`/items/2`) —
  positions shift; subdocument `_id`s exist precisely so you don't do this.

**Real-world usage** — any master–detail UI backed by an embedded array:
cart entries, saved addresses, notification preferences, education history on
a profile. The API returns each element's `_id`; edit and delete endpoints
target `"array._id": id` with positional `$` — exactly the lesson's wishlist
pattern.

**Related concepts** — the schema/model/document trio (module 03); positional
`$` mechanics (next topic); embed-vs-reference design (module 09).

---

## Topic: Arrays of primitives — adding and removing values

**What is it?** The operator set for scalar arrays like `user.interests` and
`product.tags`: `$push` (append, duplicates allowed), `$addToSet` (append
only if absent), `$pull` (remove *all* elements matching a value or
condition), `$pop` (remove first/last), with the `$each` modifier for
multi-value pushes.

**Why does it exist?** (what problem it solves) The naive alternative — load
the document, mutate the JS array, save the whole array back — has two
diseases. It **races**: two simultaneous "add yoga" requests both check, both
push, and a duplicate lands even though each request behaved "correctly". And
it **overwrites**: writing the whole array back clobbers any element another
process changed in between. The array operators run on the **server**,
atomically per document: `$addToSet`'s check-and-insert cannot interleave.

**When should I use it?** Tags, interests, wishlists of ids, category labels,
role lists — any set- or list-shaped scalar data. Use `$addToSet` when the
array means a *set* (no duplicates make sense), `$push` when order and
repetition matter (logs, history).

**When should I avoid it?** No operator removes "the element at index N" —
if your design needs positional removal from a shared array, the design is
fighting the tool. And unbounded arrays (append-forever activity feeds)
belong in their own collection, not in a document (see the deep-nesting
topic).

**Important terms**
- **`$push`** — append to the end. Creates the array if the field is absent.
- **`$addToSet`** — append unless an equal element already exists. The
  membership check and the insert are one atomic server-side step.
- **`$each`** — modifier making `$push`/`$addToSet` take several values.
  Without it, `$addToSet: { interests: ["a","b"] }` tries to add the *array
  itself* as a single element — a classic silent bug.
- **`$pull`** — remove **every** element matching a value (`"cricket"`) or a
  condition (`{ $in: [...] }`).
- **`$pop`** — remove one element from an end: `1` = last, `-1` = first.
- **`MongooseArray` methods** — `.push()`, `.addToSet()`, `.pull()` on a
  loaded document's array; they *queue* atomic operators that `save()`
  replays (visible via `doc.getChanges()`), instead of rewriting the array.

**Code example** — `02-arrays-of-objects.js`, sections 1–2:

```js
await User.updateOne({ email }, { $push: { interests: "cricket" } });  // dup OK
await User.updateOne({ email }, { $addToSet: { interests: "cricket" } }); // no-op
await User.updateOne({ email },
  { $addToSet: { interests: { $each: ["yoga", "reading"] } } }); // per-value
await User.updateOne({ email }, { $pull: { interests: "cricket" } }); // ALL copies
```

**Expected result** — pushing `"cricket"` twice yields a visible duplicate;
the `$addToSet` retry reports `modifiedCount: 0` (matched, nothing to do);
the `$each` add inserts only `"yoga"` because `"reading"` was already
present; one `$pull` wipes *both* cricket copies at once. The `getChanges()`
demo shows Mongoose queuing an atomic array op rather than `$set`-ing the
whole array.

**Common mistakes**
- Forgetting `$each` and adding an array *as one element* — the data looks
  fine until something iterates it.
- Expecting `$pull` to remove only the first match — it removes all.
- Read-modify-write for set membership — works in dev, duplicates appear
  under production concurrency. Use `$addToSet`.
- Assuming a "remove at index" operator exists — it doesn't; model removals
  by value or condition.

**Real-world usage** — "follow topic" / "add tag" endpoints are one-line
`$addToSet` updates; "unfollow" is `$pull`. Admin bulk ops combine them with
`updateMany`: "remove the discontinued `sale` tag from every product" is a
single `$pull` across the collection. Querying these arrays was module 05
(containment, `$all`, multikey indexes).

**Related concepts** — array *queries* (module 05, lesson 04); multikey
indexes (module 12); capped arrays with `$slice` (two topics down).

---

## Topic: Arrays of objects — positional updates (`$`, `$[]`, `$[id]` + `arrayFilters`)

**What is it?** The addressing system for updating *elements you can't name
by position*: the positional **`$`** ("the first element my filter matched"),
the all-positional **`$[]`** ("every element"), and the filtered positional
**`$[id]`** with the `arrayFilters` option ("every element matching this
named condition"). The daily arena is `order.items` — line items with
`product`, `quantity`, `subtotal`.

**Why does it exist?** You rarely know an element's index — you know its
*identity* ("the line item for product X") or a *property* ("items with
qty ≥ 2"). Without positional operators you'd read the document, find the
index in JS, and write back — racy and wasteful. With them, "find the element
and change it" is one atomic server-side command; no other request can see
the document half-edited.

**When should I use it?** `$` for "the one element my filter found" —
especially the `"array._id": id` REST edit pattern. `$[]` for order-wide
mutations (repricing every line, flag flips, migrations). `arrayFilters` for
conditional element updates and — crucially — anything **nested more than
one array deep**, where `$` cannot go at all.

**When should I avoid it?** Don't use `$` when several elements may match and
you mean all of them — it silently updates only the first. Don't hard-code
numeric indexes (`items.2.quantity`) in application code — positions shift.
And if you find yourself updating array elements from *outside* the parent's
context constantly, that's a data-modeling smell (promote to a collection).

**Important terms**
- **Positional `$`** — placeholder in the *update path* resolved to the index
  of the **first** array element matched by the *filter*. Requirements: the
  filter must include a condition on that array, and `$` may appear only
  **once** per path — it cannot traverse nested arrays.
- **`$[]` (all-positional)** — resolves to *every* element; no filter
  condition on the array required.
- **`$[id]` + `arrayFilters`** — you invent a name (`q`), use `$[q]` in the
  path, and define what `q` matches in the update *options*:
  `{ arrayFilters: [{ "q.quantity": { $gte: 2 } }] }`. Updates **all**
  matching elements; chains per level for nested arrays.
- **Derived fields** — stored numbers computed from other fields
  (`subtotal`, `totalAmount`). MongoDB does not recompute them; every update
  that changes their inputs must also update them — ideally in the same
  atomic command.

**Code example** — `02-arrays-of-objects.js`, sections 5–7:

```js
// $: the element the filter matched — and keep derived fields honest:
await Order.updateOne(
  { orderNumber, "items.product": productId },
  { $set: { "items.$.quantity": 2, "items.$.subtotal": unit * 2 },
    $inc: { totalAmount: unit } }
);

// $[]: 10% off every line — three layers stay consistent in ONE command:
await Order.updateOne({ orderNumber },
  { $mul: { "items.$[].unitPrice": 0.9, "items.$[].subtotal": 0.9,
            totalAmount: 0.9 } });

// arrayFilters: buy-2-get-1-free on qualifying lines only:
await Order.updateOne({ orderNumber },
  { $inc: { "items.$[q].quantity": 1 } },
  { arrayFilters: [{ "q.quantity": { $gte: 2 } }] });
```

**Expected result** — after the `$` update, exactly one line item shows
qty 2 with its subtotal and the order total both raised consistently. After
`$[]`, every unit price and subtotal ends in `.9`-style decimals (floats! —
real money uses integer paise or Decimal128). After the `arrayFilters`
update, both qty-2 lines show qty 3 while the single-unit line is untouched —
and subtotals deliberately unchanged (free units).

**Common mistakes**
- Using `$` when multiple elements match — only the first changes; the rest
  silently keep the old value. Symptom: "the update worked on my test order
  with one matching item, but production orders are inconsistent."
- Forgetting the array condition in the filter when using `$` — MongoDB
  errors because it has no matched element to resolve `$` to.
- Updating `quantity` but not `subtotal`/`totalAmount` — derived fields
  drift, and revenue reports quietly lie. Update them in the same command.
- Trying `$` across nested arrays (`"a.$.b.$.c"`) — rejected; that is
  `arrayFilters` territory (lesson 03 demonstrates the failure live).
- Misspelling the `arrayFilters` identifier — the name in `$[q]` and in the
  options must match exactly.

**Real-world usage** — cart and order editing (`PATCH /orders/:id/items/:itemId`
resolves to `"items._id"` + `$` in most Express codebases — our order items
disabled `_id`, so the lesson matches by `product` instead), inventory
adjustments, order-wide promotions, and one-off data migrations over embedded
arrays (`updateMany` + `$[]`).

**Related concepts** — `$elemMatch` queries that *find* the documents these
updates target (module 05, lesson 04); update-vs-save atomicity (modules 04
and 07); nested-array updates at depth (lesson 03 here).

---

## Topic: Adding & removing whole array elements (`$push` with `$each`/`$position`/`$slice`, `$pull` with conditions)

**What is it?** Element-level list management for arrays of objects: `$push`
inserts complete new elements (with modifiers controlling *where* —
`$position` — and *how many survive* — `$slice`), and `$pull` removes every
element matching a condition object.

**Why does it exist?** Lists change shape constantly — a customer adds a
product to a pending order, removes another, a "recently viewed" list must
keep only the last N entries. Doing this client-side and writing the whole
array back has the same race problems as always; these operators make each
list edit one atomic server-side step, and `$slice`-on-push adds the one
thing embedded arrays otherwise lack: a built-in growth bound.

**When should I use it?** Adding/removing line items, wishlist entries, saved
addresses; `$position: 0` for newest-first lists; `$push` + `$slice: -N` for
any *capped* list (recent views, last N login events, latest N status
changes).

**When should I avoid it?** Don't `$pull` with a condition broader than you
mean — it removes **all** matches (pulling `{ product: id }` removes every
line for that product, not one). Don't rely on schema validators to protect
list invariants during updates — update operators skip Mongoose validation by
default (the Order's "at least one item" rule will *not* stop a `$pull` from
emptying the array).

**Important terms**
- **`$position`** — with `$each`, inserts the new elements at a given index
  instead of appending (`$position: 0` = front).
- **`$slice` (on push)** — after the push, trims the array: `-3` keeps the
  *last* three, `3` the first three. This is the **capped array** pattern.
- **`$pull` with an object condition** — `{ $pull: { items: { product: id } } }`
  matches elements *whose fields satisfy the condition* — element-level
  filtering, **not** the exact-whole-object equality trap from queries.
- **`$sort` (on push)** — with `$each`, re-sorts the array by element fields
  before `$slice` applies — how you keep "top N by score" lists.

**Code example** — `02-arrays-of-objects.js`, sections 8–9:

```js
// Add a line item at the top AND adjust the total, atomically together:
await Order.updateOne({ orderNumber }, {
  $push: { items: { $each: [newItem], $position: 0 } },
  $inc: { totalAmount: newItem.subtotal },
});

// Remove every line for that product (and refund the total):
await Order.updateOne({ orderNumber },
  { $pull: { items: { product: productId } }, $inc: { totalAmount: -newItem.subtotal } });

// Capped list: push 4, keep only the last 3:
await TmpWishlist.updateOne({ _id }, {
  $push: { entries: { $each: newEntries, $slice: -3 } },
});
```

**Expected result** — the order grows to 4 items with the new one printed
first, total raised by exactly its subtotal; after the `$pull`, back to 3
items and the original total. The wishlist demo pushes 4 entries into a
1-entry list and prints exactly 3 surviving labels — the oldest fell off.

**Common mistakes**
- `$pull` removing more than intended — always ask "could two elements match
  this condition?"
- Pushing an item but forgetting the `$inc` on `totalAmount` — derived-field
  drift again; do both in one command.
- Using `$position` without `$each` — invalid; `$each` is the container all
  push modifiers hang off.
- Letting a "history" array grow unbounded because capping felt optional —
  see the next topic for where that road ends.

**Real-world usage** — "add to cart" / "remove from cart" endpoints;
"recently viewed products" capped at 20 with `$slice: -20`; leaderboards
keeping top-10 with `$sort` + `$slice`; audit trails keeping the last N
status changes on a document while the full history lives in its own
collection.

**Related concepts** — subdocument `_id`s as pull/edit handles (topic 2);
unbounded growth and promotion (next topic); `$pop`/`$pull` on primitives
(topic 3).

---

## Topic: Deep nesting — why it hurts, and when to promote to a collection

**What is it?** Structures more than one or two levels deep — our lesson
builds `warehouse → zones[] → racks[] → bins[]` (three array levels) in a
`tmp_` collection — and the engineering judgment of when to stop nesting and
give the inner data its **own collection** ("promotion"), keeping the former
hierarchy as plain fields (`{ warehouse, zone, rack, sku, qty }`).

**Why does it exist?** Because MongoDB *allows* arbitrary nesting, and the
first instinct ("the real world is hierarchical, so my document should be")
produces exactly this shape. The skill is knowing the costs, which compound
per level: **querying** — dot paths through multiple arrays are context-blind
(conditions can match across *different* branches), and pinning context takes
nested `$elemMatch` per level; **updating** — the positional `$` cannot
traverse more than one array, so every deep update needs an `arrayFilters`
entry per level; **retrieval** — MongoDB returns whole documents, so "one
bin" costs the entire warehouse over the wire; **concurrency** — the document
is the unit of atomicity, so all writers contend on one document; **size** —
the hard 16 MB per-document limit, which "grows with business activity" data
*will* eventually hit; **indexing** — deep multikey indexes make one entry
per leaf per document and compound multikey indexes cannot span parallel
(sibling) arrays.

**When should I use it?** (i.e., when is embedding right) When **all three**
hold: the inner data is **owned** (belongs to exactly one parent, meaningless
alone), **bounded** (a small hard maximum you can name — "items per order:
dozens"), and **read together** (the common access pattern fetches parent and
children as one unit). One or two levels that pass this test — `address`,
`order.items`, `specs` — are the document model working as intended.

**When should I avoid it?** Whenever any rule fails: data that grows with
usage (reviews, events, bins), data queried or updated independently of its
parent, or data shared between parents. Three-plus levels of *arrays* almost
always fail at least one rule — notice that none of our five seeded models
nests that deep. That's design, not coincidence.

**Important terms**
- **16 MB document limit** — a hard MongoDB server cap on BSON document
  size. Not configurable. The lesson *measures* its approach with real
  byte counts.
- **Unbounded growth** — an array that grows with business activity rather
  than having a natural maximum. The number-one modeling red flag.
- **Unit of atomicity/concurrency** — single-document updates are atomic;
  consequently one huge document serializes all its writers.
- **Promotion** — refactoring an embedded level into its own collection,
  one small document per former element, ancestry kept as plain fields.
- **`BSON.calculateObjectSize`** — the driver's own serializer doing a dry
  run; how the lesson prints true document sizes.
- **Parallel arrays** — sibling array fields in one document; a compound
  *multikey* index cannot include two of them.

**Code example** — `03-deep-nesting.js`, sections 3 and 5, same business
operation on both shapes:

```js
// DEEP: restock one bin — one arrayFilters entry PER LEVEL:
await TmpWarehouse.updateOne(
  { _id },
  { $inc: { "zones.$[z].racks.$[r].bins.$[b].qty": -2 } },
  { arrayFilters: [{ "z.code": "A" }, { "r.code": "A-R2" }, { "b.sku": "LAP-9001" }] }
);

// FLAT (after promotion): the same operation, trivial and indexable:
await TmpBin.updateOne(
  { zone: "A", rack: "A-R2", sku: "LAP-9001" },
  { $inc: { qty: 5 } }
);
```

**Expected result** — the naive two-condition query "COOK-7781 in zone A"
matches (wrongly — the SKU is only in zone B; conditions matched across
different zones), while nested `$elemMatch` answers 0 / 1 correctly. The
single-`$`-across-nested-arrays attempt prints a server rejection. The size
section prints real byte counts before/after pushing 500 bins, bytes per
bin, and how many bins fit before the 16 MB wall. After promotion, "where is
HDP-2210?" returns exactly the matching flat bin rows instead of a document
to re-search.

**Common mistakes**
- Modeling the org chart: nesting because the *domain* is hierarchical,
  instead of asking how the data is **accessed**. Hierarchy can be plain
  fields (`zone: "A"`) — it doesn't need to be document structure.
- The cross-branch query bug at depth — plausible wrong answers from
  context-blind dot paths; every level multiplies the risk.
- Believing 16 MB is "huge" — at ~30–40 bytes per tiny element that is
  hundreds of thousands of elements, but *growing toward it at all* means
  reads, writes, and replication drag megabytes long before the hard fail.
- Promoting too eagerly the *other* way — splitting owned, bounded,
  read-together data (like order items) into a collection buys you joins
  (`$lookup`/`populate`) and multi-document consistency problems for
  nothing.

**Real-world usage** — the classic promotions in a MERN store are all in
this repo already: reviews are a collection (not an array in Product)
because they're unbounded; orders reference users but embed their bounded
line items; `ratingSummary` keeps a small denormalized copy where the full
data lives elsewhere. Inventory/warehouse systems, chat threads
(messages → collection), and analytics events all follow the same
promote-the-unbounded-level rule.

**Related concepts** — embed-vs-reference decision-making in full
(module 09 — data modeling); `$lookup`/populate for reading promoted data
back together (modules 10–11); multikey index mechanics (module 12);
optimistic concurrency on contended documents (module 14).

---

## Where to next

- **Module 09 — data modeling:** this module gave you the *mechanics* of
  structure; 09 gives you the *strategy* — embed vs reference, denormalized
  copies, and schema design driven by access patterns.
- **Module 10 — aggregation:** `$unwind` turns embedded arrays into streams
  of per-element documents — how you report over `order.items` without
  promoting them.
- **Module 12 — indexes & performance:** multikey indexes over the arrays
  you learned to update here, and what they cost.
- **Module 07 — updates & deletes** (if you skipped it): the update-operator
  foundations these positional tools build on.
