export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable("users", {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
      defaultValue: Sequelize.literal("NEWID()"),
    },
    name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    email: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("GETDATE()"),
    },
    updated_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("GETDATE()"),
    },
  });

  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const adminName = process.env.ADMIN_NAME || "Admin";

  const [rows] = await queryInterface.sequelize.query(
    "SELECT id FROM users WHERE email = :email",
    { replacements: { email: adminEmail } }
  );

  if (!rows.length) {
    await queryInterface.bulkInsert("users", [
      {
        name: adminName,
        email: adminEmail,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  }
}

export async function down(queryInterface) {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";

  await queryInterface.bulkDelete("users", { email: adminEmail });
  await queryInterface.dropTable("users");
}
