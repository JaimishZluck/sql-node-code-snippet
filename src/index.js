/**
 * Application Entry Point & Server Setup
 *
 * Consolidates all server initialization and startup logic:
 * - Database connection
 * - Express app configuration
 * - Middleware registration
 * - Route registration
 * - HTTP server startup
 */

import { createServer } from "http";
import os from "os";
import express from "express";
import helmet from "helmet";

import connectDB from "./db/loader.db.js";
import config from "./config/env.config.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { verifyJWT } from "./middlewares/auth.middleware.js";
import { corsMiddleware } from "./middlewares/cors.middleware.js";
import { requestIdMiddleware } from "./middlewares/requestId.middleware.js";
import { rateLimitMiddleware } from "./middlewares/rateLimit.middleware.js";
import correlationIds from "./logger/correlation.logger.js";
import morganMiddleware from "./logger/morgan.logger.js";
import { ApiResponse } from "./utils/apiResponse.util.js";
import router from "./routes/example.routes.js";
import logger from "./logger/winston.logger.js";

const app = express();

/**
 * Register all middleware in correct order
 * Order matters: request identifiers → security → parsing → auth
 */
const registerMiddlewares = () => {
  // Request/trace identifiers
  app.use(requestIdMiddleware);
  app.use(correlationIds.middleware);

  // Security headers
  app.use(helmet());

  // CORS middleware
  app.use(corsMiddleware);

  // Rate limiting middleware
  app.use(rateLimitMiddleware);

  // Body parsing, static files, and HTTP logging
  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: true, limit: "16kb" }));
  app.use(express.static("public"));
  app.use(morganMiddleware);

  // TODO(project-setup): configure project specific middlewares.

  // Authentication
  // TODO(project-setup): configure authentication strategy.
  app.use(verifyJWT());
};

/**
 * Register all routes
 */
const registerRoutes = () => {
  // Base API routes
  // TODO(project-setup): update base API prefix according to the new project name.
  app.use(config.api.basePrefix, router);

  // Health check route
  app.get("/health", (req, res) => {
    const healthCheck = {
      status: "UP",
      uptime: process.uptime(),
      environment: config.env,
      host: os.hostname(),
      platform: os.platform(),
    };

    return res
      .status(200)
      .json(new ApiResponse(200, healthCheck, "Backend service is healthy"));
  });

  // Root route
  app.get("/", (req, res) => {
    res.send(`Welcome to ${config.appName}`);
  });
};

const httpServer = createServer(app);

// Error handling middleware (must be registered last, after all routes)
app.use(errorHandler);


/**
 * Start HTTP server on configured port and host
 */
const startServer = () => {
  registerMiddlewares();
  registerRoutes();

  const port = config.port;
  const host = config.serverHost;

  httpServer.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    logger.info(`HTTP server listening at ${url}`);
  });
};

/**
 * Application startup orchestration
 * 1. Connect to database
 * 2. Start HTTP server
 */
const startApp = async () => {
  try {
    await connectDB();
    startServer();
  } catch (err) {
    logger.error("Error starting the application", {
      error: err.message,
      stack: err.stack
    });
    // Let the process crash on startup issues so container/orchestrator can restart
    process.exit(1);
  }
};

// Start application
try {
  await startApp();
} catch (error) {
  logger.error("Failed to start application:", { error: error?.message, stack: error?.stack });
  process.exit(1);
}

export default startApp; // For testing purposes

