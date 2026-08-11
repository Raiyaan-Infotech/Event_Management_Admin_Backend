const axios = require('axios');
const logger = require('../utils/logger');

const MYMEMORY_API_URL = 'https://api.mymemory.translated.net/get';

// MyMemory's quota is CHARACTER-based and keyed on the `de` (email) param:
// 5,000 chars/day anonymous, 50,000 with an email. MYMEMORY_EMAIL accepts a
// comma-separated list, and when one address is spent the next one takes over
// mid-run instead of the whole translation failing.
//
// Caveat worth knowing: MyMemory also rate-limits by IP. Two addresses from the
// same server usually do give the full 2x, but if it ever caps per-IP the
// failover simply costs one wasted request and we stop where we would have
// stopped anyway.
const MYMEMORY_EMAILS = (process.env.MYMEMORY_EMAIL || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

// Addresses whose daily quota is spent, and the UTC day that applies to.
// MyMemory's quota resets at UTC midnight, so the set is cleared when the day
// rolls over. In-memory only: a restart just re-tries the first address, which
// costs one request to rediscover.
let exhaustedEmails = new Set();
let exhaustedDay = null;

const currentUtcDay = () => new Date().toISOString().slice(0, 10);

const resetExhaustedIfNewDay = () => {
  const today = currentUtcDay();
  if (exhaustedDay !== today) {
    exhaustedDay = today;
    exhaustedEmails = new Set();
  }
};

/**
 * Addresses still believed to have quota, in configured order.
 * Returns [''] when none are configured so the anonymous path still works, and
 * when every address is spent so the caller gets a real 429 from the API rather
 * than a synthetic one.
 */
const availableEmails = () => {
  resetExhaustedIfNewDay();
  if (!MYMEMORY_EMAILS.length) return [''];
  const usable = MYMEMORY_EMAILS.filter((e) => !exhaustedEmails.has(e));
  return usable.length ? usable : [MYMEMORY_EMAILS[MYMEMORY_EMAILS.length - 1]];
};

const markExhausted = (email) => {
  if (!email) return;
  resetExhaustedIfNewDay();
  if (!exhaustedEmails.has(email)) {
    exhaustedEmails.add(email);
    logger.logDB('autoTranslate', 'QuotaExhausted', null, {
      email,
      remaining: MYMEMORY_EMAILS.filter((e) => !exhaustedEmails.has(e)).length,
    });
  }
};

const isQuotaError = (err) => err?.statusCode === 429;

// MyMemory reports an exhausted allowance in two different wordings, and only
// one of them contains the word QUOTA. The other is the plain-English warning
// below, so matching on QUOTA alone misses the most common case.
const QUOTA_MESSAGE_PATTERN = /QUOTA|ALL AVAILABLE FREE TRANSLATIONS|MYMEMORY WARNING/i;

const isQuotaMessage = (details) =>
  typeof details === 'string' && QUOTA_MESSAGE_PATTERN.test(details);

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

  // Try each address that still has quota. A 429 retires that address and the
  // loop moves on; any other error aborts, since retrying it on a different
  // email would just repeat the same failure.
  const emails = availableEmails();
  let lastError = null;

  for (let i = 0; i < emails.length; i += 1) {
    const email = emails[i];
    try {
      return await requestTranslation(text, sourceLang, targetLang, email, fromLang, toLang);
    } catch (error) {
      lastError = error;
      if (!isQuotaError(error) || !email) break;
      markExhausted(email);
      // Fall through to the next address; if that was the last one the loop
      // ends and lastError (the 429) is what the caller sees.
    }
  }

  logger.logError(lastError);
  if (throwOnError) throw lastError;
  return text;
};

/**
 * One MyMemory request against one email address.
 * Throws on quota (429), corruption (502) and any other API failure so the
 * caller above can decide whether a different address is worth trying.
 */
const requestTranslation = async (text, sourceLang, targetLang, email, fromLang, toLang) => {
  try {
    const params = {
      q: text,
      langpair: `${sourceLang}|${targetLang}`,
    };

    if (email) {
      params.de = email;
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

    // Quota has to be checked BEFORE the success branch. When the daily
    // allowance is spent MyMemory answers `responseStatus: 200` and puts the
    // warning in responseDetails, echoing the source text back as the
    // "translation". Checked after the 200 branch (as it was), that echo is
    // saved as a real translation and the quota is never detected — so nothing
    // would ever trigger the failover to the next address.
    if (isQuotaMessage(response.data?.responseDetails)) {
      const error = new Error('Daily quota exceeded');
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

    // Other API errors
    const error = new Error(`Translation failed: ${response.data?.responseStatus || 'unknown'}`);
    error.statusCode = response.data?.responseStatus || 500;
    throw error;
  } catch (error) {
    // Add statusCode from axios response if available
    if (error.response?.status) {
      error.statusCode = error.response.status;
    }
    // Always throws: translateText owns the decision to fall back to the next
    // email, and only it knows whether the caller wanted throwOnError.
    throw error;
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

/** Quota-pool state, for logging and for reporting a run that ran dry. */
const getQuotaStatus = () => {
  resetExhaustedIfNewDay();
  return {
    configured: MYMEMORY_EMAILS.length,
    exhausted: [...exhaustedEmails],
    remaining: MYMEMORY_EMAILS.filter((e) => !exhaustedEmails.has(e)).length,
    allExhausted:
      MYMEMORY_EMAILS.length > 0 && exhaustedEmails.size >= MYMEMORY_EMAILS.length,
  };
};

module.exports = {
  translateText,
  translateToMultiple,
  batchTranslate,
  getQuotaStatus,
  LANGUAGE_CODES,
};
