require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin } = require('../helpers');

describe('Users API', () => {
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

  // ── GET /api/v1/users ────────────────────────────────────────────
  describe('GET /api/v1/users', () => {
    it('developer should list all users', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('admin should list users (company scoped)', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should support pagination params', async () => {
      const res = await request(app)
        .get('/api/v1/users?page=1&limit=5')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should support search param', async () => {
      const res = await request(app)
        .get('/api/v1/users?search=admin')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/users');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/v1/users/:id ────────────────────────────────────────
  describe('GET /api/v1/users/:id', () => {
    it('developer should get a specific user', async () => {
      const { User } = require('../../models');
      const user = await User.findOne({ where: { email: 'admin@admin.com' } });

      const res = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('admin@admin.com');
    });

    it('should return 404 for non-existent user', async () => {
      const res = await request(app)
        .get('/api/v1/users/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/users/1');
      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/v1/users ───────────────────────────────────────────
  describe('POST /api/v1/users', () => {
    it('developer should create a new user (or trigger approval)', async () => {
      const { Role } = require('../../models');
      const role = await Role.findOne({ where: { slug: 'admin' } });

      const res = await request(app)
        .post('/api/v1/users')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          full_name: 'New Test User',
          email: `newuser_${Date.now()}@test.com`,
          password: 'Test@1234',
          role_id: role.id,
          company_id: companyId,
        });

      // 201 = created, 202 = approval required
      expect([201, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('should reject duplicate email', async () => {
      const { Role } = require('../../models');
      const role = await Role.findOne({ where: { slug: 'admin' } });

      const res = await request(app)
        .post('/api/v1/users')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          full_name: 'Duplicate User',
          email: 'admin@admin.com', // already exists
          password: 'Test@1234',
          role_id: role.id,
          company_id: companyId,
        });

      expect([409, 400]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .send({ full_name: 'Test', email: 'x@x.com', password: '123' });

      expect(res.status).toBe(401);
    });
  });

  // ── PUT /api/v1/users/:id ────────────────────────────────────────
  describe('PUT /api/v1/users/:id', () => {
    it('developer should update a user (or trigger approval)', async () => {
      const { User } = require('../../models');
      const user = await User.findOne({ where: { email: 'admin@admin.com' } });

      const res = await request(app)
        .put(`/api/v1/users/${user.id}`)
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({ full_name: 'Admin Updated' });

      expect([200, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent user', async () => {
      const res = await request(app)
        .put('/api/v1/users/999999')
        .set('Cookie', devCookie)
        .send({ full_name: 'Ghost' });

      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /api/v1/users/:id/status ──────────────────────────────
  describe('PATCH /api/v1/users/:id/status', () => {
    it('developer should toggle user status', async () => {
      const { User } = require('../../models');
      const user = await User.findOne({ where: { email: 'admin@admin.com' } });

      const res = await request(app)
        .patch(`/api/v1/users/${user.id}/status`)
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({ is_active: 0 });

      expect([200, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);

      // Restore
      await User.update({ is_active: 1 }, { where: { id: user.id } });
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .patch('/api/v1/users/1/status')
        .send({ is_active: 1 });

      expect(res.status).toBe(401);
    });
  });

  // ── DELETE /api/v1/users/:id ─────────────────────────────────────
  describe('DELETE /api/v1/users/:id', () => {
    it('developer should delete a user (or trigger approval)', async () => {
      const { User, Role } = require('../../models');
      const role = await Role.findOne({ where: { slug: 'admin' } });

      // Create a temporary user to delete
      const temp = await User.create({
        full_name: 'Temp Delete User',
        email: `temp_delete_${Date.now()}@test.com`,
        password: 'Test@1234',
        role_id: role.id,
        company_id: companyId,
        is_active: 1,
      });

      const res = await request(app)
        .delete(`/api/v1/users/${temp.id}`)
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId));

      expect([200, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent user', async () => {
      const res = await request(app)
        .delete('/api/v1/users/999999')
        .set('Cookie', devCookie);

      expect(res.status).toBe(404);
    });
  });

});
