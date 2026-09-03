const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const errorHandler = require('./middleware/errorHandler');
const bodyTransform = require('./middleware/bodyTransform');
const logger = require('./utils/logger');

const app = express();

// Middleware
app.use(compression());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cookieParser());
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map(o => o.trim());

// `/api/v1/public/*` is the tenant public-site read model plus its signup,
// newsletter and contact forms. Every tenant site gets its own subdomain or
// custom domain, so the set of legitimate browser origins is open-ended and an
// env whitelist can never enumerate it — each new customer domain would be
// blocked until someone remembered to add it. Those routes are unauthenticated
// and touch no cookies (nothing under /public calls res.cookie; the vendor
// client login hands its token back in the response body), so they are served
// with permissive, credential-less CORS.
//
// Everything else keeps the strict credentialed whitelist — that is what
// carries the admin, vendor and staff JWT cookies, and `credentials: true`
// with a reflected origin is only safe against a closed list.
// EXCEPTION to the above: the website-client auth endpoints DO set cookies —
// they issue the client-portal session. A credential-less, wildcard-origin
// response makes the browser discard Set-Cookie silently, so these few paths
// must go through the credentialed whitelist instead.
//
// LIMITATION, stated rather than hidden: that whitelist cannot enumerate
// open-ended tenant domains, so this works for the origins in FRONTEND_URL
// (the public site and the portal on localhost today) and NOT for a customer's
// own custom domain. When tenant domains need it, the answer is the handoff
// token already in utils/jwt.js — log in on the tenant origin, redirect to the
// portal's own origin, exchange it for a session there — not reflecting an
// arbitrary origin with credentials: true, which is what that combination
// makes unsafe.
const COOKIE_BEARING_PUBLIC_PATHS = [
  '/api/v1/public/website-clients/login',
  // The 2FA login challenge's second leg. It sets the SAME session cookies as
  // `login` above the moment the code verifies — missed here, the browser's
  // `credentials: 'include'` fetch is silently rejected against the wildcard
  // CORS response below (`origin: '*'` cannot combine with credentials), which
  // surfaces to the visitor as a generic "Could not reach the server."
  '/api/v1/public/website-clients/login/2fa/verify',
  '/api/v1/public/website-clients/logout',
];

const isPublicSiteRoute = (req) =>
  req.path.startsWith('/api/v1/public/') && !COOKIE_BEARING_PUBLIC_PATHS.includes(req.path);

app.use(cors((req, cb) => {
  if (isPublicSiteRoute(req)) {
    return cb(null, { origin: '*', credentials: false });
  }
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    return cb(null, { origin: true, credentials: true });
  }
  cb(new Error(`CORS blocked: ${origin}`));
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyTransform);

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/v1/auth', require('./routes/auth.routes'));
app.use('/api/v1/users',       require('./routes/user.routes'));
app.use('/api/v1/departments', require('./routes/department.routes'));
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
app.use('/api/v1/push-notification-configs', require('./routes/pushNotificationConfig.routes'));
app.use('/api/v1/email-templates', require('./routes/emailTemplate.routes'));
app.use('/api/v1/email-campaigns', require('./routes/emailCampaign.routes'));
app.use('/api/v1/activity-logs', require('./routes/activityLog.routes'));
app.use('/api/v1/approvals', require('./routes/approval.routes'));
app.use('/api/v1/plugins', require('./routes/plugin.routes'));
app.use('/api/v1/color-palettes', require('./routes/colorPalette.routes'));
app.use('/api/v1/faq-categories', require('./routes/faqCategory.routes'));
app.use('/api/v1/faqs', require('./routes/faq.routes'));
app.use('/api/v1/vendors', require('./routes/vendor.routes'));
app.use('/api/v1/menus', require('./routes/menu.routes'));
// Menu Management
app.use('/api/v1/event-categories', require('./routes/eventCategory.routes'));
app.use('/api/v1/event-types', require('./routes/eventType.routes'));
app.use('/api/v1/religions', require('./routes/religion.routes'));
app.use('/api/v1/event-menus', require('./routes/eventMenu.routes'));
// Invitation templates — the super admin's Create Template wizard
app.use('/api/v1/event-templates', require('./routes/eventTemplate.routes'));
// The DESIGN family a template or frame belongs to (Elegant, Floral, Minimal).
// NOT /event-categories, which is what kind of EVENT something is.
app.use('/api/v1/template-categories', require('./routes/templateCategory.routes'));
// Uploaded border / frame artwork, classified by a template category.
app.use('/api/v1/frame-styles', require('./routes/frameStyle.routes'));
// Ornament images placed inside a template — corners, dividers, tops.
app.use('/api/v1/decorations', require('./routes/decoration.routes'));
app.use('/api/v1/plan-types', require('./routes/planType.routes'));
app.use('/api/v1/subscription-plans', require('./routes/subscriptionPlan.routes'));
app.use('/api/v1/plan-badges', require('./routes/planBadge.routes'));
// People who signed up on a tenant's public website. The public signup
// endpoint lives under /api/v1/public — everything here is admin-only.
app.use('/api/v1/website-clients', require('./routes/websiteClient.routes'));
// Client portal — requires a signed-in website client (see websiteClientAuth).
app.use('/api/v1/client', require('./routes/clientPortal.routes'));
app.use('/api/v1/payments', require('./routes/payment.routes'));
app.use('/api/v1/setup', require('./routes/setup.routes'));
app.use('/api/v1/timezones', require('./routes/timezone.routes'));
app.use('/api/v1/mail',      require('./routes/mail.routes'));
app.use('/api/v1/chat',      require('./routes/chat.routes'));
app.use('/api/v1/public',    require('./routes/public.routes'));
app.use('/api/v1/website-builder', require('./routes/companyWebsiteBuilder.routes'));

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Error Handler
app.use(errorHandler);

module.exports = app;
