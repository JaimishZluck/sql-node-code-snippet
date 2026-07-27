import { mongoose } from "./connection.db.js";
import models from "../models/index.js";
import logger from "../logger/winston.logger.js";
import config from "../config/env.config.js";

const connectDB = async () => {
  try {
    const dbNameOption = config.db.name ? { dbName: config.db.name } : {};
    await mongoose.connect(config.db.uri, dbNameOption);
    void models;
    logger.info("MongoDB connection established successfully.");
  } catch (error) {
    logger.error("Unable to connect to MongoDB:", { error: error?.message, stack: error?.stack });
    throw error;
  }
};

export default connectDB;
