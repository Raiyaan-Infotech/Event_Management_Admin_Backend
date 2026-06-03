'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT LOWER(TRIM(email)) AS email, COUNT(*) AS duplicate_count
      FROM vendor_clients
      GROUP BY LOWER(TRIM(email))
      HAVING COUNT(*) > 1
    `);

    if (duplicates.length > 0) {
      const emails = duplicates.map((row) => row.email).join(', ');
      throw new Error(`Cannot enforce unique client emails until duplicate records are resolved: ${emails}`);
    }

    await queryInterface.sequelize.query(`
      UPDATE vendor_clients
      SET email = LOWER(TRIM(email))
      WHERE email IS NOT NULL
    `);

    await queryInterface.addConstraint('vendor_clients', {
      fields: ['email'],
      type: 'unique',
      name: 'vendor_clients_email_unique',
    });

    await queryInterface.createTable('client_refresh_tokens', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      token: {
        type: Sequelize.STRING(500),
        allowNull: false,
        unique: true,
      },
      client_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'vendor_clients', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      ip_address: {
        type: Sequelize.STRING(45),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      is_active: {
        type: Sequelize.TINYINT,
        allowNull: false,
        defaultValue: 1,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('client_refresh_tokens', ['client_id', 'is_active'], {
      name: 'client_refresh_tokens_client_active',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('client_refresh_tokens');
    await queryInterface.removeConstraint('vendor_clients', 'vendor_clients_email_unique');
  },
};
