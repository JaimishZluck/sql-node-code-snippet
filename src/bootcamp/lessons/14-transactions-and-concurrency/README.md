# Module 14 — Transactions & concurrency

Two requests arrive at the same millisecond. Both want to buy the last item in
stock. What happens?

That question has three good answers in MongoDB and one very bad one, and this
module works through all of them. It also covers the guarantees behind the
word "saved" — because "the write succeeded" can mean anything from "a server
received some bytes" to "a majority of machines have it on disk".

## Before anything else: the two big ideas

**Idea 1 — a single-document write is already atomic.** No transaction
needed. `updateOne` touching twelve fields across three nested objects either
happens completely or not at all, and no other client can observe a partial
state. This covers far more cases than SQL habits suggest — and it is exactly
why our orders **embed** their line items: writing an order is one atomic
write, not a parent insert plus N child inserts.

**Idea 2 — most "database corruption" is a race in application code.** The
pattern below is not a MongoDB flaw; it is broken in every database ever
written:

```js
const product = await Product.findById(id);     // reads stock = 100
product.stock = product.stock - 1;              // computes 99 in Node.js
await product.save();                           // writes 99
```

Twenty concurrent requests all read `100`, all compute `99`, and all write
`99`. You sold twenty units and your inventory says you sold one. Nothing
errors. Nothing logs. Lesson 03 reproduces this for real.

## Transactions need a replica set

A standalone `mongod` **cannot** run transactions — they rely on the
replica-set oplog to coordinate and roll back. Lessons 01 and 02 detect this
and print setup instructions instead of crashing; lessons 03 and 04 work
everywhere.

**One-node replica set, locally:**

```bash
# 1. stop mongod, then start it with the replSet flag
mongod --dbpath <your-data-dir> --replSet rs0

# 2. initiate the set once, from mongosh
mongosh --eval "rs.initiate()"

# 3. point .env at it
#    MONGO_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0

# 4. reseed and run the lessons
npm run db:seed
```

On Windows, add this to `mongod.cfg` and restart the MongoDB service instead:

```yaml
replication:
  replSetName: rs0
```

**Docker:**

```bash
docker run -d --name mongo-rs -p 27017:27017 mongo:7 --replSet rs0
docker exec mongo-rs mongosh --eval "rs.initiate()"
```

**Atlas** clusters are replica sets already — nothing to do.

## The lessons

| File | Run with | What it covers |
| --- | --- | --- |
| `01-sessions-and-transactions.js` | `npm run lesson 14-transactions-and-concurrency/01-sessions-and-transactions` | what a session is, replica-set detection with setup instructions, a committed transaction, isolation (inside vs outside views), an aborted transaction, the rules and costs, and **when you don't need one** |
| `02-with-transaction.js` | `npm run lesson 14-transactions-and-concurrency/02-with-transaction` | `withTransaction` vs the manual dance, automatic retry of transient errors, a realistic `placeOrder` service, rollback on business failure, 6 concurrent transactions on one product, transaction options, the production shape |
| `03-concurrency-and-versioning.js` | `npm run lesson 14-transactions-and-concurrency/03-concurrency-and-versioning` | **a lost update, reproduced**, then three fixes: atomic operators, conditional updates, and optimistic concurrency with retry; Mongoose's `__v` and `VersionError`; optimistic vs pessimistic; idempotency keys |
| `04-write-read-concerns.js` | `npm run lesson 14-transactions-and-concurrency/04-write-read-concerns` | write concern (`w`, `j`, `wtimeout`), read concern (`local`/`majority`/`linearizable`/`snapshot`), read preference, read-your-own-writes, what happens during a failover, sensible defaults per workload |

**Safety:** every write in this module uses temporary documents — products
with SKUs starting `ZZ-` and orders with numbers starting `ZZZ-` — removed at
the start (clearing any crashed run) and again at the end. **Seeded stock and
orders are never permanently changed.**

---

## Topic: Transactions and sessions

**What is it?** A transaction makes several writes atomic across documents and
collections: all of them commit, or none do.

```js
const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    await Product.updateOne({ _id, stock: { $gte: qty } }, { $inc: { stock: -qty } }, { session });
    await Order.create([orderDoc], { session });       // ← ARRAY form
  });
} finally {
  await session.endSession();
}
```

**Why does it exist?** (what problem it solves) Some invariants span
documents. Decrementing stock and inserting the order must both happen or
neither: a crash in between leaves stock reduced for an order that does not
exist, and nothing in the data records that anything went wrong.

**When should I use it?** When a real invariant spans documents — money
moving between accounts, stock plus order plus payment record, anything where
a partial result is corruption rather than an inconvenience.

**When should I avoid it?** More often than you think:
- **One document changes** → already atomic.
- **Several documents, but eventual consistency is acceptable** → write one,
  then the other, and reconcile on failure.
- **Two collections that must *always* change together** → ask whether they
  should be one document. That is usually the better fix.

Transactions cost real performance, add contention (`WriteConflict` retries),
and require every caller to thread a session through.

**Important terms**
- **Session** — the context grouping operations. Created with
  `mongoose.startSession()`. Every operation in the transaction must receive
  `{ session }`.
- **`withTransaction(fn)`** — starts, commits, aborts, **and retries transient
  failures**. Use it instead of manual `startTransaction`/`commitTransaction`.
  It does **not** end the session — that is still yours.
- **`TransientTransactionError`** — a conflict; the whole transaction can be
  safely retried. `withTransaction` does this for you.
- **`UnknownTransactionCommitResult`** — the commit may or may not have
  landed; retry the commit. Also handled for you.
- **`WriteConflict`** — two transactions touched the same document. Normal
  under load; resolved by retrying.
- **Snapshot isolation** — a transaction reads a consistent point-in-time view
  plus its own writes. Other clients see **nothing** until commit.
- **60-second limit** — `transactionLifetimeLimitSeconds`. Long transactions
  are killed.

**Code example** — `01-sessions-and-transactions.js`, section 4:

```js
// ⚠️ THE classic mistake — this inserts the options object as a second document:
await Order.create(orderDoc, { session });     // WRONG

// The array signature is required to pass a session:
await Order.create([orderDoc], { session });   // RIGHT
```

**Expected result** — during the open transaction, a read *inside* it sees the
decremented stock while a read *outside* still sees the old value. After
commit both writes appear together; after abort, neither survives.

**Common mistakes**
- **Forgetting `{ session }` on one operation.** It runs outside the
  transaction and is *not* rolled back. Silent, and the worst kind of bug.
- **`Model.create(doc, { session })`.** Use the array form.
- **Not calling `endSession()`.** Leaks server-side resources.
- **Doing network I/O inside a transaction** (a payment API call, an email).
  Call the external service first, then open the transaction to record the
  result.
- **Long transactions.** Every touched document is under conflict detection
  until commit, so long transactions make everyone else retry.
- **Reaching for a transaction when a conditional update would do.** Lesson 03
  shows the cheaper fix.

**Real-world usage** — checkout (stock + order + payment), transfers between
wallets, and anything where an auditor would notice a half-finished operation.

**Related concepts** — [module 09](../09-data-modeling/README.md) (embedding
to avoid needing one), [module 07](../07-updates-and-deletes/README.md)
(single-document atomicity), [module 13](../13-validation-middleware-virtuals/README.md)
(why cascade hooks are risky without one).

---

## Topic: Race conditions and how to prevent them

**What is it?** Two operations interleaving so that one's result is silently
overwritten by the other — a **lost update**.

**Why does it happen?** (what problem it causes) Because
read → compute-in-JavaScript → write is three steps, and anything can happen
between step 1 and step 3. The window is small; the traffic is large.

**The three fixes, cheapest first**

**1. Atomic operators — let the server do the arithmetic.**

```js
// ❌ read-modify-write: 20 concurrent calls lose ~19 decrements
const p = await Product.findById(id);
await Product.updateOne({ _id: id }, { $set: { stock: p.stock - 1 } });

// ✅ one atomic server-side operation, no window at all
await Product.updateOne({ _id: id }, { $inc: { stock: -1 } });
```

**2. Conditional updates — put the precondition in the filter.**

```js
// ❌ twelve requests can all pass this `if` before any of them decrements
if (product.stock > 0) await decrement();

// ✅ the check and the change are one atomic operation
const r = await Product.updateOne(
  { _id: id, stock: { $gte: 1 } },
  { $inc: { stock: -1 } }
);
if (r.matchedCount === 0) throw new Error("OUT_OF_STOCK");
```

**3. Optimistic concurrency — version the document and retry.** For updates
that genuinely cannot be expressed as operators (reordering an array,
recomputing several fields from each other): include the values you read in
the update's filter, and retry when `matchedCount` is 0.

**When should I use each?** In that order. Only escalate when the previous one
cannot express what you need.

**Important terms**
- **Race condition** — the outcome depends on timing between concurrent
  operations.
- **Lost update** — one write silently overwrites another's result.
- **Atomic operator** — `$inc`, `$push`, `$addToSet`, `$min`, `$max`,
  `$currentDate`. The server computes; you never read first.
- **Conditional update / compare-and-set** — the precondition lives in the
  filter, so check and change are indivisible. Check `matchedCount` to see
  whether you won.
- **Optimistic concurrency** — assume conflicts are rare, detect them, retry.
  Free when uncontended.
- **Pessimistic concurrency** — lock first (transactions). Costs on every
  operation.
- **`__v` (version key)** — Mongoose's counter, incremented when a save
  modifies an array. `optimisticConcurrency: true` extends the check to
  **every** save.
- **`VersionError`** — thrown when `__v` no longer matches. The right response
  is to re-read and retry, not to show the user an error.
- **Idempotency key** — a client-supplied unique value stored on a unique
  index, so a retried HTTP request cannot place two orders.

**Code example** — `03-concurrency-and-versioning.js`, sections 1–3.

**Expected result** — the read-modify-write version leaves stock far above the
correct value (most decrements lost). The `$inc` version lands on exactly the
right number. The conditional version sells exactly 5 units to 12 buyers and
never goes negative.

**Common mistakes**
- **`doc.field = doc.field - 1; await doc.save()`.** The canonical lost
  update.
- **Checking a condition in JavaScript before updating.** Twelve requests pass
  the `if` before any of them writes.
- **Ignoring `matchedCount`.** You have no idea whether your conditional
  update actually applied.
- **Reaching for a transaction first.** Slower, more complex, and usually
  unnecessary — a filter condition solves it.
- **Retrying forever.** Cap attempts and back off.
- **Forgetting idempotency at the HTTP layer.** All the database correctness
  in the world will not stop a retried request from placing two orders.

**Real-world usage** — inventory, ticket booking, wallet balances, claiming
jobs from a queue (`{ _id, claimedBy: null }`), and "cancel only if still
pending" state machines.

**Related concepts** — [module 07](../07-updates-and-deletes/README.md)
(update operators and atomicity), [module 12](../12-indexes-and-performance/README.md)
(unique indexes as idempotency keys),
[module 15](../15-errors-and-query-behavior/README.md) (handling
`VersionError` and E11000).

---

## Topic: Write concern, read concern, read preference

**What is it?** Three independent knobs controlling what "saved" and "read"
actually guarantee.

| Knob | Question it answers | Values |
| --- | --- | --- |
| **Write concern** | how many servers must have it before you're told OK? | `w: 0`, `w: 1`, `w: "majority"`, `j: true`, `wtimeout` |
| **Read concern** | how settled must the data be? | `local`, `available`, `majority`, `linearizable`, `snapshot` |
| **Read preference** | which member answers? | `primary`, `primaryPreferred`, `secondary`, `secondaryPreferred`, `nearest` |

**Why do they exist?** (what problem they solve) Durability, consistency, and
latency genuinely trade against each other, and the right point on that curve
differs per workload. A metrics write and a payment write should not have the
same guarantees.

**When should I use each?**

| Workload | Settings |
| --- | --- |
| user-facing writes (orders, payments) | `w: "majority"`, `j: true` |
| user-facing reads | default read concern, **primary** |
| read-your-own-writes flows | **primary**, always |
| analytics / reports / exports | `secondaryPreferred`, `local` |
| metrics and logs | `w: 1` (or `w: 0` if truly disposable) |
| inside a transaction | `snapshot` + `majority` + primary (mostly the defaults) |

**Important terms**
- **`w: 1`** — the primary has it *in memory*. A primary crash before
  replication **loses** it.
- **`w: "majority"`** — a majority of voting members have it; survives a
  failover. This is what makes "we told the user it succeeded" true.
- **`j: true`** — in the on-disk journal, not just RAM.
- **`wtimeout`** — stop waiting after N ms. **A timeout does not undo the
  write** — it may still replicate afterwards.
- **Rollback** — during a failover, writes acknowledged with `w: 1` that never
  replicated are **discarded** by the new primary.
- **Replication lag** — how far behind a secondary is. Usually milliseconds;
  occasionally much more.
- **Retryable writes** — on by default (`retryWrites=true`); a single-document
  write is retried once automatically across a failover.
- **Read-your-own-writes** — the guarantee a user expects after submitting a
  form. Reading from a secondary breaks it.

**Code example** — `04-write-read-concerns.js`, section 2:

```js
await Product.create([doc], { writeConcern: { w: 1 } });                  // fast
await Product.create([doc], { writeConcern: { w: "majority", j: true } }); // durable
```

**Expected result** — nearly identical timings locally; across a real replica
set, `majority` costs a network round trip to another machine. That latency
*is* the durability.

**Common mistakes**
- **`w: 0` on anything that matters.** The driver reports success even if a
  validator or unique index rejected the write. You never hear about it.
- **Reading from secondaries after a user's own write.** The classic "my order
  disappeared" bug.
- **Assuming `wtimeout` cancels the write.** It only stops you waiting.
- **Trying to run a transaction against a secondary.** Not allowed —
  transactions require `readPreference: "primary"`.
- **Tuning these before measuring.** The defaults (`w: "majority"` on modern
  replica sets, `local` reads, primary) are correct for most applications.

**Real-world usage** — the connection string sets a global default
(`?w=majority&retryWrites=true`), analytics jobs opt into
`secondaryPreferred`, and payment paths pin `j: true`.

**Related concepts** — [module 02](../02-connections/README.md) (connection
string options), [module 18](../18-production-and-security/README.md) (replica
sets, failover, and sharding).

---

## Check yourself

1. Why can't a standalone `mongod` run transactions?
2. `Model.create(doc, { session })` — what actually happens, and what should
   you write instead?
3. Name two operations `withTransaction` retries automatically, and one it
   does not.
4. Reproduce the lost-update bug in three lines. Now fix it two different
   ways.
5. Twelve buyers, five items in stock. Write the update that cannot oversell,
   and say how you know whether a given buyer succeeded.
6. When is optimistic concurrency the right choice over a transaction?
7. What is the difference between `w: 1` and `w: "majority"` during a
   failover?
8. Your user places an order and is immediately shown an empty order list.
   What is the most likely cause?

**Next:** [module 15 — Errors & query behavior](../15-errors-and-query-behavior/README.md),
where every error type gets a correct HTTP response.
