import morgan from "morgan";
import logger from "./winston.logger.js";

// Stream writes to logger with HTTP level
const stream = {
  write: (message) => logger.http(message.trim()),
};

// Skip logging in environments other than development
const skip = () => {
  const env = process.env.NODE_ENV || "development";
  return env !== "development";
};

// Morgan middleware to structure log using `||`
// It will log the user's username if available in `req.user.username`
const morganMiddleware = morgan(
  (tokens, req, res) => {
    const username = req.user?.username || "anonymous"; 
    return [
      tokens["remote-addr"](req, res),
      "||", username, "||",
      tokens.method(req, res), "||",
      tokens.url(req, res), "||",
      tokens.status(req, res), "||",
      tokens["response-time"](req, res), "ms"
    ].join(" ");
  },
  { stream, skip }
);

export default morganMiddleware;
