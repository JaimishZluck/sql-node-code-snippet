import logger from "../logger/winston.logger.js";

const OrderModel = (sequelize, DataTypes) => {
    logger.info("Initializing Order model");

    const Order = sequelize.define(
        "Order",
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            order_name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            user_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },
        },
        {
            tableName: "orders",
            freezeTableName: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );

    Order.associate = (models) => {
        Order.belongsTo(models.User, {
            foreignKey: "user_id",
        });
    };

    return Order;
};

export default OrderModel;
