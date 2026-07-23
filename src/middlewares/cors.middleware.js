import cors from "cors";
import config from "../config/env.config.js";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_ALLOWED_HEADERS = ["Content-Type", "Authorization", "X-Request-Id"];

const allowAllOrigins = config.corsOrigin.trim() === "*";
const configuredOrigins = allowAllOrigins
  ? []
  : config.corsOrigin
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);

const DEFAULT_POLICY = {
  methods: [...HTTP_METHODS],
  headers: [...DEFAULT_ALLOWED_HEADERS],
};

const ORIGIN_POLICY = {
  "http://localhost:3000": {
    methods: ["GET"],
    headers: [...DEFAULT_ALLOWED_HEADERS],
  },
  "http://localhost:5173": {
    methods: ["GET", "POST"],
    headers: [...DEFAULT_ALLOWED_HEADERS],
  },
  "http://localhost:4000": {
    methods: ["POST"],
    headers: [...DEFAULT_ALLOWED_HEADERS],
  },
};

const getRequestMethod = (req) =>
  req.method === "OPTIONS"
    ? req.header("Access-Control-Request-Method") || "OPTIONS"
    : req.method;

const getPolicyForOrigin = (origin) => {
  if (!origin) return DEFAULT_POLICY;
  if (allowAllOrigins) return ORIGIN_POLICY[origin] || DEFAULT_POLICY;
  if (!configuredOrigins.includes(origin)) return null;
  return ORIGIN_POLICY[origin] || DEFAULT_POLICY;
};

const corsOptionsDelegate = (req, callback) => {
  const origin = req.header("Origin");
  const requestMethod = getRequestMethod(req);
  const policy = getPolicyForOrigin(origin);
  const allowedMethods = policy?.methods || [];
  const allowedHeaders = policy?.headers || [];
  const requestedHeaders = (req.header("Access-Control-Request-Headers") || "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  const allowedHeadersLower = allowedHeaders.map((header) => header.toLowerCase());
  const isMethodAllowed = allowedMethods.includes(requestMethod);
  const areHeadersAllowed =
    requestedHeaders.length === 0 ||
    requestedHeaders.every((header) => allowedHeadersLower.includes(header));
  const isAllowed = Boolean(policy) && isMethodAllowed && areHeadersAllowed;

  callback(isAllowed ? null : new Error("Not allowed by CORS"), {
    origin: isAllowed,
    credentials: true,
    methods: allowedMethods,
    allowedHeaders,
    optionsSuccessStatus: 204,
  });
};

export const corsMiddleware = cors(corsOptionsDelegate);
