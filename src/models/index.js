/**
 * Model registry.
 *
 * Importing this file registers every schema with Mongoose exactly once.
 * The DB loader imports it at startup so that `ref: "User"`-style lookups
 * and populate() always find their target model already compiled.
 */
import Example from "./example.model.js";
import User from "./user.model.js";
import Category from "./category.model.js";
import Product from "./product.model.js";
import Order from "./order.model.js";
import Review from "./review.model.js";

const models = {
  Example,
  User,
  Category,
  Product,
  Order,
  Review,
};

export default models;
