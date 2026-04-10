# Event Management — Admin Backend

## Stack
- Node.js + Express + Sequelize ORM (MySQL)
- Deployed on **Render** — auto-deploys on push to `main`
- Live URL: https://event-management-admin-backend.onrender.com
- Shared backend — admin panel AND vendor portal both hit this same server

## Structure
```
src/
  controllers/   — one file per module
  services/      — business logic (controllers call services)
  models/        — Sequelize models
  routes/        — Express routers
  middleware/    — auth, permissions, approval, company context
  utils/         — apiResponse, apiError, jwt, helpers, logger
  database/      — seeders, migrations SQL
```

## Auth Middleware
- `isAuthenticated` — admin JWT (cookie: `access_token`)
- `isVendorAuthenticated` — vendor JWT (cookie: `vendor_access_token`)
- `isStaffAuthenticated` — staff JWT (cookie: `staff_access_token`)
- `hasPermission('slug')` — admin RBAC
- `hasStaffPermission('slug')` — staff portal RBAC

## Key Route Files
- `vendor.routes.js` — all vendor + staff portal + admin vendor CRUD routes
- All staff portal routes prefixed `/staff/portal/` under `isStaffAuthenticated`
- All vendor portal routes under `isVendorAuthenticated`
- Admin routes at the bottom of each file under `isAuthenticated`

## RBAC Design
- Modules & Permissions = global (`vendor_id = NULL`)
- Roles = vendor-scoped (`vendor_id = X`)
- Vendor owner = SuperAdmin (bypasses permission checks)
- Staff role level hardcoded to 10 (custom) — never allow level changes
- Role assignment = vendor-only (`PUT /vendors/staff/:id/role`)

## Security Rules (DO NOT break these)
- `STAFF_EDITABLE_FIELDS` in `vendorStaff.service.js` — whitelist for staff portal updates
- `STAFF_CREATABLE_FIELDS` — whitelist for staff portal creates (no `role_id`)
- `CLIENT_EDITABLE_FIELDS` / `CLIENT_CREATABLE_FIELDS` in `vendorClient.service.js`
- Staff cannot assign permissions they don't own to other roles
- Staff cannot create staff with a `role_id` — checked in `staffPortal.controller.js`
- Self-delete and self-deactivate guards in `staffPortal.controller.js`
- Self-role-edit guard in `staffPortal.controller.js`

## DB
- MySQL on port 3306 locally
- Migrations run manually — SQL files in `src/database/`
- `initial_setup.sql` = full schema + seed data

## Test Credentials
- Vendor: jamal@vendor.com / 123456
- Staff: jamal@jamal.com / 123456
