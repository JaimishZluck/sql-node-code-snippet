# Module 07 — Updates & Deletes: operators, atomicity, and soft delete

Module 04 showed you the update and delete **methods** (`updateOne`,
`findOneAndUpdate`, `deleteMany`, ...). This module is about what goes **inside**
an update — and about what "delete" should actually mean in a real product.

Burn in the three big ideas first:

**Idea 1 — an update is a list of instructions, not new data.** When you send
`{ $inc: { stock: -1 } }`, you are not sending a value you computed in Node. You
are sending the *instruction* "subtract 1 from whatever is there". The MongoDB
**server** executes it against the current value. That distinction — instruction
vs computed value — is the difference between code that survives concurrency and
code that oversells your last laptop on launch day.

**Idea 2 — one document, one command: atomic. Always.** Every update command
applied to a single document is all-or-nothing, with no reader ever seeing a
half-applied state. You do not ask for this and cannot turn it off. It is the
foundation the whole module (and much of MongoDB schema design) stands on — and
it stops at the document boundary.

**Idea 3 — "delete" is a product decision.** The `deleteOne` command destroys
data. Real applications usually cannot afford that: orders reference users,
audits need history, users click things by accident. Most production "deletes"
are really updates (`deletedAt` timestamps). Knowing when to hide data and when
to truly destroy it is a design skill, not a syntax detail.

Throughout, remember the split: **operators are MongoDB features** — they run on
the server and exist with or without Mongoose. **Mongoose adds a thin layer** —
it casts your values to schema types, wraps a bare update object in `$set`,
maintains `updatedAt`, applies defaults on upsert-inserts — and its validators
mostly do **not** protect updates (details below).

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-field-update-operators.js` | `npm run lesson 07-updates-and-deletes/01-field-update-operators` | `$set`, `$unset`, `$inc`, `$mul`, `$min`, `$max`, `$rename`, `$currentDate`, upsert + `$setOnInsert`, operators vs replacement |
| `02-array-update-operators.js` | `npm run lesson 07-updates-and-deletes/02-array-update-operators` | `$push` (+`$each`/`$position`/`$slice`), `$addToSet`, `$pop`, `$pull`, `$pullAll`, positional `$`, `arrayFilters`/`$[elem]`, `$[]` |
| `03-atomic-updates.js` | `npm run lesson 07-updates-and-deletes/03-atomic-updates` | what atomic really means, the read-modify-write race (run live!), conditional atomic updates, the claim pattern |
| `04-soft-delete.js` | `npm run lesson 07-updates-and-deletes/04-soft-delete` | hard delete and dangling references, the `deletedAt` pattern, restore, the unique-index gotcha, centralizing the filter |

**Safety:** every lesson mutates **only temporary practice documents** it creates
itself — users with emails ending `@lesson.test`, products with SKUs starting
`ZZ-`, orders with orderNumbers starting `ZZZ-`, and throwaway `tmp_`
collections. Each lesson sweeps leftovers at the start and cleans up in a
`finally` block, so you can run them in any order, repeatedly, without
reseeding. Seeded data is only ever read.

---

## Topic: Update operators vs replacing the document

**What is it?** There are two ways to change a stored document. An **operator
update** sends instructions (`{ $set: { price: 999 } }`) that edit named fields
in place. A **replacement** (`replaceOne`, `findOneAndReplace`) sends an entire
new document body that swaps out everything except `_id`.

**Why does it exist?** (what problem it solves) If the only way to change a
document were "send the whole new version", every change would require reading
the document first, editing it in app memory, and writing all of it back — slow
(full document over the wire twice), and lethal under concurrency, because two
processes doing it simultaneously overwrite each other's fields. Operators let
the server make precise edits to the current state, however many processes are
writing at once.

**When should I use it?** Operators: practically always — PATCH-style API
endpoints, counters, flags, timestamps, array edits. Replacement: only for
deliberate "overwrite the whole record" flows, like importing a corrected
document from an external system.

**When should I avoid it?** Avoid replacement as the default write style. Every
field you forget to include in the replacement body is silently **deleted**.
Module 04's lesson 03 shows a user losing their age, address, and login history
to a careless replace.

**Important terms**
- **Update document** — the second argument of `updateOne`/`findOneAndUpdate`:
  an object whose top-level keys are operators (`$set`, `$inc`, ...).
- **Operator** — a `$`-prefixed instruction executed by the MongoDB server.
- **Replacement document** — a full document body with **no** operators. Mixing
  operators into a replacement is an error, and vice versa (the server rejects
  update documents where operator and non-operator keys are mixed).
- **Mongoose `$set` wrapping** — Mongoose convenience: `updateOne(f, { price: 999 })`
  is silently rewritten to `{ $set: { price: 999 } }`. Write the `$set` yourself;
  the raw shell would reject the bare form, and explicit is clearer.

**Code example** — `01-field-update-operators.js`, sections 1 and 8:

```js
// Operator update: edits two fields, everything else untouched
await Product.updateOne({ sku }, { $set: { discountPercent: 15, "specs.color": "graphite" } });

// Replacement: the document becomes EXACTLY this (plus _id)
await Product.replaceOne({ sku }, { name: "ZZ Rebuilt Speaker", sku, price: 999, category });
```

**Expected result** — after the `$set`, the product keeps its stock, tags, and
specs. After the `replaceOne`, tags/specs/discount are gone; fields like
`stock: 0` reappear only because Mongoose re-applied schema defaults while
casting the replacement.

**Common mistakes** — using replacement for partial edits (data loss); assuming
Mongoose's bare-object wrapping exists in the shell or driver (it does not);
forgetting that operator updates skip Mongoose validators unless you pass
`runValidators: true` (module 04, lesson 03).

**Real-world usage** — `PATCH /products/:id` handlers build a `$set` from the
allowed request fields. Replacement appears almost exclusively in data-import
and sync jobs.

**Related concepts** — module 04 (`updateOne` vs `findOneAndUpdate` vs
`replaceOne` return shapes), Topic: Atomic single-document updates below.

---

## Topic: `$set` and `$unset`

**What is it?** `$set` writes a value into a field (creating the field if it is
missing). `$unset` removes the field — the key itself disappears from the
stored BSON document.

**Why does it exist?** `$set` is *the* precise-edit tool: name exactly the paths
you want changed, everything else is guaranteed untouched. `$unset` exists
because documents are schemaless on the server: "this field no longer applies"
is naturally expressed by *removing the key*, something a SQL row cannot do.

**When should I use it?** `$set` for nearly every field edit. Use **dot
notation** (`"specs.color"`, `"payment.paidAt"`) to reach inside embedded
objects. `$unset` when a field should genuinely stop existing — clearing an
optional value, or migrating away from a retired field.

**When should I avoid it?** Avoid `$set`-ing a whole nested object when you mean
to change one inner field: `{ $set: { specs: { color: "red" } } }` replaces the
*entire* `specs` object — brand and warranty are gone. Avoid `$unset` when the
difference between "empty" and "absent" matters to your queries — storing
`null` (via `$set`) keeps the key present and visibly "empty on purpose".

**Important terms**
- **Dot notation** — `"outer.inner"` paths that address one nested field.
- **Missing vs null** — a *missing* field has no key in the BSON document; a
  *null* field has the key with the value `null`. Filters treat them
  differently: `{ f: null }` matches **both**, `{ f: { $exists: false } }`
  matches only true absence (module 05).
- **Hydration** — Mongoose turning a raw BSON document into a Mongoose document
  in Node. Beware: it can fill schema defaults into missing fields in memory,
  masking what is actually stored. The lesson uses the native driver
  (`mongoose.connection.db`) to show the raw truth.

**Code example** — `01-field-update-operators.js`, sections 1–2:

```js
await User.updateOne(
  { email },
  { $unset: { age: "" },            // the key is deleted ("" is ignored)
    $set: { lastLoginAt: null } }   // the key stays, holding null
);
```

**Expected result** — the raw document shows `"age" in doc === false` while
`lastLoginAt: null` is present. `{ age: { $exists: false } }` now matches the
user.

**Common mistakes** — whole-object `$set` wiping siblings (use dot notation);
expecting `$unset` to error when the field is already absent (it is a silent
no-op); confusing `$set: { f: null }` with `$unset: { f: "" }`.

**Real-world usage** — profile-edit endpoints (`$set` from validated input),
"remove my phone number" features (`$unset`), schema-migration scripts cleaning
out retired fields.

**Related concepts** — module 05 (`$exists`, null semantics), `$rename` below
(which is `$unset` + `$set` in one).

---

## Topic: Numeric operators — `$inc`, `$mul`, `$min`, `$max`

**What is it?** Server-side arithmetic: `$inc` adds a delta (negative = subtract
— there is no `$dec`), `$mul` multiplies, `$min`/`$max` write the given value
**only if** it is lower/higher than what is stored.

**Why does it exist?** Because "read the value, compute in JS, write the
result" is broken under concurrency. Two requests each reading
`loyaltyPoints: 100` and writing back `110` lose one of the two +10s. With
`$inc: { loyaltyPoints: 10 }` the server applies each delta to the *current*
value — both land, always. `$min`/`$max` similarly fold a comparison into the
atomic write: "keep the extreme" without a read-check-write gap.

**When should I use it?** Counters (stock, votes, view counts, points),
percentage price adjustments (`$mul`), "record the lowest/highest/latest"
trackers (`$min`/`$max` — they work on dates too, which makes `$max` perfect
for last-activity timestamps that must never move backwards when events arrive
out of order).

**When should I avoid it?** Money at scale in floats — `1999 * 0.9 = 1799.1`;
production stores integer paise/cents or `Decimal128`. And do not rely on
schema rules to bound the result: **update validators never run on
`$inc`/`$mul`**, so `stock: { min: 0 }` will not stop a decrement below zero
(lesson 03 demonstrates the guard that does).

**Important terms**
- **Delta** — the amount of change (`+250`, `-1`) sent instead of the result.
- **No-op update** — `$min`/`$max` that lose their comparison report
  `matchedCount: 1, modifiedCount: 0`: found the doc, wrote nothing. Not a
  failure — read the counts.
- **Missing-field behavior** — `$inc` creates the field holding the delta;
  `$mul` creates it holding `0`; `$min`/`$max` simply set the value.

**Code example** — `01-field-update-operators.js`, sections 3–4:

```js
await User.updateOne({ email }, { $inc: { loyaltyPoints: 250 } }); // +250 on the server
await Product.updateOne({ sku }, { $mul: { price: 0.9 } });        // 10% price cut
await User.updateOne({ email }, { $max: { lastLoginAt: eventTime } }); // only moves forward
```

**Expected result** — points go 100 → 350 → 300 across the lesson's calls; a
`$min: 1700` against a stored `1500` reports `modifiedCount: 0`; a late,
out-of-order login event leaves `lastLoginAt` untouched.

**Common mistakes** — implementing counters with read-then-`$set` (the race);
expecting a `ValidationError` when `$inc` crosses a schema `min`; forgetting
that `$inc` on a missing field *creates* it (typo a field name and you mint a
new counter).

**Real-world usage** — inventory decrements, review `helpfulVotes` buttons,
rate-limit counters, "lowest price in 30 days" badges (`$min`), monotonic
last-seen timestamps (`$max`).

**Related concepts** — Topic: Atomic single-document updates (why deltas beat
computed values), module 10 (aggregation `$min`/`$max` — same names, different
context: computing over many docs vs conditionally writing one).

---

## Topic: `$rename` and `$currentDate`

**What is it?** `$rename` changes a field's *name* (`fullname` → `name`),
keeping its value. `$currentDate` writes the **server's** current time into a
field.

**Why does it exist?** `$rename`: schemas evolve. When v2 of your app renames a
field, millions of stored v1 documents still carry the old key — `$rename`
migrates them without shipping values back and forth. `$currentDate`: your app
servers each have their own clock, and clocks drift. Timestamps that must be
consistent across writers ("last touched at") should come from the one clock
everybody shares — the database's.

**When should I use it?** `$rename` in migration scripts (typically written with
the native driver, since your *current* Mongoose schema no longer knows the
*old* field name). `$currentDate` for server-authoritative touch timestamps.

**When should I avoid it?** `$rename` cannot move values into or out of arrays,
and renaming an indexed field leaves the old index behind (create the new index
first, drop the old one after). Skip `$currentDate` for `updatedAt` — Mongoose's
`timestamps: true` already maintains it on every update. And when the timestamp
must equal a value your app logic also uses (e.g. you compare it right after),
`$set` with your own `Date` is simpler.

**Important terms**
- **Migration** — a one-off script that rewrites existing documents to match a
  new schema shape. MongoDB will not do this for you on deploy; old documents
  keep their old shape until you migrate them.
- **BSON Date vs timestamp** — `$currentDate: { f: true }` stores a normal
  Date; `{ $type: "timestamp" }` stores MongoDB's internal oplog-style
  timestamp — you almost always want the Date.
- **Clock skew** — different machines disagreeing about "now" by seconds or
  more; the reason server-side time exists.

**Code example** — `01-field-update-operators.js`, sections 5–6 (the `$rename`
runs on a throwaway `tmp_` collection via the native driver):

```js
const tmp = mongoose.connection.db.collection("tmp_field_migration");
await tmp.updateMany({}, { $rename: { fullname: "name" } }); // v1 -> v2 shape

await User.updateOne({ email }, { $currentDate: { lastLoginAt: true } });
```

**Expected result** — the tmp documents show `name` where `fullname` used to
be (possibly moved to the end of the document — `$rename` is internally
`$unset` + `$set`); `lastLoginAt` holds a fresh server-time Date, and
`updatedAt` moved too (Mongoose timestamps).

**Common mistakes** — running `$rename` through a strict Mongoose model that
does not know the old field; migrating only *some* documents and leaving a
mixed collection; using `$currentDate` where Mongoose already maintains
timestamps, doubling the writes for nothing.

**Real-world usage** — deploy-time migration scripts (`migrate-mongo` and
friends are `updateMany` + `$rename`/`$set` under the hood), heartbeat fields
(`lastSeenAt`) written by many app instances.

**Related concepts** — module 12 (indexes — what a rename does to them),
Mongoose `timestamps` option (module 03).

---

## Topic: Upsert and `$setOnInsert`

**What is it?** An update with `upsert: true` means "**up**date the matching
document — or in**sert** a new one if nothing matches". `$setOnInsert` lists
fields applied **only** when the insert path runs.

**Why does it exist?** The naive alternative — `findOne`, then `create` if
missing — has a race: two simultaneous requests both find nothing and both
insert. Upsert folds find-or-create into one server-side command. `$setOnInsert`
exists because some fields belong only to creation ("birth certificate" data:
signup source, initial status, createdBy) and must not be rewritten by every
later upsert.

**When should I use it?** Find-or-create flows: "get this user's cart, creating
an empty one if needed", per-day stats documents (`$inc` a counter, upserting
the day's doc into existence), imports that insert-or-refresh.

**When should I avoid it?** When an unmatched filter signals a *bug* — most
`PATCH /resource/:id` handlers should 404, not silently create. And never rely
on upsert alone for uniqueness: **two concurrent upserts can both take the
insert path**; only a unique index makes the second fail cleanly (E11000)
instead of duplicating. Upserts and unique indexes travel together.

**Important terms**
- **Insert path / update path** — the two things an upsert can do; which one
  ran is visible in the result (`upsertedCount` / `upsertedId`).
- **Filter seeding** — on insert, the filter's *equality* conditions become
  part of the new document (the `email` you filtered on is stored).
- **`setDefaultsOnInsert`** — Mongoose (on by default) applies schema defaults
  to upsert-inserted documents — why the lesson's upserted user has
  `role: "customer"` without anyone setting it.

**Code example** — `01-field-update-operators.js`, section 7:

```js
await User.findOneAndUpdate(
  { email: "ops.upsert@lesson.test" },
  { $set: { loyaltyPoints: 100 },                  // both paths
    $setOnInsert: { name: "Upsert Omi", age: 30 } }, // insert path only
  { upsert: true, new: true }
);
```

**Expected result** — first call: a new user with the filter's email, the
`$setOnInsert` name/age, the `$set` points, and schema defaults. Second call
with different values: points change, `age` stays 30 — `$setOnInsert` was
ignored on the update path.

**Common mistakes** — putting the same path in `$set` and `$setOnInsert` (the
server rejects the conflict); expecting `$setOnInsert` to run on matched
documents; upserting without a unique index and shipping a duplicate-document
bug that only appears under load.

**Real-world usage** — shopping carts, "ensure a settings document exists",
idempotent webhook ingestion (upsert by external event id), daily/hourly
metrics rollups.

**Related concepts** — module 03 (unique indexes, E11000), Topic: Atomic
single-document updates (upsert is find-or-create *made* atomic).

---

## Topic: `$push` with `$each`, `$position`, `$slice`

**What is it?** `$push` appends a value to an array field. Its modifiers extend
it: `$each` pushes several values, `$position` chooses *where* to insert
(`0` = front), and `$slice` trims the array to a maximum length in the same
atomic step.

**Why does it exist?** Arrays inside documents are a core document-model
feature, so they need first-class edit instructions — fetching the document,
`array.push()` in JS, and saving the whole array back has the same race problem
as every read-modify-write. The modifiers exist because "append" alone cannot
express the most common real pattern: a **bounded, newest-first list** that can
never bloat the document.

**When should I use it?** Event-style arrays where repeats are meaningful
(status history, comments), and — with `$each`+`$position: 0`+`$slice: N` — any
"recent items" list: recently viewed products, last 10 notifications, latest
search terms.

**When should I avoid it?** Set-like arrays (tags, follower ids) — `$push`
happily inserts duplicates; use `$addToSet`. Unbounded growth — an array that
grows forever marches the document toward the 16 MB cap and slows every read;
cap it with `$slice` or model the data as its own collection (module 09 — this
is exactly why reviews are a separate collection).

**Important terms**
- **Modifier** — `$each`/`$position`/`$slice`/`$sort` only work *inside*
  `$push`, and `$position`/`$slice` **require** `$each` — even one value must
  be wrapped: `{ $each: [v] }`.
- **`$slice` sign** — positive keeps the FIRST N elements (use when inserting
  at the front), negative keeps the LAST N (use when appending to the end).
- **Capped-array pattern** — the push-front-and-slice combo that guarantees a
  maximum array length forever.

**Code example** — `02-array-update-operators.js`, section 2:

```js
await User.updateOne(
  { email },
  { $push: { interests: { $each: ["gaming", "music"], $position: 0, $slice: 5 } } }
);
```

**Expected result** — the two new values appear at the front; the array is cut
back to 5 elements; the oldest entries fell off the end. One command, atomic.

**Common mistakes** — `$push: { f: [1, 2] }` without `$each` pushes the *array
itself* as one nested element; using `$slice: 5` with end-appends (you keep the
5 *oldest* — you wanted `-5`); letting "just a log array" grow unbounded.

**Real-world usage** — "recently viewed" carousels, notification trays,
last-N login records on a user document.

**Related concepts** — module 05 (querying arrays), module 09 (embed vs
reference — when an array should become a collection), `$addToSet` next.

---

## Topic: `$addToSet`, `$pop`, `$pull`, `$pullAll`

**What is it?** The rest of the array toolkit. `$addToSet` appends only if the
value is not already present (treats the array as a set). `$pop` removes one
element from an end (`1` = last, `-1` = first). `$pull` removes **all** elements
matching a value or a per-element condition. `$pullAll` removes all elements
equal to any value in a literal list.

**Why does it exist?** Each answers a question `$push` cannot: "add without
duplicating" (`$addToSet`), "drop one end of a list" (`$pop`), "delete by
content, not by position" (`$pull`/`$pullAll`) — all server-side and atomic,
with no read-edit-write gap for another request to fall into.

**When should I use it?** `$addToSet` for tags, interests, follower/like ids —
any membership semantics. `$pull` with a condition for cleanups like "remove
every line item with quantity ≥ 3" or "remove all blacklisted tags"
(`{ $in: [...] }`). `$pullAll` when you literally hold the list of values to
delete.

**When should I avoid it?** `$addToSet` when order or duplicates carry meaning
(it neither sorts nor dedupes what is already there — existing duplicates
survive). `$pop` when you need to know *what* was removed — it does not return
the element (use `findOneAndUpdate` without `new: true` and read the pre-update
doc). `$pull` on huge arrays as a routine operation — rethink the model.

**Important terms**
- **Set semantics** — "present or not", no duplicates. `$addToSet` compares
  the *whole* value exactly; for embedded objects, `{a:1,b:2}` and `{b:2,a:1}`
  are DIFFERENT values (BSON key order matters).
- **Per-element query** — `$pull`'s argument is a condition evaluated against
  each element (`$in`, `$gte`, regexes work); for subdocument arrays it
  matches field-by-field, so `{ quantity: { $gte: 3 } }` pulls matching lines.
- **Literal list** — `$pullAll`'s argument; nothing in it is interpreted as an
  operator.

**Code example** — `02-array-update-operators.js`, sections 1, 3–4, 9:

```js
await User.updateOne({ email }, { $addToSet: { interests: { $each: ["yoga", "fitness"] } } });
await Product.updateMany({ sku: /^ZZ-ARR-/ }, { $pull: { tags: { $in: ["budget", "gift-idea"] } } });
await Order.updateOne({ orderNumber }, { $pull: { items: { quantity: { $gte: 3 } } } });
```

**Expected result** — re-adding an existing interest reports
`modifiedCount: 0`; the blacklist pull cleans both practice products in one
command; the conditional pull removes both bulk lines from the order and
leaves the quantity-2 line.

**Common mistakes** — expecting `$addToSet` to clean existing duplicates;
confusing `$pull` (query semantics) with `$pullAll` (exact values); forgetting
that removing an absent value is a silent no-op; pulling order lines and
leaving the denormalized `totalAmount` stale (the lesson re-syncs it every
time — deliberately).

**Real-world usage** — like/unlike toggles (`$addToSet`/`$pull` with a user
id), tag management UIs, removing cancelled line items, pruning blacklisted
values across a catalog with one `updateMany`.

**Related concepts** — module 05 (array queries: `$in`, `$elemMatch`),
positional operators next (edit elements instead of removing them).

---

## Topic: Positional updates — `$`, `arrayFilters` (`$[elem]`), and `$[]`

**What is it?** Three ways to edit array elements **in place**:
- `items.$` — the index of the **first** element matched **by the filter**;
- `items.$[elem]` + the `arrayFilters` option — **every** element matching a
  named condition;
- `items.$[]` — **every** element, unconditionally.

**Why does it exist?** Without them, changing one line inside an order's
`items` array would mean rewriting the whole array from app memory (races,
again) — you cannot know an element's numeric index in advance, because another
update may have reordered or resized the array by the time yours lands. The
positional operators let the *server* resolve "which element" at execution
time.

**When should I use it?** `$` for "the one element my filter found" — update
this order's line for product X. `arrayFilters` when several elements may
match, or when the element condition is unrelated to the document filter —
"every line with quantity ≥ 2". `$[]` for blanket changes — "10% off every
line".

**When should I avoid it?** `$` when *multiple* elements may match and you mean
all of them — it edits only the first (the lesson builds an order with two
lines for the same product precisely to show this). Any positional update when
the per-element math depends on other fields (`subtotal = unitPrice × quantity`)
— then either compute in a load-modify-save (accepting the race for admin-style
fixes) or use an aggregation-pipeline update.

**Important terms**
- **Positional operator** — a path placeholder the server resolves to real
  indexes at execution time.
- **`arrayFilters`** — an *options*-level list of conditions defining each
  `$[name]` placeholder. Identifiers must start with a lowercase letter, and
  every placeholder used in a path must have a matching entry.
- **First-match rule** — `$` requires the array field to appear in the filter;
  otherwise the server errors with "the positional operator did not find the
  match needed from the query".
- **Aggregation-pipeline update** — `updateOne(filter, [{ $set: ... }])`: the
  update is a pipeline that can *compute* new values from existing fields,
  server-side (aggregation itself is modules 08/10).

**Code example** — `02-array-update-operators.js`, sections 5–8:

```js
// First matching line only — filter MUST mention the array
await Order.updateOne(
  { orderNumber, "items.product": earbudsId },
  { $set: { "items.$.quantity": 2, "items.$.subtotal": 2 * PRICE } }
);

// Every earbuds line — condition lives in the options
await Order.updateOne(
  { orderNumber },
  { $inc: { "items.$[line].quantity": 1 } },
  { arrayFilters: [{ "line.product": earbudsId }] }
);

// Every line + the total, consistent in ONE atomic command
await Order.updateOne(
  { orderNumber },
  { $mul: { "items.$[].unitPrice": 0.9, "items.$[].subtotal": 0.9, totalAmount: 0.9 } }
);
```

**Expected result** — the `$` update changes only the first of the two earbuds
lines; the `arrayFilters` update changes both; the `$[]` update discounts every
line *and* the total with no moment where a reader could see them disagree.

**Common mistakes** — using `$` while forgetting the array in the filter (server
error); assuming `$` updates all matches; a typo'd `arrayFilters` identifier
(server rejects the command); updating `quantity` but not `subtotal`, leaving
denormalized money fields lying.

**Real-world usage** — order-line edits, marking one notification read
(`arrayFilters` on its id), bulk price adjustments inside embedded arrays,
"set every item's status to refunded" (`$[]`).

**Related concepts** — module 05 (`$elemMatch` — the *query* side of matching
elements), module 09 (embedded arrays as the data being edited), Topic: Atomic
single-document updates (why one command beats three).

---

## Topic: Atomic single-document updates (and the race they prevent)

**What is it?** MongoDB's guarantee that one update command applied to one
document is **all-or-nothing and isolated**: every operator in the command
takes effect together, and no reader or writer ever observes the document
halfway through. Combined with a conditional filter, it becomes
**compare-and-set**: check and change welded into one indivisible step.

**Why does it exist?** (what problem it solves) The **read-modify-write race**.
Two checkout requests both read `stock: 1`, both pass the `if (stock >= 1)`
check in JavaScript, both compute `0`, both save. Two confirmations, one unit
— you oversold. Each individual read and write was fine; the bug lives in the
**gap** between them, where the other request's write happened. No amount of
JavaScript can close that gap, because the check runs in your process and the
data lives in another. The fix is moving the check *into* the database's atomic
step: `findOneAndUpdate({ _id, stock: { $gte: qty } }, { $inc: { stock: -qty } })`.
MongoDB serializes writes per document, so one request wins and the other's
filter simply matches nothing (returns `null` — your "out of stock" signal).

**When should I use it?** Every counter with a floor or ceiling (stock, seats,
budgets), and every "only one request may do this" rule — the **claim
pattern**: pay an order exactly once (`status: "pending"` → `"paid"`), let one
worker claim a job (`pending` → `processing` + workerId), redeem a single-use
coupon.

**When should I avoid it?** It cannot span documents. "Move points from user A
to user B" is two documents — two atomic steps with a gap between them; that
needs transactions (module 14). Also do not confuse atomic with validated: a
bare `$inc` happily drives stock to `-1` (schema `min: 0` is Mongoose-side and
update validators skip `$inc`) — the *filter condition* is what encodes the
business rule.

**Important terms**
- **Race condition** — a bug whose outcome depends on the timing of concurrent
  operations; invisible in dev, guaranteed in production traffic.
- **Read-modify-write** — the broken shape: read a value, compute in app
  memory, write the result (a blind overwrite of whatever is there *now*).
- **Compare-and-set (CAS)** — write that succeeds only if a condition still
  holds, evaluated atomically with the write.
- **Serialized writes** — MongoDB applies concurrent writes to one document
  one-at-a-time (per-document locking); order is unspecified, exclusivity is
  guaranteed.
- **Optimistic concurrency** — an alternative guard: detect stale saves via a
  version field (`__v`, kept on Order); module 14.

**Code example** — `03-atomic-updates.js`, sections 2–3 run the race for real:

```js
// BROKEN: both buyers read 1, both write 0 -> oversold
const [a, b] = await Promise.all([Product.findOne({ sku }), Product.findOne({ sku })]);
// ...both check a.stock >= 1 in JS, both save...

// FIXED: check + change in ONE atomic command; exactly one wins
const attempt = () =>
  Product.findOneAndUpdate(
    { sku, stock: { $gte: 1 } },
    { $inc: { stock: -1 } },
    { new: true }
  );
const [c, d] = await Promise.all([attempt(), attempt()]);
// one returns the doc (stock 0), the other returns null — every run
```

**Expected result** — section 2 prints two confirmations for one unit and a
final stock of 0 (oversold); section 3 prints exactly one winner and one
`null`, deterministically, no matter how the calls interleave.

**Common mistakes** — `if` checks in JavaScript guarding writes; `$set`-ing a
computed value instead of `$inc`-ing a delta; treating `findOneAndUpdate`'s
`null` as an error instead of the "condition no longer holds" signal; assuming
`updateMany` is all-or-nothing across documents (it is not).

**Real-world usage** — inventory and seat reservation, idempotent payment
webhooks, distributed job queues built on a plain collection, feature-flag
rollouts ("claim one of N slots").

**Related concepts** — module 14 (transactions, optimistic concurrency with
`__v`), module 09 (embedding related data so more changes fit inside one
atomic document update), module 04 (`findOneAndUpdate` mechanics).

---

## Topic: Soft delete vs hard delete

**What is it?** **Hard delete** removes the document (`deleteOne` — the bytes
are gone). **Soft delete** is an *update* that marks the document deleted —
here, setting `deletedAt` to a timestamp (`null` = alive) — while every
"normal" query filters to `{ deletedAt: null }`.

**Why does it exist?** (what problem it solves) Three problems with destroying
data: **references** — orders and reviews store the user's ObjectId, and MongoDB
has no foreign keys, so after a hard delete every `populate()` and `$lookup`
silently yields `null` (the lesson shows a delivered order whose owner is just…
gone); **undo** — users delete things by accident, and "restore from backup" is
not a feature; **audit** — support, finance, and fraud teams need to know who
that customer *was*. Soft delete keeps the document (references resolve,
history intact) while hiding it from normal application flows — and restore is
a one-line update.

**When should I use it?** Default to soft delete for **core business entities**:
users, orders, products, reviews — anything referenced elsewhere or needed for
history. Store a **timestamp**, not a boolean: same cost, and it answers
"when?" for audits and retention purges.

**When should I avoid it?** When data must truly cease to exist: legal erasure
(GDPR / India's DPDP Act "right to erasure" — a flag does not satisfy it), and
worthless-by-design data (sessions, OTPs, abandoned carts — often expired
automatically by a TTL index, module 12). The common **hybrid**: soft delete on
user action, then a scheduled purge job hard-deletes docs whose `deletedAt` is
older than the retention window.

**Important terms**
- **`deletedAt` pattern** — `Date | null` field; `null` = alive. The User
  schema pairs it with an `isDeleted` Mongoose **virtual** (computed in Node,
  never stored).
- **Dangling reference** — a stored ObjectId whose target no longer exists;
  `populate()` returns `null` for it.
- **Tombstone** — a soft-deleted document: present, but marked dead.
- **Partial unique index** — the fix for the big gotcha: a soft-deleted user's
  email still occupies the unique index, so re-signup fails with E11000.
  `schema.index({ email: 1 }, { unique: true, partialFilterExpression:
  { deletedAt: null } })` enforces uniqueness among *alive* docs only.
- **Purge job** — scheduled task that hard-deletes tombstones past retention.

**Code example** — `04-soft-delete.js`:

```js
// "delete"
await User.findOneAndUpdate({ email }, { $set: { deletedAt: new Date() } }, { new: true });

// every normal query must remember the filter
const user = await User.findOne({ email, deletedAt: null }); // null -> "account not found"

// restore — idempotent thanks to the condition
await User.findOneAndUpdate(
  { email, deletedAt: { $ne: null } },
  { $set: { deletedAt: null } }
);
```

**Expected result** — the hard-deleted user's order populates `user: null`; the
soft-deleted user disappears from `{ deletedAt: null }` queries yet her order
still populates; signing up with her email throws E11000 while she is deleted;
restore brings her back with one update. The seeded data itself contains ~10%
soft-deleted users — the lesson counts them read-only.

**Common mistakes** — forgetting the filter in one of 200 queries (deleted
users get marketing emails, inflate dashboards): the reason real apps
**centralize** it — a shared helper, or schema middleware
(`userSchema.pre(/^find/, function () { this.where({ deletedAt: null }); })` —
module 13) with an explicit opt-out for admin views, or a plugin like
`mongoose-delete`. Also: using a boolean instead of a timestamp; ignoring the
unique-index gotcha; claiming GDPR compliance with a flag.

**Real-world usage** — account deactivation with a grace period, trash/restore
features, order cancellation that preserves the record, admin "view deleted"
screens, retention-window purge crons.

**Related concepts** — module 04 (the delete method family, `deleteMany({})`
danger), module 12 (partial indexes, TTL indexes), module 13 (middleware to
centralize the filter), module 09 (references — why dangling ids hurt).

---

## Where to go next

- **Module 08/10 — aggregation**: computing *across* documents, and
  aggregation-pipeline updates that recompute fields server-side.
- **Module 12 — indexes**: partial unique indexes for soft delete, TTL indexes
  as automatic hard delete, and what your update filters cost.
- **Module 13 — middleware**: hooks that inject `{ deletedAt: null }` and keep
  denormalized fields in sync.
- **Module 14 — transactions**: when one atomic document is not enough, plus
  optimistic concurrency with Order's `__v`.
