
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
