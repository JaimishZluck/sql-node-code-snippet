import mongoose from "mongoose";
import addressSchema from "./schemas/address.schema.js";

/**
 * User model — customers, sellers, and admins of our imaginary store.
 *
 * TERMINOLOGY (the three words you must never mix up):
 *  - SCHEMA:   the blueprint. It describes what fields a document has, their
 *              types, defaults, and validation rules. Pure configuration —
 *              it touches no database.
 *  - MODEL:    the schema compiled into a class bound to ONE MongoDB
 *              collection ("users" here). The model is what you query:
 *              `User.find()`, `User.create()`, ...
 *  - DOCUMENT: one record returned by (or saved through) the model — a JS
 *              object with data PLUS attached methods (.save(), .populate()).
 *
 * WHAT MONGODB ACTUALLY STORES: plain BSON documents. MongoDB knows nothing
 * about this schema. Types, `required`, `enum`, defaults, `trim` — all of
 * that is enforced by Mongoose in Node.js BEFORE the data is sent to the
 * server. The only rule below that lives in the database itself is the
 * unique index created by `unique: true` (uniqueness must be checked
 * centrally, so it can only be a database-level guarantee).
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true, // Mongoose validation: reject save without a name
      trim: true, // strip accidental spaces: "  Prem " -> "Prem"
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      // NOT a validator! `unique: true` tells Mongoose to create a UNIQUE
      // INDEX in MongoDB. Duplicates are rejected by the DATABASE with a
      // duplicate-key error (E11000), not with a Mongoose ValidationError.
      unique: true,
      lowercase: true, // setter: normalizes before saving, so lookups match
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    age: {
      type: Number,
      min: [13, "Users must be at least 13"],
      max: 120,
    },
    role: {
      type: String,
      enum: ["customer", "seller", "admin"], // only these values pass validation
      default: "customer",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Embedded one-to-one relationship: the address lives INSIDE the user
    // document. One read fetches the user and the address together.
    address: addressSchema,
    // Array of primitive values — a "multikey" field. MongoDB can index and
    // query individual elements: { interests: "yoga" } matches any user
    // whose array CONTAINS "yoga".
    interests: {
      type: [String],
      default: [],
    },
    loyaltyPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastLoginAt: {
      type: Date,
    },
    // Soft delete: instead of removing the document we stamp WHEN it was
    // "deleted" and filter it out of normal queries. null = not deleted.
    // (See lesson 07-updates-and-deletes.)
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    // Explicit collection name. Without this Mongoose would pluralize +
    // lowercase the model name ("User" -> "users") — same result here, but
    // stating it removes the magic.
    collection: "users",
    // Adds createdAt/updatedAt Date fields and maintains them automatically
    // on every save/update.
    timestamps: true,
    // Removes the `__v` version key. We keep __v on Order (where we teach
    // optimistic concurrency); users don't need it.
    versionKey: false,
  }
);

// VIRTUAL: a computed property that exists on the Mongoose document only —
// MongoDB never stores it. Reading `user.isDeleted` runs this getter.
userSchema.virtual("isDeleted").get(function () {
  return this.deletedAt !== null;
});

// Secondary index on a NESTED field (dot notation), for queries like
// "all users in Mumbai". See lesson 12-indexes-and-performance.
userSchema.index({ "address.city": 1 });

// Compound index supporting the common "active users by role" query.
userSchema.index({ role: 1, isActive: 1 });

// `mongoose.models.User || ...` guard: compiling the same model name twice
// throws (it can happen with hot reload / repeated imports). Reuse the
// already-compiled model if it exists.
const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;
