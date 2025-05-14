import { sequelize } from "../db/connection.db.js";
import Sequelize from "sequelize";

const Name = sequelize.define("user", {
    id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: Sequelize.STRING,
        allowNull: false,
    },
    email: {
        type: Sequelize.STRING,
        allowNull: false,
    }
},
    {
        tableName: "somethingName",
        freezeTableName: true, // this will preven thenaem to becoime the model names plural form of the table name
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at",
    });

export { Name };