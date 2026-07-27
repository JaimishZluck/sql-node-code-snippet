import logger from "../logger/winston.logger.js";
import mongoose from "mongoose";

logger.info("Initializing Example model");

const exampleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    collection: "examples",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

const Example = mongoose.models.Example || mongoose.model("Example", exampleSchema);

export default Example;