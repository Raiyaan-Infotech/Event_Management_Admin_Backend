
---

## Session 5 — Website Builder Language & Translation Module (separate from Admin Translations)

> **Date:** 2026-08-06 | **Backend:** `D:\Jamal\Event_Management_Admin_Backend` | **Frontend:** `D:\Jamal\Event_Management_Admin_Frontend`
> **Status:** Working end-to-end for Hero Section. Other sections auto-discovered but not yet wired to the per-form translation view.

### 26. Goal

Give Website Builder its **own** Languages + Translations modules — same DB structure and same flow as the
admin panel's `Settings > Languages` / `Settings > Translations`, but completely isolated from them.

> **This is NOT the same as** `src/locales/website-builder/en.json` / `hi.json`. Those static JSON files
> translate fixed **UI chrome** on the public preview (button labels like "Choose Plan"). This new module
> translates **admin-entered content** (hero title, FAQ answers, testimonial text) stored in the DB.

---

### 27. New Database Tables (executed on Local + Production Aiven)

| Table | Purpose |
|---|---|
| `company_website_builder_languages` | Language list scoped to `company_id`. Separate from the admin `languages` table. Columns: `code`, `name`, `native_name`, `direction`, `is_default`, `is_active`, `sort_order`. English seeded as default. |
| `company_website_translation_keys` | Registry of every translatable field. Columns: `section`, `page_slug`, `record_id`, `field_key`, `field_label`, `field_type`, `default_value` (English source), `sort_order`. Unique on `(company_id, section, page_slug, record_id, field_key)`. |
| `company_website_content_translations` | The translated values. Columns: `section`, `page_slug`, `record_id`, `field_key`, `language_id`, `value`, `status` ENUM('auto','reviewed'). Unique on the same 5-part slot + `language_id`. |

**Migration scripts** (in `scratch/`, run with `node scratch/<file>`):
- `setup_website_builder_translations_raw.js` — languages + content_translations
- `setup_website_builder_translation_keys_raw.js` — translation_keys
- `setup_wb_translation_status_raw.js` — adds `status` column

> **Slot identity** — a translation is addressed by **5 parts**:
> `(company_id, section, page_slug, record_id, field_key)`.
> The frontend form and the backend scan **must agree on all 5** or the lookup silently returns `{}`.
> This caused a real bug — see section 33.

---

### 28. Backend Files

| File | Purpose |
|---|---|
| `src/services/websiteBuilderTranslation.service.js` | All logic: languages CRUD, key registry, content scan, auto-translate |
| `src/controllers/websiteBuilderTranslation.controller.js` | HTTP handlers |
| `src/routes/companyWebsiteBuilder.routes.js` | Routes mounted under `/api/v1/website-builder/` |

#### Routes

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/translations/languages` | List / create language |
| PUT | `/translations/languages/:id` | Update language |
| PATCH | `/translations/languages/:id/default` | Set default (default cannot be deactivated/deleted) |
| POST | `/translations/languages/:id/translate-all` | **Translate ALL keys into this language** |
| DELETE | `/translations/languages/:id` | Delete language |
| GET | `/translation-keys` | List keys + all languages' values (auto-syncs first) |
| GET | `/translation-keys/stats` | Completion % per language |
| GET | `/translation-keys/sections` | Distinct section list (filter dropdown) |
| PUT | `/translation-keys/register` | Register keys for a section (called on section save) |
| PUT | `/translation-keys/:id/translations` | Save one key across many languages (edit dialog) |
| POST | `/translation-keys/:id/retranslate` | Re-translate one key into all languages |
| DELETE | `/translation-keys/:id` | Delete key |
| GET/PUT | `/content-translations` | Read/write translations for one slot |
| POST | `/content-translations/auto-translate` | Auto-translate one section into one language |

---

### 29. Auto-discovery: `syncKeysFromContent()` — content already in DB is translatable

**Do NOT require re-saving a section for its text to become translatable.** The service defines a
`FIELD_CATALOG` (section to table + translatable columns) and **scans the content tables directly**.

Runs automatically on: `listKeys`, `getStats`, `listSections`, `translateAllToLanguage`.

**Currently discovers ~139 keys across 17 sections:**
`basic-information, clients, faqs, features, footer, gallery, hero-section, how-it-works, nav-menu,
pages, pricing-plans, seo, sliders, sponsors, templates, testimonials, video-tutorials`

Scan rules:
- Scoped by `company_id` **and** `website_id` (matching how the app reads content)
- Sections marked `singleton: true` use `LIMIT 1` — mirrors the app's `getSingleton`, so duplicate
  rows the UI never displays do not become ghost keys
- Multi-row sections get a `nameCol` appended to the label (e.g. `Question — How do I book?`)
- Empty values are skipped
- **Pruning deletes only the key row, never the translations** (see section 33)

#### Hero Section needs a custom `extract()` — it is structurally unusual
- Its per-page content lives inside **`design_json`** keyed by page slug, NOT a `page_slug` column
- Its CTA labels live inside **`button_1_json.label` / `button_2_json.label`**
- So `FIELD_CATALOG['hero-section'].extract(row)` returns one entry per page in `design_json`,
  pulling button labels out of the JSON columns. Registers at `page_slug='home', record_id=<row.id>`.

**Any other section with JSON-nested or per-page content will need the same `extract()` treatment.**

---

### 30. Auto-translate engine

Reuses the **existing** `autoTranslate.service.js` (MyMemory API) that the admin Languages module already uses.

```
REQUEST_DELAY_MS      = 350    // pace requests; MyMemory 429s on bursts
RATE_LIMIT_BACKOFF_MS = 5000   // one retry on 429 before giving up
```

- **Saves to DB per key as it goes** — a failed/partial run keeps everything already written
- **Resume-friendly**: keys that already have a value are skipped (no wasted quota).
  Re-running after a full success takes about 1s with 0 API calls.
- **Never overwrites `status='reviewed'`** (human-edited) translations
- `POST` body `{ "overwrite": true }` forces re-translation of `auto` values
- Output is trimmed — the API returns junk like `"seemantha\n\n\n"`

> **MyMemory quota is CHARACTER-based, not request-based:**
> **5,000 chars/day anonymous · 50,000 chars/day with email.**
> Current content is ~5,254 chars, which exceeded the anonymous limit in a single run.
> **`MYMEMORY_EMAIL=jamaludheen779@gmail.com` is now set in backend `.env`** — required.

---

### 31. Frontend Files

| File | Purpose |
|---|---|
| `src/hooks/useWebsiteBuilderTranslations.ts` | All hooks for languages, keys, stats, translate |
| `src/app/admin/website-builder/languages/` | Languages page — CRUD, active toggle, Set Default, **Translate** button |
| `src/app/admin/website-builder/translations/` | Translations page — 1:1 mirror of admin `Settings > Translations` |
| `src/app/admin/website-builder/_components/translation-side-card.tsx` | Language list card embedded in section forms |

**Sidebar** (`app-sidebar.tsx`), under Website Builder, flat general group:
`Languages` and `Translations` (next to Web UI Block, Theme Color, SEO Settings, Login Page).

#### Translations page mirrors the admin module exactly
Completion stat cards (clickable to filter) · table `Field | English (Original) | one column per language | Actions` ·
status icons per cell (reviewed / auto / missing) · filters (search, section, language, status) ·
row actions (re-translate / edit / delete) · edit dialog with a textarea per language.

---

### 32. Three ways to translate

| Scope | Where | Control |
|---|---|---|
| **All keys into one language** | Website Builder > **Languages** | Blue **Translate** button on the language row |
| One field into all languages | Website Builder > **Translations** | Re-translate icon on the row |
| One section into one language | Hero Section form (translation mode) | **Translate from English** |

#### Per-form translation view (Botble-style), currently on Hero Section only
- Languages card lists English (source) + each language with a `filled/total` badge
- Clicking a language navigates to `?page=home&lang=<id>` — **the same form** re-renders with that
  language's values; English text shows as placeholder where empty
- Banner: "You are editing the Tamil version..." plus **Translate from English** and **Back to English**
- Non-text controls (image, height, overlay, colors, button style/URL) are **dimmed and locked** —
  they are shared across languages and edited from the English version
- Save in this mode writes to `content_translations`, not the base section table

---

### 33. Bugs hit this session — read before extending

1. **Slot mismatch = silent empty result.** Hero showed `0/5` because the scan stored at
   `page_slug='', record_id=1` while the form requested `page_slug='home', record_id=0`.
   **When wiring a new section, verify the form and the scan produce the identical 5-part slot.**
   Quick check: `curl ".../content-translations?section=X&page_slug=Y&record_id=Z"` must return values, not `{}`.

2. **`useCompanyHeroSection` dropped the row `id`.** Around line 235 it returned `{...storedMap[pageSlug]}`,
   and `design_json.home` contains no `id` — so `heroData.id` was `undefined`, giving `record_id=0`.
   Fixed by layering: `{ ...backendObject, ...storedMap[pageSlug], id: backendObject.id, ... }`.
   **Any hook that merges `design_json` must preserve top-level columns.**

3. **String vs number `language_id`.** `req.params.id` is the string `"2"`; DB `language_id` is number `2`.
   A `===` comparison silently never matched, so "resume" re-translated everything and burned the quota.
   All language ids are now coerced with `Number()`.

4. **Prune deleted translations (data loss).** The sync prune step removed a key *and its translations*.
   A key can disappear because its slot address changed, not because content was deleted — 3 Tamil
   translations were destroyed this way. **Prune now deletes only the key row; translations are kept**
   and re-adopted if the slot reappears.

5. **Duplicate rows exist in the DB** — `company_website_hero_sections` (2), `footer_settings` (2),
   `basic_information` (3), all with the same `company_id` + `website_id`. The app only reads the first
   (`LIMIT 1`), so the extras are dead data, likely from `upsertSingleton` inserting instead of updating.
   Worth cleaning up separately — **not yet fixed.**

---

### 34. Current state / TODO next session

**Working:**
- Languages page (CRUD, set default, Translate All)
- Translations page (mirrors the admin module)
- Auto-discovery of 139 keys across 17 sections from existing DB content
- Auto-translate with resume, throttle, retry, trim
- Hero Section per-language form view — verified 5/5 Tamil over HTTP

**Not done:**
- **Per-form language card is only on Hero Section.** Each other section needs:
  `TranslationSideCard` + `activeLanguageId` from `?lang=`, translated-state, and `recordId` matching the scan
- **Public preview does not read these translations yet** — saving Tamil changes nothing on the
  rendered site. Preview components in `components/company-website-preview/sections/*` need to look up
  `content-translations` for the visitor's language
- Public language switcher still uses the static `en.json`/`hi.json` list, not `builder_languages`
- 3 `video-tutorials` short descriptions still untranslated (quota ran out) — re-click Translate
- Duplicate DB rows (section 33.5) not cleaned
- No permission slug gates these pages (consistent with the rest of Website Builder)


---

## Session 6 — Rendering translations, DB-driven language switcher, per-section wiring

> **Date:** 2026-08-07 | **Backend:** `D:\Jamal\Event_Management_Admin_Backend` | **Frontend:** `D:\Jamal\Event_Management_Admin_Frontend`
> **Status:** Translations now actually render. Per-section translation UI added where the page is DB-backed.

Picks up the four "Not done" items from section 34.

---

### 35. Duplicate DB rows — section 33.5's diagnosis was WRONG

`upsertSingleton` was **not** the cause. Verified: `basic_information`, `hero_sections`,
`footer_settings` and `seo_settings` have **no `page_slug` column**, so the
`if (existing && (!hasPageSlugCol || ...))` branch always takes UPDATE — it can never insert a
duplicate. The extra rows were **seed data inserted twice** (identical `updated_at` clusters at
`2026-07-29 10:21:02` and `10:39:54` across four unrelated tables).

The real latent bug was different and worse: **`getSingleton` had no `ORDER BY`**. With duplicates
present, MySQL could return either row from `LIMIT 1`, while the translation scan reads
`ORDER BY id ASC LIMIT 1`. A divergence there silently detaches every saved translation from its
slot (`record_id` points at the other row).

Fixed:
- `getSingleton` now ends `ORDER BY [page_slug priority, ]id ASC LIMIT 1` — deterministic, and
  matching the scan.
- `scratch/cleanup_singleton_duplicates.js` — keeps the lowest id per `(company_id, website_id)`,
  deletes the rest, then adds a `uniq_company_website_singleton` UNIQUE index so it cannot recur.
  Dry-run by default; `--apply` to write.
- **Executed:** Local had 5 dead rows (basic ×2, hero ×1, footer ×1, seo ×1) — deleted.
  Production was already clean. UNIQUE index added on both.

---

### 36. Public rendering — translations now reach the site

Previously saving Tamil changed nothing on the rendered page. Three pieces:

**Backend** (`websiteBuilderTranslation.service.js` + controller + routes):

| Method | Path | Purpose |
|---|---|---|
| GET | `/translations/public-languages` | Active languages, default first — feeds the switcher |
| GET | `/translations/bundle?code=ta` (or `?language_id=`) | **Every** translation for one language in one request |

The bundle is keyed by slot — `{ "faqs||13": { question, answer } }`. One request, not one per FAQ.
Both are GET, so they're already public under the router's `optionalCompanyAuth`.
An unknown/deactivated language returns `{language:null, translations:{}}` (renders English), not a 4xx.

**Frontend overlay** — applied at the **data layer**, not in components:
- `components/company-website-preview/sections/preview-translate.ts` — `createTranslator(bundle, enabled)`
  returning `one()` / `many()` / `field()`. Raw record in, raw record out with translated text swapped in,
  so every section component stays language-agnostic and needed no changes.
- Hero needs special handling: `button_1_label` / `button_2_label` are registered flat but live nested
  inside `button_1_json.label`, so `NESTED_FIELD_WRITERS` writes them back into the JSON.
  **Any future section with JSON-nested text needs an entry there.**
- `company-website-preview.tsx` wraps each raw dataset before the `build*` helpers run.
  `PageHeroSection` self-fetches, so it applies the overlay itself.

---

### 37. Language switcher is DB-driven

Was a hardcoded `en ⇄ hi` toggle calling `setLanguage` from `useTranslation()` — which **persists to
admin General Settings**. A site visitor switching to Tamil would have relabelled the admin UI.

New `components/company-website-preview/website-language-provider.tsx` holds the **site** language
separately: `?lang=` → localStorage → default. It exposes both kinds of translation, which are easy
to confuse:
- `t(key)` — static UI chrome ("Login") from `src/locales/website-builder/*.json`
- `translator` — admin-entered DB content

Also: `dir={direction}` on the preview root for `rtl` languages; the switcher hides itself when only
one language exists; a language deleted in the admin falls back to the default instead of sticking.
All 11 preview sections were repointed from `useWebsiteBuilderTranslation` to `useWebsiteLanguage`.

---

### 38. Per-section translation wiring

Two shapes, because one pattern does not fit both:

**Singleton forms** → full Botble-style mode, via new `hooks/useSectionTranslation.ts` (extracted from
hero) + `_components/translation-mode-banner.tsx` + the existing `TranslationSideCard`.
Wired: **SEO**, **Footer**. Non-text controls dim/lock via `sharedOnly`.

> Footer's English save writes `company_name` to **both** the footer row and `basic_information`.
> Its translation save now mirrors that — otherwise the rendered site header stays English.

**List sections** → new `_components/row-translate-dialog.tsx` (`RowTranslateButton`), a per-row
dialog editing all languages for that row. A per-form language card is meaningless on a list page
because every row is its own slot.
Wired: **testimonials, faqs, features, video-tutorials, how-it-works, templates, pricing-plans**.

**Deliberately NOT wired — these admin pages are local-only mock state, not DB-backed:**
`clients/page.tsx`, `sponsors/page.tsx`, `pages/page.tsx`, `_components/simple-slider-content.tsx`.
Their row ids are `Date.now()` / hardcoded `'1','2','3'`, **not** the DB ids
(clients are 7–12, sliders 4–6). Wiring them would write translations to wrong slots — exactly the
section 33.1 bug. **Fix the pages to load from the DB first, then wire.**
Meanwhile the central Translations page handles all of them correctly.

`gallery` and `nav-menu` are unwired for the same reason (no DB-backed per-row edit action).

---

### 39. Verification done

- All registered slots confirmed as `page_slug='' record_id=<db row id>` (hero: `page_slug='home'`)
  via `GET /translation-keys` — matches what the hook and dialog produce.
- `npx tsc --noEmit` clean; `npx next build` succeeds.
- Bundle endpoint returns real Tamil content for `?code=ta`; unknown code degrades to English.

### 40. TODO next session

- Make `clients` / `sponsors` / `pages` / `sliders` admin pages DB-backed, then add `RowTranslateButton`
- `highlights` (UI blocks) content isn't in `FIELD_CATALOG` at all — not translatable yet
- `basic-information.address` has no dedicated form; only `company_name` is reachable (via Footer)
- 3 `video-tutorials` short descriptions still untranslated (MyMemory quota)
- No permission slug gates the Languages/Translations pages

---

### 41. Hero-style per-form translation extended to all form pages

Follow-up: the row dialogs added in section 38 were a shortcut, not the requested UX. Every **form
page** now gets the same treatment as Hero Section — `TranslationSideCard` + `?lang=<id>` +
`TranslationModeBanner` + shared (non-text) controls dimmed and locked.

| Form page | Section | record_id source | Translatable fields |
|---|---|---|---|
| `_components/seo-content.tsx` | `seo` | settings row id | site_name, default_title, default_description |
| `_components/footer-content.tsx` | `footer` | footer row id | company_name, description, top_list_heading, top_list_heading_2 |
| `_components/login-page-content.tsx` | `login-page` | settings row id | title, **subtitle** (form labels it "Description") |
| `_components/faq-form-content.tsx` | `faqs` | `id` prop from `faqs/edit/[id]` | question, answer |
| `features/create/page.tsx` | `features` | `?id=` | title, short_description, detailed_description |
| `templates/create/page.tsx` | `templates` | `?id=` | template_name, description |
| `_components/video-tutorial-form-content.tsx` | `video-tutorials` | `id` prop from `video-tutorials/edit/[id]` | title, short_description, key_takeaways |
| `_components/pricing-plans-content.tsx` | `pricing-plans` | **selected** plan's id | plan_name, subtitle, period_label, badge_text |
| `_components/hero-section-content.tsx` | `hero-section` | hero row id + page slug | badge_text, title, description, button_1_label, button_2_label |

Shared machinery:
- `hooks/useSectionTranslation.ts` — `isTranslationMode`, `values`, `bind()`, `save()`,
  `autoTranslate()`, `buildHref()`, `registerKeys()`. `bind(key, baseValue, setBase)` spreads
  `{value, onChange, placeholder}` — English mode passes through, translation mode swaps in the
  translated value and shows the English as placeholder.
- `_components/translation-mode-banner.tsx` — banner + "Translate from English" + "Back to English".
- `handleTranslationSave(translation, label)` guards each `handleSave`: returns true when it handled
  the save, so the English validation/persist path is skipped entirely.

Notes:
- **Create mode has no side card.** A translation slot is addressed by the saved row's id, so the
  card only renders once the record exists (`isEdit && id`, or `?id=` present).
- **Pricing plans is a tabbed editor** — one form, many plans. The slot follows `currentPlan`, so
  switching plan tabs switches which row you're translating. Its badge Input is bound manually
  (it's a raw `<Input>` with `e.target.value`, not the `BuilderCounted*` `onChange(val)` shape).
- `login-page` writes DB column **`subtitle`** while the form labels the field "Description" —
  the translation key is `subtitle`.
- Row dialogs (`RowTranslateButton`) are kept on the list pages as a shortcut. They write the
  identical slots, so the two entry points cannot diverge.
- **how-it-works and testimonials keep only the row dialog** — they edit rows in a modal / inline
  table, and the hero pattern's `?lang=` URL round-trip would tear down the modal on every switch.

Verified: `npx tsc --noEmit` clean, `npx next build` compiled successfully.

---

### 42. Missing sections — FIELD_CATALOG was the real gap

The complaint "so many sections missing" was correct, and the cause was **backend**, not frontend:
those sections were never in `FIELD_CATALOG`, so the scan discovered **no keys** for them and there
was nothing for any UI to translate.

**Added 12 sections to `FIELD_CATALOG`** — key count went **139 → 219** (+80):

| Section | Table | Fields |
|---|---|---|
| `highlights` | `company_website_highlights` | custom extract from `settings_json.items[]` |
| `template-categories` | `company_template_categories` | name, description |
| `faq-categories` | `company_website_faq_categories` | name, description |
| `gallery-categories` | `company_website_gallery_categories` | name, description |
| `contact-categories` | `company_website_contact_categories` | name, description |
| `video-tutorial-categories` | `..._video_tutorial_categories` | name, description |
| `video-tutorial-subcategories` | `..._video_tutorial_subcategories` | name, description |
| `video-tutorial-difficulty-levels` | `..._video_tutorial_difficulty_levels` | name, description |
| `video-tutorial-types` | `..._video_tutorial_types` | name, description |
| `pricing-settings` | `company_website_pricing_settings` | 7 heading/subheading fields |
| `pricing-features` | `company_website_pricing_matrix_features` | feature_name, description |
| `social-links` | `company_website_social_links` | label |
| `slider-settings` | `company_website_sliders` | title |

> **Bug fixed while adding these:** `syncKeysFromContent` bailed with
> `if (usableFields.length === 0) continue;`. `highlights` has no plain columns (everything is in
> `settings_json`), so it was skipped before its extractor ever ran. Now
> `if (usableFields.length === 0 && !config.extract) continue;`.

**Highlights extractor** — cards live in `settings_json.items[]`, flattened to
`item_<n>_title` / `item_<n>_description`, **1-based**, at `page_slug=<page>, record_id=<row.id>`.
The row id is what separates instance 1 from instance 2 of the same page (they share a page_slug).
Reordering cards in the admin re-points their translations — same trade-off as every JSON-backed
section. The frontend form and preview both rebuild these keys from the item index and **must stay
1-based** to match.

### 43. Forms wired in this pass

- **Highlights** (`_components/highlights-content.tsx`) — full hero-style mode, per page+instance.
- **Testimonials** (`_components/testimonials-content.tsx`) — full hero-style mode. It edits one
  `activeItem` at a time (like pricing plans), so the slot follows the selected row. Delete is
  disabled in translation mode.
- **Category pages** — row dialogs (they are tables, not forms): template categories, FAQ categories,
  video tutorial categories / subcategories / difficulty levels / types.

**Preview overlay extended:** gallery categories, contact categories, social links, and highlights
(the last via `translator.field()` per card, since its text is not on plain columns).

### 44. Two things that are NOT missing work

- **Login & Demo / Sign In & Demo have no translatable content.** `login-demo-content.tsx` is a
  *variant picker* — it stores only the chosen variant id in **localStorage**, and every string in
  those blocks is hardcoded in `login-demo-section.tsx` and translated through the static
  `src/locales/website-builder/*.json` dictionaries (the `t()` path). There is no admin-entered text,
  so there is no DB slot and nothing for a translation form to edit. To translate those labels,
  edit `en.json` / add `ta.json` — not the Translations module.
- **Gallery Categories and Contact Categories admin pages are still local-only mock state**
  (`Date.now()` ids), like clients / sponsors / pages / simple-slider from section 38. Their DB rows
  ARE now translatable via the central Translations page, but a row button on those pages would
  write to fabricated ids. Left unwired deliberately — see section 38.

Verified: 219 keys across 27 sections; all new slots confirmed `page_slug='' record_id=<db id>`;
`tsc --noEmit` clean; `next build` compiled successfully.

### 45. "No translatable fields yet" on Highlights — unsaved-record bug

**Cause:** `company_website_highlights` had **0 rows**. The 6 cards the Highlights page shows are
`DEFAULT_HIGHLIGHTS`, hardcoded in `useHighlights.ts` and never persisted. No row → no id →
`recordId` undefined → the scan registers 0 keys → nothing to auto-translate.

The side card's `0/12` badge was misleading: it counts `translationFields`, which is built from the
in-memory default cards, so it implied 12 registered keys when there were none.

**Two real defects, both fixed:**

1. Highlights rendered its translation UI unconditionally, unlike the FAQ/features/templates forms
   which gate on an existing record. You could enter translation mode on a record that doesn't exist.
2. Saving in that state would have written to **`record_id = 0`** — the backend coerces a missing
   record_id with `|| 0` — creating orphan translations no content ever resolves to.

Fixed in `useSectionTranslation` so **no section can hit this**:
- New `canTranslate` (`!!recordId`) and `blockedReason`.
- `isTranslationMode` is now `isTranslationMode && canTranslate` — an unsaved record can never enter
  translation mode even with `?lang=` in the URL.
- `save()` and `autoTranslate()` refuse with a clear toast instead of writing to slot 0.
- `TranslationSideCard` takes `canTranslate` and explains the state rather than listing languages
  that lead nowhere. Passed from all 10 wired forms.

**Resolution for the user:** click **Back to English**, then **Save Changes** once on
`/highlights/home/1`. That creates the row; the scan then registers 12 keys
(`item_<n>_title` / `item_<n>_description` at `page_slug='home', record_id=<row id>`) and Tamil works.

Verified the extractor against a sample row — output slot and keys match what the form binds and
what the preview reads via `translator.field()`.

### 46. Highlights still showed "save this section first" AFTER saving — dropped row id (again)

Saving worked (`company_website_highlights` had the row, `id=1`, and its
`company_page_instance` UNIQUE index means `ON DUPLICATE KEY UPDATE` can't duplicate it). The UI
still refused to translate because **`getHighlights` threw the row id away**:

```js
const parsed = JSON.parse(rows[0].settings_json);
return ApiResponse.success(res, parsed, ...);   // id, page_slug, instance all lost
```

`settings_json` holds only the editor's own state, so returning it bare means `fetchedData.id` is
`undefined` → `recordId` undefined → `canTranslate` false → the card shows the "save first" message
forever, no matter how many times you save.

**This is the third instance of the same bug class** (see section 33.2 for `useCompanyHeroSection`,
and section 38 for the mock-id pages): *anything that returns a JSON blob must layer the top-level
columns back on top, because translations are addressed by the row id.*

Fixed both directions:
- `getHighlights` now returns `{ ...parsed, id, page_slug, instance }`.
- `saveHighlights` reads the row back and returns its `id` instead of echoing the request body, so
  the client has an id immediately after the first save rather than only after a refetch.

Verified: GET returns `id=1`; the scan registered **12** keys at `page_slug='home', record_id=1`;
`GET /content-translations?section=highlights&page_slug=home&record_id=1` returns the Tamil values.
Checked the rest of the controller — no other endpoint returns a bare parsed JSON blob.

### 47. Highlights instance 2 + empty img src

**Highlights (BG Filled) on home — same dropped-id cause, already fixed.**
All three highlight rows exist (`home/1` id=1, `home/2` id=2, `features/1` id=3) and the scan now
registers **12 keys each** (36 total). `GET /highlights?page_slug=home&instance=2` returns `id=2`.

Instance 2 was failing for exactly the reason section 46 describes — `getHighlights` dropped the row
id, so EVERY instance was affected, not just instance 1. The section 46 fix covers all of them; the
page needs a reload to pick up the corrected response (React Query holds the old one:
`useBuilderLanguages` staleTime 5 min, `useContentTranslations` 60 s).

Note instance 1 and instance 2 of the same page share `page_slug='home'` — only `record_id` (the row
id) separates their translation slots. That is why the id being dropped broke both at once.

**Empty `src=""` console error** (`testimonials-content.tsx`) — `activeItem.photoUrl` is `''` for a
testimonial with no photo, and an empty `src` makes the browser re-request the current page as the
image. Fixed both unguarded spots (the form's photo box and the live-preview modal) to render a
fallback instead of an empty `<img>`. The public preview section was already guarded.

### 48. Full-screen progress loader for auto-translate (real percentage, not simulated)

The banner's inline spinner gave no sense of how long a run would take. Replaced with a full-cover
overlay showing a genuine percentage.

**The percentage is real, not a fake timer.** Backend now streams one Server-Sent Event per
translated field:

- `autoTranslateContent(companyId, opts, onProgress)` — new optional `onProgress` callback, fired
  per key with `{ phase, done, total, field }`. Defaults to a no-op, so the existing POST path is
  unchanged.
- `GET /content-translations/auto-translate/stream` — SSE route. Not wrapped in `asyncHandler`
  (it writes the stream itself). EventSource can't set headers, so company scoping rides on the
  `company_id` query param, which `optionalCompanyAuth` already accepts. Handles client disconnect.
- Frontend `useSectionTranslation.autoTranslate` now drives an `EventSource` and exposes
  `autoTranslateProgress { done, total, field }`.
- `components/common/translation-progress-overlay.tsx` — full-cover loader, SVG ring, live %,
  `done / total`, and the field label currently being translated.
- Rendered from `TranslationModeBanner`, so **all wired forms get it for free**.

> **Next proxy had to change too.** `app/api/proxy/[...path]/route.ts` did
> `await backendResponse.blob()`, buffering the whole body — every progress event would have landed
> at once when the run finished. It now pipes `backendResponse.body` straight through when the
> response is `text/event-stream` (plus `X-Accel-Buffering: no`). Non-SSE responses are untouched.
> Verified through the proxy: events arrive ~1s apart, not in one burst.

### 49. Auto-translate wrote the WRONG ROW's text on multi-row sections

Found while adding progress. `autoTranslateContent` called:

```js
const keys = await listKeys(companyId, { section, page_slug });   // no record_id!
```

`listKeys` had no `record_id` filter, so for a multi-row section it returned **every row's** keys.
Results are collapsed into a single `values` object keyed by `field_key`, so the **last row silently
won** — and that text was then saved against the *target* row.

Concretely: "Translate from English" on testimonial #7 fetched all 6 testimonials' keys and saved
**testimonial #12's** translated name, event and feedback into #7. Same for FAQs, pricing plans,
features, sliders, gallery, video tutorials and every category table.

Fixed: `listKeys` now accepts `record_id` (checking `undefined/null/''` explicitly, since `0` is a
valid record_id) and `autoTranslateContent` passes it. Verified against highlights record 1 — the
stream now reports exactly its own 12 keys.

### 50. Hero was never migrated to the shared components

Hero Section still had its **own hand-rolled** translation wiring from session 5 — its own
`useBuilderLanguages` / `useContentTranslations` / `useSaveContentTranslations` /
`useAutoTranslateContent` calls, its own `tBadgeText`/`tTitle`/... state, its own banner JSX and its
own `handleAutoTranslate`. Sections 38–47 built the shared pieces from it but never converted Hero
itself, so Hero kept the old inline spinner and got none of the later fixes.

Migrated to `useSectionTranslation` + `TranslationModeBanner`:
- 5 local `t*` state vars and their loading effect → `translation.values` via `bind()`
- bespoke save branch → `handleTranslationSave(translation, activePageTitle)`
- bespoke `handleAutoTranslate` → the hook's SSE-driven `autoTranslate`
- inline banner JSX → `<TranslationModeBanner />`

Hero therefore now gets the full-screen progress loader, the `canTranslate` guard, and the
record-scoped auto-translate fix — all of which it was missing. Dead imports removed.

### 51. Language card: no more "+ Add", and consistent placement

- **Removed the "+ Add" button** and the whole Add-Language dialog from `TranslationSideCard`
  (plus its 4 state vars, handler and now-unused imports). Languages are managed centrally under
  Website Builder > Languages; creating one from inside a section form was a second source of truth.
- **Placement now matches Hero** across all 10 wired forms: banner full-width on top, Languages card
  aligned right (`self-end lg:w-72`) instead of a left-hand column.

Verified: `tsc --noEmit` clean, `next build` compiled successfully.

### 52. Language card rows are now radio-style

Each language row shows a **round indicator on the left edge** — hollow when inactive, filled with a
primary dot when active — so the selected language reads at a glance instead of having to scan to
the far right. The trailing check icon is gone (the dot carries that state now); the `filled/total`
badge stays on the right.

Marked up as a real radio group (`role="radiogroup"` on the list, `role="radio"` +
`aria-checked` on each row) since that is exactly the semantic: pick one of N.

Also corrected the empty-state copy, which still told users to click the "Add" button removed in
section 51 — it now points at Website Builder > Languages.

> Build note: a `next build` run right after the temporary dev server (section 48's proxy test)
> failed on a stale `.next` turbopack chunk. `rm -rf .next` and rebuild is clean — not a code
> regression.

### 53. Mojibake in Tamil translations — MyMemory's corpus, not our encoding

One nav label rendered as `à®ªà®¾à®¤à¯...` on the public site. DB, connection and column are all
utf8mb4 (`utf8mb4_0900_ai_ci`) — the corruption arrived **from the translation API**. MyMemory serves
community-contributed translations and some entries in its corpus are themselves UTF-8 bytes that
were once stored as Latin-1.

Defence added in `autoTranslate.service.js` (so **every** caller benefits, including the admin
Languages module):
- `MOJIBAKE_PATTERN` — a Latin-1 high byte followed by a UTF-8 continuation-range character.
  Written with `\uXXXX` escapes: the continuation range is control characters, invisible and easily
  corrupted as source literals.
- `repairMojibake()` — re-decodes latin1→utf8; if the round trip yields U+FFFD the bytes were
  already lost and it returns null, and `translateText` throws so callers keep the existing value
  instead of persisting garbage.

`scratch/test_mojibake.js` verifies **no false positives** on valid Tamil, Hindi, Arabic, French
(`café`), Portuguese (`Ça vai, ação`), German (`Grüße`) and Spanish (`¿Cómo estás?`) — important,
since a false positive would silently block legitimate accented translations.

`scratch/clean_mojibake_translations.js` (dry-run by default) repaired **2 corrupted rows** locally
(`nav-menu` label, `video-tutorial-difficulty-levels` name). Production had none.

> **Correction to an earlier read:** these values were first judged unrecoverable. That was wrong —
> the diagnostic script read them over a connection without `charset: 'utf8mb4'`, which mangled the
> read itself. With the correct charset both repaired losslessly. **Always set `charset: 'utf8mb4'`
> on mysql2 connections in scratch scripts**, or you will diagnose the tool instead of the data.

### 54. Public-site design fixes

| Area | Problem | Fix |
|---|---|---|
| Features | "View Feature" took the rotating per-card accent, so four cards showed four link colours; it also sat wherever the text ended | One `theme.primaryButton` for all; card is `flex h-full flex-col` and the CTA `mt-auto`, so links align across a row. Icons/bullets keep the accent |
| Testimonials | Section background was `bg-slate-50` (grey) | `bg-white` |
| Testimonials | Prev/next arrows and pager dots were `rounded-md` | `rounded-full` |
| Testimonials | Card was centre-aligned, avatar-first | Rebuilt to the reference: rating on top, quote (`flex-1`), author row pinned bottom, all left-aligned. Grid switched to `items-stretch` so author rows line up |
| Testimonials | Heading badge was a plain square chip | Pill badge, uppercase, letter-spaced |
| Footer newsletter | Input and button should read as one control | Joined: `flex items-stretch` with no gap, rounding split across the pair (`rounded-l-xl` / `rounded-r-xl`) and the input's right border dropped so the seam looks like a single element. Input uses `flex-1 min-w-0`, not `w-full`, which would overflow the row and squeeze the button |
| Template create | Required thumbnail showed "Required" text but no red border, unlike the file dropzone | Wrapped `ImageCropper` in an error-styled container matching the dropzone |

Verified: `tsc --noEmit` clean, `next build` compiled, backend modules load.

### 55. Highlights: fixed presets replaced with a gradient picker (frontend only)

The four "Background Presets" buttons (Default / Gradient 1–3) are gone, replaced by a real gradient
picker: **From** colour, **To** colour, an **angle** slider (0–360°) and a live swatch of exactly
what will render.

**No backend change was needed.** `saveHighlights` does `JSON.stringify(body)` into `settings_json`
with no column whitelist, so new fields (`gradient_from`, `gradient_to`, `gradient_angle`) persist
automatically.

New shared helper `highlightsBackgroundStyle(config)` in `hooks/useHighlights.ts` is the single
source of truth for the background, used by the admin form, its preview modal and the public
section — three places that each re-derived it before and had drifted apart.

Backward compatibility: rows saved before the picker carry a `preset` id and no stops.
`LEGACY_PRESETS` maps those four ids to their original colour pairs, so existing blocks keep their
look. Editing any stop clears `preset` so the two can never disagree.

> **Bug found while doing this:** the public section ignored the configured colours entirely —
> every `background_type: 'gradient'` block rendered the same hardcoded pink/purple
> (`#EC4899 → #A855F7 → #4F46E5`), regardless of what the admin had chosen. So the old presets
> only ever produced 2 distinct looks on the live site, not 4.
>
> Instance 2's default pink/purple banner is deliberately preserved for blocks that have **never**
> had a background configured, so this change doesn't silently restyle live sites.

Verified: `tsc --noEmit` clean, `next build` compiled, no `gradient-1/2/3` or preset UI left outside
the legacy compatibility map.

### 56. Newsletter input/button — joined, not gapped

Correction to section 54: the "No gap" annotation on the footer newsletter meant the input and send
button should be a **single joined control**, not that a gap was missing. They are now flush —
`flex items-stretch` with no gap, rounding split across the pair (`rounded-l-xl` on the input,
`rounded-r-xl` on the button), and the input's right border removed so the seam reads as one
element instead of two touching ones. The shadow moved to the form wrapper so it wraps the pair.

### 57. How It Works section — connector, image height, icon rendering, alignment

Four issues from the mockup comparison, all in `how-it-works-section.tsx`:

- **Icons not showing.** `STEP_ICONS` only mapped 12 hardcoded lucide components, but the admin's
  icon picker (`icon-picker-dialog.tsx`) stores full Iconify names from any collection
  (`heroicons:star`, `simple-icons:...`). Anything outside those 12 silently fell back to
  `CheckCircle2`. Switched to `<Icon icon={...} />` from `@iconify/react` (same approach already
  used in Features/Header), so every icon the picker can select actually renders.
- **Each icon had a different colour.** They inherited the flat `theme.primaryButton` tint at fixed
  opacity — barely distinguishable, not actually "different colours" as reported, so this reads as
  "no colour." Added a 5-color `STEP_ACCENTS` rotation (pink/violet/green/orange/blue), applied
  consistently to both the graphic box and the right-side icon chip for a given step.
- **Icons not aligned in a column.** The right-side icon+badge block had no fixed width, so it
  drifted left/right depending on label length. Now `w-[200px]` with `truncate` on the badge text.
- **Image not full height of card.** The graphic box was a fixed `h-36` inside a `items-center` row,
  so it never grew with a taller card. Row is now `items-stretch` and the box is
  `h-36 md:h-auto md:min-h-[9rem]`, so on desktop it fills the card.
- **Connector line "different from mockup."** Was a straight dashed vertical rule; the mockup shows
  a soft flowing curve. Replaced with an inline SVG cubic Bezier that alternates left/right per step.

### 58. Contact section — Get In Touch rebuilt to match the two-card mockup

The old layout was a single form card beside a loose stack of contact rows and a separate map box —
structurally different from the mockup's two matched cards. Rebuilt `contact-section.tsx`:

- **Left card — "Send Us a Message":** icon header, hint line, labeled fields (was placeholder-only
  inputs with no labels), "Subject" instead of an unlabeled category select.
- **Right card — "Contact Information" + map, one card:** icon chips per row (Email Us / Call Us /
  Head Office — was a plain MapPin/Phone/Mail with generic labels), map moved from its own separate
  box into a split pane inside the same card (`grid sm:grid-cols-[1.3fr_1fr]`), filling the card's
  full height.

Grid switched to `items-stretch` so the two cards match height regardless of content length.

### 59. Highlights not reflecting on the live page — local vs production data, not a bug

Checked both databases directly. **Local** has a `pricing/1` highlights row (id=8, saved 2026-08-07);
**production** does not — its `pricing/1` predates this session (id=31, 2026-08-05) and was never
re-saved with the new fields. `useSaveHighlights`'s cache invalidation is correct
(`['website-builder-highlights', page_slug, instance]`, matching the query key), so this was not a
caching or wiring defect — the screenshot's environment simply has different data than what was
edited. No code change; flagging so the next session doesn't re-chase this as a bug.

### 60. Inline side-previews moved into "Live Preview" modals (matching Hero Section)

Swept every website-builder form for a sticky/inline preview column. Two had one; both now match the
pattern already used by Hero Section, SEO, Footer, etc. — full-width form, preview only in the
"Live Preview" dialog.

- **Login Page** (`login-page-content.tsx`) — had no Live Preview button at all; the branded panel
  mockup sat permanently in a `lg:grid-cols-[1fr_1.1fr]` right column. Extracted verbatim into a new
  `Dialog`, added the `Eye` / "Live Preview" button matching every other section, grid collapsed to
  one column. The dialog's inner `sticky top-4` (meaningless once inside a Dialog, no scrolling
  ancestor to stick within) replaced with `max-h-[70vh] overflow-y-auto`.
- **Pricing Plans** (`pricing-plans-content.tsx`) — the device-switchable single-plan mockup (its own
  "Card 1: Live Plan Preview" with a desktop/mobile toggle) was a sticky card beside the form.
  Pricing Plans already had a separate "Live Preview" dialog showing all 3 plans side by side —
  folded the single-plan mockup into the **top of that same dialog** rather than adding a second
  modal, so one button shows both "the plan you're editing" and "all plans compared." Plan Summary
  and Tips cards were left in place — those are reference data, not a visual preview.

Every other section checked (testimonials, footer, gallery, sliders, features, hero, highlights, ui
blocks) already previews exclusively through its modal — nothing else needed to move.

Verified: `tsc --noEmit` clean, `next build` compiled successfully; grepped for `sticky top-` /
"Right Column: Live" across all website-builder files afterward — none remain outside a Dialog.

### 61. How It Works — connector still broken (real bug), plus flush-graphic fix

Two more passes on `how-it-works-section.tsx` after section 57's first attempt.

**Connector line collapsed to a stub.** The row wrapper was `items-start`, so the badge column
(circle + SVG) was only ever as tall as its own content — the 40px circle — regardless of the
card's actual height. `height: calc(100% - 1.5rem)` on the SVG therefore resolved against ~2.5rem,
not the card's height, producing the tiny disconnected squiggle visible in testing. Changed the row
to `items-stretch` so the badge column matches the card's rendered height, and recomputed the SVG's
top offset (`3.75rem` = `pt-5` + `h-10`, was `3.25rem`) so the curve starts exactly where the circle
ends. Simplified from an alternating dual-path to one consistent gentle S-curve, closer to the
mockup's single flowing thread.

**Graphic had its own border+radius "box within a box."** The card wrapped everything in
`p-4 sm:p-6`, so the graphic sat inset on every side, and `DynamicStepGraphic` additionally drew its
own `border` + `rounded-lg` on top of that inset position — two visible box outlines instead of one.
Mockup has the image bleeding flush to the card's left/top/bottom edges with no visible border of
its own.

Fixed: card lost its uniform padding; the graphic now sits with zero inset on any side. The card's
own `overflow-hidden` + `rounded-xl` clip the graphic's exposed corners, so no separate border/radius
is needed on the graphic — removed both. Padding moved onto the content and badge columns
individually, applied only to the edges *not* touching the graphic (`md:pl-0` on content, since the
row's own `gap` already provides that spacing) so gap and padding don't stack into a double gap.

Verified: `tsc --noEmit` clean, `next build` compiled successfully.

### 62. Highlights — "individual cards" layout, scoped to How It Works only

Investigated first before touching anything: neither reference image's content
("Guest Management..." / "1000+ Templates...") exists anywhere in the DB under highlights OR
features — both are pure reference mockups, not screenshots of misassigned live data. The real gap:
every highlights block, on every page, has always rendered as **one shared bordered container**
(`rounded-2xl border ... p-6` wrapping all items in a grid) — there was no code path that could
produce "each item as its own card." That's what "ours showing one card" meant.

Added a real `card_style: 'grouped' | 'individual'` field to `HighlightsSettings`
(`hooks/useHighlights.ts`), defaulting to `'grouped'` so every existing block is visually unchanged.
Wired it in three places:
- Admin form (`highlights-content.tsx`) — new "Card Layout" select next to Icon Style.
- Admin's own Live Preview modal — was a second, hand-duplicated render (doesn't reuse the public
  component), branched separately so it matches what the public site will show.
- Public site (`highlights-section.tsx`) — new branch takes priority over the existing
  instance-based banner/bar logic; each item becomes its own bordered card, icon in a colored circle,
  centered text.

**Scoped to How It Works only, per explicit instruction** — not a global style change. Set
`card_style: 'individual'` directly on the `how-it-works/1` row via
`scratch/set_hiw_highlights_individual.js` (dry-run by default), applied to both local (id=10) and
production (id=66). Verified via API afterward: how-it-works returns `card_style: "individual"`;
home/1 returns `card_style: null` (falls through to the `'grouped'` default) — confirming no other
page was touched.

Verified: `tsc --noEmit` clean, `next build` compiled successfully.

---

## Session 6 — Translation correctness sweep + builder form consistency

> **Date:** 2026-08-07 | Continues from Session 5 (§26–62)
> **Status:** All work COMPLETE and verified locally. **NOTHING COMMITTED OR DEPLOYED.**

### 63. ⚠️ START HERE TOMORROW — nothing is deployed

Every fix below is **uncommitted** in both repos. Production (Vercel frontend + Render backend)
still runs the buggy code.

```
Frontend  last commit 9b95556   ~20 modified files
Backend   last commit 0544bee    3 modified files
```

This matters because the user tested on `event-management-admin-frontend.vercel.app` and reported
"Not Translating" — those were the **already-fixed** bugs, still live in production. Do not
re-debug them. **Commit + push both repos first**, then re-test.

### 64. THE root cause — destructive bulk-save orphaned every translation

Four sections saved via a bulk endpoint that ran `DELETE FROM <table>` then re-INSERTed every row,
**reassigning auto-increment ids on every save**. Since translations are addressed by `record_id`,
editing *any one* item silently detached **every** item's translations in that section.

This single bug explains nearly all the "edit translation not working" reports. The translations
were saving correctly, then being orphaned by the next unrelated save.

| Section | Was | Now |
|---|---|---|
| Features | `useSaveFeaturesList` (bulk) | `useCreateFeature` / `useUpdateFeature` |
| Testimonials | `replace` from generic list hook | `create` / `update` / `remove` |
| Pricing Plans | `useSavePricingPlans` (bulk) | `useCreatePricingPlan` / `useUpdatePricingPlan` |
| Plan Features | `useSavePricingMatrixFeatures` (bulk) | `useCreate/Update/DeletePricingMatrixFeature` |

**New backend endpoints added** (`companyWebsiteBuilder.controller.js` + routes):
- `POST/PUT /pricing/plans/:id` and `/pricing-plans/:id` → `createPricingPlan`, `updatePricingPlan`
- `POST/PUT/DELETE /pricing/matrix-features/:id` → matrix feature per-item CRUD

> The bulk endpoints still exist and are still used by drag-reorder paths (which only persist
> `sort_order`). Do not delete them.

### 65. ⚠️ `_components/pricing-plans-content.tsx` IS DEAD CODE

Nothing imports it; no route renders it. **I wasted time editing it before noticing.** The real
page is `pricing-plans/create/page.tsx`.

**Before editing ANY `_components/*-content.tsx`, verify it's reachable:**
```bash
grep -rl "<filename-without-ext>" src/app/
```
It still sits in the repo and still shows up in audits. Worth deleting.

### 66. Other fixes this session

- **Templates + Features**: `router.push` to the list page right after Add meant a new record never
  had a page where the language card could appear. Now stays on the form (`router.replace` to
  `?id=<newId>`).
- **Testimonials**: which row is being edited moved from local state into the URL (`?id=`). Local
  state reset to row 1 on any fresh load — including the navigation a language switch performs —
  so you could silently translate the wrong testimonial.
- **Preview language-switch loader**: `isLoadingBundle` already existed in
  `website-language-provider.tsx` but **nothing consumed it**. Now shows a "Switching language…"
  overlay. One component powers all 9 public routes.
- **How It Works**: investigated, **already correct** — has a working `RowTranslateButton` (small
  globe icon next to Edit/Delete). No change needed.

### 67. Hardcoded UI chrome → DB (61 strings)

Static UI text (headings, buttons, placeholders) lived only in
`src/locales/website-builder/*.json` and could not be translated from the admin.

- Backend: `UI_CHROME_KEYS` in `websiteBuilderTranslation.service.js` — 61 keys registered under a
  single fixed slot **`ui-chrome||0`**, via `registerUiChromeKeys()` called from
  `syncKeysFromContent`. Not in `FIELD_CATALOG` (no table to scan), which also means the prune step
  leaves it alone.
- Frontend: `t()` in `website-language-provider.tsx` now checks
  `bundleResponse.translations['ui-chrome||0']` first, falling back to the JSON dictionary.
  One bundle fetch already covers it — the backend bundle query has no section filter.
- Labels auto-derive: `how_it_works.badge` → `How It Works · Badge`.

> Keys must stay in sync with the `t('key', 'default')` call sites in
> `components/company-website-preview/sections/*.tsx`.

### 68. Footer quick-links were untranslatable by design

Footer link lists store **bare slugs** (`features`, `gallery`, `terms-of-service`).
- Slug matches a page → renders that page's title (already translatable) ✓
- Slug matches nothing → rendered a label **derived from the slug string** — text existing in no
  table, so untranslatable ✗

That's why list *headings* translated but the links under them stayed English.

Fix: `footer` FIELD_CATALOG entry gained an `extract()` registering a `quick_link.<slug>` key per
link (including the `['home','features','templates','gallery','contact']` fallbacks that render
when nothing is configured). `buildFooter` in `preview-shared.ts` reads the override off the
already-translated footer record. Verified end-to-end with real Tamil data.

### 69. Builder form consistency — loaders + preview modals

**Preview moved into a Live Preview modal** (Hero Section pattern) for the 3 forms that had it
pinned as a permanent right column: **Features**, **Pricing Plans**, **Templates**.
On Templates only the preview card moved — the "Tips" card stays as the sidebar.

**Full-screen `PageLoader` added to 14 forms** that previously showed only a spinner inside the
Save button: features (form + list), templates, pricing-plans, video-tutorial form + its 4 taxonomy
pages, gallery, login-demo, clients, sponsors, contact-us, how-it-works, faq-form, faq-categories.

> Near-miss worth knowing: while extracting the Templates preview block, a cleanup step deleted the
> temp file holding those 71 lines *after* they were already cut from the source. Recovered exactly
> from `git diff`. If a similar extract-and-move is needed, **write the block somewhere durable
> before deleting it from the source.**

### 70. Verification status

`tsc --noEmit` clean · `next build` compiled · backend modules load · 61 ui-chrome keys confirmed
via API · footer `quick_link.*` keys confirmed · bundle endpoint returns both overlays correctly.
All temporary DB test rows and scratch scripts removed.

### 71. TODO next session

1. **Commit + push both repos** (§63) — nothing works in production until this happens.
2. Re-test the reported flows on production after Vercel/Render redeploy.
3. Consider deleting dead `_components/pricing-plans-content.tsx` (§65).
4. Run **Translate All** for Tamil to populate the new `ui-chrome` (61) and `footer.quick_link.*`
   keys — they're registered but have no translations yet.

---

## Session 7 — §71 cleared, DB-backing the mock pages, translation correctness & staleness

> **Date:** 2026-08-10 | Continues from Session 6 (§26–71)
> **Status:** §71 done. Large bug-fix sweep on top. **Only part of this is pushed — see §72.**

### 72. ⚠️ What is and isn't deployed

Mid-session the user committed and pushed both repos:

```
Frontend  655e322   Backend  705eb76      (both level with origin/main)
```

That covers §73–§76 only. **Everything from §77 onward is uncommitted.** Production DB changes,
however, were applied directly and ARE live — see §80 and §84. So production currently runs older
code against a newer schema, which is safe (the column is additive) but means the "Needs review"
UI and the manual-edit protection are not visible there yet.

### 73. §71.3 — dead component deleted

`_components/pricing-plans-content.tsx` (117 KB, zero references) removed. The real page is
`pricing-plans/create/page.tsx` (§65).

### 74. §71.2 — six mock-state admin pages made DB-backed

These pages showed hardcoded sample data, never read the DB, and their Save buttons were
`setTimeout` fakes. All six now read and write real rows, and carry `RowTranslateButton`:

| Page | Table | Section |
|---|---|---|
| `clients/page.tsx` | `company_website_clients` | `clients` |
| `sponsors/page.tsx` | `company_website_sponsors` | `sponsors` |
| `gallery/categories/page.tsx` | `company_website_gallery_categories` | `gallery-categories` |
| `contact-us/categories/page.tsx` | `company_website_contact_categories` | `contact-categories` |
| `pages/page.tsx` **+ `pages/create/page.tsx`** | `company_website_pages` | `pages` |
| `_components/simple-slider-content.tsx` | `company_website_sliders` + `_slider_items` | `sliders` |

**All writes go through per-item create/update/remove.** The bulk `replace` mutation is never used:
`replaceList()` in `companyWebsiteBuilder.service.js` really is `DELETE … WHERE company_id` followed
by re-INSERT, which reassigns auto-increment ids and orphans every translation addressed by
`record_id` (§64). Confirmed by reading the implementation, not assumed.

Two things found while doing this:

- **The pages create/edit form was mock too**, so the list's Edit pencil led to a form that loaded
  nothing and saved nothing. Now handles `?edit=<id>` and, after a create, `router.replace`s to the
  new id rather than navigating away (§66 pattern).
- **Slider items had no write routes** — only `GET /slider-items` existed. Added
  `POST /slider-items`, `PUT /slider-items/:id`, `DELETE /slider-items/:id` using the existing
  per-item factories.

Also: gallery categories' "Images" count is now real (counted from gallery items), and the slider's
"Select Page" dropdown lists actual pages instead of four hardcoded paths.

> Verified with a slot check across all six sections: registered `record_id`s match the content row
> ids exactly, `page_slug=''` throughout, **0 mismatches** (the §33.1 trap).

### 75. §71.4 — Translate All for Tamil

| | Keys created | Notes |
|---|---|---|
| Local | 64 | exactly the 61 `ui-chrome` + 3 `footer.quick_link.*` |
| **Production** | **302** | far more than expected — see below |

**Production had only 110 registered keys vs local's 387.** The key registry is built by
`syncKeysFromContent`, which only runs when someone opens a Translations/Languages endpoint — and
nobody had since the §67/§68 deploy. Running the sync took production to 410 keys, so Translate All
then had 302 to fill, not 64. 0 failures, well inside the 50k/day quota.

> **Takeaway:** after deploying anything that adds to `FIELD_CATALOG` or `UI_CHROME_KEYS`, the
> production registry is stale until an admin page is opened or a sync is run explicitly.

### 76. Public site was ignoring translations for whole sections

The user reported "I save Tamil but live still shows English". Three distinct causes:

1. **Plan features matrix** — `PlanFeaturesComparisonSection` self-fetches via
   `usePricingMatrixFeaturesData()`, so the data-layer overlay in `company-website-preview.tsx`
   never touched it. It now applies `translator.many('pricing-features', …)` itself, the way
   `PageHeroSection` does. **It was the only self-fetching section without a translator** (checked
   all 17).
2. **Contact information** — `contact-settings` was not in `FIELD_CATALOG` at all, so the address
   was never translatable, and `buildContact` received the raw record. Added the catalog entry
   (`address` only — email/phone/coords read the same in every language) and wrapped the record in
   `translator.one('contact-settings', …)`.
3. **Template category pills** — `category_name` is joined onto the template row, so it is not a
   translatable field of the `templates` section. Pills now resolve through
   `translator.field('template-categories', category_id, 'name', …)`, falling back to the English
   join.

### 77. Contact Us was a **seventh** mock page

`contact-us/page.tsx` showed hardcoded `jamal@gmail.com` / `9884699435` / `'company address f...'`,
never read the DB, and its Save did nothing. That is *why* it had no translation — no saved record
means no `record_id` means no slot. Rebuilt on `useCompanyContactSettings()` with the full
hero-style translation mode (`TranslationSideCard` + `TranslationModeBanner`, non-text fields
dimmed via `sharedOnly`).

> **Production had no contact settings row at all.** Saving the page creates one. When the user did
> that, it saved *empty* strings — which produced the two bugs in §78.

Also noted, not fixed: `company_website_contact_settings` has **duplicate rows locally** (ids 1 and
2, the same seed-twice timestamps as §35). §35's cleanup covered `basic_information`,
`hero_sections`, `footer_settings` and `seo_settings` but **missed this table**, so it also never
got the `uniq_company_website_singleton` index.

### 78. Two bugs behind "0/1 but Translate does nothing"

1. **`registerKeys` created phantom keys.** It inserted a key even when the field's English value
   was empty, so the language card read "0/1" for a section with nothing translatable. It now skips
   empty fields and deletes a key whose value has become empty. Only the key row is removed —
   translations are preserved and re-adopted (§33.4).
2. **Auto-translate failed silently with no source text.** It streamed zero events, flashed "0%"
   and closed, which reads as a broken button. `autoTranslate` now refuses up front with
   *"There is no English text in this section yet…"*.

### 79. Manual edits were being destroyed by the per-section button

**The two translate buttons behaved differently:**

| Path | Overwrote a hand-edited translation? |
|---|---|
| Translations module edit dialog | Yes (correct — a person is editing) |
| Section form / row dialog → Save | Yes (correct) |
| **"Translate from English"** (per section) | **YES — silently destroyed it** |
| "Translate" (Languages page, Translate All) | No — always checked `status='reviewed'` |

`autoTranslateContent` re-translated **every** field in the section and saved them all as `auto`.
`translateAllToLanguage` had the guard; this path never did.

Fixed: fields whose existing translation is `status='reviewed'` are excluded from the run entirely
(their row is not rewritten, so the status survives). Progress counts only what will actually be
sent, and the completion toast reports *"Kept N fields you edited by hand."*

> **This mattered more than it first looked: production has 109 `reviewed` translations.** Every one
> of them was one button press from being overwritten.

Verified against real data: seeded a sentinel as `reviewed`, ran the exact code path, confirmed the
value survived, then restored it.

### 80. Stale translations — the "Needs review" system

Question that exposed the gap: *if I hand-correct a Tamil string and then change the English, what
happens?* Reproduced it — **the Tamil silently stays, now describing the old English**, because
protection (§79) cannot distinguish "leave my wording alone" from "this is now wrong".

**Schema change** — `source_value TEXT NULL` on `company_website_content_translations`, holding the
English each translation was written from. Migration `scratch/add_translation_source_value.js`
(dry-run by default, `--apply` to write, `prod` for production).

> Backfilled every existing row with its key's *current* English, i.e. treated as in-sync. Correct
> today, and it avoids flagging ~500 rows as stale the moment it ships.
> **Applied: local 461 rows, production 499 rows.**

Behaviour now differs by authorship:

| Translation | English changes | Result |
|---|---|---|
| `auto` | → | **re-translated automatically** — no human work at risk |
| `reviewed` | → | **kept, and flagged ⚠ Needs review** |

- `saveContentTranslations` stamps `source_value` on every write.
- `listKeys` returns `is_outdated` per translation; null snapshot = not outdated (pre-column rows).
- `getStats` returns an `outdated` count per language (joined against the keys table).
- `translateAllToLanguage` refreshes stale `auto` rows instead of skipping them — previously an
  auto translation also went stale forever once its English changed.
- Translations page: **⚠ Needs review** status + filter, and an orange count on each language card
  (hidden at zero).

Verified end to end: hand-edit → change the real English in the content table → Translate All →
`outdated=true`, value preserved, `STATS outdated=1`.

> **Testing note worth keeping:** an early version of this test edited `default_value` in the keys
> table directly and reported false FAILs — `translateAllToLanguage` calls `syncKeysFromContent`
> first, which rewrites `default_value` from the content tables. **To simulate an English change you
> must edit the CONTENT table.** A test must also re-sync after restoring, or it leaves the derived
> key cache stale and poisons the next run.

### 81. Delete Language now states what it destroys

Delete is unchanged in behaviour (default language still protected; translations then language row
deleted, permanently). The confirmation now reads real numbers from `getStats`:

> *Delete Tamil? This permanently removes 501 saved translations. 109 of them were edited by hand
> and cannot be recreated by auto-translate. This cannot be undone. To hide the language from your
> site but keep its translations, switch it to Inactive instead.*

Empty languages get a short, non-alarming variant. **Advice recorded for the user: use the Active
toggle, not Delete** — same effect on the public site, data preserved.

### 82. Hardcoded UI chrome sweep — 61 → 114 keys

Whole sections were still English because the strings were typed into the components rather than
going through `t()`.

| File | Strings wrapped |
|---|---|
| `templates-section.tsx` | 16 — search box, colour/category/item filters, Filter, All Templates, **Preview**, **Use Template**, Load More |
| `login-demo-section.tsx` | 25 — And Much More + its six chips, Ready to Create…, the closing banner, Still Have Questions, Contact Support, Book a Demo, Create Custom Template, Fully Customizable, No Coding Required, View How It Works |
| `pricing-section.tsx` | Monthly Billing, `/ month`, `/ year`, group headings + subtitles, table header, five tier labels |
| `features-section.tsx` | section description |
| `video-tutorials-section.tsx` | 2 headings |

Three traps hit while doing it:

1. **Seven components had no `t` in scope.** `login-demo-section.tsx` holds eight layout variants
   and only two used the hook — the page would have crashed on load. Same for
   `TemplateGridGallerySection` and `VideoTutorialsSectionBase`.
2. **Key collision.** `templates.all_categories` already existed for the "All Templates" pill; the
   filter dropdown needed "All Categories". Same key, two different English strings — one would
   have silently won. The new one is `templates.filter_all_categories`.
3. **`t` shadowing, twice.** `TIERS.map((t) => …)` in both the pricing table header *and* its body
   shadows the translation function. Renamed to `tier` in both. The body one was not yet broken —
   it would have broken for whoever next added a translation inside a cell.

All 114 `ui-chrome` keys translated on **both** databases.

### 83. Bullet lists were DB content, not chrome

The bullet lists under feature cards and pricing plans are admin-entered but were in no catalog:

- `company_website_features.bullet_points_json` → `bullet_1`, `bullet_2`, … (1-based)
- `company_website_pricing_plans.features_json` → `feature_1`, `feature_2`, …

Both are plain JSON string arrays. Added `extract()` entries using a new `jsonStringArray()` helper
that tolerates parsed-array vs raw-string and drops blanks.

Frontend counterpart: `NESTED_FIELD_KEYS` changed from a `Set` to a **predicate** (the indexed keys
are open-ended), and `writeIndexedArray()` writes the translated values back into the JSON column.
The change-detection snapshot was generalised from hero's two named columns to the whole record.

> **Positions are 1-based on both sides and must stay that way**, or translated text lands on the
> wrong bullet. Reordering a list re-points its translations — the same trade-off every JSON-backed
> section makes.

### 84. Navbar overflowed once translated

Tamil labels run roughly 2× the English width, so the header pushed "Get Started Free" off the
right edge. Every element in the row was `shrink-0` + `whitespace-nowrap`, and the existing overflow
mechanism counts **items** (`VISIBLE_LIMIT = 7`), not width — seven short English words fit, seven
long Tamil ones do not.

Fixed in `header-section.tsx`: the link row is `min-w-0 flex-1` so it absorbs the squeeze instead of
displacing the CTA, anything that still doesn't fit scrolls inside that row (no link becomes
unreachable), gaps/text tighten at `lg` and restore at `xl`, and the brand wordmark hides below
`xl` and truncates. Language-agnostic, not a Tamil patch.

### 85. Highlights settings were saved but never read

`items_per_row`, `icon_style`, `title_color` and `description_color` are all editable in
`highlights-content.tsx` and were **ignored entirely** by `highlights-section.tsx`. Two more:

- **The common icon colour was discarded if it equalled the shipped default** —
  `config.icon_bg_color !== '#F3F0FF' ? … : pastel` — so picking that exact colour did nothing.
- **The gradient banner (instance 2) hardcoded white** icons and text, ignoring every picker. That
  is the block in the user's screenshots.

All three layouts (individual cards / gradient banner / white bar) now share one
`resolveIconColors(item, idx, fallback)`: **per-item colour → block colour → branch default**, with
`icon_style: 'outline'` rendering a ring instead of a fill. `items_per_row` drives both the grid
column class (lookup table — Tailwind needs whole class names) and the `slice()`. The banner keeps
white as its default so unconfigured blocks are unchanged.

### 86. Smaller fixes

- **How It Works → Edit Step modal** now has a `RowTranslateButton` (the list rows had one, the
  modal didn't). Uses the row-dialog pattern deliberately — a `?lang=` round-trip would close the modal.
- **Add FAQ** used to `router.push` to the list on create, so a new FAQ never had a screen where the
  language card could appear. Now `router.replace`s to `faqs/edit/<newId>` (§66).
- **Empty `src=""` guard** and Live-Preview modal consistency carried over from §60 where relevant.

### 87. Verification

`tsc --noEmit` clean · `next build` compiled (137 pages) · backend modules load · slot check clean
across all six newly-wired sections · manual-edit protection and stale-flagging both proven against
real data with restore-after · all temporary scratch scripts removed
(`add_translation_source_value.js` deliberately kept).

### 88. Open — carried to next session

**Reported by the user, not yet fixed:**

1. **Public navbar drops "Home"** — 5 of 6 items render. *Ruled out:* all 6 rows exist with
   `is_visible=1`/`is_active=1` and correct sort; `getList('menuItems')` returns all 6 on
   production; all 6 have Tamil labels including `Home → முகப்பு`; `translator.many` never drops
   records; the header has no Home special-case and its limit is 7. **Cause not isolated.**
   *Fastest next step: check whether Home appears in **English** — if yes the fault is in the
   translation overlay, if no it is the menu render.*
2. **Nav Menu admin — Login / Get Started toggles do nothing.** Unverified expectation: saved but
   never read by the public header (same class as §85).
3. **Nav Menu admin — no translation wiring** (no `useSectionTranslation`), like Contact Us was.
4. **Templates shows Tamil 1/2** — Description not translating. Likely not a bug: the scan skips
   empty values and that template's Description is blank (`0/200`). Confirm before treating as one.

**Found during audit, not reported:**

5. **Comparison-table cell values never translate** — "Up to 50", "Limited" live in
   `plan_values_json`, registered nowhere. Needs an extractor like §83.
6. **Nine of seventeen preview sections have no `min-w-0` / `break-words`** (faqs, features,
   gallery, hero, logo-wall, pricing, slider, templates, video-tutorials). This is why Tamil pricing
   cards look cramped and the "most popular" badge overlaps the card edge. Same root cause as §84.
7. **Hardcoded English fallbacks render when tables are empty** — 7 in `pricing-section.tsx`, 10 in
   `highlights-section.tsx`. Untranslatable because they exist only in code.
8. **Data bug:** a pricing plan is named `நட்சத்திர உதயம்Description` — stray "Description"
   concatenated onto the plan name.
9. **`contact_settings` duplicates + missing UNIQUE index** (§77).
10. **RTL:** the languages table stores `direction` and the preview sets `dir`, but layouts use
    physical CSS (`left-3`, `pl-9`, `text-left`). Tamil is LTR so nothing breaks yet; the first RTL
    language will render mirrored-wrong.
11. **`is_outdated` is surfaced only on the Translations page** — not in the row dialog or the
    section language card, which read a lighter shape without status.

**Deployment:** §77 onward is uncommitted. The production `source_value` column and all Tamil
translations ARE already live in the database.

---

## Session 8 — Nav Menu Login / Get Started toggles

> **Date:** 2026-08-10 | Continues from Session 7 (§72–88)

### 89. §88.2 — Login / Get Started toggles now actually hide the buttons

The §88.2 guess was right: **saved but never read** — the same class as §85.

The whole write path was already correct and needed no change:
`nav-menu-content.tsx` sends `show_login` / `show_signin` → `TABLE_COLUMNS.basicInformation`
whitelists both → `upsertSingleton` writes on `!== undefined`, so a `0` persists →
`parseHeaderSettings` in `preview-shared.ts` already parsed them into `header.showLogin` /
`header.showSignIn`.

**`header-section.tsx` simply never consumed those two fields.** Both buttons were rendered
unconditionally, so the switches looked dead no matter what was saved. Each button is now gated on
its flag, and the auth/language cluster only renders when at least one of the three (language
picker, Login, Get Started) is enabled — otherwise both toggles off on a single-language site left
an empty flex slot beside the nav.

Verified against real data, not by reading: flipped `show_login`/`show_signin` to `0` locally and
confirmed `GET /website-builder/basic-information` returns `0` (not dropped or coerced anywhere in
the chain), then restored both to `1`. `boolValue(0, true)` → `false`, which is what the new gate
reads. `tsc --noEmit` clean; `next build` compiled.

> The two toggles are independent: "Login" controls the Login button only, "Get Started" controls
> the Get Started button only. There is no separate Signup button in the header — Get Started *is*
> the signup CTA.

**Still open from §88:** the Nav Menu admin page has no translation wiring (§88.3) — that is the
second annotation on the same screenshot and was not touched here.

### 90. ⚠️ §85 was never deployed — that is why Highlights "doesn't work"

Reported: on Highlights (home, instance 1) the **Icon Style** select and the four **Colors &
Presets** pickers do nothing.

`git status` on the frontend told the story: `highlights-section.tsx` — the entire §85 fix that
made the public section *read* those settings — was **uncommitted**, so production has never run it.
Same trap as §63. Everything else from Session 7 has since been committed (HEAD `8cef1cb`); only
this file and §89's `header-section.tsx` were outstanding.

> **Check `git status` before re-debugging any "still broken" report.** This is the second time a
> session has burned effort on a bug that was already fixed but not shipped.

Two *genuine* defects were found underneath it, both of which would still have been there after
deploying §85.

### 91. Per-item icon colours silently and permanently shadowed the block colours

Production `home/1` has an icon colour on **all 5 items**. `resolveIconColors` resolves
per-item → block → default, so the block-level **Icon Background** and **Icon Color** could never
apply to any of them. Changing those pickers really did nothing, deploy or no deploy.

What made it a trap rather than a preference:
- The per-item swatch renders the *resolved* colour (`item.icon_color || settings.icon_color || …`),
  so an override and an inherited value look identical.
- `<input type="color">` writes on any interaction, so an override is set by merely opening the
  swatch — no intent required.
- Nothing could clear one. `handleItemChange` only ever assigns.

Fixed in `highlights-content.tsx`: an overridden swatch is now outlined, its tooltip says so, and a
revert button on that row deletes both keys so the item follows the block again. Added a line under
"3. Colors & Presets" stating the precedence.

### 92. `items_per_row` was deleting cards from the live site

`items.slice(0, perRow)` (all three layout branches). With production's `items_per_row: 3` and 5
cards, **the public site rendered 3 and dropped 2** — while the admin's own Live Preview modal maps
`settings.items` with no slice and showed all 5. A setting labelled "Number of Items per **Row**"
was acting as a cap.

Slice removed; `perRow` still drives the grid column class, so extra cards wrap onto the next row —
matching both the label and the admin preview.

### 93. Nav Menu translations (§88.3) — the missing UI was the smaller half

Backend was already complete: `FIELD_CATALOG['nav-menu']` registers `label` per menu row at
`page_slug='', record_id=<row id>`. Only the admin UI was missing.

**But wiring a dialog onto that page would have been useless**, because Nav Menu saved through the
bulk `PUT /menu-items` → `replaceList()` → `DELETE … WHERE company_id` + re-INSERT. That reassigns
auto-increment ids on **every save**, and translations are addressed by `record_id`. This is §64's
bug, never fixed for menu items.

Production proves it — 12 nav-menu translations for 6 menu rows:

```
menu item ids     137 138 139 140 141 142
translation rows  131…136  (orphaned)  +  137…142  (live)
```

One id block per bulk save. The Tamil labels were being written correctly and detached on the next
unrelated save.

Fixed in three parts:
1. **Backend** — added `POST /menu-items`, `PUT /menu-items/:id`, `DELETE /menu-items/:id` using the
   existing `createItem` / `updateItem` / `deleteItem` factories (the §74 slider-items pattern). The
   bulk route stays for reorder-style callers.
2. **`nav-menu-content.tsx`** — Save now diffs and writes per item. It also **keeps the row id**:
   the load effect overwrote `id` with the page slug (`'home'`, `'features'`) for pageOptions
   matching and threw the DB id away — the §33.2 / §46 bug class for the third time. The id now
   rides along as `dbId` on `DraggableItemListItem`.
3. **`RowTranslateButton`** per menu row, via a new `renderActions` render prop on
   `DraggableItemList`. Row dialog rather than the `?lang=` form mode: every row is its own slot,
   and a URL round-trip would also throw away unsaved reordering.

Verified against the local DB: ran the new per-item save path over all 7 menu rows, ids unchanged
(`20,21,22,23,24,25,26` before and after), 7/7 translations still resolving.

> Production still carries the 6 orphaned rows at `record_id` 131–136. Harmless (§33.4 keeps
> translations so they re-adopt), but dead. **Not cleaned — needs a decision.**

### 94. "Translation is not working, all fields all modules" was the badge lying

The Templates report (`Holy`, Tamil showing **1/2**) is §88.4, and it was not a translation failure.
Production data:

```
template 17 "Holy"   description length 0   keys: 17/template_name only
                                            translation: தீபாவளி கொண்டாட்டம் ✓
```

One translatable field, one translated. The card said 1/2 because `total` was `fields.length` — the
*form's* field list — while the backend only registers keys for fields that **have** English text
(§78) and deletes a key whose text becomes empty. Any record with an optional field left blank read
as permanently incomplete. This is the misleading badge §45 spotted and left in place.

Fixed in both counters — `translation-side-card.tsx` and `row-translate-dialog.tsx` now count only
fields with non-empty English source, so "Holy" reads 1/1 and goes green.

**Two real data bugs seen while checking (production, not fixed):**
- `templates/10` ("Traditional") is translated to the literal word `Description`.
- `templates/15` ("Baby Shower") is translated to `seemantha` — MyMemory corpus junk (§30).

### 95. Verification

`tsc --noEmit` clean · `next build` compiled · backend route module loads · new menu-item routes
answer `401` not `404` (registered, auth-gated) · id-stability proven against real rows with
restore-after. The temporary test script was removed.

**Uncommitted:** 7 frontend files + 2 backend files. Nothing here is on production yet — including
§85, which still isn't.

> **Update:** the user has since pushed both repos — frontend `a99d1ab`, backend `fdb398b`, both
> level with origin/main. §85 and §89–§94 are now deploying. §96 below was written against the
> **old** deployed build, which is why it looked broken.

### 96. "Translate from English" never re-synced the key registry — the real Features bug

Reported: on Features edit in Tamil mode, the title field is empty (`0/50`, English as placeholder)
and the public site renders that card's title in English while its siblings are Tamil.

`autoTranslateContent` called:

```js
const keys = await listKeys(companyId, { section, page_slug, record_id });   // no sync!
```

The key registry is **derived** from the content tables and only rebuilt when something asks
(§75). Without `sync: true` this run sees a stale snapshot, which produces exactly two symptoms:

1. A field the admin has **just filled in** has no registered key, so it is not in `keys`, gets no
   entry in `values`, and is never written. The button appears to work — progress runs, toast says
   "Translated" — but that field stays empty forever and the site keeps showing English.
2. A field whose English was **edited** is translated from the OLD `default_value`. Production
   showed this directly: feature 215's key held `"Beautiful Templates "` while the content row said
   `"Beautiful Templatesst"`.

`translateAllToLanguage` (the Languages-page button) has always passed `sync: true` — which is why
the two buttons behaved differently and why "Translate All" appeared to fix things that the
per-section button could not.

Fixed by passing `sync: true`. Proven twice against real data, both restore-after:
- Filling a previously-empty `detailed_description` and listing keys: without sync the field is
  absent, with sync it appears.
- Running the real `autoTranslateContent` on that row: the newly-filled field came back as
  `"ஒவ்வொரு நிகழ்விற்கும் நேரடி பட்ஜெட் கண்காணிப்பு."` instead of being skipped.

> Cost is one content scan per button press, the same one the Languages page already does, ahead of
> API calls that are throttled to 350ms each anyway.

### 97. Highlights "only the customised colour shows" — §85 again, plus a booby trap

Production `template/1` (row 35) at the time of the report:

```
block  icon_style: outline   card_style: individual   icon_bg_color: #ffffff   icon_color: #271111
       title_color: #ffffff  description_color: #fafcff
items  1–4 no per-item colour · 5 "One Click Import" icon_bg #010005
```

Four pastel circles and one black one is precisely what code **without** `resolveIconColors`
produces: block-level colours ignored, per-item colours the only thing honoured. Confirmed by
`git show 8cef1cb:…highlights-section.tsx | grep -c resolveIconColors` → **0**. So this was §85
undeployed, not a new defect, and the user's push resolves it. No code change.

> ⚠️ **But shipping it will make two blocks unreadable.** Those colour fields were set while the
> code ignored them, so nothing warned the admin:
>
> | Row | title/description colour | renders on | result |
> |---|---|---|---|
> | `template/1` (35) | `#ffffff` / `#fafcff` | `bg-white` individual cards | **invisible** |
> | `features/1` (32) | `#ffffff` / `#ffffff` | default gradient `#F3F0FF→#FFFFFF` | **invisible** |
>
> `home/1` (white on a blue→red gradient) and `home/2` are fine. Left alone deliberately — these are
> the admin's own colour choices on production data, and now that the pickers actually work they can
> be corrected from the UI in a few seconds. Flagged, not silently overridden.

### 98. Verification

`tsc --noEmit` clean · `next build` compiled · backend modules load · both translation fixes proven
against live rows with restore-after · local DB confirmed back to its original state (feature 15
`detailed_description` null, 2 translations, 2 keys) · scratch scripts removed.

---

## Session 9 — Translation module finished: flow change, data cleanup, speed

> **Date:** 2026-08-11 | Continues from Session 8 (§89–98)

### Today Status

```
Completed   Translation Module
Working     Manual Translation Update — Skip Version
```

**Completed — Translation Module**
- One save translates into **every** active language (was: one language per button press)
- Saving English auto-translates; the button is now only a manual re-run
- Two-email MyMemory pool with quota failover
- All hardcoded UI strings in Login & Demo wrapped and translated
- Pricing bullets + comparison table made translatable (were structurally impossible before)
- Footer address, feature bullets, plan-feature cell values now editable per language
- Corpus-junk detector + repair; dead/orphaned rows removed from both DBs
- Translations page 47s → ~2s on repeat load

**Working — Manual Translation Update, Skip Version**
- Translation is never re-synced: only EMPTY slots are ever filled
- A saved translation is never overwritten — not by an English edit, not by a re-run
- Whoever changes the English decides whether the other languages need changing, and edits them
  directly. The system does not track, flag or auto-fix that (staleness tracking removed — §102)

---

### 99. THE flow change — translate all languages, never re-sync

Two rules replaced the old behaviour, on the user's explicit instruction:

1. **One press fills every active language.** `autoTranslateContent` defaults to `all_languages: true`
   and resolves every `is_default=0 AND is_active=1` language. Previously it translated only the
   language in `?lang=`, so a section written today was translated only where the admin happened to
   be looking.
2. **Only EMPTY slots are filled.** An existing translation is never re-translated — regardless of
   `status`, and regardless of whether its English has since changed. `translateAllToLanguage` lost
   its "refresh stale auto rows" branch.

> Re-saving while editing therefore costs no API quota for text already translated. The first save
> after writing new text is the slow one.

### 100. Auto-translate on SAVE — the button is no longer the primary path

The user expected saving English to already produce the other languages. It did not: `registerKeys`
only wrote key rows, and translation happened solely on a button press.

`useSectionTranslation` gained `translateAfterSave(overrideRecordId?)`, wired into **all 12 forms**
(seo, footer, login-page, contact-us, highlights, hero-section, testimonials, faqs, features,
templates, video-tutorials, pricing-plans). Blocking, with the existing full-screen progress overlay
— chosen deliberately over a background run so the result is visible.

Four things that needed care:

- **Create vs edit.** On create the row id exists only in the mutation response; the hook's
  `recordId` closure is still `undefined`. Without passing it explicitly, every newly created record
  would silently skip translation (the §45 guard).
- **The overlay did not exist in English mode.** It is rendered by `TranslationModeBanner`, which
  returned `null` outside translation mode — exactly when an English save runs. It now renders in
  both modes; only the banner itself is mode-specific.
- **A failed translation must not look like a failed save.** The post-save path runs `silent`:
  "nothing to translate" stays quiet, and a real failure reports *"Saved, but translating failed"*.
- **Navigation raced the run.** FAQ and video-tutorial edit both `router.push` to the list on
  success, tearing down the SSE stream. They now translate first, then navigate.

> §109 found this was still wrong for FAQ *create* — same class, different route.

### 101. Two Gmail accounts with quota failover

`MYMEMORY_EMAIL` now accepts a comma-separated list. A quota error retires that address and retries
the same request on the next one; spent addresses reset at UTC midnight. In-memory only, so a restart
just re-tries the first address at the cost of one request.

> **A real bug was blocking this.** When the daily allowance is spent, MyMemory answers
> `responseStatus: 200` and puts the warning in `responseDetails`, echoing the English back as the
> "translation". The old code checked the 200-success branch FIRST, so that echo was saved as a real
> translation and quota was never detected — nothing could ever have triggered a failover. The quota
> check now runs before the success branch, and matches the plain-English wording
> (`ALL AVAILABLE FREE TRANSLATIONS`) as well as the word `QUOTA`.

Proven with a stubbed API: first → quota → second → success, and the next call skips the dead
address. **Not yet set on Render** — production still runs one address at 50k chars/day.

### 102. Staleness tracking removed entirely — and two columns dropped

The ⚠ Needs review flag, `is_outdated`, the per-language `outdated` count and the `source_value`
column are **gone**. Under §99's rule nothing auto-fixes a stale translation, and the user's position
is that whoever edits the English is responsible for the other languages.

**Columns dropped from both DBs:**

| Column | Why |
|---|---|
| `company_website_content_translations.source_value` | Its only reader was `is_outdated` |
| `company_website_translation_keys.field_type` | Written on every insert since day one, **read by nothing** |

> Dropping `field_type` would have broken **every** key registration — `registerKeys` still wrote it
> in both its INSERT and UPDATE. Caught before shipping. The obsolete
> `add_translation_source_value.js` migration was deleted (re-running it would re-add a dead column)
> and `field_type` removed from the table-creation script so a fresh install matches.

### 103. Production DB latency — the "it runs for an hour" bug

Measured from the dev machine to Aiven: **~374 ms per query round-trip** (local MySQL is
sub-millisecond). `registerKeys` did a SELECT plus an INSERT/UPDATE **per field** — ~1,000 sequential
round-trips for a ~500-key sync. That is 6+ minutes on production and 3 seconds locally, which is
exactly why it never showed up in testing.

Batched into chunked `INSERT … ON DUPLICATE KEY UPDATE` (the `uniq_key_slot` and
`uniq_translation_slot` indexes already existed):

```
sync   LOCAL  2.9s -> 0.2s          (470 keys, stable across runs)
sync   PROD   6+ min -> 34s
```

Also added `skipSync` so a multi-language run does not rescan per language.

> **Takeaway: never conclude "it's fast" from a local run.** Any `for (row of rows) { SELECT; WRITE }`
> loop is ~750ms per row against production.

### 104. Data cleanup — and why deleting junk does NOT work

Removed from production: **15 orphaned rows** (no key at that slot), **2 stale `auto`**, **~4 corpus
junk** = 21 total. Local: 1. `getTranslationBundle` selects straight from the translations table with
NO join to the keys table, so an orphaned row is still shipped to the public site — it simply does
not match a slot the page asks for, until an id or JSON index is reused.

> **The important discovery:** deleting corpus junk does not fix it. MyMemory returns the *same*
> garbage for the same input, so the next translate run recreated `"seemantha"`, `"Description"` and
> `"SharingName"` byte-for-byte. Under the never-overwrite rule the durable fix is to save the
> correct value as `status='reviewed'`, which is then permanent.

**New junk class found — trailing Latin text welded onto a good translation:**

```
"இசை இயக்கிName"           <- Music Player
"தனிபயன் பக்கங்கள்Comment"   <- Custom Pages
"நட்சத்திர உதயம்Description" <- §88.8, logged as an English content bug; it was this
```

`scratch/fix_trailing_latin_junk.js` detects non-Latin script running straight into ASCII letters
with no space (real prose never does that), strips the suffix and saves as `reviewed`. Repaired 3 on
production, 2 locally; both DBs now scan clean.

Also finished §77: `contact_settings` duplicate removed and `uniq_company_website_singleton` added on
both DBs.

### 105. Sections that could never be translated

| What | Why it was impossible | Fix |
|---|---|---|
| Plan bullets | `features_json` holds `{label, included}` objects on prod (plain strings locally); `jsonStringArray` mapped every object to `''` — **0 keys registered** | Read `label`/`text`/`title`/`name`/`value` from object entries |
| Comparison table | `company_website_pricing_matrix_features` had **0 rows on both DBs**; the admin page seeds `useState(DEFAULT_MATRIX_FEATURES)` so 7 features *looked* saved but never were (the §45/§46 trap), and the public section fell back to its own hardcoded copy | Seeded the 7 rows on both DBs |
| Comparison **cell values** ("Up to 50", "Limited") | Live in `plan_values_json`, registered nowhere (§88.5) | `limit_<tier>` extractor, keyed by tier name not position |
| Footer address | `buildFooter` prefers `footer_settings.address`, which was **not in the footer catalog** — only `contact-settings.address` was | Added to the catalog **and its `extract()`** |
| Login & Demo (14 strings) | The block had its **own hardcoded copy** of the subtitle; the `ready_subtitle` key was translated all along and nothing read it | Wrapped 14 strings, 10 new chrome keys |

> **`jsonStringArray` had a second bug:** `.filter(Boolean)` dropped text-less entries, but callers
> derive the key from the array index (`bullet_3`). One blank entry shifted every later bullet onto
> the wrong key. Now positional.
>
> **The frontend writer would have destroyed the tick/cross:** it returned the bare translated string
> for object entries, throwing `included` away. It now writes into `label` and keeps the rest.

Production went **508 → 581 keys**.

### 106. Admin UI audit — keys registered but not editable

Audited all 21 sections that have keys, comparing what the backend registers against what each admin
form exposes. **Three real gaps** (all the same class: the field list never included them):

- **Plan Features** — had a translate button, but `fields` listed only `feature_name`/`description`,
  never the `limit_*` cell values.
- **Features → Bullet Points** — worse: the whole card was `sharedOnly`, dimmed and click-blocked in
  translation mode. Its comment still claimed bullets were "shared across languages", true before §83
  and wrong since.
- **Footer → link labels** — `quick_link.<slug>` keys existed since §68 with no UI, which is why the
  list *headings* translated while the links under them stayed English.

The other 16 sections were already complete. Highlights and Footer show as "partial" in the audit
script — **false positives**, they build keys dynamically (`item_${position}_title`,
`quick_link.${slug}`) and a literal-string probe cannot see that.

Reported, deliberately not changed: **footer copyright / powered-by are hardcoded constants** in the
form — not editable in English either, so that is a missing feature, not a translation bug.

### 107. Highlights — two dead controls removed

Per the user: different colour per icon, drop the block-level one.

The block-level **Icon Background / Icon Color** could never apply: all 5 items on `home/1` already
carried their own colour, and resolution is per-item → block → default. Changing those pickers was a
guaranteed no-op. (Items acquired their own colour because `<input type="color">` writes on any
interaction — merely opening a swatch set one — and the swatch renders the *resolved* colour, so an
override looked identical to an inherited value.) Removed; icon colour is now set per row only.
Title/Description colour stay — they have no per-item equivalent.

**"Number of Items per Row" removed.** 5 items at 3-per-row rendered 3 + 2 while the mockup shows one
strip. Items now fill a single row sized to however many exist.

> The admin's own Live Preview had no rule for 5 items and fell back to 3 columns — so it would have
> kept showing 3+2 even after the public fix. That preview/live disagreement is how §92 hid.

Affects `home/1` (5 items) and `home/2` (6) on the live site; the other five blocks were already at 6.

### 108. Speed — Website Builder admin was unusable

Measured against the **live server**:

| Endpoint | Before |
|---|---|
| `translation-keys` | **22.8s** (259 KB) |
| `translation-keys/stats` | **12.5s** |
| `translation-keys/sections` | **12.1s** |

All three re-ran the same full content scan — ~47s to open the Translations page. Three causes:

1. **Backend:** a 60s throttle (`syncKeysIfStale`) shared by all three. Translation paths pass
   `freshSync: true` to bypass it — a stale registry there re-introduces §96.
2. **Frontend:** `useWBTranslationKeys` and `useWBTranslationStats` had **no `staleTime`**, so React
   Query's default of `0` refetched everything on every visit.
3. **Search fired a full scan per keystroke** — `search` sat in the React Query key with no debounce,
   so typing five characters queued five 22-second scans. Now filtered client-side; every key is
   already loaded.

Live result after deploy: `stats` 12.5s → **1.8s**, repeat `translation-keys` 22.8s → **2.9s**.

> **Measuring caught one that reading the code did not.** `sections` was still 11.8s because the
> *controller* called `service.syncKeysFromContent()` directly, going around the throttle. Fixed by
> exporting the throttled wrapper. 11.8s → **0.3s**.

### 109. FAQ create never showed its translation

Found by auditing the create paths after the user asked whether a **new** form translates on save.

Create forms save, get a new id, then navigate — and the order matters. Features, Pricing Plans and
Templates `router.replace` to the **same** route with a new `?id=`, so the component never unmounts.
Video Tutorials awaits before navigating.

**FAQ was the exception:** `/faqs/create` → `router.replace('/faqs/edit/<id>')` is a real route
change, so the component unmounted while the translation was starting, taking the progress overlay
and result toast with it. Now translates first, then navigates.

### 110. Verification

`tsc --noEmit` exit 0 · `next build` compiled (137 pages) · backend modules load · key count stable
at 581 across the throttle change · trailing-junk scan clean on both DBs · the real SSE endpoint
exercised against production (filled empty Hindi, `preserved: 2` for existing Tamil, persisted).

> Not browser-tested. The §109 bug was found by reading navigation order, not by clicking — a real
> click-through of each create form is still worth doing.

### 111. Open — carried to next session

1. **⚠ Hindi is ACTIVE on production at 4%** (22/581). A visitor switching language sees mostly
   English. Either translate it (559 fields, 13,604 chars, ~13 min, inside quota) or set it Inactive.
   This also slows every save, since each one now translates Hindi from scratch.
2. **`MYMEMORY_EMAIL` not set on Render** — production still uses one address at 50k chars/day.
3. **Uncommitted:** the `sections` throttle (2 backend files) + the §109 FAQ fix.
4. One Tamil key missing: `templates.template_name` = `"Holy"`.
5. `_components/features-content.tsx` is **dead code** — nothing imports it, same as the file deleted
   in §73. Worth deleting.
6. Footer copyright / powered-by hardcoded in the form (§106).
7. **Schema, honest assessment:** two tables is right, but they are joined on a 5-column composite
   `(company_id, section, page_slug, record_id, field_key)` instead of a `key_id` FK. That single
   choice caused §33.1, every orphan cleaned in §104, and the whole §64/§74/§93 id-reassignment
   family. A real FK with `ON DELETE CASCADE` would make orphans structurally impossible.
   Deliberately NOT done — it rewrites every query in a 1,600-line service plus a data migration.

---

## Session 10 — Required fields were not enforced in translation mode

> **Date:** 2026-08-12 | Continues from Session 9 (§99–111) | **Frontend only, uncommitted**

### 112. A translated form saved happily with its required fields empty

Reported on Templates: open a saved template in Tamil, clear **Template Name** (`*`, `0/100`), press
**Save Translation** → *"Tamil translation for Template saved successfully"*. The public site then
renders that card's name in **English**, because a missing translation legitimately falls back to the
source — so the save looked successful and the site looked untranslated.

**Cause:** `handleTranslationSave` was a pure bypass. Every wired form opens its `handleSave` with

```js
if (await handleTranslationSave(translation, 'Template')) return;   // skips ALL validation below
```

and the English `newErrors` block it skips was the *only* place required fields were ever checked.
`useSectionTranslation.save()` had no validation of its own, so translation mode had none at all.
Same hole in `RowTranslateDialog.handleSave` for the list-page row dialogs.

**Fixed in the two shared components, so every wired form gets it:**

- `TranslatableFieldInput` / `RowTranslateField` / side-card `TranslatableField` gained
  `required?: boolean`, mirroring the `*` the form already shows in English.
- `save()` rejects with the same toast the English path uses
  (*"Please fill in all required fields marked with *"*) and marks the offending keys in a new
  `translation.errors` map. `handleTranslationSave` still returns `true` on rejection — returning
  `false` would fall through to the English save path and write the content row from a translated form.
- Errors clear on typing, on a language switch, and when auto-translate fills the fields.
- Forms feed `translation.errors.<key>` into the red-border className they already had for English.
- The row dialog now renders the `*`, the red border and a per-field "… is required." line.

> **The rule that makes this safe: a required field is only enforced when its ENGLISH source has
> text.** The backend registers no key for an empty English field (§78) and deletes a key whose text
> becomes empty, so requiring a translation for a blank English field would make the form
> unsaveable with nothing the admin could do about it. Optional-in-English stays optional.

**`required` markers added, matching each form's own English validation** — not a blanket rule:

| Form / dialog | Required translation fields |
|---|---|
| templates (form + list dialog) | `template_name` |
| features | `title`, `short_description` |
| pricing-plans | `plan_name` |
| faqs (form + list dialog) | `question`, `answer` |
| testimonials (form + row dialog) | `customer_name`, `event_name`, `feedback` |
| video-tutorials (form + list dialog) | `title`, `short_description` |
| hero-section | `title` (its label was the literal string `"Title *"` — now a real `required` prop) |
| how-it-works dialogs (row + modal) | `title`, `description`, `highlight_title`, `highlight_subtext` |
| clients / sponsors / pages / nav-menu / pricing-features | the row's name/title/label |
| template-, faq-, gallery-, contact-, video-tutorial-\* categories | `name` |

**Deliberately left with no required fields:** seo, footer, login-page, contact-us, highlights and
sliders — none of them validates anything in English either, so enforcing only in translation mode
would make the Tamil form stricter than the English one. `_components/features-content.tsx` skipped:
it is dead code (§111.5).

> **Backend unchanged and still permissive.** `PUT /content-translations` must keep accepting empty
> values — that is how an *optional* translation is cleared. "Required" is a property of the form's
> field list, which exists only on the frontend; there is no backend notion of it to enforce.

Verified: `tsc --noEmit` exit 0 · `next build` compiled. Not browser-tested.

---

## Session 11 — Public-site fixes

> **Date:** 2026-08-13 | Continues from Session 10 (§112) | **Frontend only, uncommitted**

### 113. Dead space between the quote and the author row

Reported against the mockup: every testimonial card carried a tall empty band between the quote and
the author row.

**Cause — two rules fighting.** §54 gave the quote `flex-1` so author rows line up across cards of
differing length, which is correct on its own. But the card also kept a hard
`min-h-[300px]` (active) / `min-h-[280px]` (inactive) from the earlier centred design. The grid is
already `items-stretch`, so the longest quote sets the row height; the extra floor inflated every
card past its content, and `flex-1` handed the whole surplus to the quote paragraph — pushing the
author row to the bottom edge and opening ~80–100px of white space on a 2-line quote.

Fix: dropped both `min-h-*` classes in
`components/company-website-preview/sections/testimonials-section.tsx`. Cards now size to the tallest
quote in the row, so `flex-1` only absorbs the genuine difference between quotes. `items-stretch`,
the active card's lift/scale/shadow emphasis and the author alignment are all unchanged.

Two things noticed while in there, **not changed** (say the word if they should be):
- The mockup has **no divider rule** above the author row; ours keeps `border-t border-slate-100 pt-4`
  from §54. It's what made the empty band read as a boxed-off gap.
- `_components/testimonials-content.tsx`'s own Live Preview modal is still the **pre-§54 design**
  (quote icon, avatar first, centred) — it does not show what the public site renders. Same
  preview/live disagreement class as §107.
- `Event_Managment_Website_Builder/src/components/website-preview/sections/testimonials-section.tsx`
  is also still the pre-§54 card. The rendered site comes from the Admin Frontend copy.

Verified: `tsc --noEmit` exit 0 · `next build` compiled. Not browser-tested.

### 114. Hero text colour is now admin-picked (was hardcoded white)

Hero title/description were `text-white` / `text-white/90` **literals** in
`sections/hero-section.tsx`. On a light hero image — the reported case, a pale pink Contact hero —
the text is effectively invisible. Nothing in the admin could change it: the only colour control on
the form was the overlay.

Added **Title Color** and **Description Color** pickers, per page (each page has its own hero image,
so one global colour would not solve it).

**No backend change and no migration.** `company_website_hero_sections` has **no `page_slug` column**
(§35) — `useCompanyHeroSection` nests the entire per-page payload under `design_json[<slug>]` and
layers it back over the row on read. `design_json` is in both `TABLE_COLUMNS.heroSection` and
`JSON_COLUMNS`, so unknown keys inside it round-trip untouched. Confirmed against the local DB rather
than assumed: row id=1 already stores 13 keys per page for 5 pages, including `overlay_color` and
`content_alignment` — which are real columns too. `title_color` / `description_color` simply become
keys 14 and 15. (Same trick as §55's gradient stops in `settings_json`.)

| File | Change |
|---|---|
| `sections/preview-shared.ts` | `buildHero` returns `titleColor` / `descriptionColor` |
| `sections/hero-section.tsx` | `style={{ color }}` replaces the `text-white` classes |
| `_components/hero-section-content.tsx` | state + load + save + reset, new **Text Colors** card, and the form's own Live Preview mockup now honours them |
| `hooks/useCompanyWebsiteBuilder.ts` | two fields on `CompanyHeroSection` |

Details worth knowing:
- **Default is `#FFFFFF` in both the builder and the form**, so every hero saved before the picker
  existed renders exactly as it did. The description loses its old `/90` opacity — the picked colour
  now renders literally, which is what makes a dark pick actually look dark.
- The card sits inside the shared-controls wrapper, so it dims and locks in translation mode along
  with the image and overlay — colour is not per-language.
- Each picker has a **Reset** link back to white, shown only when it differs. `<input type="color">`
  fires on any interaction (§107), so a one-way picker would strand a value the admin never chose.
- Applied per page, so switching all six heroes to dark text means visiting all six. Deliberate —
  the right colour depends on that page's image.
- **Badge text/background still follow `theme.primaryButton` + white**, unchanged. Readable in the
  reported screenshot; say the word if those need pickers too.

Verified: local DB shape confirmed, `tsc --noEmit` exit 0, `next build` compiled. Not browser-tested.

### 115. Contact form + CTA blocks — four mockup mismatches

**Contact form: phone was beside email.** Email and Phone shared a
`grid sm:grid-cols-2`; every other field is full width, so the pair read as a broken row rather than
two fields. Phone is now its own full-width field directly after Email.

**Contact Information card: dead block under the social icons.** §58 put the two cards in an
`items-stretch` grid so they match height, and the form card is the taller of the two — the details
pane ended well short of the bottom edge. The rows now take the slack (`flex-1` + `justify-center`)
and the social icons stay pinned to the bottom, so the free space splits above and below the rows
instead of dangling under everything. Needed a wrapper around the heading + accent rule first:
they are two sibling elements, and any `justify-*` on the column would have pulled them apart.

**"Bg color" ×2 — one root cause, five components.** The CTA cards wash themselves with
`bg-primary/5`, `border-primary/20`, `ring-primary/20`. **`--primary` in this app is
`222.2 47.4% 11.2%` — near-black slate**, so every one of those washes rendered grey instead of the
site's pink. Nothing was theme-aware; the colour came from the *admin app's* token, not the site.

Added `alpha()` / `haloStyle()` / `bannerStyle()` in `login-demo-section.tsx` and mixed the washes
from `theme.primaryButton`. `alpha()` returns `transparent` (not a solid block) if the theme ever
hands over a non-hex value.

The user flagged the home banner and the features card; the identical defect was in three more
variants of the same file, so all five are fixed — otherwise the grey banner survives on the other
three pages:

| Variant | Page | Component |
|---|---|---|
| variant_1 | home | `LoginDemoSection` ← flagged |
| variant_2 | features | `FeaturesFirstHighlightSection` ← flagged |
| variant_4 | how-it-works | `SignupDemoSection` |
| variant_5 | contact | `ChatSignupDemoSection` |
| variant_7 | template | `TemplateDemoSection` |

`SignInDemoSection` (variant_6) is deliberately dark navy — left alone.

**"... and Feature Plans" was a seventh chip.** Styled exactly like the six feature pills, so it read
as another feature. It is a trailing aside in the reference — now plain muted text.

**Pricing "Book a Demo" (§image 2).** Ambiguous annotation, so it was asked rather than guessed: the
answer was button styling. It carried an inline `borderColor: primaryBtn`, making the secondary
action compete with the primary. Now a neutral `border-slate-300` white button, and both buttons in
that pair moved `rounded-xl` → `rounded-lg` to match the reference's radius.

> Still pink-outlined, **not changed** (only the pricing one was flagged): the secondary buttons on
> the home, how-it-works and contact CTA banners. Worth unifying if the neutral look is the intent.

Verified: `tsc --noEmit` exit 0 · `next build` compiled. Not browser-tested.

### 116. ⚠ THE ARCHITECTURE GAP — the public site was never a separate app

Raised by the user, and correct. Confirmed in code before acting:

1. **The public site was a set of routes inside the admin app.** `src/app/features`, `/pricing`,
   `/contact`, `/gallery`, `/templates`, `/how-it-works` sit beside `/admin` in the same Next
   project, and every one is `'use client'` — a crawler gets an empty shell.
2. **Tenant identity was a header, not the host.** `optionalCompanyAuth` resolves
   `x-company-id || ?company_id || user.company_id || 1`. Nothing could ever map `acme.com` to a
   company, so §54–§115's design work was really styling *company 1's* site.
3. **The schema was already built for this and unused.** `company_websites.slug` and
   `.custom_domain` are written by the builder and read by **nothing**. The vendor builder in the
   same backend already does `WHERE (slug = :slug OR custom_domain = :slug)`.

The in-admin preview was a reasonable way to build the editor; it was never the shipping
architecture, and that should have been flagged during the public-site design sessions.

### 117. Backend: host-addressed public read model

New, all under `/api/v1/public` (no auth — GETs there were already public):

| Method | Path | Purpose |
|---|---|---|
| GET | `/site/resolve?host=` | Host → company. Answers `{found:false}`, not 404, so a caller can tell "no tenant" from "API down" |
| GET | `/site/bundle?host=&lang=` | **The entire site in one response** |

- `src/services/companyPublicSite.service.js` — `parseHost` splits subdomain-vs-custom-domain
  against `PUBLIC_SITE_ROOT_DOMAINS` (comma-separated, env). Strips port, case and `www.`.
- `src/controllers/companyPublicSite.controller.js` — reads `x-forwarded-host` first (behind
  Vercel/Render `host` is internal); `?host=` is the local-dev escape hatch.

**One payload is not a nicety.** The admin preview fires ~22 client requests per page. Server-side
that is 22 sequential round trips at ~374ms against Aiven (§103). The bundle issues everything in
parallel: **35 sections in 90ms locally.**

> **Two traps hit while writing it, both silent:**
> 1. `getList`/`getSingleton` always scope by `company_id AND website_id`. **`features`,
>    `pricing_plans`, `pricing_matrix_features` and `pricing_settings` have no `website_id`
>    column** — the query throws and the section returns empty. It looked exactly like "the admin
>    hasn't added any" until the row counts were read back (6 / 3 / 7 rows really existed). They
>    use raw SQL now, and every section's failure is logged instead of swallowed.
> 2. Hero has **no `page_slug` column** — one row holds every page inside `design_json`. The merge
>    is done server-side (`buildHeroByPage`) precisely because dropping the row id there is the
>    §33.2/§46 bug, and the id is what addresses the section's translations.

### 118. New app: `D:\Jamal\Event_Management_Public_Site`

Next 15 / React 19 / Tailwind 3 — same stack as the admin app so the section components port
unchanged. Port 3010. **Named deliberately unlike the three existing `*Website_Builder*` folders,
which are all builder ADMIN apps.**

| Piece | Notes |
|---|---|
| `src/lib/site.ts` | `currentHost()` from `x-forwarded-host`/`host`; `loadSite()` fetches the bundle with ISR (`revalidate`, tagged `site:<host>` for future per-tenant invalidation) |
| `src/app/_render.tsx` | One fetch-resolve-render used by every route. 404s on unknown host **and on `status !== 'published'`** — never falls through to another company's content |
| `src/app/layout.tsx` | Per-tenant `generateMetadata` from that tenant's SEO row: title template, OG, Twitter, robots, favicon |
| `src/app/robots.ts` / `sitemap.ts` | Per-tenant. Unpublished/unknown hosts are `Disallow: /` — otherwise a half-built site is indexed the moment DNS resolves |
| Routes | `/`, `/features`, `/templates`, `/pricing`, `/how-it-works`, `/contact`, `/gallery`, `/[slug]` for builder pages |

**Three components fetched their own data** and had to be converted to props, or they would have
rendered client-side and defeated the point: `PageHeroSection`, `HighlightsSection`,
`PlanFeaturesComparisonSection`.

**The language provider was rewritten.** It used React Query; here languages and the translation
overlay arrive from the server bundle, and switching language is a *navigation* (`?lang=ta`) so the
server re-renders with the other overlay. Tamil has to be in the HTML, not applied after hydration.

### 119. Verified end-to-end (real servers, real DB)

```
resolve  eventify-co.eventinvit.test        -> company 1, published
bundle   35 sections, 90ms
GET /            200  <title> "Eventify Co. | Premier Event Management in Mumbai"  (tenant SEO row)
                      <h1> "Creating Unforgettable Moments"        server-rendered
GET /?lang=ta    200  2,049 Tamil strings IN THE HTML
GET /pricing     200  <h1> "Flexible Pricing Tiers For Every Event"
GET /contact     200  <h1> "Let Us Help You Bring Your Event To Life"
GET /  (Host: not-a-tenant.example.com)     404
robots.txt  tenant -> Allow + sitemap | unknown host -> Disallow: /
```

`tsc --noEmit` exit 0 · `next build` compiled (12 routes, all dynamic).

> `/features` shows the home hero because **no features hero has ever been saved** — `design_json`
> holds home/contact/pricing/template/how-it-works only. `heroFor()` falls back to the base row so
> an unsaved page shows the company's own copy rather than the library's sample text.

### 120. Assigning a domain

- **Subdomain:** `company_websites.slug` → `acme.<root>`. One wildcard `*.<root>` on the Vercel
  project + one wildcard DNS record. Zero per-company setup. Set `PUBLIC_SITE_ROOT_DOMAINS` on the
  **backend**.
- **Custom domain:** `company_websites.custom_domain` → customer points a CNAME at
  `cname.vercel-dns.com`; add the domain to the project (the Vercel Domains API can do this from
  the admin UI). Vercel issues the cert.
- Both columns already exist and are already written by the builder — only the *reading* was
  missing, and that is now the resolve endpoint.

### 121b. LIVE — 2026-08-13

`https://event-managment-public-website.vercel.app` · backend `f32c437` on Render.

Three things had to line up, and the failure mode of each was the *same page* ("Site not found"),
which is why it took a few passes to separate them:

1. **Backend not deployed.** `Cannot GET /api/v1/public/site/resolve` — Express's own 404. The app
   fetched it, got HTML, `loadSite()` returned null, `notFound()`. Deployed as `f32c437`.
2. **`custom_domain` was null.** Production's website row is **`id=5`, slug `company-1`** (local is
   `id=1`, `eventify-co` — they were never the same). Set via
   `scratch/set_site_domain.js` against `.env.production`, dry run first.
3. **`NEXT_PUBLIC_API_URL` missing from the Vercel build.** Inlined at build time, so the deployed
   bundle was calling `localhost:5000`. Fixed by setting it and redeploying.

> **Diagnostic worth reusing:** `robots.txt` distinguishes these instantly. It returns
> `Disallow: /` only on the `!bundle` branch, so `200 + Disallow` = the app is healthy and the data
> fetch failed, while `DEPLOYMENT_NOT_FOUND` = no deployment at all. A 404 on `/` alone cannot tell
> those apart.
>
> **A self-inflicted one:** the two candidate hosts were curled in a loop that reused one output
> file, so only the last body survived and both were reported as `DEPLOYMENT_NOT_FOUND`. The real
> host had been serving our own 404 the whole time. Write to distinct files when probing candidates.

Verified live:

```
/               200  "Make Every Moment Memorable with Event Invite"
/features       200  "Everything You Need to Create Unforgettable Events"
/pricing        200  "Choose the Perfect Plan for Your Needs"
/templates      200  "Stunning Templates for Every Celebration"
/how-it-works   200  "Create, Share and Manage your Event in Minutes"
/contact        200  "Let's Create Something Amazing Together"
/?lang=ta       200  2,219 Tamil strings IN THE HTML
title/og        "Event Invites"        (tenant's own SEO row)
robots.txt      Allow: / + sitemap     (was Disallow while unresolved)
sitemap.xml     7 URLs
```

Every page has its **own** hero copy, so per-page `design_json` resolution works against production
data, not just the local fixture.

> **Production content gaps** (from the live bundle): `pages`, `social_links`, `sliders`,
> `gallery_items`, `clients`, `sponsors` are all **0**. Populated: basic_information, footer,
> theme_settings, menu_items (6), testimonials (7), features (12), pricing_plans (7), templates (11).
> Those sections render empty — data, not a bug (§59).
>
> **Hindi is active on production** and was only 4% translated at §111.1. A visitor switching to
> Hindi now sees mostly English on a live site.

### 121. Open — before this replaces the admin routes

1. **Login & Demo variant lives in the ADMIN's `localStorage`** (§44), so the public app cannot know
   which variant an admin picked — it falls back to the per-page default map. **Needs a DB column**;
   this is a genuine parity blocker.
2. Contact form, newsletter and login/register **POST** endpoints are not wired in the new app
   (the bundle is read-only). The builder's contact form currently fakes its submit with a
   `setTimeout` anyway.
3. Admin frontend still serves its own copies of these public routes. Leave them until the new app
   is live, then delete — otherwise the same site exists at two URLs, which Google penalises.
4. No revalidation hook yet: a builder save is visible after `PUBLIC_SITE_REVALIDATE` (60s).
   The fetches are tagged `site:<host>`, so a webhook → `revalidateTag` is the next step.
5. `next/image` is not used anywhere — all `<img>`. Fine for launch, a real Lighthouse cost later.
