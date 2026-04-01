require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin, getTestCompanyId } = require('../helpers');
const path = require('path');
const fs = require('fs');

describe('Media API /api/v1/media', () => {
  let devCookie, superAdminCookie;
  let companyId;

  beforeAll(async () => {
    devCookie = await loginAsDeveloper(app);
    superAdminCookie = await loginAsSuperAdmin(app);
    companyId = await getTestCompanyId();
  });

  // ── GET /files ────────────────────────────────────────────────────
  describe('GET /api/v1/media/files', () => {
    it('should list files in the uploads folder', async () => {
      const res = await request(app)
        .get('/api/v1/media/files')
        .set('Cookie', devCookie)
        .query({ folder: 'uploads' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('files');
      expect(res.body.data).toHaveProperty('folders');
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/media/files');
      expect(res.status).toBe(401);
    });
  });

  // ── POST /folder ──────────────────────────────────────────────────
  describe('POST /api/v1/media/folder', () => {
    it('should create a folder', async () => {
      const res = await request(app)
        .post('/api/v1/media/folder')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({ folder: `uploads/test_folder_${Date.now()}` });

      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/v1/media/folder')
        .send({ folder: 'uploads/hack' });

      expect(res.status).toBe(401);
    });
  });

  // ── POST /upload ──────────────────────────────────────────────────
  describe('POST /api/v1/media/upload', () => {
    it('should upload a file (small PNG)', async () => {
      // Create a minimal 1×1 white PNG in memory (67 bytes)
      const pngBuffer = Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d76360f8cfc00000000200016f4b8f900000000049454e44ae426082',
        'hex'
      );

      const res = await request(app)
        .post('/api/v1/media/upload')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .attach('file', pngBuffer, { filename: `test_${Date.now()}.png`, contentType: 'image/png' })
        .field('folder', 'uploads');

      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('should reject upload without a file', async () => {
      const res = await request(app)
        .post('/api/v1/media/upload')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId));

      expect([400, 422]).toContain(res.status);
    });

    it('should reject unauthenticated upload', async () => {
      const pngBuffer = Buffer.from('89504e470d0a1a0a', 'hex');
      const res = await request(app)
        .post('/api/v1/media/upload')
        .attach('file', pngBuffer, { filename: 'hack.png', contentType: 'image/png' });

      expect(res.status).toBe(401);
    });
  });

  // ── POST /upload-multiple ─────────────────────────────────────────
  describe('POST /api/v1/media/upload-multiple', () => {
    it('should upload multiple files', async () => {
      const pngBuffer = Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d76360f8cfc00000000200016f4b8f900000000049454e44ae426082',
        'hex'
      );

      const res = await request(app)
        .post('/api/v1/media/upload-multiple')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .attach('files', pngBuffer, { filename: `multi1_${Date.now()}.png`, contentType: 'image/png' })
        .attach('files', pngBuffer, { filename: `multi2_${Date.now()}.png`, contentType: 'image/png' })
        .field('folder', 'uploads');

      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).post('/api/v1/media/upload-multiple');
      expect(res.status).toBe(401);
    });
  });

  // ── DELETE / ──────────────────────────────────────────────────────
  describe('DELETE /api/v1/media', () => {
    it('should accept delete request (even for non-existent file)', async () => {
      const res = await request(app)
        .delete('/api/v1/media')
        .set('Cookie', devCookie)
        .set('X-Company-Id', String(companyId))
        .send({ path: 'uploads/non_existent_file_999.png' });

      // Media service may return 200 (no-op) or 404 depending on implementation
      expect([200, 400, 404]).toContain(res.status);
    });

    it('should reject unauthenticated delete', async () => {
      const res = await request(app)
        .delete('/api/v1/media')
        .send({ path: 'uploads/hack.png' });

      expect(res.status).toBe(401);
    });
  });
});
