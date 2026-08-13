const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const service = require('../services/companyPublicSite.service');

/**
 * The Host the visitor actually typed. Behind Vercel/Render the origin host is
 * in x-forwarded-host; `?host=` is the local-dev escape hatch, since you cannot
 * point acme.com at localhost.
 */
const requestHost = (req) => req.query.host
  || req.headers['x-forwarded-host']
  || req.headers['x-site-host']
  || req.headers.host;

/**
 * GET /api/v1/public/site/resolve?host=acme.example.com
 * Cheap tenant lookup for middleware: is this host a site, and is it live?
 * Answers 200 with `{ found: false }` rather than 404 so the caller can tell
 * "no such tenant" apart from "the API is down".
 */
const resolvePublicSite = asyncHandler(async (req, res) => {
    const site = await service.resolveSite({
        host: requestHost(req),
        slug: req.query.slug,
        companyId: req.query.company_id,
    });

    if (!site) {
        return ApiResponse.success(res, { found: false }, 'No site for this host');
    }

    return ApiResponse.success(res, {
        found: true,
        id: site.id,
        company_id: site.company_id,
        slug: site.slug,
        custom_domain: site.custom_domain,
        status: site.status,
        is_published: site.status === 'published' && Boolean(site.is_active),
    }, 'Site resolved');
});

/**
 * GET /api/v1/public/site/bundle?host=acme.example.com&lang=ta
 * Everything needed to render any page of the site, in one response.
 */
const getPublicSiteBundle = asyncHandler(async (req, res) => {
    const bundle = await service.getSiteBundle({
        host: requestHost(req),
        slug: req.query.slug,
        companyId: req.query.company_id,
        languageCode: req.query.lang || req.query.code,
    });

    if (!bundle) {
        return ApiResponse.success(res, { found: false }, 'No site for this host');
    }

    return ApiResponse.success(res, { found: true, ...bundle }, 'Site bundle retrieved');
});

module.exports = {
    resolvePublicSite,
    getPublicSiteBundle,
};
