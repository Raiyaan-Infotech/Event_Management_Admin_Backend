/**
 * Add translations description key
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const mysql = require('mysql2/promise');

async function addKey() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'test',
  });

  console.log('Connected!');

  const [existing] = await conn.execute('SELECT id FROM translation_keys WHERE `key` = ?', ['settings.translations_desc']);
  if (existing.length > 0) {
    console.log('Key already exists');
    await conn.end();
    return;
  }

  const [languages] = await conn.execute('SELECT id, code FROM languages WHERE is_active = 1');

  const [result] = await conn.execute(
    'INSERT INTO translation_keys (`key`, default_value, `group`, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
    ['settings.translations_desc', 'Manage your application translations', 'settings']
  );

  const keyId = result.insertId;
  console.log('Created: settings.translations_desc');

  const translations = {
    'en': 'Manage your application translations',
    'ta': 'உங்கள் பயன்பாட்டு மொழிபெயர்ப்புகளை நிர்வகிக்கவும்',
    'hi': 'अपने एप्लिकेशन अनुवाद प्रबंधित करें'
  };

  for (const lang of languages) {
    await conn.execute(
      'INSERT INTO translations (translation_key_id, language_id, value, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [keyId, lang.id, translations[lang.code] || translations['en'], lang.code === 'en' ? 'reviewed' : 'auto']
    );
  }

  console.log('Done!');
  await conn.end();
}

addKey().catch(console.error);
