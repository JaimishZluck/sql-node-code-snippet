/**
 * LESSON 02-connections/01-connection-lifecycle — Connect, observe, disconnect
 *
 * Every other lesson in this bootcamp calls `runLesson()` and never thinks
 * about the connection. This module is the exception: here the connection IS
 * the subject, so we drive `mongoose.connect()` / `mongoose.disconnect()` by
 * hand and watch every lifecycle event fire in real time.
 *
 * You will see: readyState transitions (0 -> 2 -> 1 -> 3 -> 0), the order in
 * which events fire, why listeners must be attached BEFORE connecting, that
 * `mongoose.connection` is one shared global object, and that a query issued
 * before connecting is BUFFERED rather than rejected.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 02-connections/01-connection-lifecycle
 */
import mongoose from "mongoose";
import { section, show, note } from "../../lib/lesson-runner.js";
import config from "../../../config/env.config.js";
import User from "../../../models/user.model.js";

// Mongoose exposes the connection state as a NUMBER. These are the official
// values (mongoose.STATES maps them both ways). Knowing them is how you write
// a real health-check endpoint: `mongoose.connection.readyState === 1`.
const STATE_NAMES = {
  0: "0 = disconnected",
  1: "1 = connected",
  2: "2 = connecting",
  3: "3 = disconnecting",
  99: "99 = uninitialized",
};

const describeState = () =>
  STATE_NAMES[mongoose.connection.readyState] ?? mongoose.connection.readyState;

console.log(`\n${"#".repeat(70)}\n# LESSON: Connections 1/3 — Connection lifecycle\n${"#".repeat(70)}`);

// --------------------------------------------------------------------------
section("1. Before connecting — the connection object already exists");
// `mongoose.connection` is created the moment you import mongoose. It is a
// long-lived object representing the DEFAULT connection; connect() configures
// it rather than creating it. This is why models registered in any file
// automatically use the connection opened in loader.db.js.
show("State before connect()", {
  readyState: describeState(),
  isTheSameObjectEveryImport: mongoose.connection === mongoose.connections[0],
  // `name` is the database name — unknown until the handshake completes.
  databaseName: mongoose.connection.name ?? "(not known yet)",
});
note(
  "readyState 0 means 'disconnected' — the object exists, but no socket is " +
    "open. Mongoose creates this object at import time so that models and " +
    "event listeners can be wired up before the database is reachable."
);

// --------------------------------------------------------------------------
section("2. Attaching lifecycle listeners BEFORE connect()");
// Order matters. `connect()` starts an asynchronous handshake; if the
// 'connected' event fires before you attach a listener, you simply miss it.
// Node's EventEmitter does not replay past events for late subscribers.
// This is exactly why loader.db.js calls registerConnectionEvents() first.
const timeline = [];
const stamp = (event) =>
  timeline.push({ event, readyStateAtThatMoment: mongoose.connection.readyState });

mongoose.connection.on("connecting", () => stamp("connecting"));
mongoose.connection.on("connected", () => stamp("connected"));
// 'open' fires after 'connected', once Mongoose has finished its own internal
// setup (index builds queued, models bound). Application code that must run
// "once the DB is truly ready" belongs here, not on 'connected'.
mongoose.connection.on("open", () => stamp("open"));
mongoose.connection.on("disconnected", () => stamp("disconnected"));
mongoose.connection.on("close", () => stamp("close"));
// 'error' fires for connection-level failures (bad URI, auth failure, server
// gone). An unhandled 'error' event would crash the process, so ALWAYS
// register one — this is the single most commonly forgotten listener.
mongoose.connection.on("error", (err) => stamp(`error: ${err.message}`));

note(
  "Five listeners attached while readyState is still 0. Node's EventEmitter " +
    "does not buffer past events, so a listener attached after the event " +
    "fired never runs — that is why loader.db.js registers listeners first."
);

// --------------------------------------------------------------------------
section("3. Queries issued before connecting are BUFFERED, not rejected");
// Mongoose holds operations in a per-model buffer while readyState !== 1 and
// flushes them as soon as the connection opens. We start the query here and
// deliberately do NOT await it yet.
const bufferedCountPromise = User.countDocuments();
show("Query started while disconnected", {
  readyState: describeState(),
  promisePending: true,
});
note(
  "Nothing has been sent to MongoDB yet. Mongoose parked this operation in " +
    "its buffer. Default bufferTimeoutMS is 10000 — if no connection appears " +
    "within 10s the promise rejects with the famous error: 'Operation " +
    "`users.countDocuments()` buffering timed out after 10000ms'. When you " +
    "see that message in production, the real problem is that connect() " +
    "never succeeded — not that the query is slow."
);

// --------------------------------------------------------------------------
section("4. Connecting — the handshake");
const startedAt = process.hrtime.bigint();

// The SAME call loader.db.js makes. connect() resolves once the driver has
// selected a server, authenticated, and opened the pool's first socket.
await mongoose.connect(config.db.uri, {
  ...(config.db.name ? { dbName: config.db.name } : {}),
  maxPoolSize: config.db.maxPoolSize,
});

const connectMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

// The buffered query from section 3 flushed automatically the moment the
// connection opened — no retry logic needed on our side.
const bufferedCount = await bufferedCountPromise;

show("After connect()", {
  readyState: describeState(),
  handshakeMs: Number(connectMs.toFixed(1)),
  databaseName: mongoose.connection.name,
  host: mongoose.connection.host,
  port: mongoose.connection.port,
  bufferedQueryResolvedTo: bufferedCount,
});
note(
  "The buffered countDocuments() returned 30 without us retrying anything. " +
    "The handshake cost (TCP + server selection + auth) is why we open ONE " +
    "pool at startup and reuse it, instead of connecting per query."
);

// --------------------------------------------------------------------------
section("5. The event timeline so far");
show("Events, in the order they fired", timeline);
note(
  "'connecting' fires at readyState 2, then 'connected' and 'open' at 1. " +
    "Use 'open' (not 'connected') when the follow-up work needs models fully " +
    "ready. Note there is no 'reconnected' entry — that one only appears " +
    "after a connection DROPS and the driver recovers it."
);

// --------------------------------------------------------------------------
section("6. Two normal queries on the open pool");
// Nothing special here: this is what every other lesson does implicitly.
const [adminCount, sample] = await Promise.all([
  User.countDocuments({ role: "admin" }),
  User.findOne().select("name email role").lean(),
]);
show("Ordinary work over the live connection", { adminCount, sample });

// --------------------------------------------------------------------------
section("7. Disconnecting — and why scripts hang without it");
// An open pool holds active sockets, and active sockets are "handles" that
// keep Node's event loop alive. A script that finishes its work but never
// disconnects prints all its output and then sits there forever.
show("State before disconnect()", { readyState: describeState() });

await mongoose.disconnect();

show("State after disconnect()", {
  readyState: describeState(),
  eventsAfterDisconnect: timeline.slice(-2),
});
note(
  "readyState is back to 0 and 'disconnected' + 'close' fired. This is the " +
    "whole reason runLesson() wraps every other lesson in a try/finally that " +
    "calls disconnectDB() — without it, `npm run lesson ...` would never " +
    "return to your prompt. Next: 02-connection-pool shows what maxPoolSize " +
    "actually does to concurrent queries."
);

console.log("");
