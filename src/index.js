import dotenv from "dotenv";
import startApp from "./server/index.server.js";

dotenv.config({
  path: "./.env",
});

try {
  startApp();
} catch (error) {
  throw error;
}
