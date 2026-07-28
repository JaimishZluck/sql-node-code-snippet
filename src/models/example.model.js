import mongoose from "mongoose";

/**
 * Minimal example model kept from the original app template.
 * The bootcamp's real teaching models are User, Category, Product, Order,
 * and Review — see the other files in this folder.
 */
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
    timestamps: true,
    versionKey: false,
  }
);

const Example =
  mongoose.models.Example || mongoose.model("Example", exampleSchema);

export default Example;
