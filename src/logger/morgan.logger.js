import morgan from "morgan";
import logger from "./winston.logger.js";
import correlationIds from "./correlation.logger.js";

// Stream writes to logger with HTTP level
const stream = {
  write: (message) => logger.http(message.trim()),
};

const morganMiddleware = morgan(
  (tokens, req, res) => {
    const APP_NAME = process.env.APP_NAME || "MyApp";
    const USER_NAME = req.user?.username || "Anonymous";
    const CORRELATION_ID = correlationIds.get() || "NO_CORRELATION_ID";
    return [
      tokens["remote-addr"](req, res), "||", APP_NAME,
      "||", USER_NAME, "||", CORRELATION_ID, "||",
      tokens.method(req, res), "||",
      tokens.url(req, res), "||",
      tokens.status(req, res), "||",
      tokens["response-time"](req, res), "ms"
    ].join(" ");
  },
  { stream }
);

export default morganMiddleware;
