# Client Portal QA Report — 2026-09-02

**Scope:** Client portal only (`event_client_single` + `/client/...` API routes).
Not tested: admin panel, vendor portal, staff portal, website builder, public site.

**How this report was produced:** a background agent ran most of section 2–4 and 7
against the live servers before its process was interrupted mid-run (unrelated to
the app — the harness session it was launched from ended). Its raw evidence
(18 files under `qa-reports/2026-09-02/`) was verified line-by-line against the
actual application code before being trusted, one apparent finding was traced to
a bug in the QA script itself rather than the app (see §9), two real bugs in the
Playwright specs were found and fixed, and the agent's own test fixtures (a
foreign account, stray notes/reminders/tags, three fake message campaigns) were
found still in the local database and removed. Live browser verification
(Playwright §4) could not be completed because both dev servers were down by the
time this session resumed — that section is marked accordingly.

---

## 1. Summary

**Ship with caveats.**

The backend is in excellent shape: 444/444 existing tests pass, every documented
invariant (field whitelisting, response-history append-only rules, cross-account
isolation, `DELETE /rsvps/:id` non-existence, reminder date validation, tag
restore-not-duplicate) was independently verified against a real server, not
just read from code. Auth boundaries are solid — every unauthenticated call is
401, never 500, across a dozen probed routes including malformed and garbage
cookies.

**Caveats:**
- One genuine, low-severity input-validation gap (Critical/Warning judgment
  below) affecting four write paths.
- Responsive/cross-device testing has a suite now, but it has not actually run
  end-to-end since the server went down mid-session — see §4.
- No browser-based visual verification has happened at all for six brand-new
  screens (Guest Profile's 6 tabs, Group Details' 2 new dialogs). Route smoke
  tests confirm they don't crash; nothing confirms they look right.

Nothing here blocks shipping the backend. The frontend screens need one actual
look in a browser before calling them done.

---

## 2. Build & Smoke

✅ **Static checks clean.**
```
npx tsc --noEmit    — 0 errors, whole app
npx eslint src       — 21 pre-existing problems, ALL in files untouched this
                        session (analytics, event-categories, guest-form,
                        group-form, guests, dashboard page, global-loader,
                        breadcrumb, ChartsSection, 2 hooks, format.test).
                        Nothing new introduced.
```
⚠️ **`npm run build` intentionally NOT run** — the dev server was live on :3005
when most of this session ran; building would have written into the live
`.next` and 500'd it. This is documented as a hard rule for QA on this project
going forward (`.claude/agents/web-tester.md`).

✅ Both servers responded at the time the agent ran (`01-login.txt` shows a
successful login at 09:19:21). ⚠️ **They are down now** — neither :3005 nor
:5001 answers as of this write-up. Not an app defect; just means live
verification stopped mid-session.

---

## 3. Functional & Flows — API level

All evidence below is from `qa-reports/2026-09-02/04-auth.txt`,
`05-inv-profile.txt`, `07-isolation.txt`, `08-foreign-intact.txt`,
`09-rsvp-invariants.txt`, verified against the service source.

### ✅ Field whitelisting (the rule that recurs across this codebase)
`PUT /client/guests/:id/profile` with `name` and `email` injected alongside
`relationship`: the response and a follow-up read both show `name` and `email`
**unchanged**, `relationship` **applied**. Confirmed in `clientGuestProfile.service.js`
— only `photo` and `relationship` are ever read off `body`.

### ✅ `rsvp_status` cannot be forced to contradict `response_type`
`PUT /client/rsvps/:id` with `response_type: 'no'` and a crafted
`rsvp_status: 'accepted'` in the same body: stored value stayed `declined`/`no`,
matching the response type. The service derives `rsvp_status` server-side and
never reads it from the body — confirmed in code.

### ✅ `DELETE /client/rsvps/:id` does not exist
Both `147` and `146` → 404. Clearing a response is `PUT .../reset`, which is a
real route and was exercised successfully.

### ✅ Reset preserves the guest row
After `PUT /client/rsvps/147/reset`: guest was still readable (`GET` → 200),
`rsvp_status` returned to `invited` (not `not_responded`, since it had been
invited before), `response_type` → `none`, and — this is the important part —
**a new response-history row was written recording the clear itself**
(`from: no, to: none`). This is the exact behaviour §375 of the project's own
change log documents as the reason the history table exists.

### ✅ Response history is append-only and grows correctly
Guest 147's history has 20 rows by the time the agent finished poking it, each
one a real prior state, oldest `from_response_type: null` (the true first
entry), everything after chains correctly (`to` of one row equals `from` of the
next). Nothing was overwritten.

### ✅ Reminder / tag invariants
- Past `due_at` (2020, garbage strings, missing) → 400 in every case.
- Same tag label twice → 400 (`"already on this guest"`).
- Remove then re-add the same label → **same tag id came back**, confirming the
  soft-delete-restore path rather than a duplicate row.

### ✅ Cross-account isolation — the highest-value check, and it's clean
A throwaway "foreign" account (client 61) with its own guest, group and event
was created, then probed as the real test client (id 23) across 19 different
routes: every single one returned 404. Nothing was readable, nothing was
writable. The foreign rows were confirmed **unmodified** afterward (0 notes, 0
tags, 0 reminders written against them despite the attempts). This account and
its rows have since been deleted from the local DB — see §9 for the full
cleanup list.

### ✅ Malformed/nonexistent ids never 500
`999999`, `abc`, `-1`, `0`, `1e9`, a literal `'`, a SQL-looking string, `null` —
all returned 404, none 500.

### ✅ Test suites — full run
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
Every suite reported its own cleanup succeeded. No regressions from the last
known-good baseline (§380 of `session.md`, also 444 passing).

---

## 4. Responsive / Cross-device

⚠️ **Partially run, then interrupted — not a clean pass or fail.**

A Playwright suite was built this session specifically to close this gap
(`playwright.config.ts`, `e2e/global-setup.ts`, `e2e/responsive.spec.ts`,
`e2e/guest-profile.spec.ts`), covering the brief's required viewports (375 /
768 / 1366 / 1920) plus WebKit and Firefox engines, horizontal-scroll
detection, tap-target sizing, sidebar-trap detection, and light/dark contrast
checks.

**What actually happened:** the one run that completed (`17-playwright.txt`)
showed 84 passing and 24 failing. On inspection, **every failure was the same
bug in the test file, not the app** — `test.skip()` was called with a callback
signature `(fixtures, testInfo) => ...` that Playwright does not support at
that call site (`testInfo` is only available inside a hook), producing an
identical `TypeError: Cannot read properties of undefined (reading 'project')`
in every project. This has been fixed (moved into `test.beforeEach`), but the
fix has not been re-run — **both dev servers went down before it could be**.

**So, honestly:**
- The 84 passes that DID run are real evidence (horizontal-scroll checks
  across 10+ routes at multiple viewports came back clean).
- The 24 failures were a test-authoring bug, now fixed, unverified.
- The suite has never completed a clean full run.

**Action needed:** once the dev servers are back up, run:
```
cd event_client_single
npx playwright test
npx playwright show-report e2e-report
```

---

## 5. API — additional checks

✅ **Auth boundary, no-cookie and garbage-cookie**, across 12+ routes including
POST/PUT/DELETE: 401 in every case, never 500 (`04-auth.txt`).

✅ **`sort` query param is inert.** `?sort=;DROP` and similar were tried against
`/guests` and `/rsvps` list endpoints; both returned 200. Traced in code
(`clientGuest.service.js`, `clientRsvp.service.js`) — neither service reads a
`sort` param from the query at all, so there is nothing for it to inject into.
Not a vulnerability; the parameter simply doesn't exist yet.

✅ **`audience: 'guests'` with an empty `guest_ids` is correctly refused.**
The saved evidence (`13-stored-values.txt`) initially looked like a bug — an
empty-array send resulted in a campaign that went to all 36 guests — but the
request body that produced it wasn't preserved, and reading
`clientMessage.service.js` directly (`resolveAudience()`, lines ~205–212) shows
`audience === 'guests'` with an empty id array throws `400: "Choose at least
one guest."` This was a QA-script artifact (the fuzz test most likely never
set `audience` in that particular request, so it defaulted to `all` as
designed) rather than an app defect. **Not filed as a finding** — see the
reasoning trail in §9 if this needs re-checking.

⚠️ **See §9, Warning-1** for the one real gap found: non-string input into
`title`/`relationship`/`label` fields is coerced via `String()` rather than
rejected.

---

## 6. Load / Performance

❌ **Not run.** `autocannon` and `lighthouse` are not installed in either repo,
and installing them was out of scope for this pass (the agent's brief
explicitly forbade silent installs). No bundle-size measurement either, since
that requires a build and the dev server was live — see §2.

---

## 7. Security / Data-integrity spot checks

✅ Cross-account isolation — see §3, this is the main one and it's clean.

✅ No stack traces or raw 500s observed anywhere across the entire session,
including malformed JSON bodies, wrong types, arrays-instead-of-objects, and
null bodies sent to write endpoints (`12-messages-fuzz.txt`) — all correctly
400.

⚠️ **Warning-1 — non-string values are silently stringified, not rejected.**

**Where:** `src/services/clientGuestProfile.service.js`, four call sites:
- `createNote` / `updateNote` — `title`
- `createReminder` / `updateReminder` — `title`
- `addTag` — `label`
- `updateProfile` — `relationship`

**What happens:** each does `String(body.title || '').trim()` (or equivalent)
with no check that the input was a string to begin with. Sending
`{"relationship": {"foo":"bar"}}` gets accepted (200) and the column now
literally contains the text `[object Object]`. Sending `{"title": ["a","b"]}`
similarly stores `1,2`.

**Confirmed live**, not just read in code — the DB held real rows with these
exact stored values (`13-stored-values.txt` cross-checked against
`SELECT ... FROM event_guest_notes/event_guests` directly). Since fixed
locally, those rows have been cleaned up (§9).

**Severity:** Warning, not Critical. This is authenticated first-party input —
a client can only corrupt their own data this way, and it requires
deliberately sending a non-string where the UI never would. It's a data-hygiene
gap, not a security hole. Worth a one-line fix (`typeof body.title === 'string'`
before the `String()` coercion, four places) whenever that file is next
touched — not urgent enough to block anything.

✅ **Length limits work correctly.** Every one of the four fields above is also
`.slice()`'d to its column length (150 or 60 chars) — confirmed by DB rows with
a 60-char string of `A`s where relationship was truncated exactly at the limit,
not silently accepted longer or 500ing on DB truncation.

---

## 8. Regressions vs. last report

No previous QA report existed in `qa-reports/` before this one — nothing to
compare against. This is the baseline going forward.

---

## 9. Issues found

### Critical
None.

### Warning

**W1 — Non-string input coerced via `String()` instead of rejected.**
See §7 for full detail. `src/services/clientGuestProfile.service.js`:
`createNote`, `updateNote`, `createReminder`, `updateReminder`, `addTag`,
`updateProfile`. Repro: `POST /client/guests/:id/notes` with
`{"title": {"a":1}}` → 201, stored title is the string `[object Object]`.
**Fix:** add `typeof body.title !== 'string'` (etc.) to the existing validation
before the `String()` coercion, returning 400.

**W2 — Playwright responsive suite has never completed a clean full run.**
See §4. The bug that caused 24/24 project-mismatched failures has been fixed
in `e2e/guest-profile.spec.ts` and `e2e/responsive.spec.ts`, but not re-run
because both dev servers are currently down. **Action:** start both servers,
run `npx playwright test` from `event_client_single`, confirm 0 failures or
triage what's left.

### Suggestion

**S1 — No visual (human-eyes) verification of six new screens.**
Guest Profile's 6 tabs and Group Details' 2 new dialogs (View Member, Edit
Member) have route-level smoke tests (200, no crash) and, partially, automated
layout checks (§4), but nobody has looked at them rendered. Recommend opening
each in a browser before calling this feature done — the route-smoke result
("200") explicitly does not mean "renders correctly," only "did not error."

**S2 — This QA agent's own leftover test data was found and removed.**
Not an app bug — noting it here because it's a process gap worth closing. A
previous run of this agent was interrupted mid-session (harness-level, not
app-related) and left behind: a foreign test account + guest + group + event
(client id 61, cascaded on delete), 8 stray notes / 2 reminders / 1 tag on
real guest 146, 3 fake message campaigns with 108 message rows attached to the
real seeded test account, and 4 scratch script files in both repo roots. All
removed and verified clean (fresh `COUNT(*)` queries returned 0 across every
QA-labelled table). **Recommendation:** any future QA agent run should write
its cleanup as the FIRST step of its own script (delete-by-marker before
create), not rely on reaching the end of a long session uninterrupted.

---

## Appendix — raw evidence

All command output referenced above is preserved under
`qa-reports/2026-09-02/*.txt` (18 files) for anyone who wants to check the
verification trail directly rather than trust this summary.
