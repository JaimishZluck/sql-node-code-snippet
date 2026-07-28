# Module 18 — Production & security

The last module. Everything between "it works on my machine" and "it works at
3am under load, with real users, and without leaking anything."

Two halves:

1. **Security** — NoSQL injection is real, common, and takes one `curl`
   command. It works precisely because developers believe "no SQL, no
   injection."
2. **Operations** — secrets, connection hardening, least privilege, replica
   sets and failover, sharding, backups, and monitoring.

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-query-injection.js` | `npm run lesson 18-production-and-security/01-query-injection` | operator injection in a login (performed live against the seeded data), regex DoS, `$where`, why schemas are not enough, type coercion, request validation, allow-lists, `express-mongo-sanitize`, mass assignment, and an endpoint checklist |
| `02-safe-patterns.js` | `npm run lesson 18-production-and-security/02-safe-patterns` | secrets handling, connection-string options, database roles and least privilege, replica sets and a step-by-step failover, sharding and shard-key choice, backups, monitoring, production Mongoose settings, and a full deployment checklist |

**Safety:** both lessons are **100% read-only**. The injection lesson performs
real attacks against the seeded data to show that they work, but only ever
*reads*.

---

## Topic: NoSQL injection

**What is it?** Sending a MongoDB **operator** where your code expects a
**value**, changing the meaning of a query.

```js
// The vulnerable code — looks completely normal:
User.findOne({ email: req.body.email, isActive: req.body.isActive });

// The request:
{ "email": { "$ne": null }, "isActive": { "$ne": false } }

// The filter that actually runs:
{ email: { $ne: null }, isActive: { $ne: false } }   // → matches ANY user
```

**Why does it exist?** (what problem it causes) MongoDB filters are
**objects**, and JSON request bodies parse into objects. No string
concatenation is involved — which is exactly why the SQL intuition ("I'm not
building a string, so I'm safe") fails. An attacker who knows no email and no
password gets a session as whichever user comes first, and by targeting
`{ role: "admin" }` they can choose their victim.

**When am I vulnerable?** Whenever a request value reaches a query without
being coerced or validated. Login endpoints are the classic target, but any
filter built from `req.body`, `req.query`, or `req.params` qualifies.

**The attack surface**

| Attack | Payload | Effect |
| --- | --- | --- |
| **Operator injection** | `{"email": {"$ne": null}}` | authentication bypass, data enumeration |
| **Regex DoS** | `{"name": {"$regex": "^(a+)+$"}}` | CPU pinned; unindexed full scan |
| **`$where` injection** | `{"$where": "while(true){}"}` | arbitrary JS on the **database server** |
| **Mass assignment** | `{"role": "admin"}` in a signup body | privilege escalation |
| **Sort/projection injection** | `?sort=<any field>` | forced unindexed sort; schema disclosure |

**The defences, in order of value**

**1. Coerce the type at the boundary.** One line, and the whole class
disappears:

```js
const email = String(req.body.email ?? "").toLowerCase().trim();
// An injected object becomes the string "[object Object]" — matches nothing.
```

**2. Validate the request shape** with Joi or zod (this repo already ships
Joi). `Joi.string().email()` rejects `{ $ne: null }` before any query runs,
and the client gets a clear 400 instead of a confusing 401.

**3. Allow-list anything that selects behaviour** — sort keys, projections,
filter field names:

```js
const SORTS = { "price-asc": { price: 1 }, newest: { createdAt: -1 } };
Product.find().sort(SORTS[req.query.sort] ?? { createdAt: -1 });
```

**4. Pick write fields explicitly.** `User.create({ ...req.body })` lets an
attacker set `role`. Mongoose's strict mode only drops fields *outside* the
schema — `role`, `isActive`, and `loyaltyPoints` are all in it.

**5. Add a safety net**: `express-mongo-sanitize` strips or replaces keys
starting with `$` or containing `.`. Use `replaceWith: "_"` rather than
deleting, so attacks stay visible in logs. This is defence in depth, **not**
the primary defence.

**6. Never accept a client regex.** Build your own from an escaped string and
anchor it (`new RegExp("^" + escapeRegex(term))`), which can also use an index.
For real search, use `$text` (module 12).

**7. Replace `$where` with `$expr`** and disable server-side JavaScript
(`mongod --noscripting`).

**Important terms**
- **Operator injection** — an object where a scalar was expected.
- **Type coercion** — `String(v)`, `Number(v)`, allow-list lookup. The
  cheapest and most effective fix.
- **Mass assignment** — spreading a request body into a model so the client
  chooses which fields get written.
- **Catastrophic backtracking** — a regex whose worst case is exponential.
- **Defence in depth** — layered protections, so one gap is not fatal.

**Code example** — `01-query-injection.js`, sections 2 and 6. The lesson runs
the attack, shows it succeeding against the seeded users, then runs the same
handler with `String()` coercion and shows it failing.

**Expected result** — the vulnerable login returns a real user for a payload
containing no credentials at all. The coerced version returns `null`.

**Common mistakes**
- **"MongoDB can't be injected."** The belief is the vulnerability.
- **Trusting Mongoose schemas to stop it.** `{ email: { $ne: null } }` is
  valid query syntax against a `String` field.
- **Sanitizing only `req.body`.** `req.query` and `req.params` reach filters
  too.
- **Validating but not coercing.** A validator that accepts `any` is not a
  defence.
- **Trusting `userId` from a request body** instead of the authenticated
  session.
- **No rate limit on login.** Injection plus unlimited attempts is a very
  short path to a breach.

**Real-world usage** — every public endpoint. This repo's `src/validators/`
and `express-rate-limit` are the two pieces that belong in front of every
route that touches user input.

**Related concepts** — [module 13](../13-validation-middleware-virtuals/README.md)
(the three validation layers), [module 15](../15-errors-and-query-behavior/README.md)
(not leaking internals in errors),
[module 17](../17-api-patterns/README.md) (allow-lists and id validation in
working code).

---

## Topic: Secrets and connection hardening

**What is it?** Where credentials live, and which connection-string options
you should set on purpose rather than inherit.

**Why does it exist?** (what problem it solves) The most common MongoDB breach
is not an exploit — it is a cluster exposed to the internet with no
authentication, or a connection string committed to a public repository. Both
are configuration mistakes.

**Important terms**
- **`.env` + `dotenv`** — how this repo loads configuration
  (`node -r dotenv/config`). `.env` is git-ignored; `.env.example` documents
  the shape with no real values.
- **Fail-fast validation** — `src/config/env.config.js` makes `MONGO_URI`
  required with Joi, so a missing variable kills the process at boot instead
  of at 3am on the first query.
- **Redaction** — never log a URI with its password. Replace it before
  printing.
- **Secret manager** — AWS Secrets Manager, Vault, Kubernetes Secrets. What
  production should use instead of a file on disk.

**Connection-string options worth setting deliberately**

| Option | Why |
| --- | --- |
| `retryWrites=true` | retry a single-document write once across a failover |
| `w=majority` | acknowledge only when a majority has it — survives failover |
| `maxPoolSize=10` | per **process**; multiply by process count |
| `serverSelectionTimeoutMS=5000` | fail fast instead of hanging 30s |
| `waitQueueTimeoutMS=5000` | fail fast when the pool saturates |
| `tls=true` | always, off localhost |
| `appName=my-service` | makes "which service is doing this?" answerable in logs |

**Least privilege** — your application should connect as a user with
`readWrite` on **one** database. Never `root`. With `root`, one injection or
one bug can drop the cluster; with `readWrite`, the same bug is contained.
Separate users per service so a compromise of one does not grant access to
another's data.

**Common mistakes**
- **Hardcoding a credential.** It is then in every clone, every branch, and
  your git history forever. Rewriting history does not un-leak it — rotate.
- **Logging the connection string.** It contains the password.
- **`0.0.0.0/0` in an Atlas IP access list.** "The entire internet may attempt
  to authenticate."
- **Running `mongod` without `--auth`.** Anyone who can reach the port is an
  admin.
- **Sending `error.message` to clients.** Leaks schema paths, index names, and
  occasionally the URI.

**Related concepts** — [module 02](../02-connections/README.md) (pool sizing
and connection options), [module 15](../15-errors-and-query-behavior/README.md)
(safe error responses).

---

## Topic: Replica sets, failover, and sharding

**What is it?** A **replica set** is a group of servers holding the same data:
one **primary** takes all writes, **secondaries** replicate from its oplog.
**Sharding** splits one collection across many servers by a **shard key**.

**Why do they exist?** Replication provides availability (automatic failover)
and durability (`w: majority`). Sharding provides horizontal scale when one
machine is no longer enough.

**When should I use a replica set?** Always in production. It is also the
prerequisite for transactions (module 14) and change streams (module 16). Use
**at least 3 data-bearing members** — a majority is required to elect a
primary, and two members cannot form a majority when one dies.

**When should I shard?** Later than you think. The genuine signals: data
exceeds one machine's disk, the working set exceeds RAM, or write throughput
exceeds one primary. Under a few hundred GB, add indexes and fix queries
first — sharding adds real operational complexity.

**A failover, step by step**

1. The primary stops responding to heartbeats.
2. The remaining members hold an **election** (typically 2–12 seconds).
3. The secondary with the most recent oplog becomes primary.
4. The driver detects the change and reconnects automatically.
5. Retryable writes are retried; others surface as errors.
6. **Writes acknowledged with `w: 1` that never replicated are rolled back.**

Step 6 is why `w: majority` matters: it is what makes "we told the user it
succeeded" true afterwards.

**Choosing a shard key** — the decision you cannot undo cheaply:

- **High cardinality** — many distinct values, or chunks cannot split.
- **Even write distribution** — a monotonically increasing key (a timestamp,
  an ObjectId) sends **every** write to one shard.
- **Matches your queries** — a query without the shard key is broadcast to
  every shard, eliminating the benefit.

Good: `{ customerId: 1, orderDate: 1 }`, or a hashed key for pure
distribution. Bad: `{ createdAt: 1 }` (hot shard), `{ status: 1 }` (five
values, no room to split).

**Important terms**
- **Oplog** — a capped collection of every write. Secondaries replay it;
  change streams and point-in-time backups read it. Its **window** is how far
  back it reaches; too short and a lagging secondary needs a full resync.
- **Arbiter** — a voting member with no data. Cheap, but it cannot become
  primary — prefer a real third node.
- **Replication lag** — how far behind a secondary is. Why secondary reads
  break "read your own writes".
- **`mongos`** — the query router in a sharded cluster.
- **Chunk** — a contiguous range of shard-key values; the unit of balancing.

**Common mistakes**
- **Treating replication as a backup.** A `DROP` replicates in milliseconds.
- **A 2-member replica set.** No majority when one fails.
- **Reading from secondaries after a user's own write.**
- **Sharding to avoid adding an index.** Almost every "we need to shard"
  conversation is a missing index or a modelling problem.
- **A monotonically increasing shard key.** All writes hit one shard; you have
  paid for complexity and gained nothing.

**Related concepts** — [module 14](../14-transactions-and-concurrency/README.md)
(write/read concerns and what a failover does to them),
[module 12](../12-indexes-and-performance/README.md) (the fix that usually
precedes sharding).

---

## Topic: Backups, monitoring, and the deployment checklist

**Backups**

| Method | Notes |
| --- | --- |
| `mongodump` / `mongorestore` | logical, portable, slow on large data. Fine to tens of GB. |
| Volume snapshots | fast, but must be **atomic** across the whole volume |
| Atlas continuous backup | point-in-time restore from the oplog |

The parts people skip: **test your restores** (an untested backup is a
hypothesis), know your **RPO/RTO** before you need them, store backups
elsewhere, and encrypt them — a backup is a complete copy of your data with
none of your access controls.

**Monitoring — what to watch**

- **Slow query log** — `db.setProfilingLevel(1, { slowms: 100 })`, then read
  `system.profile`.
- **Connection count** — saturation looks exactly like slow queries.
- **Replication lag** — `rs.printSecondaryReplicationInfo()`.
- **Working set vs RAM** — the single biggest cliff in MongoDB performance.
- **`$indexStats`** — find and drop indexes nobody uses.
- **Oplog window** — how much failover headroom you have.

**Application-side production settings**

```js
mongoose.connect(uri, { autoIndex: false });   // ← the big one
```

With `autoIndex` left on (the default), a schema change triggers an index
build on a live collection at startup. Run `Model.createIndexes()` as a
deliberate deploy step instead — and **not** `syncIndexes()`, which drops
indexes the schema does not declare, including the emergency one someone added
during an incident.

Also: `maxTimeMS` on user-facing queries, a hard cap on client-supplied
`limit`, a graceful-shutdown handler, a database-aware health check,
structured logs with request ids, and rate limiting on auth endpoints.

**The checklist** — printed in full by `02-safe-patterns.js`, section 9,
grouped into security / reliability / performance / observability.

---

## Check yourself

1. Why is `User.findOne({ email: req.body.email })` dangerous, and what is the
   one-line fix?
2. Why don't Mongoose schemas stop operator injection?
3. `User.create({ ...req.body })` — what is the attack, and why doesn't strict
   mode prevent it?
4. Why must a sort parameter come from an allow-list?
5. Why is a 2-member replica set a bad idea?
6. During a failover, which writes can be lost, and what setting prevents it?
7. Why is `{ createdAt: 1 }` a bad shard key?
8. Why should `autoIndex` be `false` in production, and what runs instead?
9. Name two reasons replication is not a backup.

---

## You have finished the bootcamp

Eighteen modules, from "what is a document" to "how do I run this safely."
You can now:

- **model** — decide what to embed, what to reference, and what to duplicate
  on purpose
- **query** — every operator, projection, sort, and both pagination strategies
- **aggregate** — pipelines, `$group`, `$unwind`, `$lookup`, `$facet`, and the
  expression language
- **optimize** — read `explain()`, choose index types and field order, spot
  N+1
- **protect** — validation at three layers, middleware, transactions, and
  concurrency-safe writes
- **operate** — connections and pooling, errors, the native driver, and this
  checklist
- **build** — the API in [module 17](../17-api-patterns/README.md) is yours to
  extend

**Where to go next:** MongoDB University (free, including an M0 Atlas tier),
the official documentation (genuinely excellent — start with *Data Modeling*
and *Indexes*), and the Mongoose docs for the Node.js specifics.

Then go and build something. The modelling instincts from
[module 09](../09-data-modeling/README.md) only really form when the schema is
yours.

Every lesson stays runnable: `npm run lesson` lists them all, and
`npm run db:seed` restores the data whenever you want a clean start.
