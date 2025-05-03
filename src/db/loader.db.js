import { sequelize } from "./connection.db.js";

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    // await sequelize.sync();
    console.log("Connection has been established successfully."); //REMOVE THIS 
  } catch (error) {
    console.error("Unable to connect to the database:", error); //REMOVE THIS AND REPALCE BY THER LOGGER
  }
};

export default connectDB;
