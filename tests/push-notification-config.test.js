/**
 * Push Notification Config Service Test (Standard Module Pattern)
 *
 *   node tests/push-notification-config.test.js
 */

require('dotenv').config();
const service = require('../src/services/pushNotificationConfig.service');
const { PushNotificationConfig } = require('../src/models');
const { Op } = require('sequelize');

const PREFIX = 'zz-test-fcm-';
let pass = 0;
let fail = 0;

const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`);
  }
};

const rejects = async (label, fn, fragment) => {
  try {
    await fn();
    fail += 1;
    console.log(`  FAIL  ${label} — expected a rejection, got success`);
  } catch (error) {
    if (String(error.message).includes(fragment)) {
      pass += 1;
      console.log(`  ok    ${label}`);
    } else {
      fail += 1;
      console.log(`  FAIL  ${label}\n          expected message containing "${fragment}"\n          actual   "${error.message}"`);
    }
  }
};

const cleanup = async () => {
  await PushNotificationConfig.destroy({
    where: { name: { [Op.like]: `${PREFIX}%` } },
    force: true,
  });
};

(async () => {
  console.log('--- Testing PushNotificationConfig Service (Standard Pattern) ---');
  await cleanup();

  try {
    // 1. Validation: Name required
    await rejects(
      'Rejects empty name',
      () => service.create({ name: '' }),
      'Name is required'
    );

    // 2. Create Project 1 (Manual fields)
    const p1 = await service.create({
      name: `${PREFIX}GpsCam`,
      project_id: 'fb-analytics-d02ea',
      web_api_key: 'AIzaSyFakeKey123',
      app_id: '1:123456789:android:abcdef',
      messaging_sender_id: '123456789012',
      auth_domain: 'geocam.firebaseapp.com',
      storage_bucket: 'geocam.appspot.com',
      measurement_id: 'G-XXXXXXX',
      vapid_key: 'BEIZ12345',
      is_active: true,
    });

    check('Project 1 created with correct name', p1.name, `${PREFIX}GpsCam`);
    check('Project 1 is active', Boolean(p1.is_active), true);
    check('Project 1 project_id set', p1.project_id, 'fb-analytics-d02ea');

    // 3. Create Project 2 with JSON
    const fakeServiceAccount = JSON.stringify({
      type: 'service_account',
      project_id: 'second-project-id',
      client_email: 'firebase-adminsdk@second-project-id.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n',
    });

    const p2 = await service.create({
      name: `${PREFIX}SecondProject`,
      service_account_json: fakeServiceAccount,
      is_active: true, // Should deactivate Project 1
    });

    check('Project 2 created', p2.name, `${PREFIX}SecondProject`);
    check('Project 2 extracted project_id', p2.project_id, 'second-project-id');
    check('Project 2 is active', Boolean(p2.is_active), true);

    // 4. Verify Project 1 was deactivated (exclusivity)
    const p1Refetched = await service.getById(p1.id);
    check('Project 1 is no longer active after Project 2 activated', Boolean(p1Refetched.is_active), false);

    // 5. Active config lookup
    const active = await service.getActive();
    check('Active config is Project 2', active.id, p2.id);

    // 6. Update Project 1 to be active again
    const p1Updated = await service.update(p1.id, {
      name: `${PREFIX}GpsCam-Updated`,
      is_active: true,
    });
    check('Project 1 updated name', p1Updated.name, `${PREFIX}GpsCam-Updated`);
    check('Project 1 is active again', Boolean(p1Updated.is_active), true);

    const p2Refetched = await service.getById(p2.id);
    check('Project 2 was deactivated when Project 1 reactivated', Boolean(p2Refetched.is_active), false);

    // 7. BaseService.getAll pagination test
    const allResult = await service.getAll({ limit: 10 });
    check('getAll returns paginated object with data array', Array.isArray(allResult.data), true);

    // 8. Delete
    await service.remove(p1.id);
    await service.remove(p2.id);
    await rejects(
      'Get deleted config throws not found',
      () => service.getById(p1.id),
      'not found'
    );
  } finally {
    await cleanup();
  }

  console.log(`\nResults: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
})();
