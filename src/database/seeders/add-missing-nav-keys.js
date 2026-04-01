/**
 * Add missing navigation translation keys
 * Usage: node src/database/seeders/add-missing-nav-keys.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const mysql = require('mysql2/promise');
const axios = require('axios');

// MyMemory API for translation
async function translateText(text, fromLang, toLang) {
  try {
    if (fromLang === toLang) return text;
    if (!text || text.trim() === '') return text;

    const response = await axios.get('https://api.mymemory.translated.net/get', {
      params: {
        q: text,
        langpair: `${fromLang}|${toLang}`,
      },
      timeout: 10000,
    });

    if (response.data && response.data.responseStatus === 200) {
      return response.data.responseData.translatedText;
    }
    return text;
  } catch (error) {
    console.error(`Translation failed for "${text}": ${error.message}`);
    return text;
  }
}

const newKeys = [
  { key: 'nav.access_control', default_value: 'Access Control', group: 'navigation' },
  { key: 'nav.configuration', default_value: 'Configuration', group: 'navigation' },
  { key: 'nav.email_templates', default_value: 'Email Templates', group: 'navigation' },
  { key: 'profile.my_account', default_value: 'My Account', group: 'profile' },
];

async function addKeys() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'admin_dashboard',
  });

  console.log('Connected to database!\n');

  const [languages] = await conn.execute('SELECT id, code, name FROM languages WHERE is_active = 1');
  console.log('Languages:', languages.map(l => l.code).join(', '));

  let created = 0;
  let skipped = 0;

  for (const keyData of newKeys) {
    const [existing] = await conn.execute('SELECT id FROM translation_keys WHERE `key` = ?', [keyData.key]);
    if (existing.length > 0) {
      console.log('Skip:', keyData.key, '(already exists)');
      skipped++;
      continue;
    }

    const [result] = await conn.execute(
      'INSERT INTO translation_keys (`key`, default_value, `group`, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [keyData.key, keyData.default_value, keyData.group]
    );

    const keyId = result.insertId;
    console.log('Created:', keyData.key);
    created++;

    for (const lang of languages) {
      let value = keyData.default_value;

      if (lang.code !== 'en') {
        console.log(`  Translating to ${lang.code}...`);
        value = await translateText(keyData.default_value, 'en', lang.code);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      await conn.execute(
        'INSERT INTO translations (translation_key_id, language_id, value, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
        [keyId, lang.id, value, lang.code === 'en' ? 'reviewed' : 'auto']
      );
    }
  }

  console.log('\n========================================');
  console.log(`Created: ${created} keys`);
  console.log(`Skipped: ${skipped} keys`);
  console.log('========================================\n');

  await conn.end();
}

addKeys()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
