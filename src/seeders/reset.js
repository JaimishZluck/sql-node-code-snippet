/**
 * !! DESTRUCTIVE SCRIPT !!
 *
 * Drops the five bootcamp collections entirely — documents AND indexes.
 * Use it when you want a truly clean slate (e.g. after experimenting with
 * your own indexes in the index lessons).
 *
 *   npm run db:reset          -> drop collections
 *   npm run db:seed           -> re-create + refill them
 *
 * Difference from the seeder's own clearing step:
 *  - seed.js uses deleteMany({})   -> removes documents, KEEPS indexes
 *  - reset.js uses drop()          -> removes the whole collection,
 *                                     including its indexes
 *
 * Destructive operations live in their own clearly-named file on purpose:
 * you should never be able to wipe data "by accident" while running a
 * normal lesson.
 */
import mongoose from "mongoose";
import connectDB, { disconnectDB } from "../db/loader.db.js";

const BOOTCAMP_COLLECTIONS = ["users", "categories", "products", "orders", "reviews"];

const reset = async () => {
  await connectDB();
  const db = mongoose.connection.db;

  console.log(`\nResetting database "${mongoose.connection.name}"...\n`);

  // Only drop collections that actually exist — drop() on a missing
  // collection throws "ns not found".
  const existing = await db.listCollections().toArray();
  const existingNames = new Set(existing.map((c) => c.name));

  for (const name of BOOTCAMP_COLLECTIONS) {
    if (existingNames.has(name)) {
      await db.collection(name).drop();
      console.log(`Dropped collection: ${name}`);
    } else {
      console.log(`Collection not found (skipped): ${name}`);
    }
  }

  console.log("\nReset complete. Run `npm run db:seed` to refill the database.\n");
};

try {
  await reset();
} catch (error) {
  console.error("\nReset failed:", error.message);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
