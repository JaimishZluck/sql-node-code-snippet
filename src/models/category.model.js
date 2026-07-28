import mongoose from "mongoose";

/**
 * Category model — product categories with an optional parent category.
 *
 * This model demonstrates a PARENT-CHILD (self-referencing) relationship:
 * a category may point at another document in the SAME collection through
 * `parent`. "Laptops" -> parent "Electronics"; "Electronics" -> parent null.
 *
 * WHY a reference here instead of embedding?
 * A tree can be arbitrarily deep and a parent is shared by many children.
 * Embedding the parent inside every child would duplicate it endlessly.
 * Storing just the parent's ObjectId (like a foreign key in SQL — but NOT
 * enforced by the database) keeps each document small.
 */
const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true, // creates a unique index in MongoDB
      trim: true,
    },
    // URL-friendly identifier ("Home & Kitchen" -> "home-and-kitchen").
    // Real APIs expose slugs instead of raw ObjectIds in URLs.
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    // Self-reference: an ObjectId pointing at another Category document.
    // `ref` is Mongoose-only metadata — it tells populate() which model to
    // load. MongoDB itself stores a plain ObjectId and enforces NOTHING
    // about it (no foreign-key constraint exists).
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null, // null = top-level category
    },
  },
  {
    collection: "categories",
    timestamps: true,
    versionKey: false,
  }
);

const Category =
  mongoose.models.Category || mongoose.model("Category", categorySchema);

export default Category;
