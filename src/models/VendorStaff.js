const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
    const VendorStaff = sequelize.define('VendorStaff', {
        id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        vendor_id:   { type: DataTypes.INTEGER, allowNull: false },
        role_id:     { type: DataTypes.INTEGER, allowNull: true },
        emp_id:      { type: DataTypes.STRING(50),  allowNull: true },
        name:        { type: DataTypes.STRING(200), allowNull: false },
        email:       { type: DataTypes.STRING(255), allowNull: false },
        mobile:      { type: DataTypes.STRING(20),  allowNull: false },
        designation: { type: DataTypes.STRING(200), allowNull: true },
        doj:         { type: DataTypes.DATEONLY,    allowNull: true },
        dor:         { type: DataTypes.DATEONLY,    allowNull: true },
        dob:         { type: DataTypes.DATEONLY,    allowNull: true },
        profile_pic: { type: DataTypes.TEXT('long'), allowNull: true },
        login_access: { type: DataTypes.BOOLEAN, defaultValue: true },
        // 0=inactive, 1=active, 2=pending  (consistent with User model is_active pattern)
        is_active: { type: DataTypes.TINYINT, defaultValue: 1 },
        // Detailed HR status: active, inactive, resigned, relieved
        work_status: {
            type: DataTypes.ENUM('active', 'inactive', 'resigned', 'relieved'),
            defaultValue: 'active',
        },
        address:  { type: DataTypes.TEXT,        allowNull: true },
        country:  { type: DataTypes.STRING(100), allowNull: true },
        state:    { type: DataTypes.STRING(100), allowNull: true },
        district: { type: DataTypes.STRING(100), allowNull: true },
        city:     { type: DataTypes.STRING(100), allowNull: true },
        locality: { type: DataTypes.STRING(100), allowNull: true },
        pincode:  { type: DataTypes.STRING(20),  allowNull: true },
        company_id: { type: DataTypes.INTEGER, allowNull: true },

        // Auth fields
        password:               { type: DataTypes.STRING(255), allowNull: true },
        password_reset_token:   { type: DataTypes.STRING(10),  allowNull: true },
        password_reset_expires: { type: DataTypes.DATE,        allowNull: true },
    }, {
        tableName: 'vendor_staff',
        timestamps: true,
        paranoid: true,
        underscored: true,
        hooks: {
            beforeCreate: async (staff) => {
                if (staff.password) {
                    staff.password = await bcrypt.hash(staff.password, 12);
                }
            },
            beforeUpdate: async (staff) => {
                if (staff.changed('password') && staff.password) {
                    staff.password = await bcrypt.hash(staff.password, 12);
                }
            },
        },
    });

    VendorStaff.prototype.validatePassword = async function (password) {
        if (!this.password) return false;
        return bcrypt.compare(password, this.password);
    };

    VendorStaff.prototype.toJSON = function () {
        const values = { ...this.get() };
        delete values.password;
        delete values.password_reset_token;
        delete values.password_reset_expires;
        return values;
    };

    return VendorStaff;
};
