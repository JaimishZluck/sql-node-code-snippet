import mongoose from "mongoose";

/**
 * Reusable address SUB-SCHEMA (also called an "embedded document" schema).
 *
 * This is not a model and has no collection of its own. It describes the
 * shape of an address object that lives INSIDE another document — a user's
 * home address, an order's shipping address, etc.
 *
 * WHY embed instead of a separate "addresses" collection?
 * An address is always read together with its owner and is meaningless on
 * its own. Embedding stores it in the same document, so one read returns
 * everything — no join needed. This is the document-model way of handling
 * a one-to-one relationship. (See lesson 09-data-modeling.)
 */
const addressSchema = new mongoose.Schema(
  {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true, default: "India" },
    zip: { type: String, trim: true },
  },
  {
    // Sub-documents get their own ObjectId `_id` by default. An address is
    // never referenced individually, so the extra id is pure noise — turn
    // it off.
    _id: false,
  }
);

export default addressSchema;
