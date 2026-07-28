/**
 * LESSON 18-production-and-security/02-safe-patterns — Running this for real
 *
 * The last lesson of the bootcamp. Everything that stands between "it works
 * on my machine" and "it works at 3am under load":
 *
 *   - secrets: where credentials live, and where they must never live
 *   - connection hardening: the URI options that matter
 *   - least privilege: database users that cannot drop your data
 *   - replica sets, failover, and what actually happens during one
 *   - sharding: what it is, when you need it, and the choice you cannot undo
 *   - backups, monitoring, and a deployment checklist
 *
 * 100% READ-ONLY — it inspects server configuration and prints guidance.
 * Nothing is created, changed, or deleted.
 *
 * Run it with:  npm run lesson 18-production-and-security/02-safe-patterns
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import config from "../../../config/env.config.js";

/** Never print a connection string with its password intact. */
const redactUri = (uri) => String(uri).replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");

await runLesson("Production 2/2 — Safe patterns", async () => {
  const db = mongoose.connection.db;

  // --------------------------------------------------------------------
  section("1. Secrets — where credentials live");
  show("How this repo handles it", {
    "the URI": redactUri(config.db.uri),
    "where it comes from": ".env, loaded by `node -r dotenv/config` (see package.json scripts)",
    "validated by": "src/config/env.config.js — Joi makes MONGO_URI required, so boot fails loudly if it is missing",
    "committed?": "no — .env is git-ignored; .env.example documents the shape with no real values",
  });
  show("Rules", {
    "never hardcode": "a credential in source is in every clone, every branch, and your git history forever",
    "never log the URI": "it contains the password. Redact before printing (see redactUri above).",
    "never send it to a client": "which is why the error middleware sends a generic 500 message",
    "rotate on exposure": "if a credential reaches a log, a screenshot, or a repo, treat it as compromised",
    "in production": "use the platform's secret manager (AWS Secrets Manager, Vault, K8s Secrets), not a .env file on disk",
    "if a secret leaks into git history": "rotate it first; rewriting history does not un-leak it",
  });
  note(
    "The single most common MongoDB breach is not an exploit. It is a " +
      "cluster exposed to the internet with no authentication, or a " +
      "connection string committed to a public repository. Both are " +
      "configuration mistakes, not code mistakes."
  );

  // --------------------------------------------------------------------
  section("2. Connection string options that matter");
  show("Options to set deliberately", {
    "retryWrites=true": "retry a single-document write once across a failover. Default on modern drivers — leave it on.",
    "w=majority": "acknowledge only when a majority of members have the write. Survives failover (module 14).",
    "readPreference=primary": "the default, and required for transactions and for read-your-own-writes",
    "maxPoolSize=10": "size the pool per process, and remember to multiply by your process count (module 02)",
    "serverSelectionTimeoutMS=5000": "fail fast when no server is reachable, rather than hanging for 30s",
    "waitQueueTimeoutMS=5000": "fail fast when the pool is saturated, instead of queueing unboundedly",
    "tls=true": "always, for anything not on localhost. Atlas enforces it.",
    "authSource=admin": "where the user is defined, if it is not the target database",
    "appName=my-service": "shows up in server logs and Atlas metrics — makes 'which service is doing this?' answerable",
  });
  show("What this connection actually negotiated", {
    maxPoolSize: config.db.maxPoolSize,
    database: mongoose.connection.name,
    host: mongoose.connection.host,
    readyState: mongoose.connection.readyState,
  });

  // --------------------------------------------------------------------
  section("3. Least privilege — the database user");
  const serverStatus = await db.admin().command({ serverStatus: 1 }).catch(() => null);
  show("Roles, from least to most dangerous", {
    read: "read one database. Use for analytics and reporting jobs.",
    readWrite: "read and write one database. What your APPLICATION should use.",
    dbAdmin: "indexes, stats, validators — but not data. For migration/admin tooling.",
    dbOwner: "readWrite + dbAdmin + user admin on one database",
    root: "everything, on everything. NEVER for an application.",
  });
  show("Why it matters", {
    "an app with root": "a single injection or a bug can drop your entire cluster",
    "an app with readWrite": "the same bug is contained to data in one database",
    "separate users per service": "a compromise of one service does not grant access to another's data",
    "no anonymous access": "MongoDB started without --auth accepts anyone who can reach the port",
    authEnabled: serverStatus?.security?.authentication ? "yes" : "not reported (likely a local dev server)",
  });
  note(
    "Also: bind to an interface, not to the world. `bindIp: 127.0.0.1` for " +
      "local development, a private network address in production, and a " +
      "firewall or VPC in front of it. On Atlas this is the IP access list — " +
      "0.0.0.0/0 there means 'the entire internet may attempt to " +
      "authenticate'."
  );

  // --------------------------------------------------------------------
  section("4. Replica sets and failover");
  const hello = await db.admin().command({ hello: 1 });
  const isReplicaSet = Boolean(hello.setName);
  show("This deployment", {
    type: isReplicaSet ? `replica set '${hello.setName}'` : "standalone (development only)",
    members: hello.hosts ?? ["(single node)"],
    primary: hello.primary ?? "(n/a)",
    isWritablePrimary: hello.isWritablePrimary ?? hello.ismaster,
  });
  show("What a replica set is", {
    structure: "one PRIMARY takes all writes; SECONDARIES replicate from its oplog",
    "why 3 members": "a majority is needed to elect a primary. Two members cannot form a majority when one dies.",
    "the oplog": "a capped collection of every write. Secondaries replay it; change streams and backups read it.",
    arbiter: "a voting member holding no data. Cheap, but it cannot become primary — prefer a real third node.",
    "what you get": "automatic failover, durable writes with w:majority, secondary reads, change streams, TRANSACTIONS",
  });
  show("A failover, step by step", {
    "1": "the primary stops responding to heartbeats",
    "2": "the remaining members hold an election (typically 2-12 seconds)",
    "3": "a secondary with the most recent oplog becomes the new primary",
    "4": "the driver detects the change and reconnects automatically",
    "5": "retryable writes are retried; other operations surface as errors",
    "6": "writes acknowledged with w:1 that never replicated are ROLLED BACK",
    "your job": "w:majority for anything that matters, sensible timeouts, and handling transient errors",
  });

  // --------------------------------------------------------------------
  section("5. Sharding — horizontal scale");
  show("What it is", {
    idea: "split one collection across many servers by a SHARD KEY",
    router: "mongos — your app connects to it and it routes each query to the right shard(s)",
    "config servers": "a replica set holding the chunk map",
    "each shard": "itself a replica set — sharding does not replace replication",
  });
  show("When you actually need it", {
    "data exceeds one machine's disk": "the clearest signal",
    "the working set exceeds RAM": "everything slows down at once — usually the real reason",
    "write throughput exceeds one primary": "reads scale with secondaries; writes need shards",
    "when you do NOT need it": "under a few hundred GB. Add indexes, fix queries, and scale up first — sharding adds real operational complexity.",
  });
  show("Choosing a shard key — the decision you cannot undo cheaply", {
    "high cardinality": "many distinct values, or chunks cannot split",
    "even write distribution": "a monotonically increasing key (a timestamp, an ObjectId) sends EVERY write to one shard",
    "matches your queries": "a query without the shard key is broadcast to every shard, killing the benefit",
    "good examples": "{ customerId: 1, orderDate: 1 }, or a hashed key for pure even distribution",
    "bad examples": "{ createdAt: 1 } (hot shard), { status: 1 } (four values, no room to split)",
    "the cost of getting it wrong": "resharding is possible on MongoDB 5.0+ but expensive — choose carefully",
  });
  note(
    "Sharding is the last resort, not the first optimization. Almost every " +
      "'we need to shard' conversation turns out to be a missing index " +
      "(module 12) or a modelling problem (module 09)."
  );

  // --------------------------------------------------------------------
  section("6. Backups");
  show("Options", {
    "mongodump / mongorestore": "logical backup. Simple, portable, slow on large data. Fine up to tens of GB.",
    "filesystem / volume snapshots": "fast, but MUST be consistent — snapshot the whole volume atomically",
    "Atlas continuous backup": "point-in-time restore from the oplog. What you want if you are on Atlas.",
    "replica set != backup": "replication copies your mistakes instantly. A DROP replicates in milliseconds.",
  });
  show("The part people skip", {
    "test your restores": "an untested backup is a hypothesis, not a backup",
    "know your RPO/RTO": "how much data may you lose, and how long may recovery take? Decide before you need to.",
    "store them elsewhere": "a backup on the same host dies with the host",
    "encrypt them": "a backup file is a complete copy of your data with none of your access controls",
  });

  // --------------------------------------------------------------------
  section("7. Monitoring");
  const stats = await db.command({ dbStats: 1, scale: 1024 * 1024 });
  show("This database right now (MB)", {
    dataSizeMB: Number(stats.dataSize.toFixed(2)),
    indexSizeMB: Number(stats.indexSize.toFixed(2)),
    storageSizeMB: Number(stats.storageSize.toFixed(2)),
    collections: stats.collections,
    documents: stats.objects,
  });
  show("What to watch in production", {
    "slow query log": "db.setProfilingLevel(1, { slowms: 100 }) — then read system.profile",
    "connection count": "serverStatus().connections — saturation looks exactly like slow queries",
    "replication lag": "rs.printSecondaryReplicationInfo() — lagging secondaries serve stale reads",
    "working set vs RAM": "if indexes + hot data exceed RAM, latency degrades across the board",
    "$indexStats": "find indexes nobody uses and drop them",
    "oplog window": "how far back your oplog reaches. Too short and a lagging secondary needs a full resync.",
    "Atlas": "Performance Advisor suggests indexes from real traffic; Real-Time panel shows live operations",
  });

  // --------------------------------------------------------------------
  section("8. Application-side production settings");
  show("Things to change before you deploy", {
    "autoIndex: false":
      "mongoose.connect(uri, { autoIndex: false }). Otherwise a schema change triggers an index build on a live collection at startup.",
    "index management": "run Model.createIndexes() (not syncIndexes) as a deliberate deploy step",
    "maxTimeMS": "cap user-facing queries so one pathological request cannot occupy a connection indefinitely",
    "limit caps": "never honour a client-supplied limit without a maximum",
    "graceful shutdown": "SIGTERM handler that drains requests then closes the pool (module 02)",
    "health check": "must report the DATABASE state, not just process liveness (module 17)",
    "structured logging": "JSON logs with a request id, so one user's failure is traceable",
    "rate limiting": "especially on auth endpoints — this repo ships express-rate-limit",
  });

  // --------------------------------------------------------------------
  section("9. The deployment checklist");
  show("Before going live", {
    security: [
      "authentication enabled, and a per-service user with readWrite (never root)",
      "TLS on, bound to a private network, firewall / IP access list configured",
      "secrets in a secret manager; .env never committed",
      "request validation + type coercion on every endpoint (lesson 01)",
      "rate limiting on authentication routes",
    ],
    reliability: [
      "replica set with at least 3 data-bearing members",
      "w: majority for writes that matter; retryWrites on",
      "backups configured AND a restore actually tested",
      "graceful shutdown and a database-aware health check",
    ],
    performance: [
      "every filter and sort field indexed; explain() run on the hot paths",
      "autoIndex disabled; indexes created as a deploy step",
      "pool size matched to process count",
      "maxTimeMS and limit caps in place",
    ],
    observability: [
      "slow query profiling on",
      "alerts on connection count, replication lag, and disk",
      "structured logs with request ids",
      "$indexStats reviewed periodically",
    ],
  });

  // --------------------------------------------------------------------
  section("10. You have finished the bootcamp");
  show("What you can now do", {
    model: "decide what to embed, what to reference, and what to duplicate on purpose",
    query: "every operator, projection, sort, and both pagination strategies",
    aggregate: "pipelines, $group, $unwind, $lookup, $facet, and the expression language",
    optimize: "read explain(), choose index types and field order, and spot N+1",
    protect: "validation at three layers, middleware, transactions, and concurrency-safe writes",
    operate: "connections and pooling, errors, the native driver, and this checklist",
    build: "the API in module 17 is yours to extend",
  });
  note(
    "Where to go next: MongoDB University (free courses, including the M0 " +
      "Atlas tier), the official documentation (genuinely excellent — start " +
      "with the Data Modeling and Indexes sections), and the Mongoose docs " +
      "for the Node.js specifics. Then go and build something: the modelling " +
      "instincts from module 09 only really form when the schema is yours."
  );
  note(
    "And re-run any lesson whenever you need a reminder — `npm run lesson` " +
      "lists all of them, and `npm run db:seed` restores the data."
  );
});
