import { createServer } from "http";
import os from "os";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import config from "../config/env.config.js";
import { errorHandler } from "../middlewares/error.middleware.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requestIdMiddleware } from "../middlewares/requestId.middleware.js";
import correlationIds from "../logger/correlation.logger.js";
import morganMiddleware from "../logger/morgan.logger.js";
import { ApiResponse } from "../utils/apiResponse.util.js";
import router from "../routes/example.routes.js";
import logger from "../logger/winston.logger.js";

const app = express();

const registerMiddlewares = () => {
  // Request/trace identifiers
  app.use(requestIdMiddleware);
  app.use(correlationIds.middleware);

  // Security headers
  app.use(helmet());

  // CORS middleware
  app.use(
    cors({
      origin:
        config.corsOrigin === "*"
          ? "*"
          : config.corsOrigin.split(",").map((o) => o.trim()),
      credentials: true,
    })
  );

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

// Error handling middleware (should be last)
app.use(errorHandler);

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

export default startServer;