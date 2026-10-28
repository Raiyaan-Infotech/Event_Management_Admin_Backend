/**
 * A person an account scanned by their QR — My Favourites (2026-10-28).
 * "My Scans" lists every row; "Contacts" the ones with `is_favourite`. The
 * details are a snapshot of what the scan showed. See clientQrScan.service.
 */
module.exports = (sequelize, DataTypes) => sequelize.define(
    'ClientQrContact',
    {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        owner_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        person_kind: { type: DataTypes.ENUM('client', 'contact_person', 'event'), allowNull: false },
        person_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        role: { type: DataTypes.STRING(30), allowNull: true },
        name: { type: DataTypes.STRING(200), allowNull: false },
        photo: { type: DataTypes.STRING(500), allowNull: true },
        dial_code: { type: DataTypes.STRING(8), allowNull: true },
        mobile: { type: DataTypes.STRING(20), allowNull: true },
        email: { type: DataTypes.STRING(255), allowNull: true },
        relation: { type: DataTypes.STRING(120), allowNull: true },
        event_name: { type: DataTypes.STRING(200), allowNull: true },
        event_date: { type: DataTypes.DATEONLY, allowNull: true },
        is_favourite: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        favourited_at: { type: DataTypes.DATE, allowNull: true },
        scan_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        last_scanned_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
        tableName: 'client_qr_contacts',
        timestamps: true,
        underscored: true,
        paranoid: false,
    },
);
