import mongoose from "mongoose";
import addressSchema from "./schemas/address.schema.js";

/**
 * Order model — one purchase made by one user.
 *
 * This is the most "document-shaped" model in the project and shows the
 * hybrid modeling style real MongoDB apps use:
 *
 *  - `user`  -> REFERENCE. Users change independently of orders and one
 *               user has many orders, so we store only the ObjectId.
 *  - `items` -> EMBEDDED ARRAY OF OBJECTS. An order's line items belong to
 *               this order alone and are always read with it, so they live
 *               inside the order document.
 *  - `items[].productName` / `items[].unitPrice` -> SNAPSHOT COPIES.
 *               Deliberate duplication: if the product is renamed or its
 *               price changes next month, this order must still show what
 *               the customer actually bought and paid. Referencing alone
 *               would rewrite history.
 */

// Sub-schema for a single line item inside the order.
const orderItemSchema = new mongoose.Schema(
  {
    // Reference kept so we can still populate() the live product when needed.
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Snapshot fields — copied from the product AT PURCHASE TIME.
    productName: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false } // line items are never addressed individually — skip _id
);

const orderSchema = new mongoose.Schema(
  {
    // Human-friendly unique identifier ("ORD-100042") — what you print on
    // invoices instead of an ObjectId.
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    items: {
      type: [orderItemSchema],
      // Custom validator: an order with zero items makes no sense.
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "An order must contain at least one item",
      },
    },
    status: {
      type: String,
      enum: ["pending", "paid", "shipped", "delivered", "cancelled"],
      default: "pending",
    },
    payment: {
      method: {
        type: String,
        enum: ["card", "upi", "netbanking", "cod"],
        default: "card",
      },
      paidAt: { type: Date, default: null },
    },
    // Embedded address — a SNAPSHOT of where this order shipped. If the user
    // later edits their profile address, past orders must not change.
    shippingAddress: addressSchema,
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    // When the order was placed. Kept separate from createdAt so seeders and
    // imports can back-date orders (createdAt is when the DB record was made).
    placedAt: {
      type: Date,
      default: Date.now, // NOTE: the function itself, not Date.now() — it runs per-document
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    collection: "orders",
    timestamps: true,
    // __v (the version key) is KEPT on this model. Mongoose uses it for
    // optimistic concurrency — detecting that two processes loaded the same
    // document and both tried to save. See lesson 14-transactions.
  }
);

// Supports the most common query in any shop: "this user's orders, newest
// first" — one compound index serves both the filter and the sort.
orderSchema.index({ user: 1, placedAt: -1 });

// For dashboards filtering by status ("all pending orders").
orderSchema.index({ status: 1 });

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
