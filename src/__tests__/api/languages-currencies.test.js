require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin, getTestCompanyId } = require('../helpers');

describe('Languages & Currencies API', () => {
  let devCookie, superAdminCookie, adminCookie;
  let companyId;

  beforeAll(async () => {
    devCookie = await loginAsDeveloper(app);
    superAdminCookie = await loginAsSuperAdmin(app);
    adminCookie = await loginAsAdmin(app);
    companyId = await getTestCompanyId();
  });

  // ── LANGUAGES ────────────────────────────────────────────────────
  describe('Languages /api/v1/languages', () => {
    let createdLanguageId;

    it('GET /active — should return active languages without auth', async () => {
      const res = await request(app).get('/api/v1/languages/active');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — developer should list all languages', async () => {
      const res = await request(app)
        .get('/api/v1/languages')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — admin should list languages (company scoped)', async () => {
      const res = await request(app)
        .get('/api/v1/languages')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/languages');
      expect(res.status).toBe(401);
    });

    it('POST / — developer should create a language (or 202)', async () => {
      const res = await request(app)
        .post('/api/v1/languages')
        .set('Cookie', devCookie)
        .send({
          name: `Test Language ${Date.now()}`,
          code: `tl${Date.now().toString().slice(-3)}`,
          native_name: 'Test Lang',
          direction: 'ltr',
        });

      expect([201, 202]).toContain(res.status);
      if (res.status === 201) {
        createdLanguageId = res.body.data?.id || res.body.data?.language?.id;
      }
    });

    it('GET /:id — should get a specific language', async () => {
      const { Language } = require('../../models');
      const lang = await Language.findOne();
      if (!lang) return;

      const res = await request(app)
        .get(`/api/v1/languages/${lang.id}`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /:id — should return 404 for non-existent language', async () => {
      const res = await request(app)
        .get('/api/v1/languages/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });

    it('POST / — should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/v1/languages')
        .send({ name: 'Hacker Lang', code: 'hx' });

      expect(res.status).toBe(401);
    });
  });

  // ── CURRENCIES ────────────────────────────────────────────────────
  describe('Currencies /api/v1/currencies', () => {
    let createdCurrencyId;

    it('GET /active — should return active currencies without auth', async () => {
      const res = await request(app).get('/api/v1/currencies/active');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — developer should list all currencies', async () => {
      const res = await request(app)
        .get('/api/v1/currencies')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — admin should list currencies (company scoped)', async () => {
      const res = await request(app)
        .get('/api/v1/currencies')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET / — should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/currencies');
      expect(res.status).toBe(401);
    });

    it('POST / — developer should create a currency (or 202)', async () => {
      // currency code is varchar(3) — use 3-digit unique code
      const code = String(Date.now() % 900 + 100);
      const res = await request(app)
        .post('/api/v1/currencies')
        .set('Cookie', devCookie)
        .send({
          name: `Test Dollar ${code}`,
          code,
          symbol: `$${code.slice(-1)}`,
          exchange_rate: 1.0,
          decimal_places: 2,
          symbol_position: 'before',
        });

      expect([201, 202]).toContain(res.status);
      if (res.status === 201) {
        createdCurrencyId = res.body.data?.id || res.body.data?.currency?.id;
      }
    });

    it('GET /:id — should get a specific currency', async () => {
      const { Currency } = require('../../models');
      const currency = await Currency.findOne();
      if (!currency) return;

      const res = await request(app)
        .get(`/api/v1/currencies/${currency.id}`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /:id — should return 404 for non-existent currency', async () => {
      const res = await request(app)
        .get('/api/v1/currencies/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });

    it('POST / — should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/v1/currencies')
        .send({ name: 'Hacker Coin', code: 'HCK', symbol: 'H' });

      expect(res.status).toBe(401);
    });
  });
});
