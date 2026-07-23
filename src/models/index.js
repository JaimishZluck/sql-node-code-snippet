import Sequelize from "sequelize";
import { sequelize } from "../db/connection.db.js";
import ExampleModel from "./example.model.js";
import OrderModel from "./order.model.js";
import UserModel from "./user.model.js";

const models = {};

models.Example = ExampleModel(sequelize, Sequelize.DataTypes);
models.User = UserModel(sequelize, Sequelize.DataTypes);
models.Order = OrderModel(sequelize, Sequelize.DataTypes);

Object.values(models).forEach((model) => {
    if (typeof model.associate === "function") {
        model.associate(models);
    }
});

export { sequelize };
export default models;
