import mongoose from "mongoose";

/**
 * Product model — the store's catalog.
 *
 * Teaching highlights in this schema:
 *  - a reference to Category (one-to-many: one category, many products)
 *  - an array of tags (multikey queries + multikey index)
 *  - a nested `specs` object (dot-notation queries)
 *  - DENORMALIZED rating summary (copy of data that "belongs" to reviews)
 *  - compound, multikey, and text indexes
 *  - a virtual computed from stored fields
 */
const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: 120,
    },
    // Stock-keeping unit — the human-friendly unique product code.
    sku: {
      type: String,
      required: true,
      unique: true, // unique index — enforced by MongoDB, not Mongoose
      uppercase: true, // setter: "abc-1" is stored as "ABC-1"
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    // NOTE: JavaScript numbers are 64-bit floats — fine for a learning
    // project, but real money handling often uses integer paise/cents or
    // mongoose.Schema.Types.Decimal128. See lesson 01 (BSON types).
    price: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
    },
    discountPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 90,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    // One-to-many REFERENCE: products store their category's ObjectId.
    // populate("category") swaps the id for the actual category document.
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    // Array of strings. A query like { tags: "wireless" } matches products
    // whose array CONTAINS "wireless" — MongoDB checks each element.
    tags: {
      type: [String],
      default: [],
    },
    // Embedded document with mixed field types — queried with dot notation:
    // { "specs.brand": "Volt" }.
    specs: {
      brand: { type: String, trim: true },
      color: { type: String, trim: true },
      weightGrams: { type: Number, min: 0 },
      warrantyMonths: { type: Number, default: 0 },
    },
    // DENORMALIZATION: the source of truth for ratings is the reviews
    // collection, but we copy the aggregate here so product listings don't
    // need a join/aggregation on every page load. Trade-off: this copy must
    // be kept in sync when reviews change. (See lesson 09-data-modeling.)
    ratingSummary: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    collection: "products",
    timestamps: true,
    versionKey: false,
    // Virtuals are skipped by default when documents are converted to JSON
    // (e.g. res.json(product)). Opting in here so `finalPrice` shows up in
    // API responses.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// VIRTUAL: computed on read, never stored. Storing it would create a second
// copy of the truth that could drift out of sync with price/discount.
productSchema.virtual("finalPrice").get(function () {
  return Math.round(this.price * (1 - this.discountPercent / 100));
});

// VIRTUAL POPULATE: products do NOT store review ids (the reference lives
// on the review side). This virtual tells populate() how to fetch them
// anyway: match reviews whose `product` field equals this product's `_id`.
// Nothing is stored — it only exists when you ask for it:
//   Product.findById(id).populate("reviews")
productSchema.virtual("reviews", {
  ref: "Review",
  localField: "_id",
  foreignField: "product",
});

// COMPOUND index: supports "products in category X sorted by price" in one
// index walk. Order matters — see lesson 12-indexes-and-performance.
productSchema.index({ category: 1, price: -1 });

// MULTIKEY index: MongoDB indexes every element of the tags array.
productSchema.index({ tags: 1 });

// TEXT index: enables $text search over name + description. A collection
// can have at most ONE text index (it may cover several fields).
productSchema.index(
  { name: "text", description: "text" },
  { weights: { name: 5, description: 1 } } // name matches rank higher
);

const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);

export default Product;
