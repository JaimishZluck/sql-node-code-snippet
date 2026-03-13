import startApp from "./server/index.server.js";

// Application entrypoint.
// All environment configuration and validation is handled in src/config/env.config.js.

try {
  startApp();
} catch (error) {
  // Let the process crash on startup issues so container/orchestrator can restart.
  // TODO(project-setup): add startup error reporting/alerting if required.
  throw error;
}
