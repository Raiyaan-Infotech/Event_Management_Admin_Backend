/*
 * Closing a client account — the HTTP layer, end to end against a running server.
 *
 * ── WHY IT NEVER TOUCHES A REAL ACCOUNT ─────────────────────────────────────
 * The endpoint under test DELETES. Pointing it at the seeded test client would
 * work exactly once and take that client's whole portal with it, so every case
 * here creates its own throwaway row, signs in as it, deletes it, and hard-
 * deletes whatever is left. Nothing pre-existing is read or written.
 *
 * ── WHAT IT LOCKS ───────────────────────────────────────────────────────────
 * The confirmation gate added on top of `DELETE /client/me`. It used to accept
 * a bare call behind a session cookie — one click, or one XSS/CSRF, closed an
 * account. Two paths now, because a social-only client has no password to give:
 *
 *   password account  ->  `password` required and verified with bcrypt
 *   social account    ->  `confirm_email` must match the account's own address
 *
 * The social path is the one worth guarding hardest: the naive fix is to skip
 * the check when there is no password, which makes the accounts that cannot
 * prove themselves the easiest ones to delete.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-delete-account.test.js
 * Requires the backend running on :5001 and the local database.
 */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { WebsiteClient, sequelize } = require('../src/models');

const BASE = process.env.TEST_API_URL || 'http://localhost:5001/api/v1';
const PASSWORD = 'Delete@123';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

/** Per-case cookie jar — each throwaway account gets its own session. */
function makeClient() {
    let cookies = '';
    return async (method, path, body) => {
        const res = await fetch(`${BASE}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(cookies ? { Cookie: cookies } : {}),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const setCookie = res.headers.getSetCookie?.() ?? [];
        if (setCookie.length) cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
        let json = null;
        try { json = await res.json(); } catch { /* non-JSON body */ }
        return { status: res.status, body: json };
    };
}

/**
 * Seeded straight into the table rather than through /register, so the social
 * case (password NULL, source 'google') is reachable — the register endpoint
 * cannot produce one, and OAuth cannot be driven from a test.
 *
 * `hooks: false` on the password build keeps the pre-hashed value intact; the
 * model's beforeUpdate would otherwise hash the hash.
 */
async function seedClient({ email, withPassword }) {
    return WebsiteClient.create({
        name: 'Delete Test',
        email,
        company_id: 1,
        source: withPassword ? 'website' : 'google',
        provider_id: withPassword ? null : `test-${Date.now()}`,
        password: withPassword ? await bcrypt.hash(PASSWORD, 10) : null,
        email_verified: 1,
        is_active: 1,
    }, { hooks: false });
}

/** Reads past the default scope AND past the soft delete. */
async function readRow(id) {
    const [row] = await sequelize.query(
        'SELECT email, is_active, deleted_at FROM website_clients WHERE id = ?',
        { replacements: [id], type: sequelize.QueryTypes.SELECT },
    );
    return row || null;
}

const hardDelete = (id) =>
    sequelize.query('DELETE FROM website_clients WHERE id = ?', { replacements: [id] });

(async () => {
    console.log(`\nDelete-account API against ${BASE}\n`);
    const created = [];

    try {
        // ── No session at all ──────────────────────────────────────────────
        console.log('── unauthenticated ───────────────────────────────');
        {
            const anon = makeClient();
            const res = await anon('DELETE', '/client/me', { password: PASSWORD });
            ok('DELETE /client/me without a session -> 401', res.status === 401, `got ${res.status}`);
        }

        // ── A password account ─────────────────────────────────────────────
        console.log('\n── password account ──────────────────────────────');
        {
            const email = `delete.pw.${Date.now()}@example.com`;
            const row = await seedClient({ email, withPassword: true });
            created.push(row.id);

            const api = makeClient();
            const login = await api('POST', '/public/website-clients/login', { email, password: PASSWORD });
            ok('signs in', login.status === 200, `got ${login.status} ${JSON.stringify(login.body)}`);

            const me = await api('GET', '/client/me');
            ok('has_password is reported, so the UI can pick the right field',
                Number(me.body?.data?.client?.has_password ?? me.body?.data?.has_password) === 1,
                JSON.stringify(me.body?.data));

            const noBody = await api('DELETE', '/client/me');
            ok('no confirmation at all -> 400 (a bare click cannot delete)',
                noBody.status === 400, `got ${noBody.status}`);

            const wrong = await api('DELETE', '/client/me', { password: 'NotTheOne@1' });
            ok('wrong password -> 401', wrong.status === 401, `got ${wrong.status}`);

            // The failures must not have half-closed it.
            const still = await readRow(row.id);
            ok('still open after the refusals', still && still.deleted_at === null && String(still.email) === email,
                JSON.stringify(still));

            // A social-only confirmation must not open a password account.
            const wrongMode = await api('DELETE', '/client/me', { confirm_email: email });
            ok('email instead of a password -> 400 (cannot pick the easier gate)',
                wrongMode.status === 400, `got ${wrongMode.status}`);

            const good = await api('DELETE', '/client/me', { password: PASSWORD });
            ok('correct password -> 200', good.status === 200, `got ${good.status}`);

            const after = await readRow(row.id);
            ok('soft-deleted, not hard-deleted', after && after.deleted_at !== null, JSON.stringify(after));
            ok('is_active cleared', after && Number(after.is_active) === 0, JSON.stringify(after));
            ok('email FREED — the address is stamped so it can be reused (§172)',
                after && String(after.email).startsWith(`${email}.deleted.`), String(after?.email));

            // The session must be dead, not merely redirected away from.
            const afterMe = await api('GET', '/client/me');
            ok('the session no longer authenticates', afterMe.status === 401 || afterMe.status === 403,
                `got ${afterMe.status}`);
        }

        // ── A social-only account (no password) ────────────────────────────
        console.log('\n── social account (no password) ──────────────────');
        {
            const email = `delete.social.${Date.now()}@example.com`;
            const row = await seedClient({ email, withPassword: false });
            created.push(row.id);

            /*
              No password means no /login. The session is minted the same way the
              OAuth callback mints it, which is what the middleware actually reads.
            */
            const { generateWebsiteClientAccessToken } = require('../src/utils/jwt');
            const token = generateWebsiteClientAccessToken(row);
            const bearer = async (method, path, body) => {
                const res = await fetch(`${BASE}${path}`, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                });
                let json = null;
                try { json = await res.json(); } catch { /* non-JSON */ }
                return { status: res.status, body: json };
            };

            const me = await bearer('GET', '/client/me');
            ok('signs in with the social token', me.status === 200, `got ${me.status}`);

            const noBody = await bearer('DELETE', '/client/me');
            ok('no confirmation -> 400 (NOT waved through for having no password)',
                noBody.status === 400, `got ${noBody.status}`);

            const someone = await bearer('DELETE', '/client/me', { confirm_email: 'someone.else@example.com' });
            ok('a different email -> 400', someone.status === 400, `got ${someone.status}`);

            const pwAttempt = await bearer('DELETE', '/client/me', { password: PASSWORD });
            ok('a password on an account that has none -> 400',
                pwAttempt.status === 400, `got ${pwAttempt.status}`);

            const still = await readRow(row.id);
            ok('still open after the refusals', still && still.deleted_at === null, JSON.stringify(still));

            const cased = await bearer('DELETE', '/client/me', { confirm_email: `  ${email.toUpperCase()}  ` });
            ok('its own email, differently cased and padded -> 200',
                cased.status === 200, `got ${cased.status} ${JSON.stringify(cased.body)}`);

            const after = await readRow(row.id);
            ok('soft-deleted and email freed', after && after.deleted_at !== null
                && String(after.email).startsWith(`${email}.deleted.`), JSON.stringify(after));
        }
    } finally {
        // ── Leave nothing behind ───────────────────────────────────────────
        console.log('\n── cleanup ───────────────────────────────────────');
        for (const id of created) await hardDelete(id);
        const [{ n }] = await sequelize.query(
            "SELECT COUNT(*) n FROM website_clients WHERE email LIKE 'delete.pw.%' OR email LIKE 'delete.social.%'",
            { type: sequelize.QueryTypes.SELECT },
        );
        ok('no throwaway rows left', Number(n) === 0, `${n} remain`);
        await sequelize.close();
    }

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
