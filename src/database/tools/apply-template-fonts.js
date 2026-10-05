/**
 * Creates `template_fonts`.
 *
 * WHY: Templates → Fonts (Jamal, 2026-10-05). The admin adds fonts for
 * invitation templates — an uploaded font file, or a link — and they appear in
 * the template wizard's font lists beside the ten built in.
 *
 * Until this is run, Templates → Fonts answers with an error. Everything else
 * keeps working: the client's event options read the table through a guard and
 * simply offer no added fonts.
 *
 *   node src/database/tools/apply-template-fonts.js            (dry run, local)
 *   node src/database/tools/apply-template-fonts.js --apply
 *   node src/database/tools/apply-template-fonts.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

// Kept identical to the block in initial_setup.sql.
const DDL = `
CREATE TABLE IF NOT EXISTS \`template_fonts\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`name\` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'The CSS family name a template stores in primary_font / secondary_font',
  \`source\` enum('upload','link') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'upload' COMMENT 'upload = a font file in media storage, link = an address the admin pasted',
  \`file_url\` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'upload: where the font file is stored',
  \`file_name\` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'upload: the original filename',
  \`file_format\` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'upload: TTF | OTF | WOFF | WOFF2',
  \`file_size\` int unsigned DEFAULT NULL COMMENT 'upload: bytes',
  \`link_url\` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'link: a stylesheet (Google Fonts css2) or a font file hosted elsewhere',
  \`is_active\` tinyint NOT NULL DEFAULT '1',
  \`company_id\` int DEFAULT NULL,
  \`created_by\` int unsigned DEFAULT NULL,
  \`updated_by\` int unsigned DEFAULT NULL,
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`deleted_at\` datetime DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_template_fonts_company\` (\`company_id\`,\`deleted_at\`),
  KEY \`idx_template_fonts_status\` (\`is_active\`,\`deleted_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const parseEnv = (file) => {
    const out = {};
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    for (const l of raw.split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

(async () => {
    const env = PROD ? parseEnv('.env.production') : localEnv;
    const conn = await mysql.createConnection({
        host: env.DB_HOST,
        port: env.DB_PORT || 3306,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        charset: 'utf8mb4',
        ssl: PROD && env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : undefined,
    });

    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}`);

    const [[table]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_fonts'`
    );
    console.log(`template_fonts: ${table.n ? 'present' : 'TO CREATE'}`);

    if (table.n) {
        console.log('Nothing to do.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    await conn.query(DDL);
    console.log('template_fonts created.');
    await conn.end();
})().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
