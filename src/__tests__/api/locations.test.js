require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, getTestCompanyId } = require('../helpers');

describe('Locations API /api/v1/locations', () => {
  let devCookie, superAdminCookie;
  let companyId;
  let countryId, stateId, districtId;

  beforeAll(async () => {
    devCookie = await loginAsDeveloper(app);
    superAdminCookie = await loginAsSuperAdmin(app);
    companyId = await getTestCompanyId();

    // Grab existing IDs from DB for chained tests
    const { Country, State, District } = require('../../models');
    const country = await Country.findOne();
    const state = await State.findOne();
    const district = await District.findOne();
    countryId = country?.id;
    stateId = state?.id;
    districtId = district?.id;
  });

  // ── PUBLIC READ ROUTES ────────────────────────────────────────────
  describe('Public read endpoints (no auth required)', () => {
    it('GET /countries — should list countries', async () => {
      const res = await request(app).get('/api/v1/locations/countries');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /states — should list all states', async () => {
      const res = await request(app).get('/api/v1/locations/states');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /states/:countryId — should list states by country', async () => {
      if (!countryId) return;
      const res = await request(app).get(`/api/v1/locations/states/${countryId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /districts — should list all districts', async () => {
      const res = await request(app).get('/api/v1/locations/districts');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /districts/:stateId — should list districts by state', async () => {
      if (!stateId) return;
      const res = await request(app).get(`/api/v1/locations/districts/${stateId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /cities — should list all cities', async () => {
      const res = await request(app).get('/api/v1/locations/cities');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /cities/:districtId — should list cities by district', async () => {
      if (!districtId) return;
      const res = await request(app).get(`/api/v1/locations/cities/${districtId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /pincodes/:districtId — should list pincodes by district', async () => {
      if (!districtId) return;
      const res = await request(app).get(`/api/v1/locations/pincodes/${districtId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── PROTECTED CREATE/UPDATE/DELETE ───────────────────────────────
  describe('Protected write endpoints', () => {
    it('POST /countries — should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/v1/locations/countries')
        .send({ name: 'Hacker Country', code: 'HX' });

      expect(res.status).toBe(401);
    });

    it('POST /countries — developer/superadmin should create a country (or 202)', async () => {
      // country code is varchar(3) — keep it to 3 chars
      const code = String(Date.now() % 900 + 100); // 3-digit number (100-999)
      const res = await request(app)
        .post('/api/v1/locations/countries')
        .set('Cookie', devCookie)
        .send({ name: `Test Country ${Date.now()}`, code });

      expect([201, 202]).toContain(res.status);
    });

    it('POST /states — should create a state linked to country (or 202)', async () => {
      if (!countryId) return;
      const res = await request(app)
        .post('/api/v1/locations/states')
        .set('Cookie', devCookie)
        .send({ name: `Test State ${Date.now()}`, country_id: countryId });

      expect([201, 202]).toContain(res.status);
    });

    it('DELETE /countries/:id — should return 404 for non-existent country', async () => {
      const res = await request(app)
        .delete('/api/v1/locations/countries/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });

    it('DELETE /states/:id — should return 404 for non-existent state', async () => {
      const res = await request(app)
        .delete('/api/v1/locations/states/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });
  });
});
