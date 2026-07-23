import { sequelize } from "./connection.db.js";
import models from "../models/index.js";
import logger from "../logger/winston.logger.js";

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    void models;
    // await sequelize.sync();
    logger.info("Connection has been established successfully.");
  } catch (error) {
    logger.error("Unable to connect to the database:", { error: error?.message, stack: error?.stack });
    throw error;
  }
};

export default connectDB;
