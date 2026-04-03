const Sequelize = require('sequelize');
const env = process.env.NODE_ENV || 'development';
const config = require('../config/database')[env];

const sequelize = new Sequelize(
  config.database,
  config.username,
  config.password,
  {
    host: config.host,
    port: config.port,
    dialect: config.dialect,
    logging: false,
    pool: config.pool,
    dialectOptions: config.dialectOptions || {},
    define: {
      underscored: true
    }
  }
);

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Auth & Session
db.Session = require('./Session')(sequelize, Sequelize);
db.RefreshToken = require('./RefreshToken')(sequelize, Sequelize);

// Infrastructure
db.Company = require('./Company')(sequelize, Sequelize);
db.Role = require('./Role')(sequelize, Sequelize);
db.User = require('./User')(sequelize, Sequelize);
db.Permission = require('./Permission')(sequelize, Sequelize);
db.Module = require('./Module')(sequelize, Sequelize);
db.RolePermission = require('./RolePermission')(sequelize, Sequelize);
db.Setting = require('./Setting')(sequelize, Sequelize);
db.ApprovalRequest = require('./ApprovalRequest')(sequelize, Sequelize);
db.ActivityLog = require('./ActivityLog')(sequelize, Sequelize);
db.Plugin = require('./Plugin')(sequelize, Sequelize);

// Locations
db.Country = require('./Country')(sequelize, Sequelize);
db.State = require('./State')(sequelize, Sequelize);
db.District = require('./District')(sequelize, Sequelize);
db.City = require('./City')(sequelize, Sequelize);


// Media
// (Media module interacts with storage directly via service, no model needed)

// FAQs
db.Faq = require('./Faq')(sequelize, Sequelize);
db.FaqCategory = require('./FaqCategory')(sequelize, Sequelize);

// Email System
db.EmailConfig = require('./EmailConfig')(sequelize, Sequelize);
db.EmailTemplate = require('./EmailTemplate')(sequelize, Sequelize);
db.EmailCampaign = require('./EmailCampaign')(sequelize, Sequelize);
db.EmailQueue = require('./EmailQueue')(sequelize, Sequelize);
db.EmailSentLog = require('./EmailSentLog')(sequelize, Sequelize);

// Vendor
db.Vendor = require('./Vendor')(sequelize, Sequelize);
db.VendorClient = require('./VendorClient')(sequelize, Sequelize);
db.VendorStaff = require('./VendorStaff')(sequelize, Sequelize);

// Menus & Subscriptions
db.Menu = require('./Menu')(sequelize, Sequelize);
db.Subscription = require('./Subscription')(sequelize, Sequelize);

// Translations
db.Language = require('./Language')(sequelize, Sequelize);
db.TranslationKey = require('./TranslationKey')(sequelize, Sequelize);
db.Translation = require('./Translation')(sequelize, Sequelize);
db.MissingTranslationKey = require('./MissingTranslationKey')(sequelize, Sequelize);

// Payments
db.Payment = require('./Payment')(sequelize, Sequelize);
db.Currency = require('./Currency')(sequelize, Sequelize); // ✅ Add this line


// Define Associations
// Company Relationships
db.Company.hasMany(db.User, { foreignKey: 'company_id', as: 'users' });
db.User.belongsTo(db.Company, { foreignKey: 'company_id', as: 'company' });

db.Company.hasMany(db.Role, { foreignKey: 'company_id', as: 'roles' });
db.Role.belongsTo(db.Company, { foreignKey: 'company_id', as: 'company' });

// Role & Permission Relationships
db.Role.hasMany(db.User, { foreignKey: 'role_id', as: 'users' });
db.User.belongsTo(db.Role, { foreignKey: 'role_id', as: 'role' });

db.Role.belongsToMany(db.Permission, {
  through: db.RolePermission,
  foreignKey: 'role_id',
  otherKey: 'permission_id',
  as: 'permissions'
});
db.Permission.belongsToMany(db.Role, {
  through: db.RolePermission,
  foreignKey: 'permission_id',
  otherKey: 'role_id',
  as: 'roles'
});

db.Module.hasMany(db.Permission, { foreignKey: 'module_id', as: 'permissions' });
db.Permission.belongsTo(db.Module, { foreignKey: 'module_id', as: 'moduleRef' });

// Approval Relationships
db.User.hasMany(db.ApprovalRequest, { as: 'requestedApprovals', foreignKey: 'requester_id' });
db.ApprovalRequest.belongsTo(db.User, { as: 'requester', foreignKey: 'requester_id' });

db.User.hasMany(db.ApprovalRequest, { as: 'processedApprovals', foreignKey: 'approver_id' });
db.ApprovalRequest.belongsTo(db.User, { as: 'approver', foreignKey: 'approver_id' });

// ActivityLog Relationships 
db.ActivityLog.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });
db.User.hasMany(db.ActivityLog, { foreignKey: 'user_id', as: 'activityLogs' });

// Location Relationships
db.Country.hasMany(db.State, { foreignKey: 'country_id', as: 'states' });
db.State.belongsTo(db.Country, { foreignKey: 'country_id', as: 'country' });
db.State.hasMany(db.District, { foreignKey: 'state_id', as: 'districts' });
db.District.belongsTo(db.State, { foreignKey: 'state_id', as: 'state' });
db.District.hasMany(db.City, { foreignKey: 'city_id', as: 'cities' });
db.City.belongsTo(db.District, { foreignKey: 'city_id', as: 'district' });

// Translation Relationships
// Translation Relationships
db.TranslationKey.hasMany(db.Translation, { 
  foreignKey: 'translation_key_id', 
  as: 'translations'   // ✅ lowercase alias
});
db.Translation.belongsTo(db.TranslationKey, { 
  foreignKey: 'translation_key_id',
  as: 'translation_key'  // ✅ for reverse include in service
});
db.Language.hasMany(db.Translation, { 
  foreignKey: 'language_id',
  as: 'translations'   // ✅ lowercase alias
});
db.Translation.belongsTo(db.Language, { 
  foreignKey: 'language_id',
  as: 'language'       // ✅ for reverse include in service
});

// FAQ Relationships
db.FaqCategory.hasMany(db.Faq, { foreignKey: 'faq_category_id', as: 'faqs' });
db.Faq.belongsTo(db.FaqCategory, { foreignKey: 'faq_category_id', as: 'category' });

// Vendor Client & Staff Relationships
db.Vendor.hasMany(db.VendorClient, { foreignKey: 'vendor_id', as: 'clients' });
db.VendorClient.belongsTo(db.Vendor, { foreignKey: 'vendor_id', as: 'vendor' });

db.Vendor.hasMany(db.VendorStaff, { foreignKey: 'vendor_id', as: 'staff' });
db.VendorStaff.belongsTo(db.Vendor, { foreignKey: 'vendor_id', as: 'vendor' });



module.exports = db;
