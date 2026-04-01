require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsAdmin } = require('../helpers');

describe('Auth API', () => {

  // ── POST /api/v1/auth/login ──────────────────────────────────────
  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials and set cookies', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'developer@admin.com', password: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe('developer@admin.com');
      expect(res.body.data.user.password).toBeUndefined(); // never expose password
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should reject wrong password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'developer@admin.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-existent email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@nowhere.com', password: '123456' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject inactive user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'inactive@admin.com', password: '123456' });

      // Either 401 (user not found) or 403 (inactive) — both are rejections
      expect([401, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('should reject missing email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ password: '123456' });

      expect([400, 401]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  // ── GET /api/v1/auth/me ──────────────────────────────────────────
  describe('GET /api/v1/auth/me', () => {
    it('should return current user profile when authenticated', async () => {
      const cookie = await loginAsDeveloper(app);

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('developer@admin.com');
      expect(res.body.data.user.role).toBeDefined();
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid cookie', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', 'access_token=invalidtoken123');

      expect([401, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  // ── POST /api/v1/auth/logout ─────────────────────────────────────
  describe('POST /api/v1/auth/logout', () => {
    it('should logout and clear cookies', async () => {
      const cookie = await loginAsDeveloper(app);

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject logout without authentication', async () => {
      const res = await request(app).post('/api/v1/auth/logout');
      expect(res.status).toBe(401);
    });
  });

  // ── PUT /api/v1/auth/update-profile ─────────────────────────────
  describe('PUT /api/v1/auth/update-profile', () => {
    it('should update profile successfully', async () => {
      const cookie = await loginAsAdmin(app);

      const res = await request(app)
        .put('/api/v1/auth/update-profile')
        .set('Cookie', cookie)
        .send({ full_name: 'Updated Admin Name' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject without authentication', async () => {
      const res = await request(app)
        .put('/api/v1/auth/update-profile')
        .send({ full_name: 'Test' });

      expect(res.status).toBe(401);
    });
  });

  // ── PUT /api/v1/auth/change-password ────────────────────────────
  describe('PUT /api/v1/auth/change-password', () => {
    it('should reject wrong current password', async () => {
      const cookie = await loginAsAdmin(app);

      const res = await request(app)
        .put('/api/v1/auth/change-password')
        .set('Cookie', cookie)
        .send({ current_password: 'wrongpass', new_password: 'NewPass@123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject without authentication', async () => {
      const res = await request(app)
        .put('/api/v1/auth/change-password')
        .send({ current_password: '123456', new_password: 'NewPass@123' });

      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/v1/auth/forgot-password ───────────────────────────
  describe('POST /api/v1/auth/forgot-password', () => {
    it('should return success for existing email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'admin@admin.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return success even for non-existent email (no enumeration)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nobody@nowhere.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── POST /api/v1/auth/verify-reset-otp ──────────────────────────
  describe('POST /api/v1/auth/verify-reset-otp', () => {
    it('should reject invalid OTP', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-reset-otp')
        .send({ email: 'admin@admin.com', otp: '000000' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

});
