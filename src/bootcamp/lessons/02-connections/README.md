# Module 02 — Connections: how Node.js actually talks to MongoDB

Every other module in this bootcamp starts with `runLesson(...)` and never thinks
about the connection again. That is exactly how application code should behave —
and exactly why this module exists. Someone has to understand what `runLesson`
(and the real app) hides: what a connection *is*, what a connection *pool* is,
what the driver does when every socket is busy, and why a Node.js process
"hangs" forever if you never disconnect.

> **This module is the exception to the bootcamp pattern.** The lesson files
> here do NOT use `runLesson()`. They import `mongoose` and the config directly
> and manage the connection by hand, because the connection itself is the
> subject. Every other module should keep using `runLesson()`.

All three lessons are **read-only** — they create no documents and change
nothing, so they are safe to run in any order, any number of times.

| File | Run with | What it shows |
| --- | --- | --- |
| `01-connection-lifecycle.js` | `npm run lesson 02-connections/01-connection-lifecycle` | Manual connect, lifecycle events, `readyState` transitions, clean disconnect |
| `02-connection-pool.js` | `npm run lesson 02-connections/02-connection-pool` | Two pools (`maxPoolSize` 1 vs 10) racing 15 concurrent queries |
| `03-graceful-shutdown.js` | `npm run lesson 02-connections/03-graceful-shutdown` | SIGINT/SIGTERM handlers, letting in-flight work finish, exiting cleanly |

---

## Topic: How THIS repo connects (a walkthrough of the real code)

**What is it?** The repo already contains a complete, production-shaped
connection setup. It lives in two files you should open side by side:
`src/config/env.config.js` (turns environment variables into a validated
config object) and `src/db/loader.db.js` (opens and closes the one shared
Mongoose connection).

**Why does it exist?** (what problem it solves) Hard-coding a connection string
in code means every developer, test machine, and production server needs a code
change to point at a different database. Putting it in the environment — and
*validating* it at startup — means the same code runs everywhere and fails
loudly at boot (not at 3 a.m. on the first query) if something is missing.

**The flow, step by step:**

1. **`.env` → `process.env`.** Look at `package.json`: every script that touches
   the database runs `node -r dotenv/config ...`. The `-r dotenv/config` flag
   preloads the `dotenv` package, which reads the `.env` file and copies its
   lines into `process.env` *before* any of our code runs. That is why no file
   in `src/` ever calls `dotenv.config()` itself.
2. **`src/config/env.config.js` validates and shapes.** It builds a Joi schema
   in which `MONGO_URI` is *required* (boot fails without it), `MONGO_DB_NAME`
   is optional, and `MONGO_POOL_SIZE` is an integer that **defaults to 10**.
   The validated values are exposed as one tidy object:
   `config.db.uri`, `config.db.name`, `config.db.maxPoolSize`.
3. **`src/db/loader.db.js` connects.** Its `connectDB()`:
   - first calls `registerConnectionEvents()` — attaching `connected` / `error`
     / `disconnected` / `reconnected` listeners **before** connecting (see the
     lifecycle-events topic below for why order matters);
   - then `await mongoose.connect(config.db.uri, { dbName, maxPoolSize })`.
     Passing `dbName` as an option instead of baking it into the URI keeps one
     URI reusable across databases (handy for tests);
   - then imports `src/models/index.js`, which forces every schema to be
     registered with Mongoose at startup so `populate()` never meets an
     unregistered model at runtime.
4. **`disconnectDB()` closes.** One call to `mongoose.disconnect()` — used by
   `runLesson`, the seeder, and the app's shutdown path.

**When should I use it?** Always — application code, seeders, and (in every
other module) lessons call `connectDB()` / `disconnectDB()` and never touch
`mongoose.connect` directly.

**When should I avoid it?** Only here, in module 02, where bypassing the loader
is the whole point.

**Important terms**
- **Environment variable** — a key=value setting that lives outside the code,
  in the operating-system environment of the process.
- **`.env` file** — a local file of environment variables that `dotenv` loads
  for you in development (never committed with real secrets).
- **Connection string / URI** — the address of the MongoDB server, e.g.
  `mongodb://localhost:27017`. Can also carry options and credentials.
- **Loader** — a startup module whose one job is wiring a resource (here: the
  database) before the rest of the app runs.

**Code example** — `src/db/loader.db.js` (read the whole file — it is heavily
commented), and this module's `01-connection-lifecycle.js`, which re-plays the
loader's steps by hand so you can watch each one.

**Expected result** — running any lesson from other modules logs
`MongoDB connection established (db: mongo_bootcamp, pool: 10).` before the
lesson output — that line comes from this loader.

**Common mistakes**
- Editing code to change the database instead of editing `.env`.
- Calling `connectDB()` in many places "just to be safe" — it must run exactly
  once at startup.
- Running a script with plain `node src/...` (no `-r dotenv/config`) and then
  wondering why `MONGO_URI` is undefined.

**Real-world usage** — nearly every production Node backend has this exact
shape: a config module that validates `process.env` at boot, and a db loader
called once from the entry point before the HTTP server starts listening.

**Related concepts** — graceful shutdown (below) is the mirror image of this
loader: what `connectDB()` opens, the shutdown path must close.

---

## Topic: `mongoose.connect()` vs `mongoose.createConnection()`

**What is it?** Mongoose gives you two ways to open a connection:

- `mongoose.connect(uri, options)` — configures **the default global
  connection**, a singleton object that already exists as
  `mongoose.connection` the moment you `import mongoose`.
- `mongoose.createConnection(uri, options)` — creates and returns a **new,
  independent** `Connection` object with its **own socket pool** and its
  **own model registry**.

**Why does it exist?** (what problem it solves) The default connection exists
so that ordinary apps — which talk to exactly one database — never have to pass
a connection object around. `createConnection` exists for everything else:
talking to two different databases or clusters, multi-tenant apps (one
connection per tenant), or giving one workload different pool settings than
another (exactly what lesson 02 does).

**Why can every file just `import mongoose` and models work?** This is the
part that confuses beginners most, so slowly: `mongoose` is a singleton — every
`import mongoose from "mongoose"` in every file of the process receives the
*same object* (Node caches modules). That object owns one default `Connection`
at `mongoose.connection`. When `src/db/loader.db.js` calls `mongoose.connect()`
at startup, it configures *that shared object*. And every model created with
`mongoose.model("User", schema)` — as all files in `src/models/` do — is
automatically bound to *that same default connection*. So when
`user.model.js` was imported and later some route file runs `User.find()`,
everything meets in the middle at the one global connection the loader opened.
No file needs to import the loader; they only need the loader to have *run*.

There is a safety net behind this magic: **buffering**. If a model is used
*before* the default connection is open, Mongoose does not fail instantly — it
queues ("buffers") the operation and replays it once connected. If no
connection arrives within 10 seconds (`bufferTimeoutMS`), the operation
rejects with a timeout error. That error —
`Operation \`users.find()\` buffering timed out after 10000ms` — is the classic
symptom of "I forgot to connect first".

**When should I use which?**
- `mongoose.connect()` — the default choice; one app, one database.
- `mongoose.createConnection()` — several databases/clusters, per-tenant
  connections, or different pool options per workload.

**When should I avoid it?** Avoid `createConnection` for a single-database app:
you would take on the burden of registering every model on your connection
(`conn.model("User", userSchema)`) and passing the connection around, for no
benefit.

**Important terms**
- **Singleton** — a module/object of which exactly one instance exists per
  process.
- **Default (global) connection** — `mongoose.connection`; the one configured
  by `mongoose.connect()`.
- **Model registry** — the per-connection table mapping model names ("User")
  to compiled models. Models made with `mongoose.model()` live in the default
  connection's registry; a `createConnection` connection starts with an empty
  one.
- **Buffering** — Mongoose queueing model operations while the connection is
  not yet open (Mongoose-side behavior; the MongoDB server never sees a
  buffered query).

**Code example** — `01-connection-lifecycle.js` uses `mongoose.connect()`;
`02-connection-pool.js` uses `mongoose.createConnection()` twice and registers
the Order model on each one:

```js
const conn = mongoose.createConnection(config.db.uri, { maxPoolSize: 1 });
await conn.asPromise();               // resolves when the handshake finishes
const OrderHere = conn.model("Order", Order.schema); // per-connection model
```

**Expected result** — in lesson 02 you will see two connections report
`readyState: 1` independently, and the same schema produce two working models,
one per connection.

**Common mistakes**
- Calling `mongoose.connect()` twice with different URIs expecting two
  connections — the second call just reconfigures the same default connection.
- Using `User` (a default-connection model) and expecting it to run on a
  `createConnection` connection. Models are bound to the connection that
  created them.
- Forgetting `await conn.asPromise()` and assuming the connection is open the
  line after `createConnection` returns (it returns immediately and connects in
  the background — operations meanwhile are buffered).

**Real-world usage** — a reporting service reading from an analytics cluster
while writing to the main cluster; SaaS apps isolating tenants; job workers
given a bigger pool than the web tier.

**Related concepts** — the connection pool (next topic) is what each of these
connection objects owns.

---

## Topic: Connect ONCE at startup, then reuse

**What is it?** The rule that an application opens its MongoDB connection one
time, at boot, and every subsequent query reuses it — never
connect-per-request or connect-per-query.

**Why does it exist?** (what problem it solves) Two problems:

1. **Handshake cost.** "Opening a connection" is not one step. The client must
   perform the TCP three-way handshake, usually a TLS handshake (several more
   round trips plus certificate checks), a MongoDB `hello` exchange, and — with
   auth enabled — a SCRAM challenge–response that alone takes multiple round
   trips of deliberately slow password hashing. That is easily tens of
   milliseconds, often more over the internet. Paying it once at startup is
   free; paying it on every query can cost more than the query itself.
2. **Resource exhaustion.** Every open connection costs the *server* real
   memory (historically about 1 MB each on `mongod`) and a slot in its
   connection limit (MongoDB Atlas free tier allows only 500). A "connect per
   request" app under load opens thousands of connections, and the database
   starts refusing new ones — taking down every client, not just the buggy one.

**When should I use it?** Always. This is not an optimization; it is the
intended way to use the driver.

**When should I avoid it?** Never in a long-lived process. The only genuine
gray area is serverless functions (AWS Lambda etc.), where there is no
"startup" — and even there the fix is caching the connection across warm
invocations, not reconnecting per call.

**Important terms**
- **Handshake** — the setup conversation two machines have before real data
  flows (TCP, TLS, and MongoDB each add their own).
- **SCRAM** — Salted Challenge Response Authentication Mechanism; MongoDB's
  default password authentication, intentionally CPU-costly.
- **Round trip** — one message to the server and its reply; the unavoidable
  unit of network latency.
- **Connection churn** — rapidly opening and closing connections; poison for
  both client and server.

**Code example** — `src/db/loader.db.js` (`connectDB()` called once from the
app entry point) is the pattern itself. Lesson 01 shows what one connect
involves; imagine repeating it for every query.

**Expected result** — after the one-time connect in lesson 01, the liveness
query returns in a few milliseconds because the socket already exists.

**Common mistakes**
- Calling `mongoose.connect()` inside a request handler or inside every
  service function. Symptoms: slow requests, ballooning connection counts,
  eventually `connection refused` from the server.
- The opposite error: never awaiting the startup connect and serving traffic
  while `readyState` is still 2 — the first requests then rely on buffering
  (or time out).

**Real-world usage** — `await connectDB()` runs before
`app.listen(...)` in virtually every Express/Mongo codebase, so the server
never accepts a request it cannot serve.

**Related concepts** — the pool (next) is *why* one connection object is
enough for thousands of concurrent requests.

---

## Topic: The connection pool (`maxPoolSize`, the wait queue, `waitQueueTimeoutMS`)

**What is it?** When Mongoose "connects", the underlying **MongoDB Node.js
driver** (the `mongodb` package that Mongoose wraps) does not open one socket.
It creates a **pool**: a managed set of reusable TCP sockets to the server, up
to `maxPoolSize` of them (driver default: 100; this repo configures 10 via
`MONGO_POOL_SIZE`).

Be precise about the two meanings of "connection", because the word is
overloaded:

- **The Mongoose `Connection` object** (`mongoose.connection`, or what
  `createConnection` returns) — a high-level handle. Your app usually has ONE.
- **A pooled socket** — one actual TCP connection to `mongod`, owned by that
  handle's pool. There may be up to `maxPoolSize` of these.

So "one connection" in app-speak really means "one pool of up to N sockets".

**How a query uses the pool:** your code calls `Order.find(...)` → the driver
**checks out** a free socket from the pool → sends the query on it → waits for
the reply → **checks the socket back in**. One socket carries one operation at
a time; concurrency comes from having several sockets. Sockets are created
**lazily** — a fresh pool with `maxPoolSize: 10` has 0 sockets until queries
demand them (you can pre-open some with `minPoolSize`).

**What happens when ALL sockets are busy?** This is the crucial part: the
extra operations are **not rejected and not sent**. They wait in a **queue
inside the driver** (the *wait queue*), in your Node.js process, until a socket
is checked back in. With the default `waitQueueTimeoutMS: 0` they will wait
forever; if you set e.g. `waitQueueTimeoutMS: 5000`, an operation that cannot
get a socket within 5 s fails with a timeout error. So an undersized pool does
not produce errors under load — it produces silent queueing and rising
latency, which is far harder to spot. (Note this queue is client-side and per
process; it is different from Mongoose's *buffering*, which only happens while
the connection is not open yet.)

**Why does it exist?** (what problem it solves) It gives you the best of both
worlds: handshakes are paid rarely (sockets are reused), yet many operations
can be in flight at once (several sockets). It also caps how hard one process
can hammer the database — the pool is a built-in concurrency limiter.

**When should I tune it?** Raise `maxPoolSize` when you measure operations
spending time waiting for a socket while the database itself is idle. Lower it
when many app instances multiply into too many server connections
(instances × poolSize ≤ what the server allows, with headroom).

**When should I avoid touching it?** Don't raise it "just in case": more
sockets means more server memory, and if the database is already the
bottleneck, a bigger pool just moves the queue from your driver onto the
server, where it does more damage.

**Important terms**
- **Pool** — a kept-alive, reusable set of expensive resources (here: sockets).
- **Check out / check in** — borrowing a socket for one operation / returning
  it.
- **`maxPoolSize`** — upper bound of sockets per connection object.
- **`minPoolSize`** — sockets the driver keeps open even when idle (default 0).
- **Wait queue** — the driver's client-side line of operations waiting for a
  free socket.
- **`waitQueueTimeoutMS`** — how long an operation may wait in that line
  (default 0 = forever).

**Code example** — `02-connection-pool.js`: two `createConnection`s, one with
`maxPoolSize: 1`, one with `maxPoolSize: 10`, each hit with 15 concurrent
aggregations via `Promise.all`, timed with `console.time`.

**Expected result** — with `maxPoolSize: 1` the 15 aggregations run one after
another over a single socket; with `maxPoolSize: 10`, up to 10 run in parallel.
**Honest caveat:** on this tiny seeded dataset on localhost, each aggregation
takes ~1 ms, so 15 serialized queries may still finish in a handful of
milliseconds — the two timings can look close. The lesson prints the math for
what happens under real load (e.g. 100 ms queries: pool of 1 → ~1.5 s total;
pool of 10 → ~200 ms). The *mechanism* — queueing vs parallelism — is
identical; only the magnitude differs.

**Common mistakes**
- Reading "pool of 10" as "10 clients can connect to my app" — the pool is
  about your process's sockets to *MongoDB*, unrelated to HTTP clients.
- Expecting errors when the pool is saturated — you get queueing and latency,
  not errors (unless you set `waitQueueTimeoutMS`).
- Benchmarking pools with 1 ms queries and concluding pool size doesn't
  matter.
- Forgetting that `maxPoolSize` is per connection object *per process*: 8
  Node instances × pool 100 = 800 potential server connections.

**Real-world usage** — sizing pools is a routine production task: a checkout
service doing slow aggregations might run pool 50, while a health-check
sidecar runs pool 2, both against the same cluster.

**Related concepts** — module 12 (indexes/performance) attacks the *other* end
of the same latency problem: making each query release its socket sooner.

---

## Topic: Connection lifecycle events (`connected`, `error`, `disconnected`, `reconnected`)

**What is it?** A Mongoose `Connection` is an `EventEmitter` — the same
pattern as Node's own streams and servers. Over its life it emits, among
others:

| Event | Fires when | Typical reaction |
| --- | --- | --- |
| `connecting` | connect attempt started | debug log |
| `connected` | initial connection established (also on each re-establish) | info log |
| `open` | connected + internal setup finished (once per connect) | "ready" log |
| `error` | an error occurred on an *established* connection | error log / alert |
| `disconnected` | the connection was lost (server down, network cut) or closed | warn log / alert |
| `reconnected` | the driver's automatic retry succeeded after a loss | info log ("recovered") |
| `close` | connection fully closed after `.close()`/`disconnect()` | cleanup |

**Why does it exist?** (what problem it solves) The connection's life extends
far beyond the `await mongoose.connect(...)` line. MongoDB can go down at
hour 30 of your process's life; the network can flap; a failover can happen.
No `try/catch` around startup code can see those — they are asynchronous
events, so an event API is the only shape that fits. One subtlety worth
memorizing: an **initial** connection failure rejects the `connect()` promise
(catch it with `try/catch`); failures **after** you are connected surface as
`error`/`disconnected` events instead. You need both mechanisms.

**When should I use it?** Attach listeners once, at startup, **before**
calling `connect()` — exactly what `registerConnectionEvents()` in
`src/db/loader.db.js` does. Attaching first guarantees you cannot miss an
early event; it also documents intent: "these run for the life of the app".

**When should I avoid it?** Don't attach listeners per request or inside
frequently-called functions — you'll stack duplicates (Node warns after 10)
and log every event N times. And don't put reconnect *logic* in them: the
driver already retries by itself; your listeners should observe (log, alert,
flip a health-check flag), not steer.

**Important terms**
- **EventEmitter** — Node's publish/subscribe object: `.on(name, fn)`
  registers a callback, `.emit(name)` fires them.
- **Listener/handler** — the function you register for an event.
- **Failover** — a replica set electing a new primary; clients briefly
  disconnect and then reconnect.

**Code example** — `01-connection-lifecycle.js` attaches listeners to
`mongoose.connection` *before* connecting, so you see `connected` fire during
`connect()` and `disconnected` fire during `disconnect()`.

**Expected result** — lesson 01 prints `[event] connected`, then `[event]
open`, then after the query `[event] disconnected` and `[event] close`. You
will *not* see `reconnected` — that requires the server to die and return
mid-run. (Try it: start lesson 03, stop `mongod` during the 5-second wait, and
start it again.)

**Common mistakes**
- Attaching listeners *after* `await mongoose.connect(...)` — the `connected`
  event has already fired; your log stays silent and you assume events are
  broken.
- Treating `disconnected` as fatal and calling `process.exit()` — the driver
  was probably about to reconnect on its own.
- Forgetting an `error` listener entirely; connection errors then go
  unobserved.

**Real-world usage** — production loaders wire these to the logging/alerting
stack (as `loader.db.js` does with Winston) and often to a `/health` endpoint:
`disconnected` flips the app to "unhealthy" so the load balancer drains it,
`reconnected` flips it back.

**Related concepts** — `readyState` (next) is the *current status* snapshot;
events are the *transitions* between those statuses.

---

## Topic: `readyState` — the connection's status number (0–3)

**What is it?** `mongoose.connection.readyState` is a number telling you the
connection's current state, at Mongoose level:

| Value | Name | Meaning |
| --- | --- | --- |
| `0` | disconnected | no connection (never connected, or closed/lost) |
| `1` | connected | open and usable — the only state where queries run now |
| `2` | connecting | handshake in progress |
| `3` | disconnecting | close in progress |
| `99` | uninitialized | internal "not set up" state; rarely seen in practice |

Events and `readyState` are two views of one machine: each event marks the
moment `readyState` changes (e.g. `connected` fires as it becomes 1).

**Why does it exist?** (what problem it solves) Sometimes you need to *ask*
rather than *wait to be told*: a `/health` endpoint must answer "is the DB up
right now?"; a shutdown routine must know whether there is anything to close;
a debug log wants the state at a specific line. Events can't answer "what is
the state *now*" — `readyState` can.

**When should I use it?** Health checks
(`mongoose.connection.readyState === 1`), debugging startup/shutdown ordering,
and guard clauses in shutdown code (lesson 03 checks it before running its
final query).

**When should I avoid it?** Don't check it before every query
(`if (readyState === 1) await User.find()...`): it is a race condition — the
state can change between the check and the query — and Mongoose's buffering
plus the driver's retries already handle the transient cases. Write the query;
handle errors.

**Important terms**
- **State machine** — an object that is always in exactly one of a fixed set of
  states, with defined transitions; the connection is one.
- **Race condition** — a bug where the answer changes between checking and
  acting.

**Code example** — `01-connection-lifecycle.js` prints `readyState` before
connecting (0), immediately after *calling* `connect()` but before awaiting it
(2 — the handshake is running in the background), after awaiting (1), and
after `disconnect()` (0):

```js
const pending = mongoose.connect(config.db.uri, options); // don't await yet
console.log(mongoose.connection.readyState);              // 2 "connecting"
await pending;
console.log(mongoose.connection.readyState);              // 1 "connected"
```

**Expected result** — the sequence `0 → 2 → 1 → 0` with the matching events
interleaved.

**Common mistakes**
- Comparing against strings (`readyState === "connected"`) — it is a number.
- Using `readyState` checks as a substitute for awaiting `connect()` at
  startup.
- Assuming 0 means "was never connected" — it is also the state after a lost
  or closed connection.

**Real-world usage** — the classic Express health check:

```js
app.get("/health", (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ db: dbUp ? "up" : "down" });
});
```

**Related concepts** — lifecycle events (previous topic); graceful shutdown
(next) reads `readyState` to decide what still needs closing.

---

## Topic: Graceful shutdown (and why the process hangs without it)

**What is it?** Ending the Node.js process in an orderly sequence: stop taking
new work → let in-flight work finish → close the connection pool → exit. The
opposite is being killed mid-write or hanging forever.

**Why does the process hang if you never disconnect?** Node.js exits when its
**event loop** has nothing left that could produce work: no timers, no open
sockets, no pending I/O. An open connection pool is a set of open TCP sockets
(plus the driver's monitoring timers that heartbeat the server) — all "active
handles". So a script that connects, queries, prints, and *doesn't* disconnect
just... sits there. Nothing is wrong; Node is dutifully keeping the process
alive for a pool that might still be needed. `mongoose.disconnect()` closes
those sockets and stops those timers, the event loop drains, and the process
exits on its own. (That is why `runLesson()` in
`src/bootcamp/lib/lesson-runner.js` disconnects in a `finally` — and why
lesson 03 exits by itself after its timer fires, with no `process.exit()`
call on that path.)

**Why let in-flight queries finish first?** At the moment a shutdown signal
arrives, some sockets may be mid-operation — an order being written, a payment
being recorded. Yanking the pool shut then means those operations die
mid-flight: the client gets a "connection closed" error and, worse, for a
write you *don't know whether the server applied it* before the socket died.
The safe order for a web app is: `server.close()` (stop accepting new HTTP
requests, finish the ones in progress) → then `mongoose.disconnect()` → then
exit.

**What are SIGINT and SIGTERM?** Signals — small notifications the operating
system sends a process. `SIGINT` is what Ctrl+C sends; `SIGTERM` is the polite
"please terminate" sent by `kill`, Docker (`docker stop`), Kubernetes, and
process managers before they resort to `SIGKILL` (which cannot be caught —
you get no chance to clean up, which is exactly why you handle SIGTERM well).
Registering `process.on("SIGINT", handler)` **replaces** Node's default
behavior (die instantly) with your handler — which means the handler must
eventually call `process.exit()` itself, or the process won't stop.
*Windows note:* Ctrl+C works normally in a console (Node emulates SIGINT), but
SIGTERM has no real equivalent on Windows; registering the handler is still
correct and matters the moment the app runs in Docker/Linux.

**When should I use it?** Every long-lived process: web servers, workers,
cron-style jobs. Short scripts (seeders, lessons) need only the "disconnect at
the end" half.

**When should I avoid it?** Don't build elaborate cleanup for crash paths —
after an `uncaughtException` the process state is untrustworthy; log and exit
fast. And never block shutdown indefinitely: pair it with a timeout that
force-exits (e.g. after 10 s) so a stuck cleanup can't turn "stop" into
"hangs forever, gets SIGKILLed anyway".

**Important terms**
- **Event loop** — Node's scheduler; the process lives while the loop has
  active handles (sockets, timers, pending I/O).
- **Active handle** — a resource that keeps the loop alive; each pooled socket
  is one.
- **Signal** — an OS-level notification to a process (SIGINT, SIGTERM,
  SIGKILL).
- **In-flight operation** — a query/write sent to the server whose reply has
  not arrived yet.
- **`process.exit(code)`** — ends the process *immediately*; code 0 = success,
  non-zero = failure. It does not wait for pending work, which is why it must
  be the *last* step, never the first.

**Code example** — `03-graceful-shutdown.js`: registers SIGINT/SIGTERM
handlers that run one shared `shutdown()` (finish a representative in-flight
query → `mongoose.disconnect()` → exit), and also arms a 5-second timer that
triggers the same shutdown so the lesson always ends on its own.

**Expected result** — the lesson connects, proves liveness with a query,
prints `press Ctrl+C or wait...`, and 5 seconds later shuts itself down —
printing each shutdown step. Press Ctrl+C during the wait to see the SIGINT
path take over (a repeat Ctrl+C is ignored by a guard flag).

**Common mistakes**
- Never disconnecting in a script and concluding Node is "frozen" — the
  number-one beginner trap with Mongoose scripts.
- Calling `process.exit()` first, "to be safe" — guaranteeing cleanup never
  runs.
- Registering a SIGINT handler that forgets to exit — Ctrl+C then appears to
  do nothing.
- Not guarding against a second Ctrl+C while the first shutdown is running
  (two overlapping disconnects).

**Real-world usage** — Kubernetes sends SIGTERM, waits a grace period
(default 30 s), then SIGKILLs. A pod that ignores SIGTERM drops user requests
on every deploy; one that handles it drains cleanly and users never notice.

**Related concepts** — the db loader topic above (startup is the mirror of
shutdown); module 14 (transactions) for what MongoDB itself guarantees when a
write is interrupted.

---

## Mongoose vs MongoDB vs the driver — who does what in this module

| Behavior | Lives in |
| --- | --- |
| Default global connection, model registry, buffering, `readyState` | **Mongoose** (Node.js) |
| Socket pool, wait queue, `maxPoolSize`/`waitQueueTimeoutMS`, auto-reconnect, server heartbeats | **MongoDB Node driver** (the `mongodb` package Mongoose wraps) |
| Connection limits, per-connection memory cost, auth (SCRAM) | **MongoDB server** (`mongod`) |

Keep this table in mind: "Mongoose reconnected" really means "the driver
reconnected and Mongoose re-emitted the event", and "too many connections" is
the *server* pushing back on what your pools opened.
