# Module 03 — Mongoose basics: Schema, Model, Document — and who enforces what

Modules 01 and 02 were about MongoDB itself and about the pipe that connects
Node.js to it. This module is about the layer you will actually live in as a
MERN developer: **Mongoose**. When you finish this chapter you should never
again confuse a *schema* with a *model*, a *model* with a *collection*, or —
the mistake that causes real production bugs — a rule Mongoose checks **in
Node.js** with a guarantee the **database server** makes.

All three lessons are safe to run in any order, repeatedly. They only create
temporary data marked the bootcamp way: user emails ending `@lesson.test` and
temp collections named `tmp_*` — and they delete/drop that temp data at the
end (and at the start, in case an earlier run crashed). Seeded documents are
never modified.

| File | Run with | What it shows |
| --- | --- | --- |
| `01-schema-model-document.js` | `npm run lesson 03-mongoose-basics/01-schema-model-document` | Model anatomy, an unsaved document that already has an `_id`, `validate()`, `save()`, the Query object, instance vs static methods, `toObject()` |
| `02-schema-options-playground.js` | `npm run lesson 03-mongoose-basics/02-schema-options-playground` | `immutable`, `alias`, `select: false`, default-as-a-function, custom validators, `get`/`set` — on a throwaway model over `tmp_gadgets` |
| `03-validation-vs-db-constraints.js` | `npm run lesson 03-mongoose-basics/03-validation-vs-db-constraints` | `validateSync()` failing in Node with zero network; `unique` failing on the SERVER with E11000; the native driver bypassing the schema entirely |

---

## Topic: Mongoose — an ODM (and what "ODM" means)

**What is it?** Mongoose is an **ODM — Object–Document Mapper**: a library
that maps between the *objects* your JavaScript code works with and the
*documents* MongoDB stores. You describe the shape of your data once (a
schema), Mongoose compiles that into a class (a model), and from then on it
translates in both directions: JS objects going in are checked, typed, and
encoded; BSON documents coming out are wrapped back into rich JS objects.

Mongoose does not replace the official `mongodb` driver — it sits **on top of
it**. Every byte still travels through the driver and its connection pool
(module 02). The stack looks like this:

```
your code   →  Mongoose   (schemas, casting, validation, defaults,
                           middleware, populate, hydration)      — runs in Node
            →  mongodb    (BSON encoding, socket pool,
               driver      wire protocol, cursors)               — runs in Node
            →  TCP        →  mongod  (storage, indexes, unique
                              constraints, aggregation)          — runs on the server
```

**Why does it exist?** (what problem it solves) MongoDB is deliberately
**schemaless**: the server accepts any BSON document into any collection and
asks no questions. That flexibility is great for the database — and terrible
for an application, because application code is *never* schemaless: your
checkout code assumes `user.email` exists and is a string. Without Mongoose,
every one of those assumptions becomes a scattered `if` statement (or a
runtime crash). Mongoose moves all of them into one declared, readable place —
the schema — and enforces them automatically on every write that goes through
a model. On top of that foundation it adds casting, defaults, middleware
(hooks), virtuals, and `populate()`.

**When should I use it?** For a typical Node/Express backend with known data
shapes — i.e. almost every MERN project — Mongoose is the default choice: less
code, safer writes, self-documenting models.

**When should I avoid it?** Quick one-off scripts, data whose shape genuinely
varies per document (dynamic form builders, raw event dumps), or hot paths
where hydration overhead matters and you'd use the native driver or `lean()`
(module 10). Mongoose is also unnecessary if all you do is aggregation over
existing data — pipelines (module 11) largely bypass schemas anyway.

**Important terms**
- **ODM (Object–Document Mapper)** — maps app objects ⇄ database documents.
  Mongoose is one.
- **ORM (Object–Relational Mapper)** — the same idea for SQL databases
  (Sequelize, Prisma, Hibernate). "Relational" becomes "Document" because
  MongoDB stores documents, not rows.
- **Driver** — the low-level official client library (`mongodb` on npm) that
  speaks the MongoDB wire protocol. Mongoose wraps it.
- **Schemaless** — the server does not require documents in a collection to
  share a shape. The *server* is schemaless; your *app*, via Mongoose, is not.
- **Hydration** — wrapping a raw BSON document from the server into a full
  Mongoose Document instance with methods and change tracking.

**Code example** — every file in `src/models/` is a Mongoose schema+model;
lesson `01-schema-model-document.js` walks the User model layer by layer.

**Expected result** — after running lesson 01 you can point at any line of a
model file and say which of the five words below it belongs to.

**Common mistakes**
- Believing the schema protects the *database*. It does not — it protects
  writes that go **through your models, in your process**. Lesson 03 proves
  the native driver walks straight past it.
- Mixing up the names: **MongoDB** is the database server; **mongodb** (npm)
  is the driver; **Mongoose** is the ODM on top. Three different things.

**Real-world usage** — nearly every Express + MongoDB codebase you will join
has a `models/` folder exactly like this repo's: one schema+model per
collection, imported by routes, services, and seeders alike.

**Related concepts** — module 10 (`lean()` — opting out of hydration),
module 16 (using the native driver directly, side by side with Mongoose).

---

## Topic: The five words — Schema, Model, Document, Collection, Query

**What is it?** The complete cast of characters. Everything Mongoose does is
one of these five, and every bug report that starts with "Mongoose is weird"
usually dissolves once you name which one you're holding.

### Schema — the blueprint

A **Schema** is a plain configuration object built with
`new mongoose.Schema({...}, {...})`. It declares, for one kind of document:
which fields (called **paths**) exist, their types, their rules (`required`,
`min`, `enum`, ...), plus schema-level settings (`timestamps`, `collection`),
indexes, virtuals, and middleware. A schema is *pure description*: creating
one touches no database, opens no socket, creates no collection. It is cheap,
reusable (the address sub-schema in `src/models/schemas/address.schema.js` is
embedded by both User and Order), and inert until compiled into a model.

### Model — the compiled class

A **Model** is what `mongoose.model("User", userSchema)` returns: a real
JavaScript **class**, generated from the schema, bound to **one collection
name** and **one connection**. It plays two roles at once:

1. **Constructor** — `new User({...})` builds document instances.
2. **Collection gateway** — static methods (`User.find`, `User.create`,
   `User.updateOne`, ...) run operations against the whole collection.

**Why is it called a "model"?** The word comes from the MVC tradition (and
from ORMs like Rails' ActiveRecord and Django, which Mongoose deliberately
mirrors): the *model layer* is the part of an application that **models the
domain** — a simplified, structured representation of a real-world thing
(a user, an order) *plus the rules that govern it*. `User` doesn't just ferry
data; it owns what a valid user *is*. That is exactly what a Mongoose model
does, hence the name.

### Document — one record, alive in memory

A **Document** is an instance of a model class: the field values of one
record **plus** machinery — change tracking (`isModified`), state flags
(`isNew`), and methods (`save`, `validate`, `populate`, `toObject`).
Documents come into existence two ways: you construct one (`new User({...})`)
or a query **hydrates** one from BSON the server returned. Both kinds are
full documents; the only difference is `isNew`.

### Collection — the server-side bucket

A **Collection** is MongoDB's storage unit — it lives on the **server**,
holds BSON documents, and knows *nothing* about your schema. Think of it as a
SQL table with no column definitions. A model is bound to exactly one
collection; the collection is where indexes live and where the only true
database-level guarantees (like unique) are enforced.

### Query — the request under construction

A **Query** is the object that `User.find(...)`, `findOne`, `updateOne`,
etc. return *before* anything happens. It is a **builder**: `.where()`,
`.sort()`, `.limit()`, `.select()` each refine it and return it (that's why
chaining works). Nothing is sent to the server until you `await` it, call
`.exec()`, or attach `.then()` — a Query is a **thenable** (an object with a
`.then` method, which is all `await` needs). This is why you can build a
query in pieces, pass it around, and execute it last.

**Why does it exist?** (what problem it solves) Separating these five layers
gives each job one home: rules in the schema, collection access in the model,
per-record behavior in the document, server storage in the collection, and
request-building in the query. Blur them and you get the classic confusions —
"why didn't my collection get the new validator?" (collections never have
validators) or "why does `find()` work without `await`... sort of?" (you held
a Query, not results).

**When should I use it?** Use the vocabulary constantly — in code review, say
"that's a schema option" or "that's a document method", and half the
confusion in a Mongoose discussion disappears.

**When should I avoid it?** Not applicable — but avoid *inventing* extra
layers: e.g. wrapping every model in a hand-written "repository class" from
day one duplicates what models already are.

**Important terms**
- **Path** — Mongoose's word for a field defined in a schema, including
  nested ones (`"address.city"` is a path).
- **Compile** — turning a schema into a model class (`mongoose.model`).
- **Hydration** — BSON → Document instance (see previous topic).
- **Thenable** — any object with a `.then()` method; `await` accepts it.
  Queries are thenables, not real Promises (call `.exec()` if you want a true
  Promise).
- **Static (model) method** vs **instance (document) method** — `User.find`
  lives on the class; `user.save` lives on the instance. Lesson 01 §6 shows
  they don't cross over.

**Code example** — lesson `01-schema-model-document.js` end to end; the
five-way mapping in one line each:

```js
const userSchema = new mongoose.Schema({ ... });   // Schema    (Node, config)
const User = mongoose.model("User", userSchema);   // Model     (Node, class)
const prem = new User({ name: "Prem" });           // Document  (Node, instance)
// "users"                                         // Collection (server, storage)
const q = User.find({ role: "admin" });            // Query     (Node, builder)
const admins = await q;                            // ...executed + hydrated now
```

**Expected result** — lesson 01 prints `User.modelName` (`"User"`),
`User.collection.name` (`"users"`), shows `q instanceof mongoose.Query` as
`true` before execution, and query results reported as `instanceof User`.

**Common mistakes**
- Expecting the schema to exist "in MongoDB". It never leaves Node.
- Treating a Query like results: `const users = User.find()` without `await`
  gives you a builder, not an array. (Symptom: `users.map is not a function`.)
- Calling document methods on the model (`User.save()`) or statics on a
  document (`prem.find()`).
- Assuming a collection is created when you compile a model. It isn't —
  MongoDB creates collections lazily on the first insert (or index build).

**Real-world usage** — a typical Express handler touches all five in three
lines: the *model* builds a *query*, the results are *documents*, whose rules
came from the *schema*, over data in a *collection*.

**Related concepts** — next two topics: how compilation works, and what
executing a query actually does.

---

## Topic: How a schema becomes a model — and how the model finds its collection

**What is it?** The one-time setup step at the heart of every model file:

```js
const User = mongoose.model("User", userSchema);
```

**What does "compile" mean here?** `mongoose.model(name, schema)` builds a
brand-new class (extending Mongoose's internal `Model`), then walks the
schema and wires everything in: a property accessor per path (so `prem.email`
reads/writes tracked internal state, running getters/setters), the
validators, the defaults, the virtuals, the middleware hooks, and any
custom statics/methods you declared on the schema. The result is registered
under `"User"` in the **model registry** of the connection it belongs to —
by default, the global `mongoose.connection` that `connectDB()` opens
(module 02 explains why that just works everywhere).

Registering matters for two reasons. First, `ref: "User"` strings in *other*
schemas are resolved through this registry when you `populate()` — the string
must match a registered model name exactly. Second, a name can be registered
only **once**: compiling `"User"` twice throws `OverwriteModelError`. That is
why every model file in this repo ends with the guard:

```js
const User = mongoose.models.User || mongoose.model("User", userSchema);
```

`mongoose.models` is the registry itself — reuse the compiled model if a hot
reload or repeated import already created it.

**How does the model map to a collection?** Two ways:

1. **Automatic (the default):** Mongoose lowercases and **pluralizes** the
   model name: `"User"` → `users`, `"Category"` → `categories` (yes, it
   handles `y → ies`), `"Person"` → `people`. Lesson 01 calls the actual
   pluralizer (`mongoose.pluralize()`) so you can see it work.
2. **Explicit:** the schema option `collection: "users"` overrides the magic.
   Every model in this repo sets it even when it matches the automatic name —
   stating the collection removes a surprise for future readers.

Note what binding does **not** do: nothing is created in MongoDB at compile
time. The collection appears server-side on the first insert or index build.

**Why does it exist?** (what problem it solves) Compilation is what turns
*description* into *behavior* — a schema alone can't save anything. The
registry exists so models are defined once and referenced by name everywhere
(no circular-import nightmares between models that reference each other).
Pluralization exists purely as a convention borrowed from Rails: model names
are singular ("one User"), collections hold many ("users").

**When should I use it?** Define each model exactly once, in its own file
under `src/models/`, with the registry guard, and import it wherever needed.

**When should I avoid it?** Don't call `mongoose.model(...)` ad hoc inside
request handlers or utility functions — you'll eventually hit
`OverwriteModelError` or, worse, two subtly different schemas registered at
different times. Temp models in lesson files (like `TmpGadget` in lesson 02)
are the teaching exception, and even they use the guard.

**Important terms**
- **Model registry** — the per-connection map from model names to compiled
  models (`mongoose.models`).
- **`OverwriteModelError`** — thrown when a name is compiled twice.
- **Pluralization** — Mongoose's automatic model-name → collection-name rule.
- **Lazy collection creation** — MongoDB creates a collection on first write,
  not on model compilation.

**Code example** — lesson 01 §1 (`User.modelName`, `User.collection.name`,
the pluralizer); lesson 02 defines its own temp model bound to `tmp_gadgets`
via the `collection` option.

**Expected result** — `pluralize("User")` prints `users`,
`pluralize("Category")` prints `categories`, and `User.collection.name`
matches the schema's explicit `collection` option.

**Common mistakes**
- A `ref` string that doesn't match any registered model name (`ref: "user"`
  vs model `"User"`) — `populate()` throws `MissingSchemaError` at runtime.
- Relying on pluralization and then wondering why model `"Person"` reads
  from a `people` collection you didn't expect. When in doubt, set
  `collection` explicitly.
- "Fixing" `OverwriteModelError` by renaming the model instead of adding the
  `mongoose.models.X ||` guard.

**Real-world usage** — the registry guard is boilerplate you will see in
almost every Next.js + Mongoose codebase, where hot reloading re-imports
model files constantly.

**Related concepts** — module 02 (models bind to a *connection*; a
`createConnection` connection has its own empty registry), module 10
(populate resolves `ref` names through the registry).

---

## Topic: What actually happens when a model runs a query

**What is it?** The full journey of `await User.find({ age: "30" })`, in four
steps. Knowing the steps tells you *where* each kind of error can occur and
*which machine* does each piece of work.

**Step 1 — Build (Node, no I/O).** `User.find(filter)` constructs a `Query`
object and returns it immediately. Nothing has been validated, cast, or sent.
Chained calls (`.sort("-createdAt").limit(10).select("name email")`) just
record settings on that object. This is why queries compose so well — you can
`if`-branch extra conditions onto a query before executing it.

**Step 2 — Cast (Node, no I/O).** When execution is triggered (`await`,
`.exec()`, `.then()`), Mongoose walks the filter and **casts every value to
the schema type of its path**: `"30"` becomes the number `30` because
`age` is a `Number`; a 24-character hex string becomes an `ObjectId` for
`_id`; `"true"` becomes a boolean for `isActive`. If a value cannot be cast
(`{ age: "abc" }`), Mongoose throws a **`CastError`** — still in Node, the
server never contacted. Casting is why Mongoose queries are forgiving about
`req.query` strings while the native driver is not: BSON is typed, and
`{ age: "30" }` sent raw would match *no* documents whose age is the number
30.

**Step 3 — Send + execute (driver in Node, then the server).** The typed
filter is handed to the driver, which encodes the command as **BSON**, checks
a socket out of the connection pool (module 02), and sends it. The **server**
now does the real work: picks an execution plan (use an index, or scan the
collection — module 12), runs it against the collection, and streams matching
documents back as BSON, in batches, over a **cursor**.

**Step 4 — Hydrate (Node).** For each raw BSON document, Mongoose constructs
a full Document instance: attaches the schema, methods, virtuals, getters,
change tracking, and applies defaults for paths missing in the stored data
(without persisting them). Hydration is what lets you call `.save()` on a
query result — and it costs CPU and memory, which is exactly what `lean()`
skips (module 10).

**Why does it exist?** (what problem it solves) The split matters for
debugging: a `CastError` means step 2 (your filter is malformed — fix the
app); an `E11000` or timeout means step 3 (the server rejected or struggled);
"my virtual is missing" is a step 4 conversion question. One mental picture
kills three categories of confusion.

**When should I use it?** Recite the four steps whenever a query misbehaves,
and ask: which step did this error come from?

**When should I avoid it?** Don't fight step 1 by executing eagerly
"just in case" — building queries conditionally and executing once at the end
is idiomatic, not a hack.

**Important terms**
- **Casting** — converting filter/update values to the schema's types before
  sending. Mongoose-only behavior; the native driver sends what you give it.
- **`CastError`** — the Node-side error when casting is impossible.
- **BSON** — the binary, *typed* document format MongoDB speaks (module 01).
- **Cursor** — the server-side handle results stream through, batch by batch
  (you meet it directly in module 06's pagination lessons).
- **Hydration** — BSON → Document instance, step 4.

**Code example** — lesson 01 §5: a Query inspected before execution
(`q.getFilter()`), then executed; plus `findById` with a *string* id to watch
casting succeed.

**Expected result** — `q instanceof mongoose.Query` is `true`,
`q.getFilter()` prints the raw filter, and the string id finds the document —
proof Mongoose cast it to an ObjectId (the raw driver, given the same string,
would find nothing: a BSON string never equals a BSON ObjectId).

**Common mistakes**
- Forgetting `await` and treating the Query as results.
- Reading a `CastError` as a database problem — the server was never reached.
- Comparing `_id` values with `===` after querying: hydrated `_id`s are
  ObjectId *objects*; use `.equals()` or compare `.toString()`s.
- Assuming query results are plain JSON — they're documents until you
  `toObject()` / `toJSON()` / `lean()` them.

**Real-world usage** — the standard "list endpoint" builds one query from
`req.query` across 20 lines of conditional filters, sorts, and pagination,
then executes it once — pure step-1 composition.

**Related concepts** — module 05 (what you can put in filters), module 06
(projection/sort/pagination settings on the Query), module 12 (what the
server does in step 3), module 10 (`lean()` and step 4).

---

## Topic: Schema options — the complete tour

**What is it?** The full menu of per-field options (given in a path's
definition object) and schema-level options (the second argument to
`new mongoose.Schema(rules, options)`), each with the reason it exists.

**Why does it exist?** (what problem it solves) Every option below replaces a
piece of code you would otherwise write by hand in twenty places: an `if`
check, a normalization call, a hand-rolled `createdAt = new Date()`. Knowing
the menu keeps that logic declared in one line instead of scattered.

### Per-field options

**`type`** — the BSON-facing type of the path (`String`, `Number`, `Date`,
`Boolean`, `mongoose.Schema.Types.ObjectId`, arrays like `[String]`, nested
objects/sub-schemas). Exists because casting (query step 2) and every other
option need to know what the value *is*. The foundation everything else
stands on.

**`required`** — reject saving a document where this path is missing/empty.
Exists because "this field must exist" is the single most common data rule;
without it every consumer must null-check. Can carry a custom message:
`required: [true, "Product name is required"]`.

**`default`** — the value used when none is provided. A **plain value** is
evaluated once (when the schema file loads); a **function** is called once
*per new document* — which is the only correct choice for anything dynamic.
The classic trap: `default: Date.now` (function — fresh per doc) vs
`default: Date.now()` (one timestamp baked in at load time, stamped on every
document forever). Defaults are applied **in Node** at document creation and
then stored like any other field; they are also filled in, in memory only,
when you load an old document missing the path.

**`enum`** (strings/numbers) — restrict to a fixed set of values
(`["pending", "paid", ...]` on Order.status). Exists because "status" fields
otherwise collect typos (`"Pending"`, `"payed"`) that silently break every
filter.

**`min` / `max`** (numbers, dates) — range validation (`age: { min: 13 }`).
With array form for a message: `min: [13, "Users must be at least 13"]`.

**`minlength` / `maxlength`** (strings) — length validation. `maxlength`
also guards storage: a 2 MB "name" is almost certainly an attack or a bug.

**`trim`** (strings) — a **setter** that strips surrounding whitespace on
assignment. Exists because users paste spaces; `" a@b.c "` should equal
`"a@b.c"`.

**`lowercase` / `uppercase`** (strings) — setters that normalize case on
assignment. `email` is lowercased so lookups match regardless of how it was
typed; `sku` is uppercased for the same reason. Setters run when the value is
assigned — lesson 01 shows the document already normalized *before* save.

**`match`** (strings) — validate against a regular expression
(`match: [/^\S+@\S+\.\S+$/, "Invalid email format"]`). Its failure `kind` is
`regexp` — you'll see it in lesson 03's output.

**`immutable`** — once the document exists in the database, the field can
never change again: assignments are silently ignored and update operations
strip the path. Exists for identity-like fields (serial numbers, `createdBy`,
invoice numbers) where "changed later" always means "bug or fraud". A *new,
unsaved* document may still set it — otherwise it could never get a value.
Remember it is Mongoose-enforced: the native driver can still overwrite it.

**`enum`, `min`, `match`... and `unique`?** **No.** `unique` looks like a
validator and is listed by every tutorial next to them, but it is something
else entirely: **`unique: true` is an instruction to create a UNIQUE INDEX in
MongoDB**. Mongoose never checks uniqueness itself — it *cannot*, reliably
(see the validation topic below for the race condition). Violations arrive as
`MongoServerError` code 11000 from the **server**, not as a
`ValidationError`. This single fact is the most common Mongoose
misunderstanding in existence.

**`alias`** — a virtual second name for a stored field: store `codeName`,
read/write `doc.nickname`. Exists to let you keep *short stored keys* (bytes
are paid per document, millions of times) while code stays readable — or to
rename a field in code without migrating data. Queries use the real path by
default; `Model.translateAliases({...})` converts alias-keyed objects.

**`select: false`** — exclude the field from query results unless explicitly
re-added with `.select("+field")`. The field **is stored**; this only makes
Mongoose add a projection to every query. The canonical use: password hashes
that must never leak into an API response by accident. It is convenience, not
security — the native driver (or `.select("+password")`) sees it fine.

**`validate`** — a custom validator: `{ validator: fn, message }`. The
function returns `true`/`false` (or a Promise of one — async validators are
allowed, which is why `doc.validate()` is async). The message can be a
function receiving `props.value` for precise errors. Exists for every rule
the built-ins can't express ("warranty must be a multiple of 6", "an order
needs at least one item" — see Order.items).

**`get` / `set`** — transform values at the field level. `set` runs on
assignment (what gets **stored**); `get` runs on property access (what code
**sees**). Lesson 02 stores integer paise but exposes rupees — the standard
trick for money, since floats can't represent `0.1` exactly. Two gotchas:
getters do **not** run in `toObject()`/`toJSON()` unless you pass/configure
`{ getters: true }`, and `trim`/`lowercase`/`uppercase` are just built-in
setters.

### Schema-level options (the second argument)

**`timestamps`** — adds `createdAt` and `updatedAt` Date paths and maintains
them automatically on saves *and* update operations. Exists because "when was
this changed?" is asked of every collection eventually, and hand-maintained
timestamps are always forgotten somewhere. All five models here use it.

**`versionKey`** — controls the `__v` field Mongoose adds to documents. It is
an internal version number used to detect conflicting concurrent
modifications (optimistic concurrency — module 14) and to guard certain array
operations. This repo disables it (`versionKey: false`) everywhere except
Order, where module 14 teaches with it. Disable it when you don't use
versioning and don't want the noise; never disable it "because it looks
weird" on a model where you *do* rely on it.

**`collection`** — the explicit collection name, overriding pluralization
(previous topic).

**`toJSON` / `toObject`** — default settings for the two conversion methods.
`toObject()` you call yourself; `toJSON()` is called *implicitly* by
`JSON.stringify` — which means by `res.json(doc)` in Express. That implicit
call is why these options matter so much in APIs: Product sets
`toJSON: { virtuals: true }` so `finalPrice` appears in responses without any
route code. Both also accept a `transform` function — the standard place to
delete `password` or rename `_id` to `id` for clients (module 13).

**`_id: false`** (sub-schemas) — skip generating `_id` for embedded
documents that are never addressed individually (the address sub-schema, and
Order's line items).

### Who enforces what — the table to memorize

| Schema option | Enforced by | Notes |
| --- | --- | --- |
| `type` (casting) | **Mongoose (Node)** | the server stores whatever BSON arrives |
| `required`, `enum`, `min`/`max`, `minlength`/`maxlength`, `match`, `validate` | **Mongoose (Node)** | run on `save`/`create`/`validate`; for update operations only with `runValidators: true` |
| `default` | **Mongoose (Node)** | computed in Node, then stored as a normal field |
| `trim`, `lowercase`, `uppercase`, `set` | **Mongoose (Node)** | setters — transform at assignment time |
| `get`, `alias`, virtuals | **Mongoose (Node)** | read-time only; nothing extra stored |
| `immutable` | **Mongoose (Node)** | the native driver can still change the field |
| `select: false` | **Mongoose (Node)** | a default projection, not access control |
| `timestamps`, `versionKey` | **Mongoose (Node)** | the *fields* are stored, the *maintenance* is Mongoose's |
| `unique` | **MongoDB server** | Mongoose only *creates the index*; the server enforces it (E11000) |
| `index`, TTL, text indexes declared in schemas | **MongoDB server** | declared in Node, built and used on the server |

Everything in the "Mongoose (Node)" rows evaporates the moment a write skips
your models. Only the last two rows are guarantees the *database* makes.

**When should I use it?** Reach for an option before writing manual code in a
route: if you are normalizing, defaulting, or checking a field by hand in a
handler, a schema option probably already does it.

**When should I avoid it?** Don't encode *business workflow* in schema
options (e.g. "status can only go pending→paid" is middleware/service logic,
not an `enum`'s job), and don't pile on validators so strict that legitimate
migrations and admin fixes become impossible.

**Important terms**
- **Setter** — a function run when a value is assigned (`trim`, `lowercase`,
  custom `set`). Changes what is *stored*.
- **Getter** — a function run when a value is read (custom `get`). Changes
  what is *seen*.
- **Validator** — a check run at validation time; failure produces a
  `ValidationError`.
- **Projection** — the set of fields a query returns (`select`); module 06.
- **Optimistic concurrency** — detecting conflicting parallel edits via a
  version number (`__v`); module 14.

**Code example** — lesson `02-schema-options-playground.js` defines a temp
model on `tmp_gadgets` exercising `immutable`, `alias`, `select: false`,
function defaults, `get`/`set`, and a custom validator, and demonstrates each
behavior with printed proof (including a raw-driver read showing that
`select: false` data really is stored).

**Expected result** — lot numbers 1 and 2 (function default ran per
document); a "HACKED" serial that never sticks; `nickname` reading and
writing `codeName`; `secretNote` invisible to a normal query, visible with
`.select("+secretNote")`, present in the raw driver read; `price` printing
`499.99` while `toObject()` shows `49999`; a custom error message carrying
the offending value.

**Common mistakes**
- `default: Date.now()` instead of `default: Date.now`.
- Expecting `select: false` to be security. Anyone with DB access — or any
  query with `+field` — reads it.
- Expecting `unique` to produce a `ValidationError` (it's a server error,
  code 11000 — next topic).
- Forgetting `{ getters: true }` and shipping raw stored values (paise!) in
  an API response.
- Adding `unique: true` to a collection that already contains duplicates —
  the index build fails on the server; you must deduplicate first.

**Real-world usage** — a production User model routinely combines half this
menu on two fields alone: `email` (`required`, `unique`, `lowercase`,
`trim`, `match`) and `password` (`required`, `minlength`, `select: false`).

**Related concepts** — module 13 goes deeper on validators, getters/setters
and `toJSON` transforms; module 12 covers the indexes that `unique` and
`index` create.

---

## Topic: Mongoose validation vs database constraints

**What is it?** The two fundamentally different kinds of data rules:

- **Validation** — checks Mongoose runs **in your Node.js process** before
  sending anything: `required`, `enum`, `min`/`max`, length rules, `match`,
  custom validators. Failure = `ValidationError` (a Mongoose class), holding
  one entry per failing path in `err.errors`, each with a `kind` (`required`,
  `enum`, `min`, `regexp`, `user defined`) and a message.
- **Constraints** — guarantees the **MongoDB server** enforces, regardless of
  which client writes: in practice, **unique indexes** (from `unique: true`
  or `schema.index({...}, { unique: true })`). Failure = `MongoServerError`
  with `code: 11000` (the famous **E11000 duplicate key error**), carrying
  the offending value in `err.keyValue`.

**Why does it exist?** (what problem it solves) Why not enforce everything in
one place? Because each side can only do what it can do:

- *Validation must be app-side* to be rich and cheap: arbitrary JS logic,
  friendly messages, no server round-trip for obviously bad input.
  (`validateSync()` in lesson 03 is *synchronous* — and since network I/O in
  Node can never happen synchronously, that alone proves no server was
  involved.)
- *Uniqueness must be database-side* because of a **race condition** no app
  code can beat: two simultaneous requests each check "does this email
  exist?", each see "no", and each insert. Only the database — which orders
  all writes against the index — can serialize that decision. This is why the
  review model's "one review per (product, user)" rule is a unique compound
  *index*, not a validator.

And the third piece, proven in lesson 03: **the schema binds nobody but your
own process.** A write through the native driver
(`mongoose.connection.db.collection(...)`) skips casting, defaults,
setters, validators, middleware — everything. MongoDB happily stores
`{ email: 42, role: "superhero" }`. Any invariant that must hold for *every*
writer needs to live in the database: a unique index, or (beyond this
bootcamp's scope) MongoDB's optional server-side `$jsonSchema` collection
validator.

One more trap that belongs here: **update operations skip validators by
default.** `User.updateOne({...}, { age: 7 })` will happily write `7` unless
you pass `{ runValidators: true }`. Document saves validate always; updates
opt in. Module 13 drills this.

**When should I use it?** Both, deliberately: validation for *every* field
rule (fast, friendly errors), plus a database constraint for every invariant
that must survive concurrency and non-Mongoose writers (uniqueness above
all). They are complements, not alternatives.

**When should I avoid it?** Avoid *duplicating* uniqueness in app code (a
`findOne`-then-insert check) as your only guard — it is the race condition
above. A pre-check is fine as a fast, friendly first line, but the index
must exist behind it.

**Important terms**
- **`ValidationError`** — Mongoose's Node-side failure; inspect `err.errors`
  per path.
- **`validateSync()` / `validate()`** — run all validators without saving;
  sync version returns the error, async version rejects (async custom
  validators need it).
- **`MongoServerError`** — an error the *server* returned; `code` identifies
  which. `11000` = duplicate key.
- **E11000** — the duplicate-key error string you will grep logs for one day.
- **Race condition** — two operations interleaving so that a
  check-then-act sequence acts on stale information.
- **`Model.init()`** — resolves when Mongoose has finished building the
  schema's declared indexes in MongoDB; lesson 03 awaits it before testing
  uniqueness (an index that doesn't exist yet enforces nothing).

**Code example** — lesson `03-validation-vs-db-constraints.js`:
`validateSync()` catching four broken rules with zero network; a duplicate
email passing validation and dying on the server with 11000; the native
driver inserting garbage into `tmp_no_rules` unchallenged — and then hitting
E11000 anyway when it tries a duplicate email on `users`, because the index
lives in the database.

**Expected result** — section 1 prints the four failing paths with kinds
`required`, `regexp`, `min`, `enum`; section 3 prints
`second.validateSync()` as `undefined` (Mongoose satisfied!) followed by
`MongoServerError` / `11000` / `{ email: "duplicate.check@lesson.test" }`;
section 4 prints the stored garbage document; section 5 prints `11000` again
with no Mongoose involved.

**Common mistakes**
- Catching duplicate emails with `err instanceof ValidationError` — it never
  matches; check `err.code === 11000`.
- Testing `unique` right after adding it and concluding it "doesn't work" —
  the index hadn't finished building (or duplicates blocked the build).
  `Model.init()` or `syncIndexes()` first.
- Two documents *without* the field both count as `email: null` to a unique
  index and collide — use a sparse/partial index for optional unique fields
  (module 12).
- Believing dropping the *collection* keeps the index. Dropping a collection
  drops its indexes; recreate them (reseed, or `syncIndexes()`).
- Forgetting `runValidators: true` on updates and shipping invalid data with
  perfectly green tests that only used `save()`.

**Real-world usage** — production signup code shows the full pattern: a
`match`/`required` validation catches bad emails instantly in Node; the
unique index catches the 1-in-a-million concurrent duplicate; and the route
maps `code === 11000` to a friendly HTTP 409 "email already registered".

**Related concepts** — module 12 (indexes, sparse/partial uniqueness),
module 13 (custom/async validators, update validators), module 14 (what else
only the database can guarantee under concurrency), module 15 (handling
every error class properly), module 16 (the native driver, deliberately).

---

## Mongoose vs MongoDB — who does what in this module

| Behavior | Lives in |
| --- | --- |
| Schema, model compilation, model registry, pluralization | **Mongoose** (Node.js) |
| Casting, validation, defaults, setters/getters, aliases, `immutable`, `select: false`, virtuals, timestamps maintenance, hydration | **Mongoose** (Node.js) |
| BSON encoding, socket pool, cursors | **MongoDB Node driver** (the `mongodb` package Mongoose wraps) |
| Client-side ObjectId generation | **Driver** (in Node — no round-trip needed for `_id`) |
| Storage, collections (created lazily), index builds, **unique enforcement (E11000)**, query execution plans | **MongoDB server** (`mongod`) |

If you remember one sentence from this module: *the schema is a promise your
Node process makes to itself; only indexes are promises the database makes to
everyone.*
