/**
 * LESSON 02-connections/03-graceful-shutdown — Closing the pool on purpose
 *
 * Ctrl+C on a running server is not a polite request — by default Node just
 * dies. Any query mid-flight is abandoned, any HTTP response half-written is
 * truncated, and the connection pool is torn down by the operating system.
 * A graceful shutdown turns that into an orderly exit: stop accepting new
 * work, let in-flight work finish, close the pool, then exit.
 *
 * This lesson simulates a real shutdown end to end. It installs SIGINT and
 * SIGTERM handlers, starts some "in-flight" queries, then triggers its own
 * shutdown so you can watch the sequence without pressing anything. (You can
 * also press Ctrl+C during the first few seconds to trigger the real path.)
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 02-connections/03-graceful-shutdown
 */
import mongoose from "mongoose";
import { section, show, note } from "../../lib/lesson-runner.js";
import config from "../../../config/env.config.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";

console.log(`\n${"#".repeat(70)}\n# LESSON: Connections 3/3 — Graceful shutdown\n${"#".repeat(70)}`);

// --------------------------------------------------------------------------
section("1. Why 'just exiting' is not good enough");
note(
  "Two things break on an abrupt exit. (a) In-flight work: a request that " +
    "already wrote to MongoDB but has not sent its HTTP response leaves the " +
    "client with no idea whether it succeeded. (b) The pool: sockets closed " +
    "by the OS rather than by the driver leave the server holding dead " +
    "connections until its own timeout reaps them. Under a rolling deploy, " +
    "restarting 10 pods this way means hundreds of stranded connections."
);

// --------------------------------------------------------------------------
section("2. Connect, and track in-flight work");
await mongoose.connect(config.db.uri, {
  ...(config.db.name ? { dbName: config.db.name } : {}),
  maxPoolSize: config.db.maxPoolSize,
});
show("Connected", {
  readyState: mongoose.connection.readyState,
  database: mongoose.connection.name,
});

// A real server tracks in-flight requests so shutdown knows what to wait for.
// Express does this with `server.close()` (stops accepting NEW connections,
// resolves once existing responses finish). Here we track promises directly.
const inFlight = new Set();

const track = (promise) => {
  inFlight.add(promise);
  // `finally` removes the promise whether it succeeded or failed, so a
  // rejected query can never keep the shutdown waiting forever.
  promise.finally(() => inFlight.delete(promise));
  return promise;
};

// This flag is the "stop accepting new work" switch. Once shutdown starts,
// new requests should be rejected (HTTP 503) rather than queued.
let shuttingDown = false;

const doWork = (label, queryFn) => {
  if (shuttingDown) {
    console.log(`  [rejected] ${label} — server is shutting down (503)`);
    return Promise.resolve(null);
  }
  return track(
    queryFn().then((result) => {
      console.log(`  [done] ${label}`);
      return result;
    })
  );
};

// --------------------------------------------------------------------------
section("3. The shutdown routine");
/**
 * The canonical four steps. Order is not negotiable:
 *   1. flip the "no new work" switch
 *   2. stop the HTTP listener (here: nothing to stop)
 *   3. WAIT for in-flight work — with a hard deadline, so a stuck query
 *      cannot block the exit forever
 *   4. close the database pool, then exit
 */
const gracefulShutdown = async (signal) => {
  // Guard against double-firing: pressing Ctrl+C twice, or SIGTERM arriving
  // while SIGINT is already being handled, must not run this twice.
  if (shuttingDown) {
    console.log(`\n  [${signal}] shutdown already in progress — ignoring`);
    return;
  }
  shuttingDown = true;

  console.log(`\n  [${signal}] shutdown started`);
  console.log(`  [step 1] no longer accepting new work`);
  console.log(`  [step 2] HTTP listener would stop here (server.close())`);
  console.log(`  [step 3] waiting for ${inFlight.size} in-flight operation(s)...`);

  // Race the in-flight work against a deadline. Without this, one hung query
  // means the process never exits and your orchestrator SIGKILLs it anyway —
  // which is exactly the abrupt death we are trying to avoid.
  const FORCE_EXIT_MS = 10_000;
  const deadline = new Promise((resolve) =>
    setTimeout(() => resolve("timeout"), FORCE_EXIT_MS).unref()
  );
  const outcome = await Promise.race([
    Promise.allSettled([...inFlight]).then(() => "drained"),
    deadline,
  ]);

  console.log(`  [step 3] ${outcome === "drained" ? "all work finished" : "DEADLINE HIT — abandoning stragglers"}`);

  // Only now is it safe to close the pool. Closing it first would break the
  // very queries we just waited for.
  console.log(`  [step 4] closing the connection pool`);
  await mongoose.disconnect();
  console.log(`  [step 4] readyState is now ${mongoose.connection.readyState} (0 = disconnected)`);
  console.log(`  [${signal}] shutdown complete — the process can exit cleanly\n`);
};

// SIGINT  = Ctrl+C in your terminal.
// SIGTERM = what Docker, Kubernetes, PM2, and systemd send on stop/restart.
// Handle BOTH: handling only SIGINT means your container never shuts down
// gracefully in production, because production never sends SIGINT.
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

show("Handlers installed", {
  SIGINT: "Ctrl+C (local development)",
  SIGTERM: "docker stop / kubectl delete pod / pm2 restart",
  forceExitAfterMs: 10_000,
});
note(
  "Kubernetes sends SIGTERM, waits terminationGracePeriodSeconds (default " +
    "30s), then SIGKILL. SIGKILL cannot be caught — so your drain deadline " +
    "must be comfortably SHORTER than that grace period, or the orchestrator " +
    "kills you mid-drain."
);

// --------------------------------------------------------------------------
section("4. Simulating traffic, then a shutdown signal");
console.log("  (press Ctrl+C now to trigger the real SIGINT path instead)\n");

// Start three "requests". These are the in-flight operations shutdown waits on.
doWork("GET /orders/recent", () =>
  Order.find().sort({ placedAt: -1 }).limit(5).select("orderNumber totalAmount").lean()
);
doWork("GET /users/count", () => User.countDocuments({ isActive: true }));
doWork("GET /orders/revenue", () =>
  Order.aggregate([
    { $match: { status: "delivered" } },
    { $group: { _id: null, revenue: { $sum: "$totalAmount" } } },
  ])
);

show("In-flight operations at signal time", { count: inFlight.size });

// Fire the signal ourselves so the lesson demonstrates the full path
// unattended. In a real app this line does not exist — the signal comes from
// outside the process.
process.kill(process.pid, "SIGTERM");

// Give the handler time to run before this module finishes. (Signal handlers
// are async; without this the module body would race ahead of them.)
await new Promise((resolve) => setTimeout(resolve, 1500));

// --------------------------------------------------------------------------
section("5. What this looks like in the real app");
note(
  "In src/index.js the same shape applies, with the HTTP server in the mix:\n" +
    "    const server = app.listen(PORT);\n" +
    "    const shutdown = async (signal) => {\n" +
    "      server.close(async () => {        // stop taking new requests\n" +
    "        await disconnectDB();           // then close the pool\n" +
    "        process.exit(0);\n" +
    "      });\n" +
    "      setTimeout(() => process.exit(1), 10000).unref();  // hard deadline\n" +
    "    };\n" +
    "    process.on('SIGINT', () => shutdown('SIGINT'));\n" +
    "    process.on('SIGTERM', () => shutdown('SIGTERM'));"
);
note(
  "Common mistakes: calling disconnectDB() BEFORE server.close() (in-flight " +
    "requests then fail with 'Client must be connected'); forgetting the " +
    "double-signal guard; forgetting the hard deadline; handling SIGINT only; " +
    "and calling process.exit() inside the handler before await finishes — " +
    "process.exit() does not wait for pending promises."
);
note(
  "Module 02 complete. You now know what a connection is, what a pool is, " +
    "and how to close one properly. Next: module 03 — Schema vs Model vs " +
    "Document, the distinction everything else in Mongoose depends on."
);

console.log("");
