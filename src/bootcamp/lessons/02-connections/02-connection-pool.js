/**
 * LESSON 02-connections/02-connection-pool — What maxPoolSize really does
 *
 * "Connection pool" sounds abstract until you watch it throttle real work.
 * This lesson opens TWO separate connections to the same database — one with
 * maxPoolSize 1, one with maxPoolSize 10 — fires the SAME 15 concurrent
 * queries at each, and times them. The wall-clock difference is the pool.
 *
 * You will see: pool events (connectionCreated / checkedOut / checkedIn),
 * how the driver QUEUES work when every socket is busy, why a bigger pool is
 * not automatically better, and how to size one for a real API.
 *
 * 100% READ-ONLY — it only runs count queries against the seeded orders.
 * Nothing is created, changed, or deleted.
 *
 * Run it with:  npm run lesson 02-connections/02-connection-pool
 */
import mongoose from "mongoose";
import { section, show, note } from "../../lib/lesson-runner.js";
import config from "../../../config/env.config.js";

console.log(`\n${"#".repeat(70)}\n# LESSON: Connections 2/3 — The connection pool\n${"#".repeat(70)}`);

// --------------------------------------------------------------------------
section("1. What is in the pool?");
note(
  "A connection pool is a set of already-open, already-authenticated TCP " +
    "sockets to MongoDB. Every operation BORROWS a socket (check-out), uses " +
    "it for one round trip, and RETURNS it (check-in). Sockets are never " +
    "owned by a request — they are shared, one operation at a time each. " +
    "maxPoolSize is the ceiling on how many can exist per server."
);

/**
 * Open an INDEPENDENT connection (its own pool) with a given size.
 *
 * `mongoose.createConnection()` is the multi-connection API: unlike
 * `mongoose.connect()` it does NOT touch the global default connection, so
 * this lesson can hold two pools side by side without disturbing anything.
 * Real apps use it for multi-tenant setups (one connection per database).
 */
const openPool = async (maxPoolSize) => {
  const connection = mongoose.createConnection(config.db.uri, {
    ...(config.db.name ? { dbName: config.db.name } : {}),
    maxPoolSize,
    // How long an operation waits for a free socket before giving up. The
    // default is 0 = wait forever. We keep the default here; see section 5.
  });

  // asPromise() resolves once the handshake finishes — createConnection()
  // itself returns immediately (the connection is "connecting" at first).
  await connection.asPromise();
  return connection;
};

/**
 * Fire N independent queries AT THE SAME TIME and measure wall-clock time.
 *
 * Each query is a separate round trip, so each needs a socket. With a pool
 * of 10, ten of them travel in parallel. With a pool of 1, they are forced
 * into single file — the driver queues them and hands the one socket over,
 * one operation at a time.
 */
const raceQueries = async (connection, howMany) => {
  const collection = connection.db.collection("orders");
  const startedAt = process.hrtime.bigint();

  await Promise.all(
    Array.from({ length: howMany }, (_, i) =>
      // A non-trivial read so each round trip does real work: count orders
      // in a different status/amount band per query, so nothing is cached
      // into a single identical plan result.
      collection.countDocuments({ totalAmount: { $gte: i * 500 } })
    )
  );

  return Number(Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1);
};

// --------------------------------------------------------------------------
section("2. Instrumenting the pool with driver events");
// The native driver emits pool events on the underlying MongoClient. Mongoose
// exposes it as `connection.getClient()`. Counting these events is the
// clearest possible proof of what a pool does.
const instrument = (connection) => {
  const counters = { created: 0, checkedOut: 0, checkedIn: 0, ready: 0 };
  const client = connection.getClient();

  // A brand-new socket was opened and authenticated. This is the expensive
  // event — the whole point of a pool is to make it rare.
  client.on("connectionCreated", () => (counters.created += 1));
  // An operation borrowed a socket.
  client.on("connectionCheckedOut", () => (counters.checkedOut += 1));
  // An operation finished and gave the socket back.
  client.on("connectionCheckedIn", () => (counters.checkedIn += 1));
  client.on("connectionPoolReady", () => (counters.ready += 1));

  return counters;
};

// --------------------------------------------------------------------------
section("3. Pool of 1 vs pool of 10 — the same 15 concurrent queries");
const QUERIES = 15;

const smallPool = await openPool(1);
const smallCounters = instrument(smallPool);
const smallMs = await raceQueries(smallPool, QUERIES);

const bigPool = await openPool(10);
const bigCounters = instrument(bigPool);
const bigMs = await raceQueries(bigPool, QUERIES);

show(`${QUERIES} concurrent countDocuments()`, {
  "maxPoolSize 1": { wallClockMs: Number(smallMs), pool: smallCounters },
  "maxPoolSize 10": { wallClockMs: Number(bigMs), pool: bigCounters },
});
note(
  "Both pools ran the same 15 operations, so checkedOut is 15 on each side. " +
    "The difference is `created`: the small pool opened ONE socket and " +
    "reused it 15 times (queries ran single file); the big pool opened " +
    "several and ran them in parallel. On a local MongoDB each query takes " +
    "~1ms, so the gap is small but real — over a network, where each round " +
    "trip costs 20-50ms, the pool-of-1 timing multiplies by 15."
);
note(
  "Also notice created < checkedOut on BOTH sides. That inequality IS the " +
    "value of pooling: sockets are recycled instead of re-opened. And the " +
    "big pool typically creates fewer than 10 sockets — the driver grows " +
    "the pool lazily, on demand, rather than pre-opening the maximum."
);

// --------------------------------------------------------------------------
section("4. Where the waiting happens");
note(
  "When every socket is busy, the driver does NOT reject your query and does " +
    "NOT open socket number maxPoolSize+1. It parks the operation in a WAIT " +
    "QUEUE inside the driver, in your Node.js process, and serves it when a " +
    "socket is checked back in. Two consequences: (1) a too-small pool shows " +
    "up as latency, never as an error — which makes it sneaky to diagnose; " +
    "(2) that queue is unbounded by default, so a slow database turns into " +
    "growing memory and growing p99 latency in your API."
);
show("Timings translated into per-query cost", {
  "pool 1: ms per query": Number((Number(smallMs) / QUERIES).toFixed(2)),
  "pool 10: ms per query": Number((Number(bigMs) / QUERIES).toFixed(2)),
  configuredAppPoolSize: config.db.maxPoolSize,
});

// --------------------------------------------------------------------------
section("5. The knobs that matter (and their defaults)");
show("Driver pool options", {
  maxPoolSize: "default 100 (this repo sets it from MONGO_POOL_SIZE, default 10)",
  minPoolSize: "default 0 — sockets kept warm even when idle",
  maxIdleTimeMS: "default 0 (never) — close a socket idle this long",
  waitQueueTimeoutMS: "default 0 (wait forever) — fail fast instead of queueing",
  serverSelectionTimeoutMS: "default 30000 — how long to look for a reachable server",
  socketTimeoutMS: "default 0 — kill a socket whose operation runs this long",
});
note(
  "Set waitQueueTimeoutMS in a real API (e.g. 5000). Without it, a database " +
    "hiccup makes every request hang until the client's own timeout, which " +
    "is how one slow collection takes down a whole service."
);

// --------------------------------------------------------------------------
section("6. How to size a pool");
note(
  "Bigger is NOT better. Each socket costs memory and a thread's worth of " +
    "attention on the server, and MongoDB serves each connection from a " +
    "limited pool of its own. Rules of thumb: start at 10-20 per Node " +
    "process; multiply by the number of processes (PM2 cluster with 4 " +
    "workers x 20 = 80 sockets to the server, not 20); stay well under the " +
    "server's connection limit (Atlas M0 allows 500 total)."
);
note(
  "Node.js is single-threaded for YOUR code, so a pool larger than your " +
    "real concurrency does nothing. The right size is 'enough that the wait " +
    "queue stays near empty under peak load' — measure, do not guess."
);

// --------------------------------------------------------------------------
section("7. Cleanup — closing both pools");
// Every pool we opened must be closed, or the process hangs (lesson 01).
// `close()` on a createConnection() connection is the equivalent of
// mongoose.disconnect() for the default one.
await smallPool.close();
await bigPool.close();
show("Both pools closed", {
  smallPoolReadyState: smallPool.readyState,
  bigPoolReadyState: bigPool.readyState,
});
note(
  "Note this lesson never touched mongoose.connection (the global default) — " +
    "createConnection() keeps its pools separate. Next: 03-graceful-shutdown " +
    "shows how a real server drains this pool on SIGINT/SIGTERM."
);

console.log("");
