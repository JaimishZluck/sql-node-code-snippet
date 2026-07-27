import logger from "../logger/winston.logger.js";
import mongoose from "mongoose";

logger.info("Initializing Order model");

const orderSchema = new mongoose.Schema(
  {
    order_name: {
      type: String,
      required: true,
      trim: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    collection: "orders",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
