const service = require('../services/websiteBuilderTranslation.service');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');

const getCompanyId = (req) => req.companyId || req.user?.company_id || 1;

const getBuilderLanguages = asyncHandler(async (req, res) => {
  const data = await service.getLanguages(getCompanyId(req));
  return ApiResponse.success(res, data, 'Languages retrieved');
});

const createBuilderLanguage = asyncHandler(async (req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name) throw ApiError.badRequest('code and name are required');
  const data = await service.createLanguage(getCompanyId(req), req.body || {});
  return ApiResponse.created(res, data, 'Language created');
});

const updateBuilderLanguage = asyncHandler(async (req, res) => {
  const companyId = getCompanyId(req);
  const languages = await service.getLanguages(companyId);
  const target = languages.find((lang) => String(lang.id) === String(req.params.id));
  if (!target) throw ApiError.notFound('Language not found');
  if (target.is_default && req.body?.is_active === false) {
    throw ApiError.badRequest('The default language cannot be deactivated');
  }
  const data = await service.updateLanguage(companyId, req.params.id, req.body || {});
  return ApiResponse.success(res, data, 'Language updated');
});

const setDefaultBuilderLanguage = asyncHandler(async (req, res) => {
  const data = await service.setDefaultLanguage(getCompanyId(req), req.params.id);
  if (!data) throw ApiError.notFound('Language not found');
  return ApiResponse.success(res, data, 'Default language updated');
});

const deleteBuilderLanguage = asyncHandler(async (req, res) => {
  const companyId = getCompanyId(req);
  const languages = await service.getLanguages(companyId);
  const target = languages.find((lang) => String(lang.id) === String(req.params.id));
  if (target?.is_default) {
    throw ApiError.badRequest('The default language cannot be deleted');
  }
  const data = await service.deleteLanguage(companyId, req.params.id);
  return ApiResponse.success(res, data, 'Language deleted');
});

const getContentTranslations = asyncHandler(async (req, res) => {
  const { section, page_slug, record_id } = req.query;
  if (!section) throw ApiError.badRequest('section is required');
  const data = await service.getContentTranslations(
    getCompanyId(req),
    section,
    page_slug,
    record_id ? Number(record_id) : 0
  );
  return ApiResponse.success(res, data, 'Content translations retrieved');
});

const saveContentTranslations = asyncHandler(async (req, res) => {
  const { section, page_slug, record_id, language_id, values } = req.body || {};
  if (!section || !language_id) throw ApiError.badRequest('section and language_id are required');
  const data = await service.saveContentTranslations(getCompanyId(req), {
    section,
    page_slug,
    record_id,
    language_id,
    values,
  });
  return ApiResponse.success(res, data, 'Content translations saved');
});

// Whole-site translation overlay for one language — what the rendered website
// loads once on page load instead of fetching each slot separately.
const getTranslationBundle = asyncHandler(async (req, res) => {
  const { language_id, lang, code } = req.query;
  const target = language_id || code || lang;
  if (!target) throw ApiError.badRequest('language_id or code is required');

  const data = await service.getTranslationBundle(getCompanyId(req), {
    language_id,
    code: code || lang,
  });
  // An unknown or deactivated language is not an error for the public site —
  // it just renders the base English content.
  if (!data) return ApiResponse.success(res, { language: null, translations: {} }, 'Language not available');
  return ApiResponse.success(res, data, 'Translation bundle retrieved');
});

const getPublicLanguages = asyncHandler(async (req, res) => {
  const data = await service.getPublicLanguages(getCompanyId(req));
  return ApiResponse.success(res, data, 'Public languages retrieved');
});

// Server-Sent Events variant of auto-translate, so the UI can show a real
// percentage instead of an indeterminate spinner. The work is paced at ~350ms
// per key server-side, so a section with many fields takes long enough that
// progress genuinely matters.
//
// EventSource cannot set custom headers, so company scoping falls back to the
// `company_id` query param (already supported by optionalCompanyAuth) or the
// auth cookie. Not wrapped in asyncHandler — this writes the response stream
// itself rather than returning an ApiResponse.
const autoTranslateContentStream = async (req, res) => {
  const { section, page_slug = '', record_id = 0, language_id, all_languages } = req.query;
  // Defaults to every active language. Pass all_languages=false with a
  // language_id to translate just one.
  const allLanguages = !(all_languages === 'false' || all_languages === '0');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this, nginx/proxies buffer the stream and every event arrives at once.
    'X-Accel-Buffering': 'no',
  });

  const send = (event, payload) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  if (!section) {
    send('error', { message: 'section is required' });
    return res.end();
  }

  // If the admin closes the tab mid-run, stop writing. Work already saved to
  // the DB stays saved — autoTranslateContent persists per section at the end,
  // and translateAll persists per key.
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  try {
    const result = await service.autoTranslateContent(
      getCompanyId(req),
      {
        section,
        page_slug,
        record_id: Number(record_id) || 0,
        language_id,
        all_languages: allLanguages,
      },
      (progress) => {
        if (!aborted) send('progress', progress);
      }
    );

    if (!result) send('error', { message: 'No active language to translate into' });
    else send('complete', { translations: result });
  } catch (err) {
    send('error', { message: err?.message || 'Failed to auto-translate' });
  }

  res.end();
};

const registerTranslationKeys = asyncHandler(async (req, res) => {
  const { section, page_slug, record_id, fields } = req.body || {};
  if (!section || !Array.isArray(fields)) throw ApiError.badRequest('section and fields[] are required');
  const data = await service.registerKeys(getCompanyId(req), { section, page_slug, record_id, fields });
  return ApiResponse.success(res, data, 'Translation keys registered');
});

const listTranslationKeys = asyncHandler(async (req, res) => {
  const { section, page_slug, search } = req.query;
  // Always rescan content tables first so values already saved in the DB show up
  // without the admin having to re-save each section.
  const data = await service.listKeys(getCompanyId(req), { section, page_slug, search, sync: true });
  return ApiResponse.success(res, data, 'Translation keys retrieved');
});

const getTranslationStats = asyncHandler(async (req, res) => {
  const data = await service.getStats(getCompanyId(req));
  return ApiResponse.success(res, data, 'Translation stats retrieved');
});

const saveKeyTranslations = asyncHandler(async (req, res) => {
  const { translations } = req.body || {};
  if (!Array.isArray(translations)) throw ApiError.badRequest('translations[] is required');
  const data = await service.saveKeyTranslations(getCompanyId(req), req.params.id, translations);
  if (!data) throw ApiError.notFound('Translation key not found');
  return ApiResponse.success(res, data, 'Translations saved');
});

const deleteTranslationKey = asyncHandler(async (req, res) => {
  const data = await service.deleteKey(getCompanyId(req), req.params.id);
  if (!data) throw ApiError.notFound('Translation key not found');
  return ApiResponse.success(res, data, 'Translation key deleted');
});

const retranslateTranslationKey = asyncHandler(async (req, res) => {
  const data = await service.retranslateKey(getCompanyId(req), req.params.id);
  if (!data) throw ApiError.notFound('Translation key not found');
  return ApiResponse.success(res, data, 'Key re-translated');
});

const listTranslationSections = asyncHandler(async (req, res) => {
  const companyId = getCompanyId(req);
  await service.syncKeysFromContent(companyId);
  const data = await service.listSections(companyId);
  return ApiResponse.success(res, data, 'Sections retrieved');
});

const translateAllToLanguage = asyncHandler(async (req, res) => {
  // `overwrite: true` re-translates fields that already have a value.
  // Human-reviewed translations are always preserved.
  const overwrite = req.body?.overwrite === true;
  const data = await service.translateAllToLanguage(getCompanyId(req), req.params.id, {
    skipExisting: !overwrite,
  });
  if (!data) throw ApiError.notFound('Language not found');
  if (data.isDefault) throw ApiError.badRequest('The default language is the translation source');
  return ApiResponse.success(res, data, 'Translation completed');
});

const autoTranslateContent = asyncHandler(async (req, res) => {
  const { section, page_slug, record_id, language_id, all_languages } = req.body || {};
  // language_id is no longer required: with no id this fills every active
  // language, which is the default behaviour of the section translate button.
  if (!section) throw ApiError.badRequest('section is required');
  const data = await service.autoTranslateContent(getCompanyId(req), {
    section,
    page_slug,
    record_id,
    language_id,
    all_languages: all_languages !== false && all_languages !== 'false',
  });
  if (!data) throw ApiError.notFound('No active language to translate into');
  return ApiResponse.success(res, data, 'Content auto-translated');
});

module.exports = {
  getBuilderLanguages,
  createBuilderLanguage,
  updateBuilderLanguage,
  setDefaultBuilderLanguage,
  deleteBuilderLanguage,
  getContentTranslations,
  getTranslationBundle,
  getPublicLanguages,
  saveContentTranslations,
  registerTranslationKeys,
  listTranslationKeys,
  listTranslationSections,
  getTranslationStats,
  saveKeyTranslations,
  deleteTranslationKey,
  retranslateTranslationKey,
  translateAllToLanguage,
  autoTranslateContent,
  autoTranslateContentStream,
};
