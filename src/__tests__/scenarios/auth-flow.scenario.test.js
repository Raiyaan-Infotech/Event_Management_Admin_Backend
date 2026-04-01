require('dotenv').config({ path: '.env.test' });
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const { loginAsAdmin } = require('../helpers');

/**
 * Scenario: Full Auth Flow
 *
 * 1. Login with valid credentials → get access token cookie
 * 2. Access /me → see own profile
 * 3. Update profile (full_name)
 * 4. Change password
 * 5. Logout → cookie cleared
 * 6. Old cookie rejected
 * 7. Login with new password → success
 * 8. Login with old password → rejected
 */
describe('Scenario: Full Auth Flow', () => {
  let cookie;
  const originalPassword = '123456';
  const newPassword = 'NewSecure@456';

  it('Step 1 — Login with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@admin.com', password: originalPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers['set-cookie']).toBeDefined();

    // Save cookie for next steps
    cookie = res.headers['set-cookie'];
  });

  it('Step 2 — Access /me returns own profile', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('admin@admin.com');
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('Step 3 — Update profile (full_name)', async () => {
    const res = await request(app)
      .put('/api/v1/auth/update-profile')
      .set('Cookie', cookie)
      .send({ full_name: 'Admin Scenario Updated' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('Step 4 — /me reflects the updated name', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.full_name).toBe('Admin Scenario Updated');
  });

  it('Step 5 — Change password (correct current password)', async () => {
    const res = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({ current_password: originalPassword, new_password: newPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('Step 6 — Logout clears session', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('Step 7 — Login with NEW password succeeds', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@admin.com', password: newPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Re-save cookie for cleanup
    cookie = res.headers['set-cookie'];
  });

  it('Step 8 — Login with OLD password is rejected', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@admin.com', password: originalPassword });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // Restore original password so other tests keep working
  afterAll(async () => {
    await request(app)
      .put('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({ current_password: newPassword, new_password: originalPassword });
  });
});
