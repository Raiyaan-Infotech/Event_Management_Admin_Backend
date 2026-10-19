# Event Management — Laravel Backend Architecture + Conversion Plan

## Context

The Node/Express/Sequelize backend (`D:\Jamal\Event_Management_Admin_Backend`, MySQL on Aiven, Render)
serves 6 Next.js apps + 1 Flutter app. It grew feature-by-feature: 925 endpoints, 169 tables, two client
systems, two website builders, raw-SQL controllers, 8 live bugs. This plan defines the **Laravel 12
backend architecture** that replaces it, the cleaned schema, and how data and traffic move over.

### Decisions (Jamal, 2026-10-17)
- **API contract:** `/api/v1` paths, JSON shapes and cookie names stay identical. Frontends only change `API_URL`.
- **Database:** new database built only from Laravel migrations, filled by a one-time import.
- **Realtime chat:** small Node socket.io relay stays; Laravel owns all data.
- **Vendor side: MERGE.** Every customer-facing row belongs to a vendor; `vendor_id` is never NULL.
  **Vendor #1 = house vendor (ours)** — production "RA EVENTS" (jamal@jamal.com). The company website,
  all website clients and all events map to vendor 1.

---

## Advantages and disadvantages of converting to Laravel

**Advantages**

| # | Advantage | What it fixes in this project |
|---|---|---|
| 1 | One clear structure: 10 modules, thin controllers, one Action per use case | The 2,263-line builder controller with 115 raw queries, logic scattered between controllers and services |
| 2 | Tenant safety by default (global scopes + policies) | Builder writes with header-chosen tenant, unscoped approvals and FAQ, `|| 1` fallbacks in ~30 places |
| 3 | Smaller, honest data model: ~95 tables instead of 169 | Two client tables, two builders, dead tables, relations hidden in JSON |
| 4 | Vendor clients become full clients | Today a vendor's client cannot create events or use the mobile app |
| 5 | Built-in tools replace hand-written ones: Sanctum, queues, scheduler, notifications, validation, Socialite | 5 custom JWT flows, node-cron, custom OAuth, custom FCM token code, 20+ field whitelists |
| 6 | One migration history | 4 Sequelize + 10 SQL + ~75 `apply-*.js` scripts and repeated prod/local drift |
| 7 | Slow work moves to background jobs with retries | OTP, push, auto-translate and broadcasts currently run inside the request |
| 8 | Security by default | Unrevocable vendor/staff tokens, plaintext secrets, plaintext password in activity log, unthrottled reset OTP |
| 9 | Real tests: Pest feature, contract and architecture tests | Today's checks are scripts against a live server |
| 10 | PHP/Laravel developers are easy to hire; you already use Laravel 12 in RWMS | One stack across your projects |

**Disadvantages and risks**

| # | Disadvantage | How the plan reduces it |
|---|---|---|
| 1 | Big job: 925 endpoints, ~68k lines. Rough estimate for one developer full-time with AI help: 3–5 months to full parity | Phases; each phase is usable and tested on its own |
| 2 | No new user-visible features while rewriting; features added to Node meanwhile must be built twice | Node schema freeze; new features built in Laravel first |
| 3 | Hidden behaviour can be lost: session.md records hundreds of edge-case fixes | Contract tests replay real Node responses; session.md is the checklist per module |
| 4 | The real slowness is the production database (~374 ms per query); Laravel does not fix that, and PHP-FPM loses in-process caches between requests | Redis cache, eager loading, batched queries; Laravel Octane optional later |
| 5 | Render has no native PHP: Laravel runs as a Docker image, plus a worker, a scheduler and Redis | More services and a higher monthly bill; planned in A2 |
| 6 | Two languages remain, because chat-socket stays Node (your choice) | Kept tiny (~200 lines), no business logic |
| 7 | Cutover risk: everyone signs in again; import, QR key and password hashes must be exact | Dry-run on a production copy, QR and login checks in Part F, Node kept read-only for rollback |
| 8 | Keeping `/api/v1` identical means copying some of today's inconsistencies, such as different pagination shapes, into the Resources | Isolated in `Resources/V1`; a later v2 can clean them |
| 9 | The vendor merge needs product decisions: which plans vendor clients see, and the old vendor-client login path | Default: platform plans for everyone; legacy login endpoints kept |

**Honest alternative:** if the main goal is clean structure rather than PHP itself, the same cleanup
(merge schema, fix bugs, modules, tests) could be done inside the current Node backend with less
cutover risk. The Laravel route is the better choice if your team and future projects are PHP/Laravel.


## Progress

| Date | Phase | Result |
|---|---|---|
| 2026-10-17 | 1 — Skeleton + Core | Done in `D:\Jamal\Event_Management_Laravel_Backend`. Laravel 12.70 / PHP 8.3.35 (portable, `D:\Jamal\_tools\php83`). Core kernel, portal middleware groups, tenancy, Sanctum token model, exception map, ListQuery, EventQr, module system, companies/users/vendors tables, house-vendor seeder, CI. Pint clean, Larastan level 6 clean, 59 Pest tests pass. Every QR code in the local legacy DB decrypts with the PHP codec. |

Adjustments made while building Phase 1:
- **Approvals move to Phase 2.** The gate reads `requires_approval` from role permissions, which arrive with Identity.
- **Vendor and client guards arrive in Phase 4** with the VendorUser and Client models; the portal middleware groups already exist.
- **bcryptjs hashes:** Laravel's `Hash::check` rejects the Node `$2a$` hashes ("not Bcrypt") although PHP verifies them. `config/hashing.php` sets bcrypt `verify=false`; logins rehash to `$2y$`. Without this every existing user would fail to log in after cutover.
- **QR key for production:** derive `EVENT_QR_KEY` from the secret production actually uses (`EVENT_QR_SECRET` if set on Render, else `ACCESS_TOKEN_SECRET`).

| Date | Phase | Result |
|---|---|---|
| 2026-10-17 | 2 — Platform + Identity | Done. 132 admin routes: auth (login, refresh, logout, me, change-password, profile, reset by emailed code), employees, departments, roles + permission grants, permissions, modules, companies, approvals, activity log, settings, plugins, languages, currencies, locations (23 routes incl. bulk import), media library + proxy, UI translations + missing keys, timezones, setup status. Pint clean, Larastan level 6 clean, 120 Pest tests pass (510 assertions). |

Decisions and behaviour changes in Phase 2 (each one is a v1 bug or gap; the frontends need no change):
- **`user.permissions` is now filled** on login and `/auth/me` (list of slugs). The admin PermissionGuard reads it; v1 never sent it, so every guarded screen was hidden from employees who were not developer or super admin.
- **Full permission catalogue seeded** from the slugs the v1 admin routes and screens check (`AdminPermissionCatalogue`, 171 permissions in 41 groups). The v1 database lacked many of them. Only the admin catalogue is seeded now; vendor-portal permissions (about, staff, home_slider, …) get their own catalogue with the vendor guard in Phase 4.
- **One admin password rule:** 8+ characters, upper and lower case, a number, a symbol, no spaces — for employee create/edit, change-password, reset and new company admins. v1's backend checked nothing and its screens disagreed (6 vs 8).
- **Reset codes** are stored hashed in `password_reset_tokens`, rate limited, and "no such email" answers the same as "code sent".
- **Role hierarchy enforced everywhere:** v1 checked levels only when creating an employee; editing could raise a role above the editor's own. Roles cannot be given a level above the editor's; editors can only grant permissions they hold; developer and super_admin roles cannot be deleted or switched off; employees cannot delete or deactivate themselves.
- **Approvals:** every approvable resource has a handler (8 v1 modules had none). Requests are company-scoped. Media upload/delete approval is dropped (v1 could not execute it). `POST /approvals` (manual request creation, unused by any screen) is not ported — it would let anyone queue an unvalidated payload for a reviewer to run.
- **Settings are per company** (v1 matched by key alone, so one company could overwrite another's); secret values are encrypted at rest; the bulk save still needs the group permission (`general_settings.edit`, …).
- **Missing-key inbox** (list, create, ignore, delete, create-all, translate-all) now needs `translations.view` / `translations.manage`; v1 only required a login.
- **Media paths are checked** (no `..`, no absolute paths) on copy, move, rename and delete.
- **Company creation:** the first admin's password is hashed once (v1 hashed it twice, so that admin could never sign in).
- **Web installer** (`/setup/check`, `/test-db`, `/configure`, `/finalize`) not ported: Laravel installs with migrations and seeders; `/setup/status` reports installed.
- **Kept for the frontends:** `users.marital_status`, the currency format columns, v1 location keys (`city_id` = district, `pincode_id` = city), the non-envelope approval shapes, `is_active = 2` for "pending approval".
- **Legacy import** of these tables stays in Phase 9 with everything else (one `legacy:import` run).

| Date | Phase | Result |
|---|---|---|
| 2026-10-17 | 3 — Catalog + Templates | Done. 117 admin routes (249 total): event categories, event menus (slugs, Default grants, toggles, duplicate, reorder), subscription plans (limits, menu grants, deactivate/reactivate, delete with reason, duplicate), plan badges (+ settings), plan types, menus, notification categories and templates, both guest dropdowns, template styles, frame styles and decorations (stats, SVG recolour), template fonts (upload/link, public font file), event templates (the full 5-step wizard normaliser, stats, featured, duplicate, reorder). Pint clean, Larastan level 6 clean, 139 Pest tests pass (719 assertions). |

Decisions and behaviour changes in Phase 3:
- **Correction to Part B:** `menus` and `plan_types` are NOT dead — the admin plan-type screen, plan wizard and vendor form use them. Both are ported. `plan_badge_plans` is ported too (used when a badge applies to selected plans).
- **Relations out of JSON:** `event_templates.decoration_ids` → `event_template_decoration` (ordered), `event_templates.plan_ids` → `event_template_plan`, `plan_types.menu_ids` → `plan_type_menu`. The API still sends and receives the arrays.
- **Renamed tables:** `subscription_plans` → `plans`, `subscription_plan_menus` → `plan_menu`; `guest_relationship_options` + `guest_food_preference_options` → `guest_options` with a `kind` column. v1 keys and response names are unchanged.
- **Uniqueness enforced by the database** (per company, among live rows): category names, menu slugs, plan codes, template codes, style slugs, font names, notification trigger keys. v1 enforced most of these in code only.
- **Plan menu grants:** the Default (locked) menus are always kept on save, and marking a menu Default grants it to every plan in one statement (both v1 rules). A cache version (`PlanGrants`) is bumped on every change, for the client portal in Phase 6.
- **Duplicate actions** (plans, menus, templates, notification templates) run directly with the create permission. In v1 they went through the create-approval check, which could never succeed (an empty body failed validation).
- **SVG recolour and the media proxy** read artwork only from our storage or from URLs already stored on our rows (the same SSRF guard as v1); Templates registers those rows with Platform's `KnownUploads`.
- **Phase 2 bug found and fixed:** editing or deleting a location failed, because Laravel passes route parameters to controller methods by position and the route default `level` arrived as the id. Covered by a test now.
- New shared Core pieces: `RecordWriter` (moved from Platform), `RecordController`, `RowResource`, `CallbackListQuery`, `Flag`.

| Date | Phase | Result |
|---|---|---|
| 2026-10-17 | 4 — Vendors + Clients | Done. 133 routes (382 total). Vendors: owner and staff sign-in (login, refresh, logout, reset by e-mailed code, change password, handoff), vendor profile, staff, vendor roles and permissions, departments, the vendor's tier, admin vendor screens (list, CRUD, status, impersonate, approvals). Clients: one `clients` table for both v1 client systems; client portal and app sign-in (password, phone code, Google/Facebook, 2FA with backup codes and trusted browser, token refresh), sessions per device, account (profile, photo, password, close account, favourites, settings, notification switches, push devices), admin `/website-clients`, vendor and staff client screens, the vendor's newsletter list, sign-up / sign-in / newsletter on a vendor's public site, and the v1 vendor-client portal. Pint clean, Larastan level 6 clean, 176 Pest tests pass (1,131 assertions). |

Decisions and behaviour changes in Phase 4:
- **One client table.** `website_clients` + `vendor_clients` → `clients` (vendor_id NOT NULL). v1 names stay in the API: `client_id` (now `code`), `subscription_plan_id` (`plan_id`), `subscription_id`/`plan` (`plan_type_id`, the vendor's tier), `profile_pic` (`avatar_url`), `client_type` (`newsletter_opt_in`). Two response shapes are kept: the website-client shape (client portal, app, admin) and the vendor-client shape (vendor, staff, vendor-client portal).
- **Every client can sign in everywhere** their login allows: a vendor's client can use the client portal and the app, a website client the vendor-client portal. `login_access`, `is_active` and the vendor's status are checked at sign-in and on every request, so switching a client off ends their access at once (v1 waited for the token to expire). Vendor-created clients still start without login access (v1 default).
- **Uniqueness per vendor:** e-mail and mobile are unique per vendor among live clients. v1 made vendor-client e-mails unique across ALL vendors. Deleted clients no longer block their e-mail (v1 renamed the e-mail on delete).
- **Mobile numbers match both ways:** "9876543210" finds "919876543210" and the reverse. v1 only matched one way, so the same person could register twice.
- **Sessions:** one `client_sessions` row per device, its access and refresh tokens linked by `session_id`. A refresh rotates the pair inside the same session and the old refresh token stops working. Password change signs out every other device; password reset and account closing sign out all.
- **Security fix — vendor-client password reset:** v1 returned the reset code in the "forgot password" response, so anyone who knew a client's e-mail could take over the account. The code is now e-mailed only (10 minutes, 5 tries). The client portal's forgot-password screen still works; it just no longer shows a code.
- **Security fix — approvals:** a password sent with an admin client change that needs approval is hashed before the request is stored (never plain text in `approval_requests`).
- **2FA secrets are encrypted at rest** (v1 stored them plain). The trust-this-browser cookie is encrypted and stops working when 2FA is turned off and on again (same rule as v1).
- **Two password rules kept, per screen:** the client portal, app and admin use 8+ characters with a number and a capital letter; the vendor and staff portals, the vendor's public sign-up and the vendor-client portal use exactly 8 with upper, lower, number and symbol. Merging them would break one set of screens.
- **Admin client list** shows the clients of every vendor of the company (v1 showed only website clients); `?vendor_id=` and `?source=` narrow it.
- **Bug 2 fixed for clients too:** `/vendors/client/subscription/plans` used the missing `Subscription` model; it reads plan types now.
- **OTP delivery** goes through a Core `OtpSender` contract. Until Messaging (Phase 7) adds MSG91, codes are only logged and, outside production, returned as `dev_code` (v1 behaviour). `OTP_ACCEPT_ANY` is ignored in production.
- **Extension points for later phases:** `MobileSignInHooks` (Events: guest and organizer numbers get accounts on first phone sign-in, organizer check, link guest rows after sign-in), `SocialSignIn::allowHosts` (Sites: tenant domains as sign-in return addresses), `ClientSettings::emailDeliveryUsing` (Messaging: e-mail provider configured).
- **Not ported yet, by design:** `/client/event-options` and the client event screens arrive with Events (Phase 6).

| Date | Phase | Result |
|---|---|---|
| 2026-10-17 | 5 — Billing | Done. 18 routes (400 total). Client portal `/client/billing/*`: overview with usage and plan features, plans with tax, scheduled plan change, cancel and resume, invoices (list with stats, detail with items, payments, timeline and amount in words), billing history, payment methods, contact sales. Admin `/payments`: list, stats, detail, record a payment, confirm/fail a pending one. Pint clean, Larastan level 6 clean, 188 Pest tests pass (1,248 assertions). |

Decisions and behaviour changes in Phase 5:
- **Tables renamed, one per idea:** `client_subscriptions` (kept), `client_subscription_events` → `subscription_events`, `client_invoices` (+ items) → `invoices`, `invoice_items`, `client_transactions` → `transactions`, `client_payment_methods` → `payment_methods`, `client_sales_enquiries` → `sales_enquiries`. All are children of `clients`; none carries company_id or vendor_id.
- **Bug 4 fixed — admin Payments screen:** v1 read a `payments` table nothing wrote to, and `/payments/stats` crashed. The screen now shows the clients' payments and refunds from the billing ledger, for every vendor of the company, in the v1 row shape (the client appears as `user`). The `payments` table is dropped.
- **Admins can record a payment** (`POST /payments` with an invoice, amount, method): the way a UPI, bank or cash payment that arrived outside a payment provider settles an invoice. A pending payment can be confirmed (it then counts against the invoice), failed or cancelled. A payment that already counted cannot be flipped back; refunds belong to the payment provider. v1's status endpoint changed a free-floating row with no effect on any invoice.
- **v1 rules kept:** a client the admin put on a plan gets a subscription the first time billing opens, its term rolled forward to today; reading a subscription applies a due plan change, renews ended terms (one invoice per term, `INV-<year>-<6 digits>`) and ends a cancelled one at its term end; `clients.plan_id` mirrors the plan the subscription grants; GST 18% added on top, split CGST/SGST; card numbers and CVCs are refused outright, only a provider token is accepted, and only when a provider is configured (503 otherwise); manual methods (UPI, bank last 4 digits only, cash); at most 5 methods.
- **Invoice numbers are unique across the platform** (v1: per company, enforced in code only).
- **Usage numbers** (events, guests, storage) come from `UsageMeters`, which Events fills in Phase 6. Until then they are 0 — true, as no events exist in the new system yet.
- **No payment provider yet** (same as v1): invoices carry no due date and say "Online payment is not enabled yet"; `RAZORPAY_KEY_ID` or `STRIPE_SECRET_KEY` switches tokenised cards on.

| Date | Phase | Result |
|---|---|---|
| 2026-10-18 | 6 — Events | Done. 119 routes (519 total). Events (wizard options from the plan, create/edit/delete, QR, list filters, dashboard stats, analytics, wishlist, cover and invitation images), organizer access, the phone book (guests, groups, CSV import/export, profile with notes/tags/reminders), participants, RSVPs with answer history and settings, joining by QR (public resolve and phone code, join, the guest's own RSVP, participant directory), agenda, family, gallery with albums, wishes with content filter and blocking, splash screens. Pint clean, Larastan level 6 clean, 212 Pest tests pass (1,588 assertions). |

Decisions and behaviour changes in Phase 6:
- **Organizer access is a rule, not an identity swap.** v1's middleware replaced the signed-in client with the event's owner on every request that named an organised event. Now one `EventAccess` rule decides: the owner and the organizer (while the owner's account is active) manage the event; only the owner deletes it; participants view it. Events an organizer runs appear on their list marked `is_organizer`.
- **Relations out of JSON:** `events.menu_ids` / `menu_order` → `event_menu` (selected + position); the rsvp / participant / family / wish settings and the wish word filter → `event_settings`. `disabled_app_menu_ids` (always reset to []) is dropped; the API still sends it empty.
- **Correction to Part C:** `events.theme_id` stays a template code, not a foreign key — every stored code is a premium theme built into the frontends, none exists in `event_templates`.
- **Children carry only their parent:** participants, agenda, family, gallery, wishes hang off the event; guests, groups, splash screens off the client; notes, tags, reminders off the guest. v1 repeated website_client_id and company_id on every row.
- **Guest accounts are made in the event's vendor** when a guest joins by QR (v1 always used vendor 1), and phone matching on participants and accounts is per vendor (v1 matched any client in any vendor with that number).
- **Phone sign-in hooks from Phase 4 are now live:** a guest's or organizer's number gets an account on first sign-in, "login as organizer" checks real events, and a verified sign-in links the person's guest rows and claims organised events.
- **Billing usage is now real:** events created in the term, heads, phone-book size and media storage (gallery + wish files).
- **Video handling** (make playable, mute, poster frame) uses ffmpeg (`FFMPEG_PATH`); image thumbnails use GD. Without ffmpeg a video is stored as uploaded and a requested mute is refused — v1 behaved the same when its binary was missing.
- **Deleting an event removes its gallery and wish files** from storage (v1 purgeEvent).
- **Notifications and messages:** v1 wrote notification rows inline (guest added, new RSVP, wish flagged) and sent a welcome invitation on join. These are now domain events (`ClientNotice`, `ParticipantAdded`) for the Messaging module (Phase 7). Message history in RSVP details, guest profiles and analytics reads through `MessageLog`, empty until Messaging registers it.
- **Not ported here, by design:** event notifications (scheduled notices to guests), messages, the notification feed and notification templates — Messaging (Phase 7).

| Date | Phase | Result |
|---|---|---|
| 2026-10-18 | 7 — Messaging | Done. 106 routes (625 total). Settings → Email (providers, test, connection debug) and Settings → Push Notifications (Firebase projects from the service-account file); every e-mail the platform writes now goes out through the default provider; one-time codes by MSG91 WhatsApp / SMS; the client notification feed; the Messages screen (compose by group or guest, preview with merge fields, send now or later, history with delivery counts); the app's Send Notification (draft / send / schedule in the organizer's time zone); the automatic notices per event and the Welcome Invitation; in-app mail and chat for admins, vendors and clients, with the `chat-socket/` relay; platform e-mail templates; the vendor's e-mail categories, templates and newsletter. Pint clean, Larastan level 6 clean, 238 Pest tests pass (2,006 assertions). |

Decisions and behaviour changes in Phase 7:
- **E-mail actually goes out.** The default mailer ("configured") sends through the provider marked default in Settings → Email, from its sender; with none set, e-mails are written to the log (a missing provider never breaks a sign-in). v1 read SMTP settings from env for some e-mails and from the table for others.
- **Secrets encrypted at rest:** e-mail provider passwords and API keys, and the Firebase service account and private key (v1 stored all four plain). Responses never include them (v1 rule kept).
- **Push to devices, counted per person:** FCM v1 with a signed service-account token (no SDK, same as v1). Tokens Firebase reports as uninstalled or invalid are switched off in one update per reason.
- **Messages screen channels:** push is sent through Firebase; e-mail is now sent too, one personalised e-mail per guest, on the queue, when a provider is set up (v1 recorded e-mail campaigns but never sent them). WhatsApp has no provider: still recorded with the reason shown (v1).
- **One broadcast table pair:** v1's `event_message_campaigns` + `event_messages` and `event_notifications` + `event_notification_recipients` are `event_broadcasts` + `event_broadcast_recipients`, with `source` = message | notice keeping each screen's rows apart.
- **Organizers too:** messages, notifications and the per-event notice switches work for the event's organizer as well as its owner (the Phase 6 access rule); v1 checked the owner only.
- **Message history is live:** RSVP details, guest profiles, analytics and "invitations sent" now read the recipient rows (Phase 6 showed none).
- **Notification feed rows** carry the event, the participant and v1's side-panel detail. The client settings screen still says in-app delivery is not on (v1's wording, unchanged).
- **Mail and chat for three portals on one set of routes:** the portal comes from `x-portal-type` (v1), else from the cookie present, else from the token. A "vendor" in mail and chat is the business (any of its logins).
- **Chat relay:** `chat-socket/` (Node, ~200 lines, no database) holds sockets and presence; Laravel issues 10-minute HS256 socket tokens and owns every row. The relay calls Laravel's `/api/internal/chat/*` with a shared secret and the user's token; Laravel pushes REST-sent messages to the relay. Typing is relayed only into rooms the socket was allowed to join (v1 checked membership on every keystroke).
- **Chat read state** lives on `chat_participants` (v1 kept it twice, also in `chat_read_states`). Unread counts are one query for the whole list (v1: two per conversation).
- **Validation errors are 400** in mail (v1 answered 500 with the same message).
- **Vendor newsletter** stays in-app (one mail + bell per client, v1); recipients are filtered by the tier name as before.
- **Not ported, needs a decision:** admin **E-mail Campaigns** (`/email-campaigns`, 13 routes). The screen exists, but v1 never started its scheduler, so no campaign ever ran, and its tables are empty (Part B lists them as dead). Ported later only if wanted.
- **Dropped columns:** `email_configs.imap_*` (never saved by v1), `email_templates.is_predefined`, campaign `window_start/end`, `chat_conversations.context_id`, `chat_participants.is_muted`, `chat_messages.edited_at`.

| Date | Phase | Result |
|---|---|---|
| 2026-10-18 | 8 — Sites | Done. 279 routes (904 total). One website builder for both v1 builders: the admin panel's Website Builder (`/website-builder/*`, the house vendor's marketing site: every section, highlights, page blocks, pricing, features, how-it-works, FAQs, the template showcase, video tutorials) and the builder app (`/vendors/website/*`, the signed-in vendor's own site: builder data, preview, publish, every section); the public site app's `/public/site/resolve` and `/site/bundle` for any site by host; a vendor's public website and contact form; content translation (languages, key registry rebuilt from the content, auto-translate with a progress stream, whole-site overlay); the admin FAQ screen and colour palettes. Pint clean, Larastan level 6 clean, 255 Pest tests pass (2,427 assertions). |

Decisions and behaviour changes in Phase 8:
- **One builder, one set of tables.** v1's 35 `company_website_*` and 21 `vendor_website_*` tables (plus the showcase pair, FAQ pair and palettes) are 30 tables: `sites` (kind marketing | vendor), `site_settings` (the single-row sections — basic information, hero, footer, SEO, login, theme, contact, pricing headings — as one JSON document each) and one table per list section, hanging off `site_id`. Column names are v1's, so rows answer as v1 sent them.
- **Who owns which site:** the house vendor (vendor 1) owns the marketing site; any vendor, the house vendor included, may own one vendor site. A vendor site is set up on its first save, with the six fixed pages (v1).
- **Security fixes:** v1's admin builder let any admin login change anything and took the company from a header; writes now need the new **website_builder.edit** permission and always reach the house marketing site. Visitors' contact messages and the translation screens need **website_builder.view** (v1 served the messages to anyone). Content reads stay open (the admin app's own preview pages read them). Developer and super admin roles pass; other admin roles need the new permission granted.
- **Bug 8 fixed:** the admin's page blocks were written over vendor 1's own vendor site; each page of the marketing site now keeps its own block list (`?page_slug=`).
- **Bulk saves keep ids.** v1 deleted and re-inserted every row on a bulk save (social links, testimonials, menu, plans...), which gave each row a new id and detached its translations and the contact page's links. Rows sent with their id are now updated in place.
- **Links stay inside the site:** a menu item's parent or page, a photo's album, a message's subject, a slide's slider, a contact link's social link must be rows of the same site, or they are dropped (v1 stored any number). The vendor builder's ENUM coercion is kept for vendor sites ("_self" → "self").
- **The vendor builder's pricing and features work.** v1 pointed them at the company tables, on columns those did not have; each site now has its own.
- **The template showcase is kept** (correction to Parts B/D: `company_templates` is not dead — production has 11 templates and 7 categories). It is `site_templates` + `site_template_categories` of the marketing site; the seven starting categories are created with the site, not on every empty read.
- **FAQs once:** the admin FAQ screen (`/faqs`, `/faq-categories`, v1 tables `faqs`/`faq_categories`, empty on production) and the builder's FAQ section share the marketing site's FAQs, each answering in its own v1 shape.
- **Bug 3 fixed:** colour palettes can be edited and deleted.
- **Public site:** any site resolves by host — a slug under `PUBLIC_SITE_ROOT_DOMAINS` or its custom domain — so vendors' sites can be served by the public site app too. The bundle and the builder payloads are cached until the site next changes.
- **Translations:** v1's rules kept — only empty slots are filled, in every active language at once; a removed key keeps its translations; writes batched. Slots are per site. Brand names are no longer offered for translation (client and sponsor names, social link labels, the company name, the site name). Correction to Part D: the public site's fixed wording ("ui-chrome", 229 keys) stays as translation keys, not `lang/*.json`, because the Translations screen edits it.
- **A vendor's public forms** (sign-up, sign-in, newsletter, contact) work on the site's address as well as the company-name slug; "Continue with Google" may return to a site's custom domain.
- **The public vendor website** sends the vendor's public profile only (v1 sent every vendor column, bank details included).
- **Dropped:** `vendor_website_publish_snapshots` (never read; publishing still bumps the version), runtime CREATE/ALTER TABLE in request handlers, base64-image migration on read (pasted images are still stored on save), `company_templates.use_count`.
- **For the legacy import (Phase 9):** site, section and record ids change, so translation slots (`record_id`) and contact-page links must be re-pointed through `legacy_id_map`; v1's hero copy per page already lives in the hero's `design_json`.

| Date | Phase | Result |
|---|---|---|
| 2026-10-18 | 9 — Import | Ready. `php artisan legacy:import [--dry-run] [--report=file] [--skip-locations]`: ten steps (platform, catalog, templates, vendors, identity, clients, billing, events, messaging, sites) copy the Node database (read only, SSL for production) in one transaction; a dry run does everything and rolls back. Dry run against production: every table accounted for, ~390,000 rows, 5 minutes. Running it twice gives the same result (tested). Pint clean, Larastan level 6 clean, 257 Pest tests pass (2,501 assertions). |

Decisions in Phase 9:
- **Ids kept** wherever something outside the database points at them: events (QR codes), website clients (the app), vendors, admin users, plans, templates, locations. Merged tables get new ids by position (the same on every run), recorded in `legacy_id_map`: vendor clients follow the last website client; vendor staff follow the last vendor (the owner login takes the vendor's own id); guest options, broadcasts and every site table are numbered afresh.
- **Mail and chat** pointed at vendor clients in v1; they are re-pointed to the merged clients.
- **Duplicates are retired, not dropped:** a live login whose e-mail is already another live login's (vendor users are unique across vendors), or a client whose e-mail or mobile repeats within a vendor, is imported as deleted and named in the report.
- **Secrets encrypted on the way in:** setting secrets, the vendor account number, Firebase keys, e-mail provider passwords, 2FA secrets. Passwords and secrets are removed from the imported activity log (v1 logged a changed password in plain text).
- **Pasted pictures** (data: text in vendor-client and staff photos) are stored as files on the real run.
- **Permissions by slug:** grants are matched to the new catalogues; renamed admin slugs are carried over (admin_settings.* → settings.*, locations.manage → locations create/edit/delete...); grants that cannot exist for that kind of role are reported (v1 gave vendor 1's role every admin permission).
- **Translations** follow their rows to the new ids; brand-name translations are left out; the key registry is rebuilt by a scan.
- **Not imported:** sessions and refresh tokens (everyone signs in again), the empty `payments`, `email_campaigns`, `email_queue`, `email_sent_logs`, `localities`, `pincodes`, `vendor_website_publish_snapshots`, the Sequelize meta tables, and v1 `modules` (the permission catalogue is seeded).

Findings of the production dry run that need a decision before the real run:
- **Staff logins that share an owner's e-mail:** staff 1–2 use jamal@jamal.com (vendor 1's owner login) and staff 3–8 use ram@gmail.com (vendor 10's owner login). One person, one login now, so these staff rows would be retired; the owners keep signing in. Change their e-mails in v1 first if they must stay staff.
- **Vendor clients with junk or repeated mobiles** (1, 1234567, 9876543210, 9884699435): 7 would be retired.
- **Vendor clients 1 and 2** have the tier "gold", which matches no tier; they would have none.
- **6 contact-page social links** point at social links v1 had already deleted; left out (the contact page shows all social links, as it did).

Answers to the dry run's findings (2026-10-18):
- **Staff logins sharing an owner's e-mail** are leftover test data (the old system was not meant to allow it): the owner keeps the login, the staff copies are retired.
- **Clients sharing a mobile number are allowed** (v1 vendor clients could). The database no longer refuses it; clients a vendor adds or edits, and the vendor-client portal's own profile, may repeat a number. Sign-up, a client's own profile in the client portal / app and admin-made clients still refuse a number already in use (v1 website-client rule). Phone sign-in with a shared number picks the account that can sign in, a self-made one before a vendor-added one, then the oldest.
- **Tier labels** that are part of exactly one tier's name count as that tier ("gold" → "Sample Gold").

| Date | Phase | Result |
|---|---|---|
| 2026-10-18 | 10 — Cutover | Prepared, not deployed. `Dockerfile` (one image, roles web / worker / scheduler, nginx + php-fpm + ffmpeg), `render.yaml` (API, worker, scheduler, chat relay, Redis; secrets asked by Render), `docs/DEPLOY.md` (before the day, the switch, rollback). The API now trusts the load balancer's forwarded headers, and both database connections can use SSL without a CA file (Aiven). The image has not been built here (no Docker on this machine). |

Open for the switch:
- The Laravel folder is not a git repository yet; Render deploys from GitHub.
- **The mobile app has the API address built in** (`API_BASE_URL`, default the Node service's onrender.com address). Either deploy the new API into the existing Render service so the address stays (no app update), or publish an app update with the new address.
- A new empty database on Aiven, the secrets (APP_KEY, EVENT_QR_KEY from the Node secret, CHAT_SOCKET_SECRET), and a short announced downtime for the real import.

---

# PART A — BACKEND ARCHITECTURE

## A1. Style and principles

**Modular monolith, layered inside each module.** One Laravel app, one deploy, one database — split into
10 business modules with hard boundaries. No microservices (traffic and team size do not need them).

Principles every file follows:
1. **Tenant safety by construction** — tenancy is enforced by global scopes and policies, never by
   remembering a `where` in each query.
2. **Thin HTTP, fat Actions** — a controller validates (FormRequest), calls one Action, returns one Resource.
   All business rules live in Actions. No SQL in controllers.
3. **One use case = one Action class** (`CreateEvent`, `ApproveRequest`, `PublishSite`) — easy to find,
   test, queue, and put behind approval.
4. **Modules depend one way** and talk only through Actions, domain Events, or Contracts.
5. **External services behind interfaces** (SMS, WhatsApp, push, storage, translation) so they can be
   swapped or faked in tests.
6. **The v1 API shape is produced by Resources**, so the database can be clean while responses stay
   identical. A future v2 adds new Resources/controllers, not new business logic.
7. **Everything is tested at the HTTP boundary** (Pest), plus architecture tests that fail the build when
   a boundary is crossed.

## A2. System diagram (runtime)

```
 Vercel: Admin · Vendor · Staff · Website Builder · Client Portal · Public Site        Flutter app
                     │  HTTPS, httpOnly cookies                                          │ Bearer token
                     ▼                                                                   ▼
 ┌──────────────────────────── Render ───────────────────────────────────────────────────────────┐
 │  web       Laravel API  (nginx + php-fpm)  /api/v1/*                                           │
 │  worker    php artisan queue:work   → push, OTP SMS/WhatsApp, auto-translate, broadcasts, media  │
 │  cron      php artisan schedule:work → due broadcasts & event notifications (every minute),    │
 │                                        token/OTP cleanup, activity-log pruning                 │
 │  socket    chat-socket (Node socket.io) ⇄ internal HTTP (shared secret) ⇄ Laravel              │
 │  redis     queue · cache · locks (withoutOverlapping / onOneServer)                            │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
          │                         │                           │
   Aiven MySQL 8             S3 + CloudFront             FCM · MSG91 · Google/Facebook OAuth · MyMemory
   (utf8mb4_unicode_ci)      (all media)
```

## A3. Tenancy model — two layers, no NULL owners

```
COMPANY  (platform owner, 1 row)                         PLATFORM layer — column company_id NOT NULL
 ├── admin users · roles · approvals · activity · settings
 └── CATALOGUE  event categories · event menus · plans · plan badges · event templates · frames ·
                decorations · fonts · notification templates · guest options · languages · currencies

VENDOR  (business account; #1 = HOUSE VENDOR = us)       VENDOR layer — column vendor_id NOT NULL
 ├── vendor_users  (owner + staff) · vendor roles · vendor departments
 ├── clients ──► events ──► participants · gallery · agenda · family · wishes · broadcasts · splash
 │          └─► subscriptions · invoices · transactions · payment methods
 ├── sites  (vendor 1: the MARKETING site + its own vendor site; other vendors: their vendor site)
 └── newsletters · in-app mail · chat
```

Rules:
- Platform tables carry `company_id`; vendor tables carry `vendor_id`. Never both, never NULL.
- Only **aggregate roots** carry `vendor_id` (vendor_users, clients, events, sites, conversations, mails,
  newsletters). Children carry only their parent id (`event_id`, `client_id`, `site_id`); tenancy is derived.
- The house vendor is config, not a magic number: `config/tenancy.php` → `house_vendor_id = env('HOUSE_VENDOR_ID', 1)`,
  read through `Vendor::house()`. A seeder guarantees the row exists.
- The catalogue is platform-wide: clients of every vendor buy platform `plans`
  (per-vendor pricing later = add `plans.vendor_id`, nothing else changes).

## A4. Portals, guards, tenant context

| Portal | Frontend | Route prefix (v1) | Guard → model | Cookie kept | Tenant set by `ResolveTenant` |
|---|---|---|---|---|---|
| Admin | Admin_Frontend | `/api/v1/{module}` | `admin` → `User` | `access_token` | company = user's; acting vendor = house vendor |
| Vendor | Vendor_Frontend, Website_Builder | `/api/v1/vendors/*` | `vendor` → `VendorUser` (owner) | `vendor_access_token` | vendor = user's vendor |
| Staff | event_invite_staff | `/api/v1/vendors/staff/portal/*` | `vendor` → `VendorUser` (staff) | `staff_access_token` | vendor = user's vendor |
| Client | event_client_single, Flutter | `/api/v1/client/*` | `client` → `Client` | `website_client_access_token`, legacy `client_access_token`, Bearer | vendor = client's vendor |
| Public site | Public_Site | `/api/v1/public/*` | none | — | site + vendor from `Host` |

`config/auth.php`:

```php
'guards' => [
    'admin'  => ['driver' => 'sanctum', 'provider' => 'users'],
    'vendor' => ['driver' => 'sanctum', 'provider' => 'vendor_users'],
    'client' => ['driver' => 'sanctum', 'provider' => 'clients'],
],
'providers' => [
    'users'        => ['driver' => 'eloquent', 'model' => App\Modules\Identity\Models\User::class],
    'vendor_users' => ['driver' => 'eloquent', 'model' => App\Modules\Vendors\Models\VendorUser::class],
    'clients'      => ['driver' => 'eloquent', 'model' => App\Modules\Clients\Models\Client::class],
],
```

Sanctum rejects a token whose owner is not the guard's model, so a client token can never open an admin route.
Access token 15 min + refresh token 7 days (ability `refresh`), both revocable rows in `personal_access_tokens`
— this replaces 3 token tables and makes vendor/staff logout real.
Permissions: spatie/laravel-permission with **teams** — admin roles use `team_id = company_id`, vendor
roles use `team_id = vendor_id`. Vendor owner bypasses checks via `Gate::before`.
Event organizer access becomes a **policy rule** (`owner OR organizer`), replacing today's identity-swapping middleware.

## A5. Request lifecycle

```
Request
  → global      CORS (strict list; /public wildcard without credentials), SnakeCaseInput (camelCase → snake_case)
  → portal      CookieToBearer → auth:<guard> → ResolveTenant (CurrentCompany, CurrentVendor, spatie team id)
  → route       implicit model binding (global scopes already applied → other tenants' rows are 404)
  → FormRequest rules() + authorize() via Policy → toData() returns a typed DTO
  → Controller  one Action call
  → Action      business rules · DB::transaction · dispatch domain Event
  → Model       Eloquent + global scopes (BelongsToCompany / BelongsToVendor) + casts + enums
  → Resource    v1 JSON keys
  → ApiResponse {success, message, data, pagination?, timestamp}
After commit: Event → Listener → queued Job (push, OTP, translate, notify)
Errors: one exception map in bootstrap/app.php → same v1 error envelope
```

## A6. Project structure

```
Event_Management_Laravel_Backend/
├── app/
│   ├── Core/                                   shared kernel — no business rules
│   │   ├── Http/
│   │   │   ├── ApiResponse.php                 v1 envelope: success / created / error / paginated / pendingApproval
│   │   │   ├── Middleware/                     SnakeCaseInput · CookieToBearer · ResolveTenant · ResolveSiteFromHost · PublicCors
│   │   │   └── Resources/V1Resource.php        base JsonResource (dates, nulls, ids as v1 expects)
│   │   ├── Tenancy/                            CurrentCompany · CurrentVendor · BelongsToCompany · BelongsToVendor · Tenancy::bypass()
│   │   ├── Approvals/                          ApprovableAction · ApprovalGate · ApprovalRequest model
│   │   ├── Contracts/                          SmsGateway · WhatsAppGateway · PushGateway · ObjectStorage · MachineTranslator
│   │   ├── Infrastructure/                     Msg91Sms · Msg91WhatsApp · FcmPush · S3Storage · MyMemoryTranslator
│   │   ├── Queries/ListQuery.php               v1 list params: search · is_active · page · limit · sort_by · sort_order
│   │   ├── Data/                               base DTO
│   │   ├── Exceptions/                         ApiException (status + message) · PlanRequired · PlanLimitReached · TenantNotResolved
│   │   └── Support/                            ModuleServiceProvider · Slug · Phone · Money · EventQr (EVQ1 codec)
│   └── Modules/
│       ├── Platform/   Identity/   Catalog/   Templates/   Vendors/
│       ├── Clients/    Billing/    Events/    Messaging/   Sites/
├── bootstrap/app.php                           routing · middleware groups · exception map
├── config/tenancy.php  config/approvals.php  config/settings.php (which keys are secret)
├── database/migrations/                        only Laravel migrations (modules load their own too)
├── lang/en.json  lang/ta.json  lang/{locale}/site.json     UI text (was translation_keys + ui-chrome)
├── routes/console.php                          schedule
├── tests/Feature/{Module}/  tests/Contract/  tests/Arch/
└── chat-socket/                                Node relay (package.json, server.js)
```

**Inside one module — full example, `app/Modules/Events/`:**

```
Events/
├── EventsServiceProvider.php          registers routes, migrations, policies, listeners, morph map
├── routes/
│   └── client.php                     /api/v1/client/events…, /participants…, /rsvps…, /agenda…, /wishes…
├── Http/
│   ├── Controllers/Client/            EventController · ParticipantController · RsvpController · AgendaController
│   │                                  GalleryController · FamilyController · WishController · SplashScreenController
│   ├── Requests/                      StoreEventRequest · UpdateEventRequest · StoreParticipantRequest …
│   └── Resources/V1/                  EventResource · EventListResource · ParticipantResource · WishResource …
├── Actions/
│   ├── CreateEvent.php  UpdateEvent.php  DeleteEvent.php  IssueEventQr.php
│   ├── AddParticipant.php  RespondToRsvp.php  JoinEventByQr.php
│   └── PostWish.php  BlockWishAuthor.php …
├── Data/                              CreateEventData · ParticipantData · RsvpAnswerData
├── Queries/                           EventListQuery · ParticipantListQuery · RsvpStatsQuery
├── Models/                            Event · EventSetting · Guest · GuestGroup · Participant · AgendaItem
│                                      FamilyMember · GalleryCategory · GalleryItem · Wish · WishLike · SplashScreen
├── Enums/                             EventStatus · EventPrivacy · RsvpResponse · BroadcastChannel
├── Policies/                          EventPolicy · ParticipantPolicy · WishPolicy
├── Events/                            EventCreated · ParticipantJoined · RsvpChanged
├── Listeners/                         SendWelcomeInvitation · LogRsvpChange
├── Jobs/                              GenerateVideoPoster · ExportGuestsCsv
└── Database/
    ├── Migrations/                    2026_..._create_events_table.php …
    ├── Factories/                     EventFactory · ParticipantFactory
    └── Seeders/
```

**Module catalogue:**

| Module | Owns | Depends on | Exposes to others |
|---|---|---|---|
| Platform | companies, settings, plugins, languages, currencies, locations, media | — | `Settings`, `ObjectStorage`, `CurrentCompany` |
| Identity | admin users, departments, roles, approvals, activity, admin auth | Platform | `ApprovalGate`, activity logging |
| Catalog | event categories, event menus, plans, plan features, badges, notification catalogue, guest options | Platform | `PlanEntitlements` |
| Templates | event templates, template categories, frames, decorations, fonts | Catalog | `TemplateArtwork` |
| Vendors | vendors, vendor users, vendor roles/departments, newsletters | Identity | `Vendor::house()`, `CurrentVendor` |
| Clients | clients, client auth (password · OTP · social · 2FA), devices, preferences | Vendors, Catalog | `Client`, `ClientAuthenticator` |
| Billing | subscriptions, invoices, transactions, payment methods, sales enquiries | Clients, Catalog | `ActivePlan` |
| Events | events, QR, guests, participants, RSVP, agenda, family, gallery, wishes, splash | Clients, Billing, Templates | domain events `EventCreated`, `ParticipantJoined`, `RsvpChanged` |
| Messaging | broadcasts, notification triggers, notifications feed, in-app mail, chat | Events, Clients, Vendors | `NotifyParticipants`, `SendBroadcast` |
| Sites | sites, sections, pages, menus, blocks, public bundle, content translation | Vendors, Catalog, Templates | `SiteBundle` |

## A7. Core building blocks (Laravel 12 code shape)

**Module service provider** — each module mounts its own routes under the v1 prefix of its portal:

```php
abstract class ModuleServiceProvider extends ServiceProvider
{
    /** portal => [url prefix, middleware group] — matches today's v1 URLs exactly */
    private const PORTALS = [
        'admin'  => ['api/v1',                         'portal.admin'],
        'vendor' => ['api/v1/vendors',                 'portal.vendor'],
        'staff'  => ['api/v1/vendors/staff/portal',    'portal.staff'],
        'client' => ['api/v1/client',                  'portal.client'],
        'public' => ['api/v1/public',                  'portal.public'],
    ];

    public function boot(): void
    {
        $this->loadMigrationsFrom($this->modulePath('Database/Migrations'));
        foreach (self::PORTALS as $portal => [$prefix, $group]) {
            $file = $this->modulePath("routes/{$portal}.php");
            if (is_file($file)) {
                Route::prefix($prefix)->middleware(['api', $group])->group($file);
            }
        }
    }
}
```

**Middleware groups and exception map** — `bootstrap/app.php`:

```php
->withMiddleware(function (Middleware $m) {
    $m->api(prepend: [SnakeCaseInput::class]);
    $m->group('portal.admin',  [CookieToBearer::class.':access_token',        'auth:admin',  ResolveTenant::class]);
    $m->group('portal.vendor', [CookieToBearer::class.':vendor_access_token', 'auth:vendor', ResolveTenant::class]);
    $m->group('portal.staff',  [CookieToBearer::class.':staff_access_token',  'auth:vendor', ResolveTenant::class, EnsureStaff::class]);
    $m->group('portal.client', [CookieToBearer::class.':website_client_access_token,client_access_token', 'auth:client', ResolveTenant::class]);
    $m->group('portal.public', [PublicCors::class, ResolveSiteFromHost::class]);
})
->withExceptions(function (Exceptions $e) {
    $e->render(fn (ApiException $x)             => ApiResponse::error($x->getMessage(), $x->status()));
    $e->render(fn (ValidationException $x)      => ApiResponse::error($x->validator->errors()->first(), 400, $x->errors()));
    $e->render(fn (AuthenticationException $x)  => ApiResponse::error('Authentication required. Please login.', 401));
    $e->render(fn (AuthorizationException $x)   => ApiResponse::error('Access denied. Insufficient permissions.', 403));
    $e->render(fn (NotFoundHttpException $x)    => ApiResponse::error('Resource not found', 404));
})
```

Public routes that are not logged-in routes (login, OTP, signup) live in each module's `routes/public.php`
or in a guest sub-group of their portal, with named rate limiters `auth` (30/15min), `code` (10/15min),
`refresh` (60/15min) — same numbers as today.

**Cookie → bearer** (keeps every frontend's cookie unchanged):

```php
final class CookieToBearer
{
    public function handle(Request $request, Closure $next, string ...$cookies): Response
    {
        if (! $request->bearerToken()) {
            foreach ($cookies as $name) {
                if ($token = $request->cookie($name)) {
                    $request->headers->set('Authorization', 'Bearer '.$token);
                    break;
                }
            }
        }
        return $next($request);
    }
}
```

**Tenancy** — request-scoped context + global scope that refuses to run unscoped:

```php
final class CurrentVendor              // registered with $app->scoped(): fresh per request
{
    private ?Vendor $vendor = null;
    public function set(Vendor $v): void { $this->vendor = $v; }
    public function has(): bool         { return $this->vendor !== null; }
    public function id(): int           { return $this->vendor?->id ?? throw new TenantNotResolved(); }
}

trait BelongsToVendor
{
    public static function bootBelongsToVendor(): void
    {
        static::addGlobalScope('vendor', function (Builder $q) {
            if (Tenancy::isBypassed()) return;                 // import command, platform reports
            $q->where($q->qualifyColumn('vendor_id'), app(CurrentVendor::class)->id()); // throws if unresolved
        });
        static::creating(fn (Model $m) => $m->vendor_id ??= app(CurrentVendor::class)->id());
    }

    public function vendor(): BelongsTo { return $this->belongsTo(Vendor::class); }
}

final class ResolveTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        $actor = $request->user();
        $vendor = match (true) {
            $actor instanceof User       => Vendor::house(),     // admin works on the house vendor
            $actor instanceof VendorUser => $actor->vendor,
            $actor instanceof Client     => $actor->vendor,
        };
        app(CurrentCompany::class)->set($vendor->company);
        app(CurrentVendor::class)->set($vendor);
        setPermissionsTeamId($actor instanceof User ? $vendor->company_id : $vendor->id);
        return $next($request);
    }
}
```

Child models (participants, gallery items, wishes…) have no `vendor_id`; they are reached through their
event, whose scope already filters by vendor, and their Policy checks ownership of that event.

**List queries** — reproduce today's `?search=&is_active=&page=&limit=&sort_by=&sort_order=`:

```php
abstract class ListQuery
{
    protected array $searchable = [];
    protected array $sortable = ['created_at'];

    abstract protected function base(Request $r): Builder;
    protected function filters(Builder $q, Request $r): void {}

    public function paginate(Request $r): LengthAwarePaginator
    {
        $q = $this->base($r);
        if ($term = trim((string) $r->query('search'))) {
            $q->where(fn ($w) => array_map(fn ($c) => $w->orWhere($c, 'like', "%{$term}%"), $this->searchable));
        }
        $this->filters($q, $r);
        $sort  = in_array($r->query('sort_by'), $this->sortable, true) ? $r->query('sort_by') : $this->sortable[0];
        $dir   = strtolower((string) $r->query('sort_order')) === 'asc' ? 'asc' : 'desc';
        $limit = min(max((int) $r->query('limit', 10), 1), 100);
        return $q->orderBy($sort, $dir)->paginate($limit);
    }
}
```

**Approvals** — every approvable operation is an Action class, so approval stores *which class* and
*which payload*; approving simply runs it. No string service map (fixes bug 6), company-scoped by the model scope:

```php
interface ApprovableAction { public function permission(): string; }   // e.g. 'event_templates.create'

final class ApprovalGate
{
    public function run(User $actor, ApprovableAction $action, Data $payload, Closure $execute): mixed
    {
        if (! $this->requiresApproval($actor, $action->permission())) {
            return $execute();
        }
        return ApprovalRequest::create([
            'requester_id' => $actor->id,
            'action'       => $action::class,
            'permission'   => $action->permission(),
            'payload'      => $payload->toArray(),
            'status'       => ApprovalStatus::Pending,
        ]);                                     // controller answers 202 via ApiResponse::pendingApproval()
    }
}
// ApproveRequest action: app($request->action)->handle(...$request->payload) inside a transaction.
```

## A8. One feature end to end — "client creates an event"

`Modules/Events/routes/client.php`

```php
Route::get('events',          [EventController::class, 'index']);
Route::post('events',         [EventController::class, 'store']);
Route::get('events/{event}',  [EventController::class, 'show'])->can('view', 'event');
```

`Http/Requests/StoreEventRequest.php`

```php
final class StoreEventRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'event_category_id' => ['required', 'integer', 'exists:event_categories,id'],
            'name'              => ['required', 'string', 'max:200'],
            'start_date'        => ['required', 'date_format:Y-m-d'],
            'end_date'          => ['required', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'menu_ids'          => ['array'], 'menu_ids.*' => ['integer'],
            'primary_color'     => ['nullable', 'regex:/^#([0-9a-f]{6}|[0-9a-f]{8})$/i'],
            // … every writable field from today's WRITABLE_FIELDS, one rule each
        ];
    }

    public function toData(): CreateEventData { return CreateEventData::from($this->validated()); }
}
```

`Http/Controllers/Client/EventController.php`

```php
final class EventController
{
    public function store(StoreEventRequest $request, CreateEvent $createEvent): JsonResponse
    {
        $event = $createEvent->handle($request->user(), $request->toData());
        return ApiResponse::created(new EventResource($event), 'Event created');
    }
}
```

`Actions/CreateEvent.php` — the "plan is the gatekeeper" rule lives here, once:

```php
final class CreateEvent
{
    public function __construct(private PlanEntitlements $plans, private EventQr $qr) {}

    public function handle(Client $client, CreateEventData $data): Event
    {
        $plan = $this->plans->activePlanFor($client);            // throws PlanRequired (400)
        $this->plans->assertLimit($client, $plan, 'max_events');  // throws PlanLimitReached (400)
        $this->plans->assertGrants($plan, $data->categoryId, $data->menuIds);

        return DB::transaction(function () use ($client, $plan, $data) {
            $event = $client->events()->create($data->attributes() + ['plan_id' => $plan->id]);
            $event->menus()->sync($this->plans->menuSync($plan, $data));   // defaults added, order kept
            $event->update(['qr_token' => $this->qr->issue($event)]);      // EVQ1 format, same key
            EventCreated::dispatch($event);
            return $event->load(['category', 'plan', 'menus']);
        });
    }
}
```

`Models/Event.php`

```php
final class Event extends Model
{
    use BelongsToVendor, SoftDeletes, HasFactory;

    protected $fillable = ['client_id', 'organizer_client_id', 'event_category_id', 'plan_id', 'event_template_id',
                           'name', 'start_date', 'end_date', 'status', 'privacy' /* … */];
    protected $casts = ['start_date' => 'date:Y-m-d', 'end_date' => 'date:Y-m-d',
                        'status' => EventStatus::class, 'privacy' => EventPrivacy::class];

    public function client(): BelongsTo     { return $this->belongsTo(Client::class); }
    public function menus(): BelongsToMany  { return $this->belongsToMany(EventMenu::class)->withPivot('sort_order', 'is_enabled'); }
    public function participants(): HasMany { return $this->hasMany(Participant::class); }
    public function settings(): HasOne      { return $this->hasOne(EventSetting::class); }

    public function derivedStatus(): string { /* draft / cancelled / past / live / upcoming — today's deriveStatus() */ }
}
```

`Policies/EventPolicy.php` — organizer access is a rule, not an identity swap:

```php
final class EventPolicy
{
    public function view(Client $c, Event $e): bool   { return $this->manage($c, $e) || $e->participants()->where('client_id', $c->id)->exists(); }
    public function update(Client $c, Event $e): bool { return $this->manage($c, $e); }
    public function delete(Client $c, Event $e): bool { return $e->client_id === $c->id; }   // organizer may not delete
    private function manage(Client $c, Event $e): bool { return in_array($c->id, [$e->client_id, $e->organizer_client_id], true); }
}
```

`Http/Resources/V1/EventResource.php` — clean schema in, v1 keys out:

```php
final class EventResource extends V1Resource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                => $this->id,
            'website_client_id' => $this->client_id,              // v1 name kept
            'event_category_id' => $this->event_category_id,
            'name'              => $this->name,
            'menu_ids'          => $this->menus->pluck('id'),     // pivot → v1 array
            'menu_order'        => $this->menus->sortBy('pivot.sort_order')->pluck('id'),
            'theme_id'          => $this->template?->code,        // FK → v1 slug
            'derived_status'    => $this->derivedStatus(),
            'plan'              => PlanBriefResource::make($this->whenLoaded('plan')),
            'category'          => CategoryBriefResource::make($this->whenLoaded('category')),
            // … remaining v1 keys
        ];
    }
}
```

`tests/Feature/Events/CreateEventTest.php`

```php
it('creates an event and refuses one over the plan limit', function () {
    $client = Client::factory()->onPlan(maxEvents: 1)->create();

    asClient($client)->postJson('/api/v1/client/events', eventPayload())
        ->assertCreated()->assertJsonPath('data.derived_status', 'upcoming');

    asClient($client)->postJson('/api/v1/client/events', eventPayload())
        ->assertStatus(400)->assertJsonPath('success', false);
});

it('never shows another vendor\'s event', function () {
    $event = Event::factory()->forVendor(Vendor::factory())->create();
    asClient(Client::factory()->create())->getJson("/api/v1/client/events/{$event->id}")->assertNotFound();
});
```

## A9. Cross-cutting decisions

| Concern | Choice | Why |
|---|---|---|
| Auth | Sanctum, 3 guards, cookie→bearer | revocable tokens everywhere, cookies unchanged |
| RBAC | spatie/laravel-permission + teams | one roles system for admin and vendor portals |
| Validation | FormRequest + typed DTO | replaces 20+ hand-written whitelists that silently dropped fields |
| Activity log | spatie/laravel-activitylog, `logOnly($fillable)` | never logs `$hidden` (fixes bug 7) |
| Content translation | spatie/laravel-translatable on content fields only | brand names, URLs, codes are never translatable |
| UI translation | `lang/*.json` behind the same `/translations/{lang}` endpoint | static text is code, not data |
| Settings | `settings` table, unique (company_id, key), `encrypted` cast for keys listed in `config/settings.php` | secrets no longer plaintext |
| Files | Storage `s3` disk + CloudFront, URL columns kept | frontends expect URL strings |
| Jobs / schedule | Redis queue, `schedule:work`, `withoutOverlapping()->onOneServer()` | replaces in-process node-cron |
| Push / OTP | FCM channel, MSG91 SMS + WhatsApp channels behind Contracts | swappable, fakeable in tests |
| Social / 2FA | laravel/socialite, pragmarx/google2fa | maintained libraries instead of custom code |
| Caching | `Cache::remember` for plan grants and site bundles, busted by model observers | prod DB is ~374 ms per query |
| N+1 protection | `Model::preventLazyLoading(! app()->isProduction())` | catches slow queries in development |
| QR codes | `Core/Support/EventQr` (AES-256-GCM, `EVENT_QR_KEY` derived once from today's secret) | printed invitations keep working |
| Passwords | bcrypt, `verify => false`, rehash on login | existing bcryptjs hashes keep working |

Deliberately **not** used: repository layer (Eloquent + Query classes are enough), spatie/medialibrary
(URLs stay on rows), spatie/query-builder (its `filter[]` format differs from v1), nwidart/laravel-modules
(plain PSR-4 modules + one provider each is less magic), microservices.

## A10. Conventions

- **Naming:** Actions are verbs (`CreateEvent`), Queries end in `Query`, DTOs end in `Data`, Resources live in `Resources/V1`.
- **Database:** unsigned `bigIncrements`; `foreignId()->constrained()`; one collation `utf8mb4_unicode_ci`;
  snake_case timestamps; `status` enums instead of tri-state `is_active`; `approval_status` separate;
  soft deletes only where restore is a feature; JSON columns only for true documents (block config, design),
  never for relations.
- **Unique + soft delete:** soft-deletable tables get a stored generated column
  `alive = IF(deleted_at IS NULL, 1, NULL)` and unique indexes like `(vendor_id, email, alive)`; deleted
  rows hold NULL and never block a new row, so today's "rename the email/slug on delete" hack in
  `base.service.remove` disappears.
- **Money:** `decimal(12,2)` + currency code; **dates:** `date` columns compared as strings in the event timezone.
- **Config over constants:** house vendor, rate limits, upload limits, plan cache TTL in `config/*.php`.

## A11. Quality gates (CI on every push)

- `pint --test` (style), Larastan level 6 (static types), Pest feature + contract tests.
- Pest **architecture tests**:

```php
arch('controllers never touch the database directly')
    ->expect('App\Modules')->classes()->toHaveSuffix('Controller')
    ->not->toUse(['Illuminate\Support\Facades\DB']);

arch('events module does not reach into sites')
    ->expect('App\Modules\Events')->not->toUse('App\Modules\Sites');

arch('vendor-layer models are tenant scoped')
    ->expect(['App\Modules\Clients\Models\Client', 'App\Modules\Events\Models\Event', 'App\Modules\Sites\Models\Site'])
    ->toUseTrait(App\Core\Tenancy\BelongsToVendor::class);
```

- Contract tests replay recorded Node responses (`tests/Contract/fixtures/*.json`) and assert identical JSON keys and status codes.

---

# PART B — WHY: FINDINGS IN THE CURRENT BACKEND

### B1. Size today

| Item | Count |
|---|---|
| Runtime JS | ~67,700 lines (services 40.9k, controllers 11.3k, models 8.5k, routes 3.1k) |
| API endpoints | 925 |
| Tables | 169 (prod 170 — both `SequelizeMeta` and `sequelizemeta`) |
| Login tables | 5 — users, vendors, vendor_staff, vendor_clients, website_clients |
| Website-builder tables | 59 (35 company + 24 vendor) |
| Migration mechanisms | 4 Sequelize + 10 SQL + ~75 `tools/apply-*.js` + `initial_setup.sql` |
| Collations | 129 tables unicode_ci, 40 tables 0900_ai_ci, 1 utf8mb3 — cross-table joins fail |
| Production rows | 12 vendors, 8 staff, 48 vendor clients, 14 website clients, 9 events, 61 templates |

### B2. Dead → drop
`localities`, `pincodes`, `vendor_website_pricing_*` (3), `vendor_website_publish_snapshots`, `vendor_newsletters`,
`payments`, `email_campaigns`, `email_queue`, `email_sent_logs`, `plan_badge_plans`, `menus`, `plan_types`,
`refresh_tokens`, `client_refresh_tokens`, `client_sessions`, both Sequelize meta tables; `company_website_contact_social_links`
is referenced but does not exist. Unused columns: `email_configs.imap_*`, 4 currency format columns,
`email_templates.is_predefined`, `plan_types.validity`, `users.marital_status`, `vendors.reg_no/gst_no/landline`,
`guests.migrated_from_guest_id`, `event_message_campaigns.window_start/end`, `company_templates.use_count`,
`chat_conversations.context_id`, `chat_messages.edited_at`, `chat_participants.is_muted`.

### B3. Duplicated → merged
clients (2 tables) · vendor logins (vendors + vendor_staff) · website builder (59 tables) · plans (4 sources) ·
FAQ (2) · template showcase vs real templates · guest person columns on guests + participants ·
broadcasts (2 table pairs) · notification feeds (2) · sessions (3) · translations (3 systems) ·
guest dropdowns (2) · tutorial taxonomies (4) · site logos (clients + sponsors).

### B4. Misused structure
1. Brand names translated ("HDFC Bank", "Amazon", "Facebook", company and site name); 229 UI strings stored as content.
2. Translations keyed by row id; bulk replace re-inserts rows and orphans them.
3. Admin UI blocks saved in the vendor table (`vendor_id = company_id`, `website_id = 1`).
4. Vendor builder pricing/features query company tables on missing columns.
5. Relations stored as JSON: `events.menu_ids/menu_order/disabled_app_menu_ids/theme_id`, `event_templates.decoration_ids/plan_ids/available_for`, `website_clients.favourite_*`.
6. Two plan pointers per client; `is_active` = 0/1/2 (2 = pending approval).
7. Location names shifted (`cities` = localities, `cities.city_id` → districts).
8. `settings.key` globally unique despite `company_id`; secrets plaintext.
9. Tenant defaults to company 1 in ~30 places; builder tenant taken from a header.
10. Runtime `CREATE TABLE` / `ALTER TABLE` in request handlers; 2,263-line controller with 115 raw queries.
11. Child rows repeat `website_client_id` + `company_id` already known from their event.
12. Company creation copies modules/permissions per company; 19 dead 410 routes; `scratch/` scripts; `err*.log` committed.

### B5. Live bugs (never ported)
1 company admin password hashed twice · 2 vendor subscription endpoints import a missing model ·
3 colour palette edit/delete always 404 · 4 `/payments` crashes · 5 vendor activity never saved ·
6 approvals for 8 modules throw "No service found" · 7 plaintext password in `activity_logs` ·
8 admin UI blocks overwrite vendor #1's blocks.

### B6. Security gaps (closed by Part A)
Builder writes without permission checks and with header-chosen tenant · approvals not company-scoped ·
FAQ unscoped · missing-key routes unguarded · reset OTP plaintext and unthrottled · vendor/staff tokens
unrevocable · one signing secret for five token types · different password rules per portal.

---

# PART C — TARGET SCHEMA (≈95 tables, from 169)

| Module | Tables |
|---|---|
| Platform | companies, settings, plugins, languages, currencies, countries, states, districts, cities |
| Identity | users, departments, roles, permissions, model_has_roles, model_has_permissions, role_has_permissions, permission_groups, approval_requests, activity_log, personal_access_tokens, password_reset_tokens |
| Catalog | event_categories, event_menus, plans, plan_menu, plan_features, plan_badges, notification_categories, notification_templates, guest_options |
| Templates | template_categories, event_templates, event_template_decoration, event_template_plan, frame_styles, decorations, template_fonts |
| Vendors | vendors, vendor_users, vendor_departments, vendor_newsletters, vendor_newsletter_recipients |
| Clients | clients, client_devices, client_two_factor, client_backup_codes, client_preferences, client_notification_prefs, client_favourites, otp_codes |
| Billing | client_subscriptions, subscription_events, invoices, invoice_items, transactions, payment_methods, sales_enquiries |
| Events | events, event_menu, event_settings, guests, guest_groups, participants, participant_response_logs, guest_notes, guest_tags, guest_reminders, agenda_items, family_members, gallery_categories, gallery_items, wishes, wish_likes, wish_blocks, splash_screens |
| Messaging | event_broadcasts, event_broadcast_recipients, notifications, conversations, conversation_participants, messages, mails, mail_recipients, mail_folders |
| Sites | sites, site_settings, site_pages, site_menu_items, site_blocks, site_sliders, site_slides, site_gallery_categories, site_gallery_items, site_testimonials, site_logos, site_social_links, site_contact_categories, site_contact_messages, site_faq_categories, site_faqs, site_features, site_steps, tutorials, tutorial_taxonomies, site_languages |

Key shapes:
- `clients`: `vendor_id` NOT NULL; unique (vendor_id, email), (vendor_id, mobile); `source`
  (website, google, facebook, admin, vendor, qr); `newsletter_opt_in`; `code` (old `CLI-…`); plan only via active subscription.
- `vendor_users`: `vendor_id`, `is_owner`, `department_id`, credentials; `vendors` keeps business profile + bank details.
- `sites`: `vendor_id` NOT NULL, `kind` (`marketing` | `vendor`), unique `slug`, unique `custom_domain`, `is_primary`.
  Only the house vendor owns a `marketing` site. Admin `/website-builder/*` edits it; `/vendors/website/*`
  edits the signed-in vendor's `vendor` site.
- `events`: `vendor_id`, `client_id`, `organizer_client_id`, `plan_id`, `event_template_id` (FK); menus via `event_menu`; settings in `event_settings`.

---

# PART D — DATA IMPORT (`php artisan legacy:import [--dry-run]`)

Reads a `legacy` DB connection, writes the new DB under `Tenancy::bypass()`, per module, idempotent.
`legacy_id_map` records every old → new id. Dry-run prints row counts old vs new and every unmapped value.

| From | To | Rule |
|---|---|---|
| companies | companies | same ids |
| vendors | vendors | same ids; **1 = house vendor**; `company_id` NULL → 1; soft-deleted 3, 6 stay soft-deleted |
| vendors (login columns) | vendor_users | one `is_owner` row per vendor, same email + hash |
| vendor_staff | vendor_users | `is_owner = 0`; role → spatie role, `team_id = vendor_id` |
| website_clients | clients | **same ids**, vendor 1 |
| vendor_clients | clients | new ids after max website-client id; `source = vendor`; `client_type` → `newsletter_opt_in`; old `plan` text reported, not assigned |
| company_websites + company_website_* | sites `marketing` (vendor 1, primary) + site_* | slug `company-1`, Vercel domain kept |
| vendor_websites + vendor_website_* | sites `vendor` + site_* | `ra-events-1` → vendor 1's vendor site |
| vendor_website_ui_blocks with `website_id = 1` | marketing site blocks | admin-bug rows (real vendor sites are 2, 3, 4) |
| company_website_clients + sponsors | site_logos | `type` |
| company_templates | — | dropped; showcase reads `event_templates` |
| company_website_content_translations | translatable JSON on site_* | via `legacy_id_map`; brand-name fields dropped; `ui-chrome` → `lang/{locale}/site.json` |
| translation_keys + translations | `lang/{locale}.json` | one file per active language |
| subscription_plans | plans | same ids |
| events | events | **same ids** (QR); `theme_id` slug → `event_template_id` via `event_templates.code`; JSON menus → `event_menu`; settings → `event_settings` |
| event_participants + guests | participants + guests | person columns on guest, per-event columns on participant |
| event_message_campaigns + event_notifications | event_broadcasts | `channel` column |
| mails, chat_* | mails, conversations, messages | actor ids re-pointed through `legacy_id_map` |
| sessions / refresh tokens | — | not imported; everyone signs in again at cutover |

---

# PART E — PHASES

First action after approval: save this document as `D:\Jamal\Event_Management_Admin_Backend\docs\LARAVEL_MIGRATION_PLAN.md`.
During the rewrite Node gets no new tables or columns; new features are built in Laravel first.

0. **Fix live bugs 1–8 in Node** only if production needs them before cutover.
1. **Skeleton + Core** — repo `D:\Jamal\Event_Management_Laravel_Backend`; Laravel 12, packages, everything in
   A6/A7 (Core kernel, middleware groups, exception map, guards, tenancy, ListQuery, ModuleServiceProvider),
   Pint/Larastan/Pest/arch tests, CI, `legacy` connection, house-vendor seeder.
2. **Platform + Identity** — admin auth, users, roles, approvals (gate + requests), settings, locations, languages, currencies, media, activity, UI translations.
3. **Catalog + Templates**.
4. **Vendors + Clients** — vendor_users, vendor roles, merged clients and every login path.
5. **Billing**.
6. **Events**.
7. **Messaging** + `chat-socket/`.
8. **Sites** — merged builder, public resolve/bundle, content translation.
9. **Import** — dry-run on a production copy, fix the report, real run.
10. **Cutover** — deploy, import, switch every frontend `API_URL`, Node kept read-only for rollback.

Each phase is done when its contract tests, tenancy tests and arch tests pass and its frontend screens are checked.

---

# PART F — VERIFICATION

- Contract tests: Pest asserts status codes and JSON keys equal recorded Node responses for every ported endpoint.
- Tenancy tests: vendor user, staff, client never read or write another vendor's rows; admin builder touches only the house vendor's marketing site.
- Arch tests (A11) green in CI.
- `legacy:import --dry-run` report reviewed: row counts, unmapped plan labels, re-pointed mail/chat actors.
- QR: every production `events.qr_token` decrypts to its event id with the PHP codec.
- Logins with existing accounts: jamal@vendor.com (local vendor 1), jamal@jamal.com (prod vendor 1 / staff), a website client, a former vendor client.
- Manual pass: admin, vendor, staff, client portal, public site, Flutter app against local Laravel.
