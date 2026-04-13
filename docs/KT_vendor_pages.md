# KT — Vendor Pages Module
**From:** Senior Dev  
**To:** Junior Dev  
**Date:** 2026-04-12  
**Feature:** Vendor Website Pages (HTML content builder for vendor portal)

---

## 1. What Is This Feature?

Every vendor (event management company) has a public-facing website.  
That website can have custom pages — like "Our Clients", "Gallery", "FAQ", "Blog", etc.

This module lets the **vendor** create, edit, and delete those pages from their portal.  
Each page has a **name**, a **short description**, and a **content** field that stores raw HTML  
(written using a rich text editor in the frontend).

---

## 2. Which Table Is Affected?

### `vendor_pages`

```sql
CREATE TABLE `vendor_pages` (
  id          INT           AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255)  NOT NULL,           -- Page title e.g. "Our Clients"
  description TEXT          NULL,               -- Short summary shown in hero section
  content     LONGTEXT      NULL,               -- Raw HTML from rich text editor
  is_active   TINYINT(1)    DEFAULT 1,          -- 1 = active, 0 = inactive
  vendor_id   INT           NULL,               -- Which vendor owns this page
  company_id  INT           NULL,               -- Admin company context (always set)
  created_by  INT           NULL,               -- vendor.id who created it
  updated_by  INT           NULL,               -- vendor.id who last edited it
  deleted_by  INT           NULL,               -- vendor.id who deleted it
  created_at  DATETIME      DEFAULT NOW(),
  updated_at  DATETIME      DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  DATETIME      NULL                -- NULL = alive, set = soft deleted
);
```

**Why LONGTEXT for content?**  
A page can have lots of HTML — images encoded as base64, styled tables, full articles.  
`TEXT` only holds 65KB. `LONGTEXT` holds up to 4GB. Safe choice.

**Why soft delete (`deleted_at`)?**  
Sequelize `paranoid: true` — when you call `page.destroy()`, it sets `deleted_at = NOW()`  
instead of running a real `DELETE`. All `findAll/findOne` queries automatically filter  
`WHERE deleted_at IS NULL`. This means deleted records are recoverable from DB if needed.

**Why `vendor_id` scoping?**  
Multiple vendors use the same backend. Vendor A must never see or touch Vendor B's pages.  
Every query in the service always passes `WHERE vendor_id = req.vendor.id`.

---

## 3. Backend File Map

```
src/
  models/
    vendorPage.js              ← Sequelize model (maps JS object ↔ DB row)
  services/
    vendorPage.service.js      ← All DB logic lives here
  controllers/
    vendorPage.controller.js   ← Receives HTTP req, calls service, sends response
  routes/
    vendor.routes.js           ← URL definitions + middleware wiring
```

### How these layers talk to each other

```
HTTP Request
    ↓
vendor.routes.js       — "Is this vendor logged in? Route this URL to the right controller fn"
    ↓
vendorPage.controller  — "Parse req.params/body, call service, return ApiResponse"
    ↓
vendorPage.service     — "Run Sequelize query, throw ApiError if something's wrong"
    ↓
MySQL (vendor_pages table)
```

---

## 4. Backend — File by File

### `src/models/vendorPage.js`

Defines the Sequelize model. Key settings:

| Setting | Value | Why |
|---|---|---|
| `tableName` | `vendor_pages` | Explicit — don't let Sequelize guess |
| `timestamps: true` | auto | Sequelize manages `created_at` / `updated_at` |
| `paranoid: true` | soft delete | `destroy()` sets `deleted_at` instead of DELETE |
| `underscored: true` | snake_case | DB columns use `vendor_id` not `vendorId` |

---

### `src/services/vendorPage.service.js`

This is where all business logic lives. Controllers should be thin — they just call these.

#### `getAll(query, vendorId, companyId)`
- Calls `baseService.getAll()` — a shared utility that handles pagination, search, sort
- Search works on `name` and `description` fields
- Always scoped: `WHERE vendor_id = vendorId`
- Returns `{ data: [...], pagination: { total, page, limit, totalPages } }`

#### `getById(id, vendorId, companyId)`
- `findOne({ where: { id, vendor_id: vendorId } })`
- The `vendor_id` check is intentional — prevents vendor A from reading vendor B's page by guessing an ID
- Throws `ApiError.notFound` if not found (controller catches this automatically via `asyncHandler`)

#### `create(data, vendorId, companyId)`
- Checks for duplicate name per vendor first
- `findOne({ where: { name, vendor_id } })` — if exists, throws `ApiError.conflict`
- Why? Two pages with the same name from the same vendor would be confusing on the website

#### `update(id, data, vendorId, companyId)`
- Fetches the page first to confirm ownership
- If name is changing, checks for duplicates again (excludes current record via `Op.ne`)
- Calls `page.update(data)` — Sequelize only updates fields present in `data`

#### `updateStatus(id, status, vendorId)`
- Toggles `is_active` — if it's `1` it becomes `0`, if `0` becomes `1`
- Note: the `status` param from the request body is not actually used — the toggle logic ignores it and just flips the current value. This is intentional.

#### `remove(id, vendorId)`
- Calls `page.destroy()` — because model is `paranoid: true`, this sets `deleted_at`
- Real data is never deleted from DB

---

### `src/controllers/vendorPage.controller.js`

Thin layer. Each function:
1. Calls the matching service method
2. Passes `req.vendor.id` and `req.vendor.company_id` (set by `isVendorAuthenticated` middleware)
3. Logs activity via `logVendorActivity` on create/update/delete
4. Sends back `ApiResponse.success(res, data, message)`

All functions are wrapped in `asyncHandler` — so if the service throws an `ApiError`,  
it's caught automatically and sent as a proper JSON error response. No try/catch needed in controllers.

---

### `src/routes/vendor.routes.js` (relevant section)

```js
router.get('/pages',              isVendorAuthenticated, vendorPageController.getAll);
router.get('/pages/:id',          isVendorAuthenticated, vendorPageController.getById);
router.post('/pages',             isVendorAuthenticated, vendorPageController.create);
router.put('/pages/:id',          isVendorAuthenticated, vendorPageController.update);
router.patch('/pages/:id/status', isVendorAuthenticated, vendorPageController.updateStatus);
router.delete('/pages/:id',       isVendorAuthenticated, vendorPageController.remove);
```

These are mounted at `/api/v1/vendors` in `app.js`, so full URLs are:

| Method | Full URL | What it does |
|---|---|---|
| GET | `/api/v1/vendors/pages` | List all pages (paginated) |
| GET | `/api/v1/vendors/pages/:id` | Get single page |
| POST | `/api/v1/vendors/pages` | Create new page |
| PUT | `/api/v1/vendors/pages/:id` | Update page |
| PATCH | `/api/v1/vendors/pages/:id/status` | Toggle active/inactive |
| DELETE | `/api/v1/vendors/pages/:id` | Soft delete page |

**Why `isVendorAuthenticated` and not `isAuthenticated`?**  
`isAuthenticated` = admin JWT cookie (`access_token`)  
`isVendorAuthenticated` = vendor JWT cookie (`vendor_access_token`)  
These are completely separate auth systems. Vendor routes must use vendor middleware.

**Where is the old `vendorpage.route.js` file?**  
It exists but was never finished — missing router declaration, middleware imports, and module.exports.  
It was never mounted in `app.js`. The routes were inlined directly into `vendor.routes.js` instead.  
The old file can be deleted.

---

## 5. Frontend File Map

```
src/
  hooks/
    use-vendor-pages.ts                         ← All TanStack Query hooks for pages API
  app/(dashboard)/website/pages/
    page.tsx                                    ← Main list page (just renders PagesListContent)
    _components/
      pages-list-content.tsx                   ← Table with search/sort/pagination/delete
    create/
      page.tsx                                 ← Create form with rich text editor + preview
    edit/[id]/
      page.tsx                                 ← Edit form — fetches existing page by ID
    view/[id]/
      page.tsx                                 ← Read-only view — renders HTML in iframe
```

---

## 6. Frontend Hooks — `use-vendor-pages.ts`

All API calls go through `apiClient` (axios instance with base URL + cookie auth).

| Hook | HTTP Call | Used In |
|---|---|---|
| `useVendorPages(params?)` | `GET /vendors/pages` | List page |
| `useVendorPage(id)` | `GET /vendors/pages/:id` | Edit + View pages |
| `useCreateVendorPage()` | `POST /vendors/pages` | Create page |
| `useUpdateVendorPage(id)` | `PUT /vendors/pages/:id` | Edit page |
| `useDeleteVendorPage()` | `DELETE /vendors/pages/:id` | List page (delete action) |
| `useUpdateVendorPageStatus()` | `PATCH /vendors/pages/:id/status` | (available, not used in UI yet) |

**Why TanStack Query (React Query) instead of useState + useEffect + fetch?**
- Automatic caching — visiting the list twice doesn't hit the API twice
- `invalidateQueries` — after create/update/delete, the list auto-refreshes
- `isPending` state built in — easy loading spinners on buttons
- Error handling built in — no boilerplate try/catch everywhere

**Query key pattern:**
```ts
const VENDOR_PAGES_KEY = ['vendor-pages'] as const;

// List: ['vendor-pages', { page: 1, limit: 10 }]
// Single: ['vendor-pages', 5]
```
When `useCreateVendorPage` succeeds, it runs:
```ts
queryClient.invalidateQueries({ queryKey: VENDOR_PAGES_KEY })
```
This invalidates ALL keys starting with `'vendor-pages'` — both the list and any cached single pages.

---

## 7. Scenario Walkthroughs

### Scenario A — Vendor creates a new page

1. Vendor fills in Name, Description, and writes HTML content in the rich text editor
2. Clicks **CREATE**
3. `useCreateVendorPage().mutate({ name, description, content })` fires
4. `POST /api/v1/vendors/pages` → `isVendorAuthenticated` middleware runs:
   - Reads `vendor_access_token` cookie
   - Decodes JWT → sets `req.vendor = { id, company_id, ... }`
5. Controller calls `vendorPageService.create(body, req.vendor.id, req.vendor.company_id)`
6. Service checks: does a page with this name already exist for this vendor?
   - Yes → throws `ApiError.conflict` → 409 response → toast error in frontend
   - No → `VendorPage.create({ ...data, vendor_id, company_id })` → row inserted
7. Controller logs activity: `"Page 'Gallery' created"`
8. `ApiResponse.success(res, page, 'Page created successfully', 201)`
9. Frontend hook `onSuccess`: invalidates query cache, shows success toast, redirects to `/website/pages`

---

### Scenario B — Vendor edits a page

1. Vendor visits `/website/pages/edit/7`
2. Page component calls `useVendorPage(7)`
3. `GET /api/v1/vendors/pages/7` → service: `findOne({ where: { id: 7, vendor_id: X } })`
   - If vendor B tries to access vendor A's page ID 7 → not found (vendor_id mismatch) → 404
4. `useEffect` populates form fields when data loads
5. Vendor edits content, clicks **UPDATE**
6. `useUpdateVendorPage(7).mutate({ name, description, content })`
7. `PUT /api/v1/vendors/pages/7` → service fetches page again (ownership check) → `page.update(data)`
8. Sequelize only updates the fields passed — if vendor doesn't change the name, `name` isn't in the body, so it stays untouched
9. Success → cache invalidated → toast → redirect to list

---

### Scenario C — Vendor deletes a page

1. In the list, vendor clicks the dropdown → **Delete**
2. `useDeleteVendorPage().mutate(pageId)`
3. `DELETE /api/v1/vendors/pages/:id`
4. Service: `page.destroy()` → sets `deleted_at = NOW()` in DB (soft delete)
5. Row still exists in DB but all future queries filter `WHERE deleted_at IS NULL` so it's invisible
6. Cache invalidated → list refreshes → row disappears

---

### Scenario D — Vendor views a page (HTML preview)

1. Vendor clicks **View** → `/website/pages/view/7`
2. `useVendorPage(7)` fetches the page
3. `page.content` is raw HTML string e.g.:
   ```html
   <h2>Our Clients</h2><p>We have worked with <strong>200+</strong> clients...</p>
   ```
4. This is rendered inside an `<iframe srcDoc={htmlContent}>` — not `dangerouslySetInnerHTML`
5. **Why iframe?** Isolates the HTML in its own document context. CSS from the vendor portal  
   doesn't bleed into the page preview. The page renders exactly as it would on the public website.
6. `sandbox="allow-scripts allow-same-origin allow-popups"` — allows basic JS in the preview  
   but blocks form submissions and top-level navigation

---

### Scenario E — Search + Pagination on the list

1. Vendor types "gallery" in the search box
2. `useVendorPages({ page: 1, limit: 10, search: 'gallery' })` fires with a 30s stale time
3. `GET /api/v1/vendors/pages?page=1&limit=10&search=gallery`
4. `baseService.getAll` builds: `WHERE vendor_id = X AND (name LIKE '%gallery%' OR description LIKE '%gallery%')`
5. Returns `{ data: [...], pagination: { total: 1, page: 1, limit: 10, totalPages: 1 } }`
6. `PaginationControls` uses `total` for page count — it's server-side pagination, not client-side

---

## 8. Key Decisions & Why

| Decision | Why |
|---|---|
| Routes inlined in `vendor.routes.js`, not a separate file | `vendorpage.route.js` was broken (missing router + exports). Simpler to inline where all other vendor routes live. |
| `LONGTEXT` for content | Rich text HTML can be very large. `TEXT` (65KB) is not enough. |
| Soft delete (`paranoid: true`) | Consistent with all other vendor models (`vendor_staff`, `vendor_clients`). Data is recoverable. |
| `vendor_id` checked on every query | Prevents IDOR (Insecure Direct Object Reference) — a vendor guessing another vendor's page ID |
| View page uses `<iframe>` not `dangerouslySetInnerHTML` | Isolates styles, prevents vendor portal CSS leaking into HTML preview |
| `useVendorPage(id)` fetches on edit load | No stale data — always gets fresh content from DB when opening the editor |
| Content saves as raw HTML | The rich text editor outputs HTML. Storing it as-is means no conversion needed. The DB just stores the string. |

---

## 9. What Does NOT Exist Yet (Future Work)

- **Status toggle UI** — `PATCH /pages/:id/status` exists in backend, hook exists in frontend, but no toggle button in the list UI yet
- **Staff portal access** — currently only the vendor (owner) can manage pages. Staff with `website_management.view` permission cannot yet access pages through the staff portal
- **Public website rendering** — the HTML stored here needs to be fetched and rendered on the actual public vendor website (separate frontend project)
- **Image uploads inside content** — the rich text editor currently doesn't upload images to server; any images are inline base64 which inflates content size

---

## 10. Files Changed in This Feature

### Backend
| File | Change |
|---|---|
| `src/models/vendorPage.js` | New — Sequelize model |
| `src/services/vendorPage.service.js` | New — all DB logic |
| `src/controllers/vendorPage.controller.js` | New — HTTP handlers |
| `src/routes/vendor.routes.js` | Modified — added controller import + 6 routes |
| `initial_setup.sql` | Modified — added `CREATE TABLE vendor_pages` |

### Frontend (Vendor Portal)
| File | Change |
|---|---|
| `src/hooks/use-vendor-pages.ts` | New — all TanStack Query hooks |
| `src/app/(dashboard)/website/pages/_components/pages-list-content.tsx` | Modified — replaced mock data with real API |
| `src/app/(dashboard)/website/pages/create/page.tsx` | Modified — calls `useCreateVendorPage` |
| `src/app/(dashboard)/website/pages/edit/[id]/page.tsx` | Modified — fetches + updates via API |
| `src/app/(dashboard)/website/pages/view/[id]/page.tsx` | Modified — converted to client component, fetches via API |
