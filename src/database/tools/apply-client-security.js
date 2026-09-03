#!/usr/bin/env node
/**
 * Client portal Security — sessions, authorized devices and 2FA.
 *
 *   client_sessions
 *   client_two_factor
 *   client_backup_codes
 *
 * ── WHY THIS TABLE HAS TO EXIST BEFORE THE SCREENS CAN ──────────────────────
 * The Security tab used to say that Active Sessions, Authorized Devices and
 * "Log out all other sessions" were not merely unbuilt but IMPOSSIBLE. That was
 * true and worth saying: a website client's tokens are stateless JWTs signed and
 * forgotten, so there was no row anywhere to list, and nothing to revoke. A
 * "Log Out" button would have cleared a cookie and left the token working.
 *
 * `client_sessions` is the row that was missing. One per sign-in.
 *
 * ── THE JTI WAS ALREADY THERE ───────────────────────────────────────────────
 * `generateWebsiteClientRefreshToken` (src/utils/jwt.js) has always minted a
 * `jti` uuid into every refresh token and then never looked at it again.
 * Persisting that value is the whole mechanism: the token already carries its
 * own primary key, so revocation is a lookup rather than a new token format.
 *
 * ── ONE TABLE, TWO SCREENS ──────────────────────────────────────────────────
 * Active Sessions and Authorized Devices are the SAME rows read two ways — live
 * sign-ins, and devices that have been remembered. Two tables would mean two
 * copies of "which device is this", and the first symptom of them drifting is a
 * device you revoked still being able to sign in.
 *
 * ── WHAT IT DELIBERATELY DOES NOT STORE ─────────────────────────────────────
 * `location` is nullable and stays NULL. The design shows "Mumbai, India" per
 * row, which needs a GeoIP service this project does not have and has not
 * bought. The column is here so the day one is added nothing has to migrate;
 * until then the screens print the IP address, which is true, instead of a city
 * that was guessed.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-client-security.js
 *   node src/database/tools/apply-client-security.js --apply
 *   node src/database/tools/apply-client-security.js --prod --apply
 *
 * Dry runs by default; `--prod` dry-runs too until `--apply` is added.
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

/** Read, never guessed — see §313.3 and the six migrations that guessing cost. */
async function clientIdType(conn) {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients' AND COLUMN_NAME = 'id'`,
        [process.env.DB_NAME],
    );
    if (!rows.length) throw new Error('website_clients.id not found — wrong database?');
    return rows[0].COLUMN_TYPE.toUpperCase();
}

const TABLES = (fk) => ({
    client_sessions: `
CREATE TABLE IF NOT EXISTS \`client_sessions\` (
  \`id\`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`website_client_id\` ${fk} NOT NULL,

  -- The refresh token's own \`jti\`. Already minted by jwt.js and, until now,
  -- never read — which is why this table can identify a session without
  -- changing the token format or storing the token itself.
  \`jti\`               CHAR(36)     NOT NULL,

  -- Which door they came in by. The portal sends cookies; the Flutter app sends
  -- Authorization: Bearer and cannot receive a Set-Cookie at all, so the two
  -- refresh through different paths and a session has to say which it is.
  \`transport\`         ENUM('web','app') NOT NULL DEFAULT 'web',

  -- Parsed from the User-Agent at sign-in and then FROZEN. Re-deriving it on
  -- read would make an old row change its mind about what device it was.
  \`device_name\`       VARCHAR(120) NULL COMMENT 'e.g. "Windows · Chrome". NULL when the UA said nothing useful',
  \`device_type\`       VARCHAR(20)  NULL COMMENT 'desktop / mobile / tablet',
  \`browser\`           VARCHAR(60)  NULL,
  \`os\`                VARCHAR(60)  NULL,

  \`ip_address\`        VARCHAR(45)  NULL COMMENT '45 = an IPv6 address with an IPv4 tail',
  \`user_agent\`        VARCHAR(500) NULL,
  -- ⚠ Always NULL today. No GeoIP service exists in this project; the column is
  -- here so adding one later is not a migration. The UI shows the IP instead of
  -- inventing a city.
  \`location\`          VARCHAR(120) NULL,

  \`last_active_at\`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`expires_at\`        DATETIME     NOT NULL,

  -- Revoked rather than deleted: "this session was signed out at 14:02" is the
  -- answer to the only question anybody asks of a session that is gone.
  \`revoked_at\`        DATETIME     NULL,
  \`revoked_reason\`    VARCHAR(40)  NULL COMMENT 'logout / revoked / revoked_all / password_change / rotated',

  -- "Trust this device for 30 days" — this device may skip the 2FA code until
  -- then. A date, not a flag, so it expires on its own; there is no scheduled
  -- job in this system that could ever turn a flag back off.
  \`trusted_until\`     DATETIME     NULL,

  \`created_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (\`id\`),
  -- One row per refresh token. Rotation writes a new row and revokes the old,
  -- so a replayed token cannot resurrect a session that was signed out.
  UNIQUE KEY \`client_sessions_jti\` (\`jti\`),
  KEY \`client_sessions_client\` (\`website_client_id\`, \`revoked_at\`, \`last_active_at\`),
  CONSTRAINT \`fk_client_sessions_client\`
    FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    client_two_factor: `
CREATE TABLE IF NOT EXISTS \`client_two_factor\` (
  \`id\`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`website_client_id\` ${fk} NOT NULL,

  -- The shared secret, base32. A SEPARATE TABLE rather than a column on
  -- website_clients on purpose: that model's defaultScope already has to
  -- exclude \`password\` and \`otp_hash\`, and a secret that leaks because
  -- somebody wrote .findByPk() without a scope is the one failure this design
  -- can rule out entirely.
  \`secret\`            VARCHAR(255) NOT NULL,

  -- Enrolment is two steps: a secret exists as soon as the QR is shown, but 2FA
  -- is not ON until a code from the app proves it was actually scanned.
  -- Otherwise somebody who closed the tab mid-setup is locked out by a secret
  -- they never stored.
  \`is_enabled\`        TINYINT(1)   NOT NULL DEFAULT 0,
  \`confirmed_at\`      DATETIME     NULL,

  \`last_used_at\`      DATETIME     NULL,
  -- The 30-second window a code was accepted for. A TOTP code stays valid for
  -- its whole window, so without this the same six digits work twice — which is
  -- exactly what somebody reading them over a shoulder needs.
  \`last_used_counter\` BIGINT       NULL,

  \`created_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`client_two_factor_client\` (\`website_client_id\`),
  CONSTRAINT \`fk_client_two_factor_client\`
    FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    client_backup_codes: `
CREATE TABLE IF NOT EXISTS \`client_backup_codes\` (
  \`id\`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`website_client_id\` ${fk} NOT NULL,

  -- Hashed, like a password, because that is what it is: a credential that
  -- signs somebody in without the authenticator. Storing them readable would
  -- mean a database dump is a list of working keys.
  \`code_hash\`         VARCHAR(255) NOT NULL,

  -- A row per code, not a JSON array on the client: "used" is a fact about ONE
  -- code, and two codes being spent at once must not overwrite each other.
  \`used_at\`           DATETIME     NULL,

  \`created_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (\`id\`),
  KEY \`client_backup_codes_client\` (\`website_client_id\`, \`used_at\`),
  CONSTRAINT \`fk_client_backup_codes_client\`
    FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
});

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        const fk = await clientIdType(conn);
        console.log(`  website_clients.id is ${fk} — foreign keys will match it\n`);

        const tables = TABLES(fk);

        for (const [name, ddl] of Object.entries(tables)) {
            const [existing] = await conn.query(
                `SELECT TABLE_NAME FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [process.env.DB_NAME, name],
            );

            const label = name.padEnd(20);
            if (existing.length) {
                console.log(`  = ${label} already present, skipping`);
            } else if (!APPLY) {
                console.log(`  + ${label} WOULD CREATE`);
            } else {
                await conn.query(ddl);
                console.log(`  + ${label} created`);
            }
        }

        // Report the shape back, so a run is evidence rather than a claim — the
        // reason schema-audit.js exists at all.
        console.log('');
        for (const name of Object.keys(tables)) {
            const [cols] = await conn.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [process.env.DB_NAME, name],
            );
            console.log(`  ${name.padEnd(20)} ${cols.length ? `${cols.length} columns` : 'ABSENT'}`);
        }
        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
