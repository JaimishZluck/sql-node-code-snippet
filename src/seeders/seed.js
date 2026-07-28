/**
 * Database seeder — fills the bootcamp database with realistic sample data.
 *
 * Run it with:            npm run db:seed
 * Run it again any time:  it CLEARS the five bootcamp collections first,
 *                         so it is always safe to re-run (repeatable).
 *
 * Order of operations matters because later collections reference earlier
 * ones by ObjectId (which only exists AFTER insert):
 *
 *   1. categories  (parents first, then children that point at them)
 *   2. users
 *   3. products    (reference a category)
 *   4. orders      (reference a user + snapshot products)
 *   5. reviews     (reference a user and a product)
 *   6. recompute each product's denormalized ratingSummary from its reviews
 *   7. syncIndexes() so every index declared in the schemas actually
 *      exists in MongoDB (index lessons depend on this)
 *
 * Generation vs insertion are deliberately separate: the `data/` modules
 * only BUILD plain JavaScript objects; this file is the only place that
 * writes to the database.
 */
import mongoose from "mongoose";
import connectDB, { disconnectDB } from "../db/loader.db.js";
import User from "../models/user.model.js";
import Category from "../models/category.model.js";
import Product from "../models/product.model.js";
import Order from "../models/order.model.js";
import Review from "../models/review.model.js";
import { createRandom } from "./lib/random.js";
import { categoryDefinitions } from "./data/categories.data.js";
import { buildUsers } from "./data/users.data.js";
import { buildProducts } from "./data/products.data.js";
import { buildOrders } from "./data/orders.data.js";
import { buildReviews } from "./data/reviews.data.js";

const seed = async () => {
  // Fixed seed => identical data on every run => reproducible lessons.
  const random = createRandom(42);

  await connectDB();
  console.log(`\nSeeding database "${mongoose.connection.name}"...\n`);

  // -- 1. Clear existing bootcamp data (repeatable seeding) ------------------
  // deleteMany({}) removes every document but keeps the collections and
  // their indexes. (dropDatabase would nuke indexes too — see reset.js.)
  await Promise.all([
    User.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    Order.deleteMany({}),
    Review.deleteMany({}),
  ]);
  console.log("Cleared users, categories, products, orders, reviews.");

  // -- 2. Categories: parents first, then children ---------------------------
  const parentDefs = categoryDefinitions.filter((c) => c.parentSlug === null);
  const childDefs = categoryDefinitions.filter((c) => c.parentSlug !== null);

  const parents = await Category.insertMany(
    parentDefs.map(({ parentSlug, ...def }) => ({ ...def, parent: null }))
  );

  // Map slug -> real ObjectId so children can point at their parent.
  const idBySlug = new Map(parents.map((c) => [c.slug, c._id]));

  const children = await Category.insertMany(
    childDefs.map(({ parentSlug, ...def }) => ({
      ...def,
      parent: idBySlug.get(parentSlug),
    }))
  );

  const categories = [...parents, ...children];
  console.log(`Inserted ${categories.length} categories (${parents.length} parents, ${children.length} children).`);

  // -- 3. Users --------------------------------------------------------------
  const users = await User.insertMany(buildUsers(random, 30));
  console.log(`Inserted ${users.length} users.`);

  // -- 4. Products (need category ObjectIds) ---------------------------------
  const products = await Product.insertMany(buildProducts(random, categories, 9));
  console.log(`Inserted ${products.length} products.`);

  // -- 5. Orders (need user + product ObjectIds) -----------------------------
  const orders = await Order.insertMany(buildOrders(random, users, products, 300));
  console.log(`Inserted ${orders.length} orders.`);

  // -- 6. Reviews (unique per user+product pair) -----------------------------
  const reviews = await Review.insertMany(buildReviews(random, users, products, 200));
  console.log(`Inserted ${reviews.length} reviews.`);

  // -- 7. Sync the denormalized ratingSummary on each product ----------------
  // The reviews collection is the source of truth; products carry a cached
  // average + count so listings don't need an aggregation per page load.
  // This is what "keeping denormalized data in sync" looks like in practice.
  const ratingStats = await Review.aggregate([
    { $group: { _id: "$product", average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  await Product.bulkWrite(
    ratingStats.map((stat) => ({
      updateOne: {
        filter: { _id: stat._id },
        update: {
          $set: {
            "ratingSummary.average": Math.round(stat.average * 10) / 10,
            "ratingSummary.count": stat.count,
          },
        },
      },
    }))
  );
  console.log(`Updated ratingSummary on ${ratingStats.length} products.`);

  // -- 8. Make sure every schema-declared index exists in MongoDB ------------
  // Mongoose normally builds indexes lazily in the background; syncIndexes()
  // forces them to exist NOW and drops stray ones, so explain() lessons show
  // the expected IXSCAN plans.
  await Promise.all([
    User.syncIndexes(),
    Category.syncIndexes(),
    Product.syncIndexes(),
    Order.syncIndexes(),
    Review.syncIndexes(),
  ]);
  console.log("Synced indexes for all collections.");

  console.log("\nSeed complete. Explore the data with `npm run lesson 01`.\n");
};

try {
  await seed();
} catch (error) {
  console.error("\nSeeding failed:", error.message);
  process.exitCode = 1;
} finally {
  // Close the connection pool so the Node process can exit.
  await disconnectDB();
}
