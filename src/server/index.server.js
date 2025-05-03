import connectDB from "../db/loader.db.js";
import startServer from "./express.server.js";

const startApp = async () => {
  try {
    await connectDB();
    startServer();
  } catch (err) {
    console.error("Error starting the application:", err);
    process.exit(1); 
  }
};

export default startApp;
