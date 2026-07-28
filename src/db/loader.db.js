/**
 * Database connection loader (Mongoose).
 *
 * This file owns ONE job: opening and closing the application's connection
 * to MongoDB. Models, seeders, and business logic never connect on their
 * own — they all share the single connection opened here.
 *
 * WHY a single shared connection?
 * `mongoose.connect()` does not open just one socket. It creates a
 * CONNECTION POOL — a set of reusable TCP sockets (up to `maxPoolSize`).
 * Every query borrows a free socket from the pool and returns it when done.
 * Opening a fresh connection per query would pay the TCP + auth handshake
 * cost every time and quickly exhaust server resources.
 *
 * WHY can other files just `import mongoose` and use models without
 * importing this file? Mongoose keeps a default global connection object
 * (`mongoose.connection`). `mongoose.connect()` here configures that global
 * object, and every model created via `mongoose.model()` automatically uses
 * it. That is why models "just work" everywhere once this loader has run.
 */
import mongoose from "mongoose";
import models from "../models/index.js";
import logger from "../logger/winston.logger.js";
import config from "../config/env.config.js";

/**
 * Attach listeners to connection lifecycle events.
 * These fire asynchronously over the life of the app, which makes them the
 * right place for logging/alerting — e.g. MongoDB going down mid-flight
 * emits "disconnected", and the driver retrying successfully emits
 * "reconnected".
 */
const registerConnectionEvents = () => {
  const connection = mongoose.connection;

  connection.on("connected", () => {
    logger.info("Mongoose connected to MongoDB.");
  });

  connection.on("error", (error) => {
    logger.error("Mongoose connection error:", { error: error?.message });
  });

  connection.on("disconnected", () => {
    logger.warn("Mongoose disconnected from MongoDB.");
  });

  connection.on("reconnected", () => {
    logger.info("Mongoose reconnected to MongoDB.");
  });
};

/**
 * Open the application's MongoDB connection (and its socket pool).
 * Called exactly once at startup. Await it before serving traffic so the
 * first request never races the database handshake.
 */
const connectDB = async () => {
  try {
    registerConnectionEvents();

    await mongoose.connect(config.db.uri, {
      // Which database to use. Passing it as an option (instead of putting
      // it in the URI) keeps the URI reusable across databases.
      ...(config.db.name ? { dbName: config.db.name } : {}),

      // Upper bound of sockets in the connection pool. When every socket is
      // busy, additional queries WAIT in a queue inside the driver — they
      // are not rejected. See lesson 02-connections.
      maxPoolSize: config.db.maxPoolSize,
    });

    // Importing the models package here forces every schema to be
    // registered with Mongoose at startup (so `ref: "User"` lookups and
    // populate() never hit an unregistered model at runtime).
    void models;

    logger.info(
      `MongoDB connection established (db: ${mongoose.connection.name}, pool: ${config.db.maxPoolSize}).`
    );
  } catch (error) {
    logger.error("Unable to connect to MongoDB:", {
      error: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
};

/**
 * Close the connection pool gracefully.
 * Called on shutdown (or at the end of a script/lesson/seeder run) so the
 * Node.js process can exit cleanly — an open pool keeps the event loop
 * alive and the process "hangs" without this.
 */
export const disconnectDB = async () => {
  await mongoose.disconnect();
  logger.info("MongoDB connection closed.");
};

export { connectDB };
export default connectDB;
