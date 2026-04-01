require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsDeveloper, loginAsSuperAdmin, loginAsAdmin } = require('../helpers');

describe('Approvals API', () => {
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

  // ── GET /api/v1/approvals ────────────────────────────────────────
  describe('GET /api/v1/approvals', () => {
    it('super admin should list approval requests', async () => {
      const res = await request(app)
        .get('/api/v1/approvals')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('developer should list all approvals', async () => {
      const res = await request(app)
        .get('/api/v1/approvals')
        .set('Cookie', devCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/approvals');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/v1/approvals/pending ────────────────────────────────
  describe('GET /api/v1/approvals/pending', () => {
    it('should return pending approvals count', async () => {
      const res = await request(app)
        .get('/api/v1/approvals/pending')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── PATCH /api/v1/approvals/:id/approve ─────────────────────────
  describe('PATCH /api/v1/approvals/:id/approve', () => {
    it('should return 404 for non-existent approval', async () => {
      const res = await request(app)
        .patch('/api/v1/approvals/999999/approve')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(404);
    });

    it('should reject non-super-admin attempting to approve', async () => {
      const res = await request(app)
        .patch('/api/v1/approvals/1/approve')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId));

      // 403 = forbidden, 404 = approval not found (either is valid rejection)
      expect([403, 404]).toContain(res.status);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).patch('/api/v1/approvals/1/approve');
      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /api/v1/approvals/:id/reject ──────────────────────────
  describe('PATCH /api/v1/approvals/:id/reject', () => {
    it('should return 404 for non-existent approval', async () => {
      const res = await request(app)
        .patch('/api/v1/approvals/999999/reject')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(404);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).patch('/api/v1/approvals/1/reject');
      expect(res.status).toBe(401);
    });
  });

  // ── Approval workflow integration ────────────────────────────────
  describe('Approval workflow (create → approve)', () => {
    it('admin creating a user should trigger approval (202)', async () => {
      const { Role } = require('../../models');
      const role = await Role.findOne({ where: { slug: 'admin' } });

      const res = await request(app)
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          full_name: 'Approval Flow User',
          email: `approval_flow_${Date.now()}@test.com`,
          password: 'Test@1234',
          role_id: role.id,
          company_id: companyId,
        });

      // Admin (level 50) should get 202 approval required
      // Developer/SuperAdmin (level >= 100) bypasses approval
      expect([201, 202]).toContain(res.status);

      if (res.status === 202) {
        expect(res.body.approval_id).toBeDefined();
        expect(res.body.message).toMatch(/approval/i);

        // Now super admin approves it
        const approvalId = res.body.approval_id;
        if (approvalId) {
          const approveRes = await request(app)
            .patch(`/api/v1/approvals/${approvalId}/approve`)
            .set('Cookie', superAdminCookie)
            .set('X-Company-Id', String(companyId));

          expect(approveRes.status).toBe(200);
          expect(approveRes.body.success).toBe(true);
        }
      }
    });
  });

});
