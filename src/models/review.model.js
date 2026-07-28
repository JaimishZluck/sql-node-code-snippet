import mongoose from "mongoose";

/**
 * Review model — one user's review of one product.
 *
 * This collection is the classic way to model a MANY-TO-MANY relationship
 * in MongoDB: many users review many products, so each review document
 * holds one (user, product) pair — much like a join table in SQL, except
 * the "join row" here can carry rich data of its own (rating, text, votes).
 *
 * WHY a separate collection instead of embedding reviews in the product?
 * A popular product can collect thousands of reviews. Embedding them would
 * grow the product document without bound (MongoDB caps documents at 16 MB)
 * and force every product read to drag all reviews along. Unbounded
 * one-to-many => reference, bounded => embed. (Lesson 09-data-modeling.)
 */
const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: [1, "Rating must be between 1 and 5"],
      max: [5, "Rating must be between 1 and 5"],
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    helpfulVotes: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    collection: "reviews",
    timestamps: true,
    versionKey: false,
  }
);

// COMPOUND UNIQUE index: one review per (product, user) pair. A user trying
// to review the same product twice gets a duplicate-key error (E11000) from
// MongoDB itself — this rule cannot be enforced reliably in app code alone,
// because two simultaneous requests would both pass an app-level check.
reviewSchema.index({ product: 1, user: 1 }, { unique: true });

// Supports "reviews for product X, newest first" on product pages.
reviewSchema.index({ product: 1, createdAt: -1 });

const Review = mongoose.models.Review || mongoose.model("Review", reviewSchema);

export default Review;
