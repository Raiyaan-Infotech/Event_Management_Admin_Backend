const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { Op } = require('sequelize');
const { TemplateFont } = require('../models');
const mediaService = require('./media.service');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

/**
 * Fonts the admin added for invitation templates (Templates → Fonts).
 *
 * The template wizard offers its ten built-in fonts PLUS every active row
 * here; a template stores the font's NAME, exactly as it does for a built-in.
 * The client portal and the admin preview load an added font through
 * `GET /template-fonts/:id/file` (an upload) or the link itself (a stylesheet).
 */

/** What a font file may be, and the type a browser expects it served as. */
const FORMATS = {
    '.ttf': { format: 'TTF', mime: 'font/ttf' },
    '.otf': { format: 'OTF', mime: 'font/otf' },
    '.woff': { format: 'WOFF', mime: 'font/woff' },
    '.woff2': { format: 'WOFF2', mime: 'font/woff2' },
};

const formatOf = (name) => FORMATS[path.extname(String(name || '').split('?')[0]).toLowerCase()] || null;

const cleanName = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);

/**
 * A family name goes into CSS (`font-family: "<name>"`) on three frontends, so
 * it is letters, digits, spaces and a few joining marks — never a quote, a
 * semicolon or a brace.
 */
const assertName = (name) => {
    if (!name) throw ApiError.badRequest('Please enter the font name.');
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.\-]*$/.test(name)) {
        throw ApiError.badRequest('A font name may contain letters, numbers, spaces, hyphens, dots and underscores only.');
    }
};

const assertLink = (raw) => {
    const link = String(raw ?? '').trim();
    if (!link) throw ApiError.badRequest('Please enter the font link.');
    if (link.length > 1000) throw ApiError.badRequest('That link is too long.');
    let url;
    try {
        url = new URL(link);
    } catch {
        throw ApiError.badRequest('Please enter a valid link, starting with https://');
    }
    if (url.protocol !== 'https:') throw ApiError.badRequest('The font link must start with https://');
    return url.toString();
};

const scope = (companyId) => (companyId ? { company_id: companyId } : {});

const assertUnique = async (name, companyId, exceptId = null) => {
    const clash = await TemplateFont.findOne({
        where: { ...scope(companyId), name, ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) },
        attributes: ['id'],
    });
    if (clash) throw ApiError.badRequest(`A font named "${name}" already exists.`);
};

const toPlain = (row) => {
    const p = row.toJSON ? row.toJSON() : { ...row };
    // A stylesheet link names its own families; a file link is a single font.
    p.link_kind = p.source === 'link' ? (formatOf(p.link_url) ? 'file' : 'stylesheet') : null;
    return p;
};

const getAll = async (query = {}, companyId) => {
    const where = { ...scope(companyId) };
    if (query.search) where.name = { [Op.like]: `%${String(query.search).trim()}%` };
    if (query.source === 'upload' || query.source === 'link') where.source = query.source;
    if (query.is_active !== undefined && query.is_active !== '') where.is_active = Number(query.is_active) ? 1 : 0;

    const rows = await TemplateFont.findAll({ where, order: [['name', 'ASC']] });
    return rows.map(toPlain);
};

const getById = async (id, companyId) => {
    const row = await TemplateFont.findOne({ where: { id, ...scope(companyId) } });
    if (!row) throw ApiError.notFound('Font not found.');
    return row;
};

/**
 * Add a font. `file` (multer, in memory) makes it an upload; without one the
 * body's `link_url` makes it a link.
 */
const create = async (body, file, userId, companyId) => {
    const name = cleanName(body.name);
    assertName(name);
    await assertUnique(name, companyId);

    const data = {
        name,
        is_active: body.is_active === undefined ? 1 : (Number(body.is_active) ? 1 : 0),
        company_id: companyId || null,
        created_by: userId || null,
    };

    if (file) {
        const kind = formatOf(file.originalname);
        if (!kind) throw ApiError.badRequest('Upload a TTF, OTF, WOFF or WOFF2 font file.');
        const stored = await mediaService.upload(file, { folder: 'template-fonts' }, companyId || 1);
        Object.assign(data, {
            source: 'upload',
            file_url: stored.url,
            file_name: String(file.originalname).slice(0, 255),
            file_format: kind.format,
            file_size: file.size,
        });
    } else {
        Object.assign(data, { source: 'link', link_url: assertLink(body.link_url) });
    }

    const row = await TemplateFont.create(data);
    logger.logDB('create', 'TemplateFont', row.id, { name, source: data.source });
    return toPlain(row);
};

/** Rename, switch on / off, or change a link font's address. The file of an upload is not replaced. */
const update = async (id, body, userId, companyId) => {
    const row = await getById(id, companyId);
    const patch = { updated_by: userId || null };

    if (body.name !== undefined) {
        const name = cleanName(body.name);
        assertName(name);
        if (name !== row.name) await assertUnique(name, companyId, row.id);
        patch.name = name;
    }
    if (body.is_active !== undefined) patch.is_active = Number(body.is_active) ? 1 : 0;
    if (body.link_url !== undefined && row.source === 'link') patch.link_url = assertLink(body.link_url);

    await row.update(patch);
    return toPlain(row);
};

const remove = async (id, companyId) => {
    const row = await getById(id, companyId);
    await row.destroy();
    return true;
};

/**
 * The active fonts, as the renderers need them — name and where to load it
 * from. Used by the client's event options. Never throws: a database that has
 * not had `template_fonts` created yet must not take the event wizard down
 * with it, so that case answers with no added fonts.
 */
const listForRender = async (companyId) => {
    try {
        const rows = await TemplateFont.findAll({
            where: { ...scope(companyId), is_active: 1 },
            attributes: ['id', 'name', 'source', 'link_url'],
            order: [['name', 'ASC']],
        });
        return rows.map(toPlain).map((f) => ({
            id: f.id, name: f.name, source: f.source, link_url: f.link_url, link_kind: f.link_kind,
        }));
    } catch (error) {
        logger.logError(error);
        return [];
    }
};

/**
 * The bytes of an UPLOADED font, for `GET /template-fonts/:id/file`.
 *
 * Served by the API rather than straight from storage because a browser only
 * accepts a web font from another origin when the response carries CORS
 * headers, and a bucket or CDN is not guaranteed to send them. This route
 * always does.
 */
const readFile = async (id) => {
    const row = await TemplateFont.findOne({ where: { id, is_active: 1, source: 'upload' } });
    if (!row || !row.file_url) throw ApiError.notFound('Font not found.');
    const kind = formatOf(row.file_name) || formatOf(row.file_url);
    const mime = kind ? kind.mime : 'application/octet-stream';

    const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    for (const prefix of ['/uploads/', appUrl ? `${appUrl}/uploads/` : null]) {
        if (prefix && row.file_url.startsWith(prefix)) {
            const root = path.resolve(__dirname, '../../uploads');
            const full = path.resolve(root, row.file_url.slice(prefix.length));
            if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) {
                throw ApiError.notFound('That font file no longer exists.');
            }
            return { buffer: fs.readFileSync(full), mime };
        }
    }

    // In remote storage. The address is one this service wrote itself at
    // upload, not anything a visitor supplied.
    const res = await axios.get(row.file_url, { responseType: 'arraybuffer', timeout: 15000 });
    return { buffer: Buffer.from(res.data), mime };
};

module.exports = { getAll, getById, create, update, remove, listForRender, readFile, FORMATS };
