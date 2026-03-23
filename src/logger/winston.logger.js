import winston from "winston";
import path from "path";
import util from "util";
import correlationIds from './correlation.logger.js';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};
const level = () => {
  const env = process.env.NODE_ENV || "development";
  return env === "development" ? "debug" : "http";
};
const colors = {
  error: "red",
  warn: "yellow",
  info: "blue",
  http: "magenta",
  debug: "cyan",
};

winston.addColors(colors);

const getTimestamp = () => {
  const now = new Date();
  const pad = (n, z = 2) => ('00' + n).slice(-z);
  const hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;

  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
    `${pad(hour12)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}:${pad(now.getMilliseconds(), 4)} ${ampm}`;
};

// Format for console output (with colors)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: getTimestamp
  }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...metadata } = info;
    const correlationId = correlationIds.get() || 'NO_CORRELATION_ID';

    // Filter metadata: only keep safe, defined fields
    const safeFields = {};
    const allowedKeys = ['method', 'url', 'status', 'ip', 'user', 'file', 'line', 'column', 'function', 'error', 'code'];

    for (const [key, value] of Object.entries(metadata)) {
      // Skip Symbol properties and undefined values
      if (!key.startsWith('Symbol(') && value !== undefined && value !== null) {
        if (allowedKeys.includes(key) || (typeof value === 'string' && value.length < 500)) {
          safeFields[key] = value;
        }
      }
    }

    const metadataString = Object.keys(safeFields).length > 0
      ? `\n${util.inspect(safeFields, { colors: true, depth: 2 })}`
      : "";

    return `[${timestamp}] [${correlationId}] ${level}: ${message}${metadataString}`;
  })
);

// Format for file output (without colors)
const fileFormat = winston.format.combine(
  winston.format.timestamp({
    format: getTimestamp
  }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...metadata } = info;
    const correlationId = correlationIds.get() || 'NO_CORRELATION_ID';

    // Filter metadata: only keep safe, defined fields
    const safeFields = {};
    const allowedKeys = ['method', 'url', 'status', 'ip', 'user', 'file', 'line', 'column', 'function', 'error', 'code'];

    for (const [key, value] of Object.entries(metadata)) {
      // Skip Symbol properties and undefined values
      if (!key.startsWith('Symbol(') && value !== undefined && value !== null) {
        if (allowedKeys.includes(key) || (typeof value === 'string' && value.length < 500)) {
          safeFields[key] = value;
        }
      }
    }

    const metadataString = Object.keys(safeFields).length > 0
      ? `\n${JSON.stringify(safeFields, null, 2)}`
      : "";

    return `[${timestamp}] [${correlationId}] ${level}: ${message}${metadataString}`;
  })
);

const getLogFileName = (level) => {
  const date = new Date().toISOString().split("T")[ 0 ]; // YYYY-MM-DD format
  return path.join("logs", `${date}-${level}.log`);
};

const transports = [
  new winston.transports.Console({
    format: consoleFormat
  }),
  new winston.transports.File({
    filename: getLogFileName("combined"),
    format: fileFormat
  }),
  new winston.transports.File({
    filename: getLogFileName("error"),
    level: "error",
    format: fileFormat
  }),
  new winston.transports.File({
    filename: "logs/combined.log",
    format: fileFormat
  }),
  new winston.transports.File({
    filename: "logs/error.log",
    level: "error",
    format: fileFormat
  }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
});

export default logger;
