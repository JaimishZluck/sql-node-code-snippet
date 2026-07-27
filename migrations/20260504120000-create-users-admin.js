import mongoose from "mongoose";
import User from "../src/models/user.model.js";

const connect = async () => {
  const mongoUri = process.env.MONGO_URI;
  const mongoDbName = process.env.MONGO_DB_NAME || undefined;

  if (!mongoUri) {
    throw new Error("MONGO_URI is required to run migration scripts");
  }

  await mongoose.connect(mongoUri, mongoDbName ? { dbName: mongoDbName } : {});
};

export async function up() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const adminName = process.env.ADMIN_NAME || "Admin";

  const existingUser = await User.findOne({ email: adminEmail });
  if (!existingUser) {
    await User.create({
      name: adminName,
      email: adminEmail,
    });
  }
}

export async function down() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  await User.deleteOne({ email: adminEmail });
}

async function run() {
  const action = process.argv[2];

  if (!["up", "down"].includes(action)) {
    throw new Error('Usage: node -r dotenv/config migrations/20260504120000-create-users-admin.js <up|down>');
  }

  await connect();
  try {
    if (action === "up") {
      await up();
    } else {
      await down();
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && process.argv[1].endsWith("20260504120000-create-users-admin.js")) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
