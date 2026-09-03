/*
 * Snapshot and restore a client's real security state around a test run.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `client-security.test.js` and `client-2fa-login.test.js` both exercise the
 * FIRST website_clients row / `test@example.com` — the exact seeded account
 * used for manual, interactive testing (scanning a real QR with a real phone).
 * Before this file existed, both tests unconditionally wiped that account's
 * `client_two_factor`, `client_backup_codes` and `client_sessions` rows as
 * "clean slate" / "cleanup" — which meant re-running either test while someone
 * had 2FA enrolled in a browser silently deleted their enrollment. That is
 * exactly what happened once: a re-run to verify a CORS fix erased a real
 * enrollment mid-test-session, and the next login attempt failed with a
 * confusing "wrong code" instead of "2FA was never actually enabled."
 *
 * The fix is not "don't clean up" — a test needs a known starting state — it is
 * "put back exactly what was there." Backup codes are restored by copying their
 * HASHES directly, which needs no knowledge of the original plaintext codes;
 * sessions are restored with their original `jti`, so a session cookie already
 * sitting in someone's browser keeps resolving afterward.
 */

async function snapshotClientSecurity(db, clientId) {
    const [twoFactor, backupCodes, sessions] = await Promise.all([
        db.ClientTwoFactor.scope('withSecret').findOne({ where: { website_client_id: clientId } }),
        db.ClientBackupCode.findAll({ where: { website_client_id: clientId } }),
        db.ClientSession.findAll({ where: { website_client_id: clientId } }),
    ]);

    return {
        twoFactor: twoFactor ? twoFactor.get({ plain: true }) : null,
        backupCodes: backupCodes.map((r) => r.get({ plain: true })),
        sessions: sessions.map((r) => r.get({ plain: true })),
    };
}

/** Strip the columns Sequelize must generate itself on insert. */
const withoutGenerated = (row) => {
    const { id, created_at, updated_at, ...rest } = row;
    return rest;
};

async function restoreClientSecurity(db, clientId, snapshot) {
    // Clear whatever the test itself left behind before restoring — the test
    // may have created its own rows, and this must not end with a duplicate
    // of both the test's data and the original.
    await db.ClientBackupCode.destroy({ where: { website_client_id: clientId } });
    await db.ClientTwoFactor.destroy({ where: { website_client_id: clientId } });
    await db.ClientSession.destroy({ where: { website_client_id: clientId } });

    if (snapshot.twoFactor) {
        await db.ClientTwoFactor.create(withoutGenerated(snapshot.twoFactor));
    }
    if (snapshot.backupCodes.length) {
        await db.ClientBackupCode.bulkCreate(snapshot.backupCodes.map(withoutGenerated));
    }
    if (snapshot.sessions.length) {
        // `jti` is preserved exactly — it is what a cookie already sitting in
        // someone's browser names, and a new value would orphan that cookie.
        await db.ClientSession.bulkCreate(snapshot.sessions.map(withoutGenerated));
    }
}

module.exports = { snapshotClientSecurity, restoreClientSecurity };
