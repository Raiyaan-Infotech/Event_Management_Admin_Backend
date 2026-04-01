require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin, getTestCompanyId } = require('../helpers');

describe('Translations & Translation Keys API', () => {
  let devCookie, superAdminCookie, adminCookie;
  let companyId;

  beforeAll(async () => {
    devCookie = await loginAsDeveloper(app);
    superAdminCookie = await loginAsSuperAdmin(app);
    adminCookie = await loginAsAdmin(app);
    companyId = await getTestCompanyId();
  });

  // ── TRANSLATIONS (public + utility endpoints) ─────────────────────
  describe('Translations /api/v1/translations', () => {
    it('GET /stats — should return translation statistics (public)', async () => {
      const res = await request(app).get('/api/v1/translations/stats');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /groups — should return translation groups (public)', async () => {
      const res = await request(app).get('/api/v1/translations/groups');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /export — should export all translations (public)', async () => {
      const res = await request(app).get('/api/v1/translations/export');
      expect(res.status).toBe(200);
    });

    it('GET /missing/count — should return count of missing keys (public)', async () => {
      const res = await request(app).get('/api/v1/translations/missing/count');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /:langCode — should return translations for a language (public)', async () => {
      const { Language } = require('../../models');
      const lang = await Language.findOne({ where: { is_active: 1 } });
      if (!lang) return;

      const res = await request(app).get(`/api/v1/translations/${lang.code}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /report-missing — should accept missing key report (public)', async () => {
      const res = await request(app)
        .post('/api/v1/translations/report-missing')
        .send({
          key: `test.missing.key.${Date.now()}`,
          default_value: 'Test missing key',
          page_url: '/test-page',
        });

      expect([200, 201]).toContain(res.status);
    });

    it('GET /missing — should require auth to list missing translations', async () => {
      const unauth = await request(app).get('/api/v1/translations/missing');
      expect(unauth.status).toBe(401);

      const auth = await request(app)
        .get('/api/v1/translations/missing')
        .set('Cookie', devCookie);
      expect(auth.status).toBe(200);
    });
  });

  // ── TRANSLATION KEYS ──────────────────────────────────────────────
  describe('Translation Keys /api/v1/translation-keys', () => {
    let createdKeyId;

    it('GET / — developer should list all translation keys', async () => {
      const res = await request(app)
        .get('/api/v1/translation-keys')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — admin should list translation keys (company scoped)', async () => {
      const res = await request(app)
        .get('/api/v1/translation-keys')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/translation-keys');
      expect(res.status).toBe(401);
    });

    it('POST / — developer should create a translation key (or 202)', async () => {
      const uniqueKey = `test.key.${Date.now()}`;
      const res = await request(app)
        .post('/api/v1/translation-keys')
        .set('Cookie', devCookie)
        .send({
          key: uniqueKey,
          default_value: 'Test translation key value',
          group: 'test',
          auto_translate: false,
        });

      expect([201, 202]).toContain(res.status);
      if (res.status === 201) {
        createdKeyId = res.body.data?.id || res.body.data?.translationKey?.id;
      }
    });

    it('GET /:id — should get a specific translation key', async () => {
      const { TranslationKey } = require('../../models');
      const key = await TranslationKey.findOne();
      if (!key) return;

      const res = await request(app)
        .get(`/api/v1/translation-keys/${key.id}`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /:id — should return 404 for non-existent key', async () => {
      const res = await request(app)
        .get('/api/v1/translation-keys/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });

    it('GET /:id/translations — should return translations for a key', async () => {
      const { TranslationKey } = require('../../models');
      const key = await TranslationKey.findOne();
      if (!key) return;

      const res = await request(app)
        .get(`/api/v1/translation-keys/${key.id}/translations`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST / — should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/v1/translation-keys')
        .send({ key: 'hacker.key', default_value: 'hack', group: 'hack' });

      expect(res.status).toBe(401);
    });
  });
});
