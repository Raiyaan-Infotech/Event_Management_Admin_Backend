require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin, getTestCompanyId } = require('../helpers');

describe('Activity Logs API /api/v1/activity-logs', () => {
  let devCookie, superAdminCookie, adminCookie;
  let companyId;

  beforeAll(async () => {
    devCookie = await loginAsDeveloper(app);
    superAdminCookie = await loginAsSuperAdmin(app);
    adminCookie = await loginAsAdmin(app);
    companyId = await getTestCompanyId();
  });

  // ── GET / ─────────────────────────────────────────────────────────
  describe('GET /api/v1/activity-logs', () => {
    it('developer should list all activity logs', async () => {
      const res = await request(app)
        .get('/api/v1/activity-logs')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('super admin should list activity logs (company scoped)', async () => {
      const res = await request(app)
        .get('/api/v1/activity-logs')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('admin should list activity logs', async () => {
      const res = await request(app)
        .get('/api/v1/activity-logs')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/activity-logs');
      expect(res.status).toBe(401);
    });

    it('should support pagination params', async () => {
      const res = await request(app)
        .get('/api/v1/activity-logs?page=1&limit=5')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── GET /user/:userId ─────────────────────────────────────────────
  describe('GET /api/v1/activity-logs/user/:userId', () => {
    it('should return activity logs for a specific user', async () => {
      const { User } = require('../../models');
      const user = await User.findOne();
      if (!user) return;

      const res = await request(app)
        .get(`/api/v1/activity-logs/user/${user.id}`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/activity-logs/user/1');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /module/:module ───────────────────────────────────────────
  describe('GET /api/v1/activity-logs/module/:module', () => {
    it('should return activity logs for a specific module', async () => {
      const res = await request(app)
        .get('/api/v1/activity-logs/module/auth')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should support users module logs', async () => {
      const res = await request(app)
        .get('/api/v1/activity-logs/module/users')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/activity-logs/module/auth');
      expect(res.status).toBe(401);
    });
  });

  // ── DELETE /clear ─────────────────────────────────────────────────
  describe('DELETE /api/v1/activity-logs/clear', () => {
    it('developer should be able to clear old logs', async () => {
      const res = await request(app)
        .delete('/api/v1/activity-logs/clear')
        .set('Cookie', devCookie)
        .query({ days: 9999 }); // use large value to avoid deleting real test data

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .delete('/api/v1/activity-logs/clear')
        .query({ days: 9999 });

      expect(res.status).toBe(401);
    });
  });
});
