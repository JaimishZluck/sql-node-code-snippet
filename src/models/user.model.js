import logger from "../logger/winston.logger.js";

const UserModel = (sequelize, DataTypes) => {
    logger.info("Initializing User model");

    const User = sequelize.define(
        "User",
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            email: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
            },
        },
        {
            tableName: "users",
            freezeTableName: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );

    User.associate = (models) => {
        User.hasMany(models.Order, {
            foreignKey: "user_id",
        });
    };

    return User;
};

export default UserModel;
