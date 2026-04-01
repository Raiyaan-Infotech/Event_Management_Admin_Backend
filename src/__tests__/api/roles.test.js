require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin } = require('../helpers');

describe('Roles & Permissions API', () => {
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

  // ── ROLES ────────────────────────────────────────────────────────
  describe('GET /api/v1/roles', () => {
    it('developer should list all roles', async () => {
      const res = await request(app)
        .get('/api/v1/roles')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('admin should list roles (company scoped)', async () => {
      const res = await request(app)
        .get('/api/v1/roles')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/roles');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/roles/:id', () => {
    it('should get a specific role', async () => {
      const { Role } = require('../../models');
      const role = await Role.findOne({ where: { slug: 'admin' } });

      const res = await request(app)
        .get(`/api/v1/roles/${role.id}`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent role', async () => {
      const res = await request(app)
        .get('/api/v1/roles/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/roles', () => {
    it('developer should create a role', async () => {
      const res = await request(app)
        .post('/api/v1/roles')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          name: `Test Role ${Date.now()}`,
          slug: `test_role_${Date.now()}`,
          level: 10,
          is_active: true,
          company_id: companyId,
        });

      expect([201, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/v1/roles')
        .send({ name: 'Test', slug: 'test', level: 10 });

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/v1/roles/:id', () => {
    it('should update a role', async () => {
      const { Role } = require('../../models');
      const role = await Role.findOne({ where: { slug: 'admin' } });

      const res = await request(app)
        .put(`/api/v1/roles/${role.id}`)
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({ name: 'Admin Updated' });

      expect([200, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });
  });

  describe('DELETE /api/v1/roles/:id', () => {
    it('should delete a custom role', async () => {
      const { Role } = require('../../models');
      // Create a throwaway role
      const temp = await Role.create({
        name: 'Temp Role',
        slug: `temp_role_${Date.now()}`,
        level: 5,
        is_active: true,
        company_id: companyId,
      });

      const res = await request(app)
        .delete(`/api/v1/roles/${temp.id}`)
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId));

      expect([200, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent role', async () => {
      const res = await request(app)
        .delete('/api/v1/roles/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });
  });

  // ── PERMISSIONS ──────────────────────────────────────────────────
  describe('GET /api/v1/permissions', () => {
    it('developer should list all permissions', async () => {
      const res = await request(app)
        .get('/api/v1/permissions')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/permissions');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/permissions/:id', () => {
    it('should get a specific permission', async () => {
      const { Permission } = require('../../models');
      const perm = await Permission.findOne({ where: { slug: 'ads.view' } });

      const res = await request(app)
        .get(`/api/v1/permissions/${perm.id}`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/v1/permissions', () => {
    it('developer should create a permission', async () => {
      const res = await request(app)
        .post('/api/v1/permissions')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          name: `Test Permission ${Date.now()}`,
          slug: `test.perm.${Date.now()}`,
          module: 'test',
          is_active: true,
          company_id: companyId,
        });

      expect([201, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });
  });

});
