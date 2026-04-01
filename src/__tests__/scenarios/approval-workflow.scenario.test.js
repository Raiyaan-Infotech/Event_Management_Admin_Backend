require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsSuperAdmin, loginAsAdmin } = require('../helpers');

/**
 * Scenario: Approval Workflow
 *
 * Admin wants to add a new employee to the company.
 * Since Admin (level 50) actions require Super Admin (level 100) approval:
 *
 * APPROVE path:
 *   1. Admin creates new employee  → 202 (approval pending)
 *   2. SuperAdmin sees it in pending list
 *   3. SuperAdmin approves it
 *   4. New employee can now log in
 *
 * REJECT path:
 *   1. Admin creates another employee → 202
 *   2. SuperAdmin rejects it
 *   3. Rejected employee cannot log in
 */
describe('Scenario: Admin creates employee → SuperAdmin approves/rejects', () => {
  let superAdminCookie, adminCookie;
  let companyId, adminRoleId;

  beforeAll(async () => {
    superAdminCookie = await loginAsSuperAdmin(app);
    adminCookie = await loginAsAdmin(app);

    const { Company, Role } = require('../../models');
    const company = await Company.findOne({ where: { name: 'Default Company' } });
    companyId = company.id;

    const adminRole = await Role.findOne({ where: { slug: 'admin', company_id: companyId } });
    adminRoleId = adminRole.id;
  });

  // ── APPROVE path ─────────────────────────────────────────────────
  describe('Approve path: employee gets activated', () => {
    let approvalId;
    const employeeEmail = `employee_approve_${Date.now()}@test.com`;

    it('Step 1 — Admin adds a new employee → 202 (pending approval)', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          full_name: 'New Employee',
          email: employeeEmail,
          password: 'Employee@123',
          role_id: adminRoleId,
          company_id: companyId,
          is_active: 1,
        });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('pending_approval');
    });

    it('Step 2 — SuperAdmin sees pending approvals count > 0', async () => {
      const res = await request(app)
        .get('/api/v1/approvals/pending')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('Step 3 — SuperAdmin finds the pending approval in the list', async () => {
      const res = await request(app)
        .get('/api/v1/approvals')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      const list = res.body.data;
      const found = Array.isArray(list) ? list.find(a => a.is_active === 2) : null;
      if (found) approvalId = found.id;
      expect(found).toBeTruthy();
    });

    it('Step 4 — SuperAdmin approves the request', async () => {
      expect(approvalId).toBeDefined();

      const res = await request(app)
        .patch(`/api/v1/approvals/${approvalId}/approve`)
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId))
        .send({ review_notes: 'Looks good, approved' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Step 5 — Approved employee can now log in', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: employeeEmail, password: 'Employee@123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(employeeEmail);
    });
  });

  // ── REJECT path ──────────────────────────────────────────────────
  describe('Reject path: employee stays inactive', () => {
    let rejectApprovalId;
    const rejectedEmail = `employee_reject_${Date.now()}@test.com`;

    it('Step 1 — Admin adds another employee → 202', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .set('X-Company-Id', String(companyId))
        .send({
          full_name: 'Rejected Employee',
          email: rejectedEmail,
          password: 'Employee@123',
          role_id: adminRoleId,
          company_id: companyId,
          is_active: 1,
        });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('pending_approval');
    });

    it('Step 2 — SuperAdmin finds and rejects the pending approval', async () => {
      const res = await request(app)
        .get('/api/v1/approvals')
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId));

      expect(res.status).toBe(200);
      const list = res.body.data;
      const found = Array.isArray(list) ? list.find(a => a.is_active === 2) : null;
      if (found) rejectApprovalId = found.id;

      const res2 = await request(app)
        .patch(`/api/v1/approvals/${rejectApprovalId}/reject`)
        .set('Cookie', superAdminCookie)
        .set('X-Company-Id', String(companyId))
        .send({ review_notes: 'Not approved at this time' });

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
    });

    it('Step 3 — Rejected employee cannot log in (never activated)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: rejectedEmail, password: 'Employee@123' });

      expect([401, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });
});
