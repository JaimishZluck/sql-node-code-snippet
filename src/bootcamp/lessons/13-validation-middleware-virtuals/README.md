# Module 13 — Validation, middleware, virtuals

Modules 11 and 12 lived on the **server**: aggregation and indexes are
MongoDB features that work no matter what client talks to the database. This
module is the opposite. Everything here runs **in Node.js, inside Mongoose**,
and none of it exists as far as MongoDB is concerned.

That single fact is the theme:

> Mongoose validators, middleware, virtuals, getters, and setters are
> **application-layer** features. They protect and shape data that flows
> **through your models**. They are invisible to `mongosh`, to a migration
> script using the native driver, to another service, and to
> `Model.aggregate()`.

That is not a criticism — application-layer rules are exactly what you want
for things like "hash the password before saving" or "an order must have at
least one item". But you must always know which layer a rule lives in, because
that determines what can bypass it.

| Rule | Enforced by | Bypassed by |
| --- | --- | --- |
| `required`, `min`, `enum`, `match`, custom validators | **Mongoose** (Node.js) | native driver, mongosh, other services, `updateOne` without `runValidators` |
| `unique`, partial/TTL indexes, `$jsonSchema` | **MongoDB** (server) | nothing |
| `pre`/`post` hooks | **Mongoose** | `aggregate()`, native driver, and the wrong hook type (see below) |
| virtuals, getters, `toJSON` transforms | **Mongoose** | `.lean()`, `aggregate()`, native driver |

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-validation.js` | `npm run lesson 13-validation-middleware-virtuals/01-validation` | built-in validators and the `ValidationError` shape, casting vs validation, custom/async/cross-field validators, array validators, **why updates skip validators**, `unique` is not a validator, `validateSync`, and the three layers validation belongs in |
| `02-middleware.js` | `npm run lesson 13-validation-middleware-virtuals/02-middleware` | document vs query middleware and the `this` trap, execution order, `pre('validate')` vs `pre('save')`, `isModified`, the soft-delete query hook, why `findOneAndUpdate` skips `pre('save')`, error-handling middleware, what hooks are good and bad for |
| `03-virtuals-getters-setters.js` | `npm run lesson 13-validation-middleware-virtuals/03-virtuals-getters-setters` | virtuals aren't stored and **can't be queried**, opting in with `toJSON: { virtuals: true }`, getters and their traps, setters, virtual setters, `toJSON` transforms for hiding secrets, the `lean()` interaction, and how to choose between virtual / stored field / aggregation |

**Safety:** every write in this module targets temporary data — users whose
email ends `@lesson.test`, products with SKUs starting `ZZ-`, and throwaway
collections named `tmp_*`. All of it is deleted at the start (to clear a
crashed previous run) and again at the end. **No seeded document is ever
modified.**

---

## Topic: Validation

**What is it?** Rules attached to schema paths that Mongoose checks before
writing. Built-in ones (`required`, `min`, `maxlength`, `enum`, `match`) plus
custom functions, sync or async.

**Why does it exist?** (what problem it solves) MongoDB will store literally
anything. Without a validation layer, one bad request writes `age: -5` or
`role: "wizrd"` and every downstream query has to defend against it forever.
Validation makes bad data a *failed write* instead of a *permanent problem*.

**When should I use it?** For invariants that belong to the **data itself** —
rules that must hold regardless of which endpoint or script is writing. "An
order must have at least one item" is a data invariant. "The request body must
contain a `couponCode` field" is a request-shape rule, and belongs in your
route validator (Joi/zod), not the model.

**When should I avoid it?** For rules requiring data the document does not
have (validators cannot reliably query other collections during updates), for
anything expensive (validators run on every save), and for request-format
checks that would produce a clearer error earlier in the stack.

**Important terms**
- **`ValidationError`** — thrown when one or more validators fail. Its
  `error.errors` is an object keyed by **field path**, each with a `message` —
  map it straight to a 400 response body.
- **`CastError`** — thrown *before* validation, when a value cannot be
  converted to the schema type (`age: "abc"`). It appears inside
  `error.errors` too, so one handler covers both.
- **Casting** — Mongoose converting a value to the declared type. This is why
  `req.query.minPrice` (always a string) works in `find()`.
- **`runValidators`** — the option that makes update operations validate.
  **Off by default.**
- **`context: 'query'`** — makes `this` available in validators during an
  update. Even then `this` is the *query*, not the document.
- **`validateSync()` / `validate()`** — validate without saving. The sync form
  skips async validators.
- **`unique: true`** — **not a validator.** It asks Mongoose to build a unique
  **index**; MongoDB enforces it and rejects violations with error **11000**.

**Code example** — `01-validation.js`, section 5:

```js
// Silently accepted — validators do NOT run on updates by default:
await Product.updateOne({ _id: id }, { $set: { price: -9999 } });

// Rejected:
await Product.updateOne({ _id: id }, { $set: { price: -9999 } }, { runValidators: true });
```

**Expected result** — the first write succeeds and stores `-9999` despite the
schema's `min: 0`. The second throws a `ValidationError`.

**Common mistakes**
- **Assuming updates validate.** They do not. Either pass
  `{ runValidators: true }` everywhere, set it globally with
  `mongoose.set('runValidators', true)`, or load-modify-`save()` when
  correctness matters more than the extra round trip.
- **Expecting `required` to be checked on an update.** It cannot be — a field
  absent from the update is simply not examined.
- **Cross-field validators on updates.** `this` is not the document, so
  "endsAt must be after startsAt" silently stops working.
- **Treating a duplicate key as a `ValidationError`.** It arrives as a
  `MongoServerError` with `code: 11000`; check `error.keyPattern` to see which
  field collided.
- **Adding `unique: true` to a collection that already has duplicates.** The
  index build fails, and `syncIndexes()` reports it — clean the data first.
- **Relying on a single layer.** Route validators miss your own scripts;
  Mongoose validators miss `mongosh`; indexes cannot express business rules.

**Real-world usage** — the model layer of every MERN backend. Typically paired
with a route-level Joi/zod schema and an Express error handler that turns
`ValidationError` into a 400 with a field-keyed body.

**Related concepts** — [module 12](../12-indexes-and-performance/README.md)
(unique and partial indexes as real constraints),
[module 15](../15-errors-and-query-behavior/README.md) (catching and
translating every error type), [module 03](../03-mongoose-basics/README.md)
(where schema options were introduced).

---

## Topic: Middleware (hooks)

**What is it?** Functions that run automatically before (`pre`) or after
(`post`) an operation.

```js
schema.pre("save", function (next) { /* `this` is the DOCUMENT */ next(); });
schema.pre(/^find/, function (next) { /* `this` is the QUERY */ next(); });
schema.post("save", function (error, doc, next) { /* error handler */ });
```

**Why does it exist?** (what problem it solves) Some work must happen on
*every* write, no matter which code path triggered it. Hashing a password in
three different controllers is three chances to forget. A hook makes it
structural instead of a matter of discipline.

**When should I use it?** Password hashing, normalizing/deriving fields,
soft-delete filtering, audit trails, and keeping a denormalized copy in sync.

**When should I avoid it?** Slow work (every save waits for it — use a queue),
multi-collection cascades (nothing wraps them in a transaction, so a partial
cascade corrupts data), and complex business logic you would rather test
directly. Hooks fire implicitly, which makes debugging harder; use them for
cross-cutting concerns, not for the main story.

**Important terms**
- **Document middleware** — `validate`, `save`, `updateOne` (document
  version), `deleteOne` (document version). `this` is the **document**.
- **Query middleware** — `find`, `findOne`, `findOneAndUpdate`, `updateOne`
  (model version), `deleteMany`, `countDocuments`, … `this` is the **Query**.
  Use `this.getFilter()`, `this.getUpdate()`, `this.setOptions()`.
- **Aggregate middleware** — `pre('aggregate')`; `this` is the Aggregate, and
  `this.pipeline()` lets you inject stages.
- **`isNew`** — true on the first save.
- **`isModified(path)`** — whether a path changed. **Essential** in
  `pre('save')` password hashing, or you re-hash the hash every save.
- **Error-handling middleware** — a `post` hook with the signature
  `(error, doc, next)`. The right place to turn E11000 into a friendly
  message.
- **`next(err)` / throwing** — aborts the operation; nothing is written.

**Code example** — `02-middleware.js`, sections 1 and 4:

```js
schema.pre("save", function (next) {
  if (this.password && this.isModified("password")) {
    this.passwordHash = hash(this.password);
    this.password = undefined;
  }
  next();
});

// ⚠️ This does NOT trigger pre('save') — no document is ever loaded
await Account.findOneAndUpdate({ email }, { $set: { password: "plaintext" } });
```

**Expected result** — the lesson prints the exact hook execution order for a
`create()`, then shows that `findOneAndUpdate` fires only the *query* hooks.
The plaintext-password scenario is a real bug pattern, not a hypothetical.

**Common mistakes**
- **Using `this` as a document in query middleware.** `this.email` is
  `undefined` in `pre('findOneAndUpdate')`; the hook silently does nothing.
- **Password hashing only in `pre('save')`.** Any code path using
  `findOneAndUpdate` stores plaintext. Either hash in both places or forbid
  password updates via `findOneAndUpdate`.
- **Forgetting `isModified`.** Re-hashing an already-hashed password on every
  save breaks login.
- **Expecting hooks on `aggregate()` or the native driver.** They do not run.
- **Cascading deletes in a hook** without a transaction. A failure halfway
  leaves orphans.
- **Saving the same model inside its own `post('save')`.** Infinite loop.
- **Registering hooks after compiling the model.** `mongoose.model()` snapshots
  the schema — hooks added afterwards are ignored.

**Real-world usage** — the soft-delete `pre(/^find/)` filter and password
hashing are in nearly every production Mongoose codebase. Audit logging in
`post('findOneAndUpdate')` is common in regulated domains.

**Related concepts** — [module 07](../07-updates-and-deletes/README.md) (soft
delete), [module 09](../09-data-modeling/README.md) (denormalized copies that
hooks keep in sync), [module 14](../14-transactions-and-concurrency/README.md)
(why cascades need transactions), [module 15](../15-errors-and-query-behavior/README.md)
(error-handling middleware).

---

## Topic: Virtuals, getters, setters, and transforms

**What is it?**
- A **virtual** is a computed property that is never stored:
  `product.finalPrice`.
- A **getter** transforms a stored value on the way *out*.
- A **setter** transforms an assigned value on the way *in*, before storage.
- A **`toJSON` transform** reshapes the whole object at serialization time.

**Why do they exist?** (what problem they solve) Storing a derived value means
keeping two things in sync forever — and one missed update path means a
product displays the wrong price indefinitely. A virtual cannot drift because
there is nothing to drift. Transforms solve a different problem: making sure
`passwordHash` never reaches a response, without trusting every controller to
remember.

**When should I use them?**
- **Virtual** — display-only derived values: `finalPrice`, `fullName`,
  `isDeleted`, `ageInYears`.
- **Setter** — normalizing input: strip phone formatting, trim, lowercase.
- **`toJSON` transform** — hiding internal fields and renaming `_id` to `id`
  across every response.

**When should I avoid them?**
- **Never** use a virtual for a value users filter or sort by — MongoDB cannot
  see it. Compute it in an aggregation, or store it.
- **Getters** are best avoided in most codebases: they apply on read but *not*
  in queries, so `find({ amountPaise: 1499 })` searches raw stored values
  while `doc.amountPaise` returns the transformed one. Format in the response
  layer instead.

**Important terms**
- **Virtual** — `schema.virtual("x").get(fn)`; may also have `.set(fn)`.
- **`toJSON: { virtuals: true }`** — required, or `res.json(doc)` omits every
  virtual and your frontend gets `undefined`.
- **Virtual populate** — a virtual defined with `{ ref, localField,
  foreignField }`, letting `populate()` follow a reference stored on the
  *other* side (our `product.reviews`). Covered in module 10.
- **`transform(doc, ret)`** — runs last during serialization; mutate and
  return `ret`.
- **`select: false`** — a stronger alternative for secrets: the field is not
  even loaded unless you opt in with `.select("+passwordHash")`.
- **Instance method vs virtual** — a virtual is a *value*
  (`user.fullName`); a method is an *action*
  (`user.comparePassword(x)`).

**Code example** — `03-virtuals-getters-setters.js`, sections 2 and 7:

```js
// A virtual CANNOT be queried — this matches nothing:
await Product.find({ finalPrice: { $lt: 1000 } });

// The server-side equivalent that works:
await Product.aggregate([
  { $addFields: { finalPrice: { $multiply: ["$price", 0.8] } } },
  { $match: { finalPrice: { $lt: 1000 } } },
]);

// Hide secrets from every response, once:
toJSON: { transform(doc, ret) { delete ret.passwordHash; return ret; } }
```

**Expected result** — the virtual query returns `0`; the aggregation returns
real products. The transform output contains no `passwordHash`,
`internalNotes`, or `__v`.

**Common mistakes**
- **Querying or sorting by a virtual.** Silently returns nothing / no order.
- **Forgetting `toJSON: { virtuals: true }`.** The value exists in code and
  vanishes in the response.
- **Adding `.lean()` and losing every virtual, getter, and transform.** The
  most common "it worked yesterday" regression in this area.
- **Getters that also run on your own internal reads.** Double-converting
  units is a real and very confusing bug.
- **Using a virtual where you needed a stored, indexed field.** If users
  filter by it, it must exist in the database.

**Real-world usage** — `finalPrice` on a product, `fullName` on a user,
`isDeleted` from `deletedAt`, virtual-populated `reviews`, and a `toJSON`
transform that strips `passwordHash` and `__v` and renames `_id` to `id`.

**Related concepts** — [module 10](../10-populate-and-lean/README.md)
(`lean()` and virtual populate), [module 11](../11-aggregation/README.md)
(computing derived values the server can filter on),
[module 09](../09-data-modeling/README.md) (when to store a derived value
instead).

---

## Check yourself

1. Which of these are enforced by MongoDB rather than Mongoose: `required`,
   `unique`, `enum`, a TTL index, `min`?
2. Why does `updateOne({...}, { $set: { price: -5 } })` succeed despite
   `min: 0`, and what are your two options for fixing it?
3. In `pre('save')`, what is `this`? In `pre('findOneAndUpdate')`?
4. A colleague hashes passwords in `pre('save')`. Which code path stores
   plaintext anyway?
5. Why is `isModified('password')` essential in a password-hashing hook?
6. `Product.find({ finalPrice: { $lt: 1000 } })` returns nothing even though
   cheap products exist. Why, and what are your three options?
7. You add `.lean()` to an endpoint and `finalPrice` disappears from the
   response. Explain.
8. What is the difference between a `ValidationError` and error code 11000,
   and how should an API respond to each?

**Next:** [module 14 — Transactions & concurrency](../14-transactions-and-concurrency/README.md),
where several writes must succeed or fail together.
