import Joi from "joi";

const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  PORT: Joi.number().default(4000),
  APP_NAME: Joi.string().default("BaseBackendService"),
  SERVER_HOST: Joi.string().hostname().default("localhost"),
  CORS_ORIGIN: Joi.string().default("*"),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000),
  RATE_LIMIT_MAX: Joi.number().default(100),

  DB_NAME: Joi.string().allow("").optional(),
  DB_USERNAME: Joi.string().allow("").optional(),
  DB_PASSWORD: Joi.string().allow("").optional(),
  DB_HOST: Joi.string().allow("").optional(),

  JWT_SECRET: Joi.string().min(8).required(),
  JWT_EXPIRY: Joi.string().default("1d"),

  LOG_LEVEL: Joi.string()
    .valid("error", "warn", "info", "http", "debug")
    .default("info"),

  REDIS_URL: Joi.string().allow("").optional(),
  SOCKET_IO_PATH: Joi.string().default("/socket.io"),
  API_BASE_PREFIX: Joi.string().default("/api/v1"),
})
  .unknown()
  .prefs({ abortEarly: false });

const { value: env, error } = envSchema.validate(process.env);

if (error) {
  // TODO(project-setup): update required environment variables for your project.
  throw new Error(
    `Environment validation error: ${error.details
      .map((d) => d.message)
      .join(", ")}`
  );
}

const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  appName: env.APP_NAME,
  serverHost: env.SERVER_HOST,
  corsOrigin: env.CORS_ORIGIN,
  db: {
    // TODO(project-setup): update database configuration as needed.
    name: env.DB_NAME,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    host: env.DB_HOST,
  },
  jwt: {
    secret: env.JWT_SECRET,
    expiry: env.JWT_EXPIRY,
  },
  logLevel: env.LOG_LEVEL,
  redisUrl: env.REDIS_URL,
  socket: {
    path: env.SOCKET_IO_PATH,
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },
  api: {
    basePrefix: env.API_BASE_PREFIX,
  },
};

export default config;

