/**
 * LESSON 14-transactions-and-concurrency/04-write-read-concerns
 *
 * When MongoDB tells you a write succeeded, what exactly has it promised?
 * That question has several answers, and you choose which one you want:
 *
 *   WRITE CONCERN  — how many servers must have the write before you are told
 *                    it succeeded. Durability vs latency.
 *   READ CONCERN   — how "settled" the data you read must be. Freshness vs
 *                    guaranteed-not-to-be-rolled-back.
 *   READ PREFERENCE— which member of the replica set to read from. Load
 *                    distribution vs staleness.
 *
 * These are the knobs behind every "we lost data during a failover" story.
 * They matter most on replica sets, but understanding them changes how you
 * think about durability everywhere.
 *
 * SAFE TO RE-RUN: writes only temporary documents (ZZ- SKUs), cleaned up at
 * both ends.
 *
 * Run it with:  npm run lesson 14-transactions-and-concurrency/04-write-read-concerns
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

const cleanup = () => Product.deleteMany({ sku: /^ZZ-/ });

await runLesson("Transactions 4/4 — Write and read concerns", async () => {
  await cleanup();

  // --------------------------------------------------------------------
  section("1. What the topology looks like");
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  const isReplicaSet = Boolean(hello.setName);
  show("This server", {
    replicaSet: hello.setName ?? "(standalone — no replication)",
    members: hello.hosts?.length ?? 1,
    isWritablePrimary: hello.isWritablePrimary ?? hello.ismaster,
    maxWireVersion: hello.maxWireVersion,
  });
  note(
    isReplicaSet
      ? "You are on a replica set, so the guarantees below are real and " +
          "observable."
      : "You are on a standalone server. Write concern w:'majority' still " +
          "works (a majority of one node is one node), but the interesting " +
          "trade-offs only appear with real replication. The concepts still " +
          "matter — read on, and revisit after setting up a replica set."
  );

  // --------------------------------------------------------------------
  section("2. Write concern — 'how sure do you want to be?'");
  show("The levels", {
    "w: 0": "fire and forget. The server does not even acknowledge. FASTEST, no guarantee at all.",
    "w: 1": "the PRIMARY has it in memory. Default for standalone. A primary crash before replication LOSES it.",
    "w: 'majority'":
      "a majority of voting members have it. Survives a failover. THE DEFAULT on modern replica sets, and what you want for anything that matters.",
    "w: 2 / w: 3": "a specific count of members. Rarely better than 'majority'.",
    "j: true": "the write is in the on-disk journal, not just RAM. Survives an abrupt process kill.",
    wtimeout: "give up waiting after N ms. NOTE: a timeout does NOT undo the write.",
  });

  // Mongoose passes writeConcern straight through to the driver.
  const category = (await Product.findOne().select("category").lean()).category;

  const timed = async (label, fn) => {
    const t = process.hrtime.bigint();
    await fn();
    return { [label]: Number((Number(process.hrtime.bigint() - t) / 1e6).toFixed(2)) };
  };

  const fast = await timed("w: 1 (ms)", () =>
    Product.create([{ name: "ZZ WC One", sku: "ZZ-WC-1", price: 100, stock: 1, category }], {
      writeConcern: { w: 1 },
    })
  );
  const durable = await timed("w: 'majority', j: true (ms)", () =>
    Product.create([{ name: "ZZ WC Majority", sku: "ZZ-WC-2", price: 100, stock: 1, category }], {
      writeConcern: { w: "majority", j: true },
    })
  );
  show("Same insert, two durability levels", { ...fast, ...durable });
  note(
    "On a local single node the difference is small; across a replica set " +
      "spanning availability zones, w:'majority' adds a network round trip to " +
      "another machine. That latency IS the durability — you are waiting for " +
      "a second copy to exist. Do not 'optimize' it away on writes that " +
      "matter."
  );
  note(
    "The dangerous one is w: 0. The driver reports success immediately, even " +
      "if the write was rejected by a validator or a unique index. You will " +
      "never hear about the failure. Use it only for genuinely disposable " +
      "data like high-volume metrics."
  );

  // --------------------------------------------------------------------
  section("3. Setting write concern at each level");
  show("Where you can set it", {
    "connection string": "mongodb://host/db?w=majority&journal=true — applies to everything",
    "per model": "new mongoose.Schema({...}, { writeConcern: { w: 'majority', j: true } })",
    "per operation": "Model.create([doc], { writeConcern: { w: 1 } })",
    "per transaction": "session.withTransaction(fn, { writeConcern: { w: 'majority' } })",
    precedence: "operation > model > connection string",
    "sensible default": "w:'majority' globally, and relax it only where you have measured a need",
  });

  // --------------------------------------------------------------------
  section("4. Read concern — 'how settled must this data be?'");
  show("The levels", {
    local: "whatever this node has right now. May include writes that a failover could ROLL BACK. Default.",
    available: "like local but skips shard-consistency checks. Sharded clusters only; can return orphans.",
    majority:
      "only data acknowledged by a majority — guaranteed never to be rolled back. Slightly staler, much safer.",
    linearizable:
      "reflects all writes acknowledged before this read began. Strongest, slowest, primary + single doc only.",
    snapshot: "a consistent point-in-time view across the whole operation. Used inside transactions.",
  });

  const localRead = await Product.find({ sku: /^ZZ-WC/ })
    .read("primary")
    .setOptions({ readConcern: { level: "local" } })
    .select("sku")
    .lean();
  const majorityRead = await Product.find({ sku: /^ZZ-WC/ })
    .setOptions({ readConcern: { level: "majority" } })
    .select("sku")
    .lean();
  show("Same query, two read concerns", {
    "readConcern local": localRead.map((d) => d.sku),
    "readConcern majority": majorityRead.map((d) => d.sku),
    identicalHere: localRead.length === majorityRead.length,
  });
  note(
    "Identical results here, because nothing is failing over. The difference " +
      "appears at the worst possible moment: during a primary election, a " +
      "'local' read can return a write that the new primary never received — " +
      "so it effectively un-happens. Reading with 'majority' means anything " +
      "you saw is permanent. Use it wherever you make a decision based on " +
      "the read (payment status, entitlement checks)."
  );

  // --------------------------------------------------------------------
  section("5. Read preference — which member answers?");
  show("The modes", {
    primary: "always the primary. Strongest consistency. THE DEFAULT.",
    primaryPreferred: "primary if available, otherwise a secondary",
    secondary: "only secondaries. Distributes read load; data may lag.",
    secondaryPreferred: "secondaries if available, otherwise the primary",
    nearest: "lowest network latency, primary or secondary. Good for geo-distributed reads.",
  });
  const primaryRead = await Order.countDocuments({ status: "delivered" });
  // On a standalone this silently falls back to the only node available.
  const nearestRead = await Order.find({ status: "delivered" })
    .read("nearest")
    .countDocuments();
  show("Counting the same thing two ways", {
    "read('primary')": primaryRead,
    "read('nearest')": nearestRead,
  });
  note(
    "Reading from secondaries is tempting — free capacity! — but REPLICATION " +
      "LAG is real. A user who places an order (write to primary) and is " +
      "redirected to their order list (read from a secondary) can be told the " +
      "order does not exist. This 'read your own writes' failure is the " +
      "classic secondary-reads bug. Rules: use secondaries for analytics, " +
      "reports, and exports; use the primary for anything a user just wrote."
  );
  note(
    "Transactions REQUIRE readPreference: 'primary'. You cannot run one " +
      "against a secondary at all."
  );

  // --------------------------------------------------------------------
  section("6. Putting them together");
  show("Sensible defaults by workload", {
    "user-facing writes (orders, payments)": "w: 'majority', j: true, readConcern 'majority', primary",
    "user-facing reads": "readConcern 'local' (default), primary — freshness matters more than settledness",
    "read-your-own-writes flows": "primary reads, always",
    "analytics / reporting / exports": "secondaryPreferred, readConcern 'local' — staleness is fine",
    "metrics and logs": "w: 0 or w: 1 — throughput matters more than any single record",
    "inside a transaction": "readConcern 'snapshot', w: 'majority', primary (mostly the defaults)",
  });

  // --------------------------------------------------------------------
  section("7. What actually happens during a failover");
  note(
    "Sequence: the primary becomes unreachable -> the remaining members hold " +
      "an ELECTION (a few seconds) -> a secondary becomes the new primary -> " +
      "the driver reconnects automatically and RETRIES retryable operations. " +
      "During the election, writes fail or queue; reads from secondaries keep " +
      "working."
  );
  show("What this means for your code", {
    "retryable writes": "on by default — a single-document write is retried once automatically",
    "retryWrites=true": "in the connection string; leave it on",
    "what is NOT retried": "multi-document operations and anything non-idempotent, unless in a transaction",
    "rollback": "writes acknowledged with w:1 that never replicated are DISCARDED by the new primary",
    "the lesson": "w: 'majority' is what makes 'we told the user it succeeded' true after a failover",
    "your job": "handle transient connection errors; do not assume the primary never moves",
  });

  // --------------------------------------------------------------------
  section("8. Cleanup");
  await cleanup();
  show("Cleanup", { tempProducts: await Product.countDocuments({ sku: /^ZZ-/ }) });
  note(
    "Module 14 complete. Next: module 15 — every error MongoDB and Mongoose " +
      "can throw at you, and how a real API should respond to each."
  );
});
