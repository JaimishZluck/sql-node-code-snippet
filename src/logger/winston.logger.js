
import winston from "winston";
import path from "path";
import util from "util";

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || "development";
  return env === "development" ? "debug" : "warn";
};

const colors = {
  error: "red",
  warn: "yellow",
  info: "blue",
  http: "magenta",
  debug: "white",
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: "DD MMM, YYYY - HH:mm:ss:ms" }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...metadata } = info;

    // Filter out internal Winston properties
    const filteredMetadata = Object.fromEntries(
      Object.entries(metadata).filter(([key]) => !key.startsWith('Symbol('))
    );

    const metadataString = Object.keys(filteredMetadata).length > 0
      ? `\n${util.inspect(filteredMetadata, { colors: true, depth: null })}`
      : "";

    return `[${timestamp}] ${level}: ${message}${metadataString}`;
  })
);

const getLogFileName = (level) => {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format
  return path.join("logs", `${date}-${level}.log`);
};

const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: getLogFileName("combined"),
  }),
  new winston.transports.File({
    filename: getLogFileName("error"),
    level: "error",
  }),
  new winston.transports.File({ filename: "logs/combined.log" }),
  new winston.transports.File({ filename: "logs/error.log", level: "error" }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

export default logger;
