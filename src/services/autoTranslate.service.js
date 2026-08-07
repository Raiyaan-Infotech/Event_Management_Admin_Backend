const axios = require('axios');
const logger = require('../utils/logger');

const MYMEMORY_API_URL = 'https://api.mymemory.translated.net/get';

// Add your email here to get 10,000 requests/day (instead of 1,000)
// Leave empty for anonymous 1,000 requests/day
const MYMEMORY_EMAIL = process.env.MYMEMORY_EMAIL || '';

// Language code mapping for MyMemory API
const LANGUAGE_CODES = {
  en: 'en',
  ta: 'ta',  // Tamil
  hi: 'hi',  // Hindi
};

// MyMemory serves community-contributed translations, and some of the entries
// in its corpus are themselves mis-encoded — UTF-8 bytes that were once stored
// as Latin-1. Those come back as "à®ªà®¿à®°" instead of "பிர". Our DB and
// connection are utf8mb4, so the damage arrives from the API, not from us.
//
// The signature is a Latin-1 high byte followed by a character in the UTF-8
// continuation range. Real prose never produces that pair — U+0080–U+00BF are
// control/punctuation codepoints, not letters — so this does not fire on
// legitimate accented text like "café" or "Ça va".
// Written with escapes on purpose: the continuation range is control
// characters, which are invisible (and easily corrupted) as source literals.
const MOJIBAKE_PATTERN = /[\u00C2-\u00F4][\u0080-\u00BF]/;

/**
 * Repairs Latin-1-mangled UTF-8, or returns null when the text is beyond repair.
 * Re-decoding only works if every original byte survived; if the round trip
 * yields replacement characters, bytes were already lost and the string is
 * unusable — better to fail the translation than to persist garbage.
 */
const repairMojibake = (text) => {
  if (typeof text !== 'string' || !MOJIBAKE_PATTERN.test(text)) return text;
  const repaired = Buffer.from(text, 'latin1').toString('utf8');
  return repaired.includes('\uFFFD') ? null : repaired;
};

/**
 * Translate text using MyMemory API (Free - 1000 requests/day)
 * @param {string} text - Text to translate
 * @param {string} fromLang - Source language code (e.g., 'en')
 * @param {string} toLang - Target language code (e.g., 'ta', 'hi')
 * @param {boolean} throwOnError - If true, throws errors instead of returning original text
 * @returns {Promise<string>} - Translated text
 */
const translateText = async (text, fromLang = 'en', toLang, throwOnError = true) => {
  // Skip if same language
  if (fromLang === toLang) {
    return text;
  }

  // Skip empty text
  if (!text || text.trim() === '') {
    return text;
  }

  const sourceLang = LANGUAGE_CODES[fromLang] || fromLang;
  const targetLang = LANGUAGE_CODES[toLang] || toLang;

  try {
    const params = {
      q: text,
      langpair: `${sourceLang}|${targetLang}`,
    };

    // Add email for 10,000 requests/day instead of 1,000
    if (MYMEMORY_EMAIL) {
      params.de = MYMEMORY_EMAIL;
    }

    const response = await axios.get(MYMEMORY_API_URL, {
      params,
      timeout: 10000, // 10 second timeout
    });

    // Check for rate limit in response (MyMemory returns 429 status in responseStatus)
    if (response.data && response.data.responseStatus === 429) {
      const error = new Error('Rate limit exceeded');
      error.statusCode = 429;
      throw error;
    }

    if (response.data && response.data.responseStatus === 200) {
      const rawText = response.data.responseData.translatedText;
      const translatedText = repairMojibake(rawText);
      if (translatedText === null) {
        // Corrupted beyond repair — fail so callers keep the existing value
        // rather than writing mojibake into the site.
        const error = new Error('Translation service returned corrupted text');
        error.statusCode = 502;
        throw error;
      }
      logger.logDB('autoTranslate', 'Translation', null, {
        from: fromLang,
        to: toLang,
        original: text.substring(0, 50),
        translated: translatedText.substring(0, 50),
      });
      return translatedText;
    }

    // Check for quota exceeded message
    if (response.data?.responseDetails?.includes('QUOTA')) {
      const error = new Error('Daily quota exceeded');
      error.statusCode = 429;
      throw error;
    }

    // Other API errors
    const error = new Error(`Translation failed: ${response.data?.responseStatus || 'unknown'}`);
    error.statusCode = response.data?.responseStatus || 500;
    throw error;
  } catch (error) {
    // Add statusCode from axios response if available
    if (error.response?.status) {
      error.statusCode = error.response.status;
    }
    logger.logError(error);

    // Throw error for retry logic
    if (throwOnError) {
      throw error;
    }
    // Fallback: return original text
    return text;
  }
};

/**
 * Translate text to multiple languages
 * @param {string} text - Text to translate
 * @param {string} fromLang - Source language code
 * @param {string[]} toLangs - Array of target language codes
 * @returns {Promise<Object>} - Object with language codes as keys and translations as values
 */
const translateToMultiple = async (text, fromLang = 'en', toLangs = []) => {
  const translations = {};

  for (const toLang of toLangs) {
    if (toLang === fromLang) {
      translations[toLang] = text;
    } else {
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      translations[toLang] = await translateText(text, fromLang, toLang);
    }
  }

  return translations;
};

/**
 * Batch translate multiple texts to a single language
 * @param {Array<{key: string, text: string}>} items - Array of items with key and text
 * @param {string} fromLang - Source language code
 * @param {string} toLang - Target language code
 * @returns {Promise<Object>} - Object with keys as keys and translations as values
 */
const batchTranslate = async (items, fromLang = 'en', toLang) => {
  const translations = {};

  for (const item of items) {
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
    translations[item.key] = await translateText(item.text, fromLang, toLang);
  }

  return translations;
};

module.exports = {
  translateText,
  translateToMultiple,
  batchTranslate,
  LANGUAGE_CODES,
};
