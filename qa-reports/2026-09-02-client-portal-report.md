# Client Portal QA Report — 2026-09-02

**Scope:** Client portal only (`event_client_single` + `/client/...` API routes).
Not tested: admin panel, vendor portal, staff portal, website builder, public site.

**How this report was produced, in two parts:**

**Part A (API + backend invariants):** a background agent ran most of section
2–4 and 7 against the live servers before its harness process was interrupted
mid-run (unrelated to the app). Its raw evidence (18 files under
`qa-reports/2026-09-02/`) was verified line-by-line against the actual
application code before being trusted — one apparent finding was traced to a
bug in the QA script itself rather than the app (§9), and the agent's own
leftover test fixtures (a foreign account, stray notes/reminders/tags, three
fake message campaigns, 108 fake message rows) were found still in the local
database and removed.

**Part B (browser / responsive / regression fix):** once the dev servers were
back up, a Playwright suite (built this session) was run for real, end to end,
across 6 browser configurations. It surfaced 7–8 apparent failures; each was
individually triaged against actual evidence rather than taken at face value.
**5 turned out to be bugs in the test code, not the app**, and were fixed.
**1 real application bug was found and fixed** — a missing image-URL helper
causing every page load to 404 on the signed-in client's avatar. **2 remain
open**, both minor (§9).

---

## 1. Summary

**Ship with caveats.**

The backend is in excellent shape: 444/444 existing tests pass, every
documented invariant (field whitelisting, response-history append-only rules,
cross-account isolation, `DELETE /rsvps/:id` non-existence, reminder date
validation, tag restore-not-duplicate) was independently verified against a
real server. Auth boundaries are solid — every unauthenticated call is 401,
never 500, and a signed-out browser was confirmed to never render protected
content.

The one real *application* bug found this session (avatar 404 on every page
load) has been fixed and verified. One real, low-severity input-validation
gap (non-string values silently stringified instead of rejected) has been
fixed and verified live against the running server.

**Caveats:**
- The mobile tap-target gap and the Firefox contrast flake (both flagged
  during Playwright testing) have since been fixed / re-verified as
  non-reproducing — see §4 and §9. **No caveat remains from Playwright.**
- The 6 brand-new screens (Guest Profile's 6 tabs, Group Details' 2 dialogs)
  now have both route-smoke AND flow-level browser coverage, but nobody has
  looked at them with human eyes yet.
- Load testing was not run — `autocannon`/`lighthouse` are not installed and
  installing them wasn't authorized this session.

---

## 2. Build & Smoke

✅ **Static checks clean**, both times checked (before and after all fixes):
```
npx tsc --noEmit    — 0 errors, whole app
npx eslint src       — 21 pre-existing problems, ALL in files untouched this
                        session. Nothing new introduced by any change made.
```
⚠️ **`npm run build` intentionally NOT run** — the dev server was live and
building would write into the live `.next` and 500 it. Documented as a hard
rule in `.claude/agents/web-tester.md` for future QA passes on this project.

✅ Both servers verified live and answering for the entirety of Part B
(`curl` checks before every phase of testing).

---

## 3. Functional & Flows — API level

All evidence below is from `qa-reports/2026-09-02/*.txt`, cross-checked
against the service source, and — for the two items that looked ambiguous —
re-verified with fresh live requests rather than trusted from the saved logs.

### ✅ Field whitelisting (the rule that recurs across this codebase)
`PUT /client/guests/:id/profile` with `name` and `email` injected alongside
`relationship`: response and a follow-up read both show `name`/`email`
**unchanged**, `relationship` **applied**. `clientGuestProfile.service.js`
only ever reads `photo` and `relationship` off `body`.

### ✅ `rsvp_status` cannot be forced to contradict `response_type`
Crafted `rsvp_status: 'accepted'` alongside `response_type: 'no'`: stored
value stayed `declined`/`no`. The service derives `rsvp_status` server-side
and never reads it from the body.

### ✅ `DELETE /client/rsvps/:id` does not exist
Both `147` and `146` → 404. Clearing a response is `PUT .../reset`, exercised
successfully.

### ✅ Reset preserves the guest row, and writes history for the clear itself
After reset: guest still readable, `rsvp_status` → `invited` (not
`not_responded`), and a new response-history row was written recording the
clear (`from: no, to: none`) — exactly the behaviour the change log documents
as the reason the history table exists.

### ✅ Response history is append-only and grows correctly
Guest 147's history reached 20 rows over the session, oldest entry
`from_response_type: null` (the true first answer), every later row's `from`
chains to the previous row's `to`. Nothing was overwritten.

### ✅ Reminder / tag invariants
- Past `due_at` (2020, garbage, missing) → 400 in every case, confirmed live
  again in Part B (object/array titles also correctly 400 now — see W1 below).
- Same tag label twice → 400.
- Remove then re-add the same label → same tag id restored, not duplicated.

### ✅ Cross-account isolation — the highest-value check, and it's clean
A throwaway foreign account (client 61, its own guest/group/event) was probed
as the real test client across 19 routes: **every one 404'd**. Nothing
readable, nothing writable, foreign rows confirmed unmodified afterward. This
account and its rows have since been fully removed from the local DB.

### ✅ Malformed/nonexistent ids never 500
`999999`, `abc`, `-1`, `0`, `1e9`, a literal `'`, a SQL-looking string, `null`
— all 404, none 500.

### ✅ A signed-out visitor never sees protected content
Re-verified in Part B with a fresh Playwright browser context carrying no
cookie: `RSVPs` heading absent, zero table rows rendered. (An earlier draft of
this check looked at the URL instead of the content and produced a false
alarm when it couldn't complete an external redirect the test environment
doesn't run — see §9 for the correction.)

### ✅ Test suites — full run, twice (before and after all fixes)
```
client-guest-profile.test.js    74/74
client-rsvps.test.js            50/50
client-messages.test.js         74/74
client-payment-methods.test.js  65/65
client-billing.test.js          58/58
client-billing-api.test.js      56/56
client-settings-api.test.js     47/47
client-delete-account.test.js   20/20
──────────────────────────────────────
                                444/444
```
Every suite reported its own cleanup succeeded. No regressions.

---

## 4. Responsive / Cross-device — RUN, for real

A Playwright suite (`playwright.config.ts`, `e2e/global-setup.ts`,
`e2e/responsive.spec.ts`, `e2e/guest-profile.spec.ts`) covers 375 / 768 / 1366
/ 1920px viewports plus WebKit and Firefox engines: horizontal-scroll
detection on every dashboard route, tap-target sizing, sidebar open/close
without trapping scroll, and light/dark contrast on the Guest Profile.

**The honest history of getting this suite to a trustworthy state:**

The first full run showed 24 identical failures — traced to a Playwright API
misuse in the test file (`test.skip()` called with a signature the library
doesn't support outside a hook), not an app bug. Fixed.

The second full run showed 7 failures. Each was individually investigated:

| Failure | Real cause | Verdict |
|---|---|---|
| Group member profile link missing | My test used `event_id=1`; group 7's actual members are on event **22** | ❌ test bug, fixed |
| "View member details" dialog | downstream of the same wrong event id | ❌ test bug, fixed |
| "Edit member" contact-field check | downstream of the same wrong event id | ❌ test bug, fixed |
| Signed-out visitor "reached the dashboard" | test checked the URL; the app's own redirect target (a different origin, the tenant website) isn't running in this test environment, so the URL didn't change even though protected content correctly never rendered | ❌ test bug, fixed — now asserts on content |
| Firefox: page scrolls sideways on Dashboard | did not reproduce on re-run | — not reproduced |
| Note add/edit/delete | Playwright locator ambiguity (`div` filter matched dozens of nested wrapper elements) | ❌ test bug, fixed |
| Sidebar open/close | Next.js's own **dev-mode** overlay badge intercepted the click — does not exist in a production build | ❌ test-environment artifact, worked around with justification in the test |

**Two failures remain, both investigated and both real (not test bugs):**

**Open-1 — FIXED.** Mobile tap targets: table row links (guest/group names in
RSVPs, Guests, Group Details), the two footer links, and a breadcrumb link
measured 15–19px tall at 375px width against the 44px guideline. Traced each
to its real component (not all were where they first appeared to be — the
"Dashboard 52×15" element turned out to be a **breadcrumb** link, not the
sidebar nav as first assumed) and grew each one's tap area with padding:

- Table-row name/group links: `py-1.5` added directly (no negative margin —
  rows sit close together, and an invisible hit-zone bleeding into the
  adjacent row's click area would be a worse problem than the one being
  fixed).
- Footer links: `py-2.5 -my-2.5` (padding cancelled by negative margin) — safe
  here, since the footer has generous surrounding whitespace.
- Breadcrumb link: `py-1.5` only, no attempt at full 44px compliance — the bar
  itself is a fixed `h-[30px]` strip; redesigning it to fit a 44px target
  would be a much bigger, out-of-scope change for a Suggestion-tier finding.

**Deliberately NOT touched:** the sidebar's own `SidebarMenuButton` (shadcn/ui
primitive, `h-8`/32px is an app-wide density convention already, not unique to
mobile) — changing it would be a broader design decision than this fix
warranted.

Re-run after the fix: **passes.**

**Open-2 — resolved by re-verification, not a code change.** The Firefox
dark-mode contrast flake (flagging "Event"/"Test Client" as low-contrast) was
re-run 3 times after Open-1's fixes: isolated, paired with its light-mode
sibling, and as part of a full clean run. **Passed all three times.** It did
not reproduce again — treated as a one-off resource-contention flash during
the heaviest part of a parallel 6-browser run, not a real defect. No code
change was made for it, since there was nothing reproducible to fix.

**Final state, full suite re-run clean:** 108 tests passing, 0 failing, 60
skipped (viewport-scoped tests correctly not running outside their target
project).

---

## 5. API — additional checks

✅ **Auth boundary, no-cookie and garbage-cookie**, across 12+ routes
including POST/PUT/DELETE: 401 in every case, never 500.

✅ **`sort` query param is inert.** Neither `clientGuest.service.js` nor
`clientRsvp.service.js` reads a `sort` param at all — `?sort=;DROP` has
nothing to act on. Not a vulnerability; the parameter doesn't exist yet.

✅ **`audience: 'guests'` with empty `guest_ids` is correctly refused.**
Traced in `clientMessage.service.js` (`resolveAudience()`) — throws 400. The
saved evidence that looked like a bug (an empty array resulting in a send to
all 36 guests) was a QA-script artifact: that particular fuzz request most
likely never set `audience` at all, defaulting to `all` by design.

✅ **W1 fixed and verified live.** See §9.

---

## 6. Load / Performance

❌ **Not run.** `autocannon` and `lighthouse` are not installed in either
repo. Installing them was not authorized during this pass. No bundle-size
measurement, since that requires a build and the dev server was live for
almost the entire session.

---

## 7. Security / Data-integrity spot checks

✅ Cross-account isolation — see §3, clean.

✅ No stack traces or raw 500s anywhere across the entire session, including
malformed JSON, wrong types, arrays-instead-of-objects, null bodies — all
correctly 400.

✅ **Length limits work correctly** — every text field is `.slice()`'d to its
column length (150/60 chars), confirmed against real truncated rows in the DB.

✅ **W1 — now fixed.** See §9 for detail and live verification.

---

## 8. Regressions vs. last report

No previous QA report existed before this one — this is the baseline.

---

## 9. Issues found

### Critical
None.

### Fixed this session

**F1 — Client avatar 404s on every single page load.**
`src/components/layout/Header/Header.tsx` rendered
`<AvatarImage src={client.avatar_url} />` using the raw database value
(`/uploads/client-avatars/...jpg`), which is a path relative to the
**backend** (port 5001). Rendered as-is on the frontend's own origin (port
3005), it resolves against the wrong server and 404s — confirmed directly
(`curl` against :5001 → 200, same path against :3005 → 404). This codebase
already has the correct fix built and used in 8+ other places
(`src/lib/media-url.ts`'s `mediaUrl()` helper); `Header.tsx` was the one spot
that used the raw value instead. **Fixed**, and the identical latent bug
found and fixed in `guest-profile.tsx`'s guest-photo rendering (not yet
visibly failing only because no guest has an uploaded photo yet). Verified:
`tsc --noEmit` clean, page reload confirmed 200.

**F2 (was "W1") — Non-string input coerced via `String()` instead of
rejected.**
`src/services/clientGuestProfile.service.js`: `createNote`, `updateNote`,
`createReminder`, `updateReminder`, `addTag`, `updateProfile`. Previously,
sending `{"title": {"a":1}}` returned 201 and stored the literal text
`[object Object]`. **Fixed**: all six call sites now check `typeof value ===
'string'` before use and return 400 for anything else. **Verified live**
against the running server after the fix:
```
POST .../notes       {"title":{"a":1}}                     -> 400 "A note needs a title."
POST .../tags         {"label":[1,2]}                       -> 400 "A tag needs a label."
PUT  .../profile       {"relationship":{"x":1}}              -> 400 "Relationship must be text."
POST .../reminders     {"title":{"a":1},"due_at":"..."}      -> 400 "A reminder needs a title."
POST .../tags          {"label":"W1-verify"}  (control)      -> 201 (normal strings still work)
```
`client-guest-profile.test.js` re-run after the fix: still 74/74.

⚠️ **Scope note:** the same `String(body.x || '')` pattern (without a type
check) exists in five OTHER service files — `clientGuestGroup`,
`clientInvoice`, `clientMessage`, `clientPaymentMethod`, `clientRsvp`. These
were **not** touched — F2 was scoped to the file the original finding named.
Worth the same fix whenever those files are next in for other work.

### Warning
None open. (W1 from the earlier draft was fixed and verified — see F2 above.
The two items originally tracked as W2 have both since been closed: see
Open-1/Open-2 in §4.)

### Fixed this session (continued)

**F3 — Mobile tap targets grown across 6 elements.** See §4, Open-1 for full
detail: `rsvps/page.tsx` (guest name + group name links), `guests/page.tsx`
(guest name link), `rsvps/groups/[id]/group-detail.tsx` (member name link),
`Footer.tsx` (3 links), `Breadcrumb.tsx` (1 link). Verified: `tsc --noEmit`
clean, no new eslint problems, the originally-failing Playwright test now
passes, and a full 108-test suite re-run afterward stayed at 0 failures.

### Suggestion

**S1 — No human-eyes visual verification.**
Guest Profile's 6 tabs and Group Details' 2 dialogs now have both
route-smoke AND flow-level Playwright coverage (tabs render real content,
dialogs open without navigating away, contact fields are confirmed
non-editable in Edit Member). Nobody has looked at the actual rendered pixels.
Recommend a manual pass before calling this feature fully done.

**S2 — QA process gap, since fixed for future runs.**
A previous run of this agent left behind test fixtures (a foreign account,
stray notes/reminders/tags, 3 fake campaigns with 108 fake message rows) when
its harness process was interrupted mid-session. All found and removed this
session (verified via fresh `COUNT(*)` queries returning 0). Recommendation
for any future automated QA run: write cleanup as the FIRST step (delete by
marker before create), not something that only happens if the run reaches
its own end.

---

## Part C — full-module browser coverage (follow-up pass)

The original browser testing only covered RSVPs, Guest Profile and Group
Details in flow depth (the feature actually being built this session), plus
route-smoke on a handful of other pages. A follow-up pass extended this to
**every module in the client portal**:

- **Smoke coverage** (loads, no horizontal scroll) expanded from ~14 routes to
  **24**, across all 6 browser configurations — every billing sub-page,
  analytics, event categories, templates, event create/detail, guest
  add/edit/import, profile, delete-account, and the `[...slug]` placeholder.
- **New flow-level tests** written and run for: Event Categories (create/edit/
  delete), Guests (add with required-event validation, search, delete), CSV
  Import (loads), Settings → Preferences (toggle a real switch, confirm it
  survives a reload), Notifications (mark-all-read), Events (wizard step 1,
  list), Profile (loads real account data).

### F4 — FIXED. A real crash, found via the expanded smoke coverage.

`/dashboard/analytics` — never previously browser-tested — threw
`undefined is not an object (evaluating 'SOURCE_META[row.key].label')` once,
under full 6-browser simultaneous load. Live API response was independently
verified clean (`GET /client/events/analytics` → all 5 keys valid, matching
the frontend's map exactly), and it did not reproduce across 4 isolated
retries — the trigger was never pinned to a specific cause.

What WAS real and fixable regardless: the code had **19 separate unguarded
lookups** (`RSVP_META[key]`, `CHANNEL_META[key]`, `SOURCE_META[key]`) across
three lookup maps, each assuming the backend will only ever send a value
already in that map — with no fallback if that assumption is ever wrong for
even one frame. **Fixed**: added a guarded `metaOf()` helper and replaced all
19 call sites; an unrecognized value now renders "Unknown" instead of
blanking the page. Verified: still shows real labels under normal load
("WhatsApp Invite", no "Unknown" fallback triggered), `tsc --noEmit` clean, no
new eslint issues.

### F5 — Major finding, NOT fixed (needs a product decision, not a code fix).

**`/dashboard/event-categories` is broken for every real client.** It is
wired into the real sidebar nav (`navigation.ts`), reachable by any signed-in
client — but its own source code labels it explicitly:
`"SAMPLE MODULE... template for every other module"` (`use-event-categories.ts`
header comment). It calls `GET/POST /api/v1/event-categories` directly. The
backend's own comment in `clientPortal.routes.js` says: *"a client must never
reach /event-categories directly, because that endpoint is the whole
catalogue rather than what their plan allows."*

**Confirmed live**: every request from this screen — list, create — returns
**401**. Not a bug in one place; the screen was never wired to a client-facing
endpoint at all. Marked in the test suite with `test.fail()` (an EXPECTED
failure — Playwright will loudly flag it if this ever unexpectedly starts
passing). **Not fixed** — building the real client-scoped backend route, or
removing the nav link until one exists, is a product decision this report
defers rather than makes unilaterally.

### One non-reproducible dev-server artifact — no code change

`/dashboard/guests/147` threw `useGuestStats is not defined` once, at
desktop-1920, under the same full-load conditions. Investigated: that route's
own code (`guests/[id]/page.tsx`, `guest-form.tsx`) **never references
`useGuestStats` at all** — the identifier is used correctly in five other,
unrelated files. Did not reproduce across 4 isolated retries. Unlike F4, there
is no underlying unguarded pattern here to harden — this reads as Next.js dev
server HMR noise under simultaneous 6-way compilation load, which would not
occur in a production build or normal single-browser use. No code change
made.

### Final numbers, full suite, all modules, all 6 browser configurations

```
206 passed · 1 known-expected failure (Event Categories, F5) · 105 skipped
```

The 105 "skipped" are viewport-scoped tests correctly not running outside
their target project (e.g. the mobile-only tap-target test skipping on
desktop projects) — not a coverage gap.

---

## Appendix — raw evidence

Command output from Part A is preserved under `qa-reports/2026-09-02/*.txt`
(18 files). Playwright's own HTML report and traces for every run in Part B
are under `event_client_single/e2e-report/` and `event_client_single/test-
results/` (regenerated on each run — not preserved historically).
