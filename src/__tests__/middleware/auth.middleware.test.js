require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin } = require('../helpers');

describe('Auth Middleware', () => {
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

  // ── isAuthenticated ──────────────────────────────────────────────
  describe('isAuthenticated', () => {
    it('should allow request with valid access_token cookie', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
    });

    it('should block request with no cookies', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/authentication required/i);
    });

    it('should block request with malformed token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', 'access_token=not.a.valid.jwt');

      expect([401, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('should block request with tampered token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', 'access_token=eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.tampered');

      expect([401, 403]).toContain(res.status);
    });
  });

  // ── hasRole ──────────────────────────────────────────────────────
  describe('hasRole (isDeveloper)', () => {
    it('developer should access developer-only routes', async () => {
      const res = await request(app)
        .get('/api/v1/companies')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
    });

    it('admin should be blocked from developer-only routes', async () => {
      const res = await request(app)
        .get('/api/v1/companies')
        .set('Cookie', adminCookie);

      expect([403, 401]).toContain(res.status);
    });

    it('super admin should be blocked from developer-only routes', async () => {
      const res = await request(app)
        .get('/api/v1/companies')
        .set('Cookie', superAdminCookie);

      expect([403, 401]).toContain(res.status);
    });
  });

  // ── hasPermission ────────────────────────────────────────────────
  describe('hasPermission', () => {
    it('admin with ads.view permission should list ads', async () => {
      const res = await request(app)
        .get('/api/v1/ads')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
    });

    it('developer should bypass all permission checks', async () => {
      // Developer has no explicit permissions but bypasses checks
      const res = await request(app)
        .get('/api/v1/ads')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
    });

    it('super admin should bypass all permission checks', async () => {
      const res = await request(app)
        .get('/api/v1/ads')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
    });
  });

  // ── Role hierarchy ────────────────────────────────────────────────
  describe('Role hierarchy levels', () => {
    it('developer (level 1000) should access all routes', async () => {
      const routes = [
        '/api/v1/users',
        '/api/v1/roles',
        '/api/v1/permissions',
        '/api/v1/settings',
        '/api/v1/ads',
        '/api/v1/companies',
      ];

      for (const route of routes) {
        const res = await request(app)
          .get(route)
          .set('Cookie', devCookie);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      }
    });

    it('super admin (level 100) should access company routes', async () => {
      const routes = [
        '/api/v1/users',
        '/api/v1/roles',
        '/api/v1/settings',
        '/api/v1/ads',
        '/api/v1/approvals',
      ];

      for (const route of routes) {
        const res = await request(app)
          .get(route)
          .set('Cookie', superAdminCookie)
          .set('X-Company-Id', String(companyId));
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      }
    });
  });

  // ── Response format ───────────────────────────────────────────────
  describe('API response format', () => {
    it('success response should have correct shape', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', devCookie);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('error response should have correct shape', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('message');
    });

    it('password should never appear in any user response', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', devCookie);

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/"password"/);
      expect(body).not.toMatch(/"password_reset_token"/);
    });
  });

});
