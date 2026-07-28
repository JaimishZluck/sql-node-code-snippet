/**
 * The bootcamp API — everything from modules 1-16 as a runnable Express app.
 *
 * Start it with:  npm run bootcamp:api
 * Then open:      http://localhost:4100
 *
 * This is deliberately separate from the repo's main app (src/index.js). It
 * has no auth, no rate limiting, and no logging middleware, because the point
 * is to show the DATABASE patterns without anything else competing for your
 * attention. Everything here is a real pattern you would keep; the things it
 * omits are covered by the main template.
 */
import express from "express";
import mongoose from "mongoose";
import connectDB, { disconnectDB } from "../../db/loader.db.js";
import productRoutes from "./products.routes.js";
import orderRoutes from "./orders.routes.js";
import dashboardRoutes from "./dashboard.routes.js";
import { errorMiddleware, notFoundMiddleware } from "./lib/error.middleware.js";

const PORT = Number(process.env.BOOTCAMP_API_PORT ?? 4100);

const app = express();
app.use(express.json());

/**
 * A health endpoint that reports the DATABASE state, not just "the process is
 * alive". readyState 1 means connected (module 02) — an orchestrator that only
 * checks whether the port answers will happily route traffic to an instance
 * that cannot reach MongoDB.
 */
app.get("/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    status: connected ? "ok" : "degraded",
    database: {
      readyState: mongoose.connection.readyState,
      name: mongoose.connection.name,
    },
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** A tiny index so the API is explorable from a browser. */
app.get("/", (req, res) => {
  res.json({
    name: "MongoDB Bootcamp API",
    tryThese: {
      "list products": "/api/products?minPrice=1000&sort=price-desc",
      "filter by tags": "/api/products?tag=premium&inStock=true&limit=5",
      "text search": "/api/products/search?q=wireless",
      "product detail": "/api/products/<id>",
      "orders (cursor paged)": "/api/orders?limit=5",
      "order detail": "/api/orders/<id>",
      "place an order": "POST /api/orders  { userId, items: [{ productId, quantity }] }",
      "dashboard summary": "/api/dashboard/summary",
      "top products": "/api/dashboard/top-products?limit=5",
      "top customers": "/api/dashboard/customers?city=Mumbai",
      "catalogue health": "/api/dashboard/catalogue",
      health: "/health",
    },
  });
});

app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Order matters: the 404 handler must come after every real route, and the
// error handler must be LAST of all.
app.use(notFoundMiddleware);
app.use(errorMiddleware);

/**
 * Connect BEFORE listening.
 *
 * If we listened first, the first few requests would race the database
 * handshake and hit Mongoose's buffering timeout (module 15). Failing to
 * start at all is a much better outcome than starting broken.
 */
await connectDB();

const server = app.listen(PORT, () => {
  console.log(`\n  MongoDB Bootcamp API listening on http://localhost:${PORT}`);
  console.log(`  Try:  http://localhost:${PORT}/api/products?minPrice=1000&sort=price-desc`);
  console.log(`  Stop: Ctrl+C\n`);
});

/**
 * Graceful shutdown (module 02, lesson 03).
 *
 * Order is not negotiable: stop accepting new requests, let in-flight ones
 * finish, THEN close the connection pool. Closing the pool first would break
 * the very requests we are waiting for.
 */
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return; // guard against a second Ctrl+C
  shuttingDown = true;
  console.log(`\n  [${signal}] shutting down...`);

  // A hard deadline, so one stuck request cannot block the exit forever.
  const forceExit = setTimeout(() => {
    console.error("  [shutdown] deadline hit — forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    await disconnectDB();
    console.log("  [shutdown] complete\n");
    process.exit(0);
  });
};

// SIGINT is Ctrl+C; SIGTERM is what Docker, Kubernetes, and PM2 send.
// Handling only SIGINT means your container never shuts down gracefully.
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
