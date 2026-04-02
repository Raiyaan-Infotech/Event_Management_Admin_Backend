const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const cookieParser = require('cookie-parser');
const errorHandler = require('./middleware/errorHandler');
const bodyTransform = require('./middleware/bodyTransform');
const logger = require('./utils/logger');

const app = express();

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cookieParser());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyTransform);

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/v1/auth', require('./routes/auth.routes'));
app.use('/api/v1/users', require('./routes/user.routes'));
app.use('/api/v1/roles', require('./routes/role.routes'));
app.use('/api/v1/permissions', require('./routes/permission.routes'));
app.use('/api/v1/modules', require('./routes/module.routes'));
app.use('/api/v1/companies', require('./routes/company.routes'));
app.use('/api/v1/settings', require('./routes/setting.routes'));
app.use('/api/v1/locations', require('./routes/location.routes'));
app.use('/api/v1/languages', require('./routes/language.routes'));
app.use('/api/v1/currencies', require('./routes/currency.routes'));
app.use('/api/v1/media', require('./routes/media.routes'));
app.use('/api/v1/translations', require('./routes/translation.routes'));
app.use('/api/v1/translation-keys', require('./routes/translationKey.routes'));
app.use('/api/v1/email-configs', require('./routes/emailConfig.routes'));
app.use('/api/v1/email-templates', require('./routes/emailTemplate.routes'));
app.use('/api/v1/email-campaigns', require('./routes/emailCampaign.routes'));
app.use('/api/v1/activity-logs', require('./routes/activityLog.routes'));
app.use('/api/v1/approvals', require('./routes/approval.routes'));
app.use('/api/v1/plugins', require('./routes/plugin.routes'));
app.use('/api/v1/faq-categories', require('./routes/faqCategory.routes'));
app.use('/api/v1/faqs', require('./routes/faq.routes'));
app.use('/api/v1/vendors', require('./routes/vendor.routes'));
app.use('/api/v1/menus', require('./routes/menu.routes'));
app.use('/api/v1/subscriptions', require('./routes/subscription.routes'));
app.use('/api/v1/payments', require('./routes/payment.routes'));
app.use('/api/v1/setup', require('./routes/setup.routes'));
app.use('/api/v1/timezones', require('./routes/timezone.routes'));

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Error Handler
app.use(errorHandler);

module.exports = app;