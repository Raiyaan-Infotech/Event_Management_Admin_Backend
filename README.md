# Event Management — Admin Backend

> Node.js + Express REST API for the Event Management platform. Powers all admin panel, vendor portal, and user frontend operations through a multi-tenant, permission-based architecture.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js 4.21.2 |
| Database | MySQL (via MySQL2 3.20.0) |
| ORM | Sequelize 6.37.5 |
| Auth | JWT (jsonwebtoken 9.0.3) + bcryptjs 2.4.3 |
| Email | Nodemailer + Mailgun.js + Brevo + ElasticEmail |
| IMAP | Imapflow 1.2.10 |
| File Storage | Local filesystem + AWS S3 + CloudFront CDN |
| Image Processing | Sharp 0.34.5 |
| File Uploads | Multer 1.4.5 |
| Scheduling | node-cron 4.2.1 |
| Logging | Winston + Winston-daily-rotate-file |
| Security | Helmet 8.0.0 + express-rate-limit |
| Validation | express-validator 7.2.1 |
| Compression | compression 1.7.5 |
| Testing | Jest 30.3.0 + Supertest 7.2.2 |

---

## Project Structure

```
src/
├── app.js              # Express app setup (CORS, middleware, routes)
├── server.js           # Server entry point
├── config/
│   ├── database.js     # Sequelize config (dev/test/prod, connection pool, SSL)
│   └── constants.js    # User status, roles, pagination, file type constants
├── controllers/        # 28 controllers (request/response handlers)
├── models/             # 33+ Sequelize models with associations
├── routes/             # 27 route files
├── middleware/         # Auth, approval, company context, error handler, logger
├── services/           # 25+ business logic service files
├── utils/              # JWT utils, logger, API response/error helpers
├── database/
│   └── seeders/        # Database seed scripts
└── __tests__/          # Jest test files
uploads/                # Local file storage
```

---

## API Base URL

```
http://localhost:5001/api/v1
```

---

## All API Modules & Routes

### Authentication (`/auth`)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | Login (admin/employee) |
| POST | `/auth/forgot-password` | Request password reset OTP |
| POST | `/auth/verify-reset-otp` | Verify OTP |
| POST | `/auth/reset-password` | Reset password |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Get current user |
| PUT | `/auth/change-password` | Change password |
| PUT | `/auth/update-profile` | Update profile |

### Users / Employees (`/users`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/users` | List all employees |
| GET | `/users/:id` | Get employee by ID |
| POST | `/users` | Create employee *(approval required)* |
| PUT | `/users/:id` | Update employee *(approval required)* |
| DELETE | `/users/:id` | Delete employee *(approval required)* |
| PATCH | `/users/:id/status` | Toggle status |

### Roles (`/roles`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/roles` | List roles |
| GET | `/roles/:id` | Get role |
| POST | `/roles` | Create role *(approval required)* |
| PUT | `/roles/:id` | Update role *(approval required)* |
| DELETE | `/roles/:id` | Delete role *(approval required)* |
| POST | `/roles/:id/permissions` | Assign permissions to role |

### Permissions (`/permissions`)
CRUD: GET list, GET by ID, POST, PUT, DELETE

### Modules (`/modules`)
CRUD: GET list, GET by ID, POST, PUT, DELETE + `POST /:id/permissions`

### Companies (`/companies`) — Developer Only
| Method | Endpoint | Description |
|---|---|---|
| GET | `/companies/dashboard` | Company stats dashboard |
| GET | `/companies` | List all companies |
| GET | `/companies/:id` | Get company |
| POST | `/companies` | Create company |
| PUT | `/companies/:id` | Update company |
| DELETE | `/companies/:id` | Delete company |
| PATCH | `/companies/:id/status` | Update company status |

### Settings (`/settings`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/settings/public` | Public settings (no auth) |
| GET | `/settings` | All settings |
| GET | `/settings/group/:group` | By group |
| GET | `/settings/:key` | By key |
| PUT | `/settings/:key` | Update setting *(approval required)* |
| POST | `/settings/bulk` | Bulk update *(approval required)* |

### Locations (`/locations`)
**Public (no auth):** GET countries, states, districts, cities
**Protected:** POST/PUT/DELETE + bulk imports for all entities *(approval required)*

### Languages (`/languages`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/languages/active` | Active languages (public) |
| GET/POST/PUT/DELETE | `/languages` | CRUD *(approval required)* |
| PATCH | `/languages/:id/default` | Set default language |

### Currencies (`/currencies`)
Same pattern as Languages + `PATCH /:id/default`

### Media (`/media`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/media/files` | List files |
| POST | `/media/folder` | Create folder |
| POST | `/media/upload` | Upload single file *(approval required)* |
| POST | `/media/upload-multiple` | Upload up to 10 files *(approval required)* |
| POST | `/media/rename` | Rename file |
| POST | `/media/copy` | Copy file |
| POST | `/media/move` | Move file |
| DELETE | `/media` | Delete file *(approval required)* |

### Email Configs (`/email-configs`)
CRUD + `POST /:id/test` (test connection) + `PATCH /:id/toggle` (toggle active)

### Email Templates (`/email-templates`)
CRUD + `GET /parts` + `GET /variables` + `POST /:id/preview` + `POST /:id/send`

### Email Campaigns (`/email-campaigns`)
CRUD + `GET /holidays` + `GET /variable-mappings` + `GET /queue/stats` + `POST /queue/process` + `POST /:id/activate` + `POST /:id/pause` + `POST /:id/trigger` + `GET /:id/statistics`

### Translations (`/translations`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/translations/:langCode` | All translations for language (public) |
| GET | `/translations/:langCode/:group` | By group (public) |
| GET | `/translations/stats` | Translation stats (public) |
| POST | `/translations/report-missing` | Report missing key (public) |
| GET | `/translations/missing` | Missing keys list |
| POST | `/translations/translate-all` | Auto-translate to language |
| POST | `/translations/missing/create-all` | Create all missing keys |

### Translation Keys (`/translation-keys`)
CRUD + `POST /bulk-import` + `GET /:id/translations` + `PUT /:id/translations` + `POST /:id/retranslate` + `POST /:id/retranslate-all`

### FAQs (`/faqs`) · FAQ Categories (`/faq-categories`)
Standard CRUD *(create/update/delete require approval)*

### Menus (`/menus`)
CRUD + `PATCH /:id/status` + `PATCH /:id/display-status`

### Subscriptions (`/subscriptions`)
CRUD + `PATCH /:id/status`

### Payments (`/payments`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/payments/stats` | Payment statistics |
| GET/POST | `/payments` | List / Create |
| GET | `/payments/:id` | Get payment |
| PATCH | `/payments/:id/status` | Update status |

### Plugins (`/plugins`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/plugins` | All plugins grouped by category |
| GET | `/plugins/:slug` | Plugin + config |
| PUT | `/plugins/:slug/toggle` | Enable / Disable |

### Vendors (`/vendors`)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/vendors/auth/login` | Vendor login (separate JWT) |
| POST | `/vendors/auth/logout` | Vendor logout |
| POST | `/vendors/auth/forgot-password` | Forgot password |
| POST | `/vendors/auth/reset-password` | Reset password |
| GET | `/vendors/auth/me` | Get vendor profile |
| PUT | `/vendors/auth/profile` | Update vendor profile |
| POST | `/vendors/auth/change-password` | Change password |
| GET | `/vendors/auth/activity` | Vendor activity log |
| GET/POST | `/vendors` | List / Create *(approval required)* |
| GET/PUT/DELETE | `/vendors/:id` | Get / Update / Delete |
| PATCH | `/vendors/:id/status` | Toggle status |

### Approvals (`/approvals`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/approvals` | List approval requests |
| GET | `/approvals/pending` | Pending count |
| GET | `/approvals/:id` | Single request |
| POST | `/approvals` | Create request |
| PATCH | `/approvals/:id/approve` | Approve *(admin only)* |
| PATCH | `/approvals/:id/reject` | Reject *(admin only)* |
| DELETE | `/approvals/:id` | Cancel request |

### Activity Logs (`/activity-logs`)
GET list, GET by user, GET by module, DELETE (clear old)

### Setup Wizard (`/setup`) — Public, install-guarded
`GET /status` · `POST /check` · `POST /test-db` · `POST /configure` · `POST /company` · `POST /admin` · `POST /finalize`

### System
- `GET /timezones` — All timezones (public)
- `GET /health` — Health check (public)

---

## Database Models (33+)

### Core
| Model | Key Fields |
|---|---|
| **User** | full_name, email, phone, password, role_id, company_id, department, designation, is_active |
| **Role** | name, slug, level, description, company_id, is_active |
| **Permission** | name, slug, module_id, company_id, is_active |
| **RolePermission** | role_id, permission_id, **requires_approval** |
| **Module** | name, slug, description, company_id, is_active |
| **Company** | name, slug, domain, logo, email, max_users, is_active |
| **Setting** | key, value, group, type, company_id |
| **Plugin** | slug, name, category, is_active, config_group, config_route, company_id |
| **RefreshToken** | token, user_id, expires_at, is_active |

### Locations
`Country` → `State` → `District` → `City` (hierarchical)

### Email System
| Model | Key Fields |
|---|---|
| **EmailConfig** | driver (smtp/brevo/elasticemail/sendmail), host, port, api_key, is_default |
| **EmailTemplate** | name, slug, type (header/footer/template), subject, body, variables (JSON) |
| **EmailCampaign** | campaign_type (holiday/scheduled/recurring), target_audience, target_roles, next_run_at |
| **EmailQueue** | recipient_email, status, attempts, sent_at |
| **EmailSentLog** | recipient_email, gateway, gateway_transaction_id |

### Localization
`Language` · `Currency` · `TranslationKey` · `Translation` · `MissingTranslationKey`

### Business
| Model | Key Fields |
|---|---|
| **Vendor** | company_name, membership (basic/silver/gold/platinum), bank_name, acc_no, status |
| **Menu** | name, icon, sort_order, is_active, display_status |
| **Subscription** | name, price, validity, menu_ids (JSON), features, is_custom |
| **Faq** | question, answer, faq_category_id, sort_order |
| **Payment** | amount, currency, status (pending/completed/failed/refunded/cancelled), gateway |

### Audit
| Model | Key Fields |
|---|---|
| **ApprovalRequest** | requester_id, module_slug, action, request_data (JSON), is_active (2=pending, 1=approved, 0=rejected) |
| **ActivityLog** | user_id, action, module, old_values (JSON), new_values (JSON), ip_address |

---

## Middleware

| Middleware | Purpose |
|---|---|
| `auth.js` | `isAuthenticated`, `hasRole`, `hasPermission`, `hasMinLevel`, `isDeveloper` |
| `approval.js` | `checkApprovalRequired` — intercepts sensitive mutations, returns 202 |
| `company.js` | `extractCompanyContext` — sets `req.companyId` from user or `X-Company-Id` header |
| `vendorAuth.js` | `isVendorAuthenticated` — vendor-specific JWT validation |
| `activityLogger.js` | Logs all actions to ActivityLog model |
| `bodyTransform.js` | camelCase → snake_case normalization |
| `errorHandler.js` | Global error response formatting |
| `setup.js` | `setupGuard` — blocks setup routes after installation |

---

## Authentication

**Type:** JWT with HTTP-only cookies

| Token | Expiry | Cookie Name |
|---|---|---|
| Admin Access Token | 15 minutes | `access_token` |
| Admin Refresh Token | 7 days | `refresh_token` |
| Vendor Access Token | 15 minutes | `vendor_access_token` |
| Vendor Refresh Token | 7 days | `vendor_refresh_token` |

**Security:**
- bcryptjs password hashing (12 salt rounds)
- `password_changed_at` timestamp invalidates old tokens
- `login_access` flag allows admin to revoke API access
- Rate limiting on auth endpoints
- Helmet security headers

---

## Permission & Role System

**Hierarchy:**
```
developer    level 1000 — Full system, cross-company access
super_admin  level 100  — Bypasses all approvals
admin        level 50
subadmin     level 25
custom       level 10
```

**Permission slugs:** `{module}.{action}` e.g. `employees.view`, `vendors.create`, `roles.delete`

**Modules covered:** employees, roles, permissions, modules, settings, locations, languages, currencies, media, translations, email_templates, email_campaigns, email_configs, activity_logs, plugins, faqs, faq_categories, vendors, menus, subscriptions, payments

---

## Approval Workflow

1. Sensitive route includes `checkApprovalRequired` middleware
2. Middleware creates `ApprovalRequest` record (`is_active: 2` = pending)
3. Returns `HTTP 202` with `approval_required: true` in response body
4. For CREATE actions: resource created with `is_active: 2` (pending)
5. Admin (level ≥ 100) reviews and approves/rejects
6. On approval: original action executed, resource activated
7. **Super Admin and Developer bypass entirely**

---

## Email System

**Drivers:** SMTP · Brevo · ElasticEmail · sendmail

**Campaign types:**
- `holiday` — triggered on a specific holiday date
- `scheduled` — one-time at a specific date/time
- `recurring` — cron-based (daily/weekly/monthly)

**Target audiences:** `all_users` · `active_users` · `verified_users` · `by_role`

**Processing:** Email queue → worker processes queue → logs to `EmailSentLog`

---

## File Storage

| Storage | Notes |
|---|---|
| Local | `/uploads` directory, served at `/uploads/*` |
| AWS S3 | `@aws-sdk/client-s3` + CloudFront CDN |
| Max size | 10 MB (configurable) |
| Allowed types | Images (jpeg, png, gif, webp, svg), PDF, documents, video, audio |

---

## Environment Variables

```env
PORT=5001
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=event_

ACCESS_TOKEN_SECRET=your_access_secret
REFRESH_TOKEN_SECRET=your_refresh_secret

CORS_ORIGIN=http://localhost:3002

UPLOAD_DIR=uploads
MAX_FILE_SIZE=10485760
```

---

## Getting Started

```bash
npm install
npm run dev      # nodemon — http://localhost:5001
npm test         # Jest test suite
```

### Database Setup
```bash
npx sequelize-cli db:create
npx sequelize-cli db:migrate
npx sequelize-cli db:seed:all
```

Or use the built-in Setup Wizard: `GET /api/v1/setup/status`
