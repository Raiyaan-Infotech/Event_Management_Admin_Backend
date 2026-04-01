require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin } = require('../helpers');

describe('Settings API', () => {
  let devCookie, superAdminCookie, adminCookie;
  let companyId;

  beforeAll(async () => {
    devCookie = await loginAsDeveloper(app);
    superAdminCookie = await loginAsSuperAdmin(app);
    adminCookie = await loginAsAdmin(app);

    const { Company } = require('../../models');
    const company = await Company.findOne({ where: { name: 'Default Company' } });
    companyId = company.id;
  });

  // ── GET /api/v1/settings/public ─────────────────────────────────
  describe('GET /api/v1/settings/public', () => {
    it('should return public settings without auth', async () => {
      const res = await request(app).get('/api/v1/settings/public');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── GET /api/v1/settings ─────────────────────────────────────────
  describe('GET /api/v1/settings', () => {
    it('developer should list all settings', async () => {
      const res = await request(app)
        .get('/api/v1/settings')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('admin should list settings (company scoped)', async () => {
      const res = await request(app)
        .get('/api/v1/settings')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/settings');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/v1/settings/group/:group ───────────────────────────
  describe('GET /api/v1/settings/group/:group', () => {
    it('should list settings by group', async () => {
      const res = await request(app)
        .get('/api/v1/settings/group/general')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── GET /api/v1/settings/:key ────────────────────────────────────
  describe('GET /api/v1/settings/:key', () => {
    it('should get a setting by key', async () => {
      const { Setting } = require('../../models');
      const setting = await Setting.findOne({ where: { is_active: true } });

      if (setting) {
        const res = await request(app)
          .get(`/api/v1/settings/${setting.key}`)
          .set('Cookie', devCookie);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }
    });

    it('should return 404 for non-existent key', async () => {
      const res = await request(app)
        .get('/api/v1/settings/non_existent_key_xyz')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });
  });

  // ── PUT /api/v1/settings/:key ────────────────────────────────────
  describe('PUT /api/v1/settings/:key', () => {
    it('developer should update a setting (or trigger approval)', async () => {
      const { Setting } = require('../../models');
      const setting = await Setting.findOne({ where: { is_active: true } });

      if (setting) {
        const res = await request(app)
          .put(`/api/v1/settings/${setting.key}`)
          .set('Cookie', devCookie)
          .set('X-Company-Id', String(companyId))
          .send({ value: setting.value });

        expect([200, 202]).toContain(res.status);
        expect(res.body.success).toBe(true);
      }
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .put('/api/v1/settings/some_key')
        .send({ value: 'test' });

      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/v1/settings/bulk ───────────────────────────────────
  describe('POST /api/v1/settings/bulk', () => {
    it('developer should bulk update settings', async () => {
      const { Setting } = require('../../models');
      const settings = await Setting.findAll({ where: { is_active: true }, limit: 2 });

      if (settings.length > 0) {
        const updates = settings.map(s => ({ key: s.key, value: s.value }));

        const res = await request(app)
          .post('/api/v1/settings/bulk')
          .set('Cookie', devCookie)
          .set('X-Company-Id', String(companyId))
          .send({ settings: updates });

        expect([200, 202]).toContain(res.status);
        expect(res.body.success).toBe(true);
      }
    });
  });

});
