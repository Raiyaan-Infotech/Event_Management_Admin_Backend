# Event Invite Project Audit

Date: 2026-05-02

Scope reviewed:
- Admin backend
- Admin frontend
- Vendor portal frontend

This is a focused engineering audit, not a full line-by-line review. The goal is to capture the highest-signal bugs, risks, and improvements found during the current sweep.

## High Priority Findings

### 1. Public vendor lookup is slow and can resolve the wrong vendor

Files:
- [src/controllers/publicWebsite.controller.js](/mnt/d/Jamal/Event_Management_Admin_Backend/src/controllers/publicWebsite.controller.js:24)

Problem:
- Public vendor pages currently load all active vendors and then compare a computed slug in memory.
- This does not scale well as vendor count grows.
- Two similar company names can collide into the same computed slug.

Impact:
- Public website requests may get slower over time.
- Wrong vendor website could be returned if names normalize to the same slug.

Recommended fix:
- Add a real unique `slug` column on vendors.
- Generate and persist slug at create/update time.
- Query vendor directly by slug in SQL instead of scanning all active vendors.

## 2. Public client ID generation has a race condition

Files:
- [src/controllers/publicWebsite.controller.js](/mnt/d/Jamal/Event_Management_Admin_Backend/src/controllers/publicWebsite.controller.js:140)

Problem:
- Client IDs are generated with `count + 1`.
- Two concurrent registrations can produce the same ID.

Impact:
- Duplicate client IDs in production traffic.
- Failed inserts or inconsistent identity records.

Recommended fix:
- Use a database-backed unique strategy.
- Better options: auto-increment based public code, UUID-based public ID, or transaction-safe sequence logic.

## 3. Theme JSON parsing is brittle across backend and admin

Files:
- [src/services/theme.service.js](/mnt/d/Jamal/Event_Management_Admin_Backend/src/services/theme.service.js:19)
- [appearance-content.tsx](/mnt/d/Jamal/Event_Management_Admin_Frontend/src/app/admin/appearance/_components/appearance-content.tsx:18)

Problem:
- Theme fields such as `plans` and `home_blocks` are parsed with raw `JSON.parse(...)`.
- Invalid stored JSON can break theme listing, filtering, validation, or preview rendering.

Impact:
- Admin theme management can fail unexpectedly.
- One bad DB value can break page rendering instead of degrading safely.

Recommended fix:
- Introduce a shared safe JSON parser helper in backend and frontend.
- Return fallback arrays when JSON is malformed.
- Log parse failures in backend for cleanup visibility.

## 4. Vendor portal redirects during render

Files:
- [page.tsx](/mnt/d/Jamal/Event_Management_Vendor_Frontend/src/app/(dashboard)/website/pages/view/[id]/page.tsx:24)

Problem:
- The page calls `router.push(...)` inside render when data is missing.

Impact:
- React warnings.
- UI flicker.
- Unstable navigation behavior.

Recommended fix:
- Move redirect logic into `useEffect`, or use a proper route-level not-found/redirect pattern.

## 5. Hardcoded registration date shown in vendor client profile

Files:
- [view-client-content.tsx](/mnt/d/Jamal/Event_Management_Vendor_Frontend/src/app/(dashboard)/clients/_components/view-client-content.tsx:398)

Problem:
- The UI shows `Registered: 31 Mar 2026` as a fixed string.

Impact:
- Incorrect client data shown to users.
- Loss of trust in the admin/vendor data surface.

Recommended fix:
- Use the real registration timestamp from the API.
- Fall back to a neutral placeholder if the field is unavailable.

## 6. Login debug logging is still present in backend auth flow

Files:
- [src/services/auth.service.js](/mnt/d/Jamal/Event_Management_Admin_Backend/src/services/auth.service.js:102)

Problem:
- Debug login state is printed in backend logs.

Impact:
- Noisy logs.
- Increased risk of sensitive operational details leaking into stored logs.

Recommended fix:
- Remove the debug logs.
- If needed, replace with structured logger calls behind a debug flag.

## Medium Priority Findings

### 7. Public vendor route was vulnerable to asset-like slug noise

Status:
- Already mitigated in vendor frontend by blocking asset-like slugs such as `favicon.ico` before public vendor fetches run.

Remaining improvement:
- Add a real favicon/app icon to the vendor frontend so the browser does not make stray fallback requests.

### 8. Loading UX is inconsistent across the project

Status:
- Vendor portal has been improved with shared full-page loader and initial boneyard skeleton wiring.

Remaining issue:
- Admin frontend and some local widget states still use mixed loading patterns.

Recommended fix:
- Standardize page-level loading, table loading, and form loading patterns across admin and vendor apps.

### 9. Preview and rich content surfaces rely on raw HTML injection

Examples:
- [src/app/preview/page.tsx](/mnt/d/Jamal/Event_Management_Vendor_Frontend/src/app/preview/page.tsx:30)
- [src/app/[slug]/pages/[id]/page.tsx](/mnt/d/Jamal/Event_Management_Vendor_Frontend/src/app/[slug]/pages/[id]/page.tsx:29)
- [src/components/blocks/AboutUs.tsx](/mnt/d/Jamal/Event_Management_Vendor_Frontend/src/components/blocks/AboutUs.tsx:43)

Problem:
- `dangerouslySetInnerHTML` is used in multiple public-facing and preview-facing surfaces.

Impact:
- If sanitization is missing upstream, this increases XSS risk.

Recommended fix:
- Verify sanitization happens before persistence.
- Prefer a single trusted sanitization pipeline for CMS-like HTML fields.

## Current Improvement Work Already Started

### Vendor portal

Completed recently:
- Shared full-page blur loader
- Shared preview action cleanup
- Missing preview button coverage on major website management pages
- `next/image` and `next/link` cleanup in many vendor pages
- Header city mapping fixed from vendor locality/city data
- `favicon.ico` public route noise mitigated
- `boneyard-js` installed
- Shared boneyard skeleton components added for:
  - website settings pages
  - details/view pages
  - dashboard data tables
  - three-panel builder layouts

Pending:
- Complete first boneyard snapshot registry build
- The build attempted to install Chromium and stalled on first run

## Recommended Next Action Order

1. Persist real vendor `slug` and update public website lookup.
2. Replace `count + 1` public client ID generation with a safe unique strategy.
3. Add shared safe JSON parsing for theme-related fields.
4. Fix render-time redirects in vendor pages.
5. Replace hardcoded client registration date with real API data.
6. Remove backend auth debug logs.
7. Finish boneyard registry generation and extend skeleton usage where helpful.
8. Audit HTML sanitization for public/vendor content blocks.

## Suggested Follow-up Audit Pass

A stronger second pass should focus on:
- authentication and session flow
- approval/permission logic
- public website content sanitization
- DB integrity constraints
- subscription/theme assignment consistency
- API error contract consistency across admin and vendor apps

