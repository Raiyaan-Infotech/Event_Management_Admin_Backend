const { Module, Permission } = require('../../models');

/**
 * Seed global staff modules and permissions.
 * These are shared by all vendors (vendor_id = NULL).
 * Vendors create their own roles and assign these permissions.
 */
const staffModules = [
  {
    name: 'Dashboard',
    slug: 'dashboard',
    description: 'Staff dashboard overview',
    permissions: [
      { name: 'View Dashboard', slug: 'dashboard.view', description: 'View the dashboard' },
    ],
  },
  {
    name: 'Profile',
    slug: 'profile',
    description: 'Staff profile management',
    permissions: [
      { name: 'View Profile', slug: 'profile.view', description: 'View own profile' },
      { name: 'Edit Profile', slug: 'profile.edit', description: 'Edit own profile' },
    ],
  },
  {
    name: 'Schedule',
    slug: 'schedule',
    description: 'Staff schedule management',
    permissions: [
      { name: 'View Schedule', slug: 'schedule.view', description: 'View schedules' },
      { name: 'Create Schedule', slug: 'schedule.create', description: 'Create schedules' },
      { name: 'Edit Schedule', slug: 'schedule.edit', description: 'Edit schedules' },
      { name: 'Delete Schedule', slug: 'schedule.delete', description: 'Delete schedules' },
    ],
  },
  {
    name: 'Tasks',
    slug: 'tasks',
    description: 'Staff task management',
    permissions: [
      { name: 'View Tasks', slug: 'tasks.view', description: 'View tasks' },
      { name: 'Create Tasks', slug: 'tasks.create', description: 'Create tasks' },
      { name: 'Edit Tasks', slug: 'tasks.edit', description: 'Edit tasks' },
      { name: 'Delete Tasks', slug: 'tasks.delete', description: 'Delete tasks' },
    ],
  },
  {
    name: 'Communication',
    slug: 'communication',
    description: 'Email and chat communication',
    permissions: [
      { name: 'View Communication', slug: 'communication.view', description: 'View messages and emails' },
      { name: 'Send Communication', slug: 'communication.send', description: 'Send messages and emails' },
    ],
  },
  {
    name: 'Settings',
    slug: 'settings',
    description: 'Staff settings',
    permissions: [
      { name: 'View Settings', slug: 'settings.view', description: 'View settings' },
      { name: 'Edit Settings', slug: 'settings.edit', description: 'Edit settings' },
    ],
  },
  {
    name: 'Help',
    slug: 'help',
    description: 'Help and support',
    permissions: [
      { name: 'View Help', slug: 'help.view', description: 'View help and support' },
    ],
  },
];

const seedVendorModules = async () => {
  let modulesCreated = 0;
  let permissionsCreated = 0;

  for (const mod of staffModules) {
    // Upsert module (skip if already exists)
    const [moduleRecord] = await Module.findOrCreate({
      where: { slug: mod.slug, vendor_id: null },
      defaults: {
        name: mod.name,
        slug: mod.slug,
        description: mod.description,
        vendor_id: null,
        is_active: 1,
      },
    });

    if (moduleRecord._options.isNewRecord !== false) modulesCreated++;

    for (const perm of mod.permissions) {
      const [, created] = await Permission.findOrCreate({
        where: { slug: perm.slug, vendor_id: null },
        defaults: {
          name: perm.name,
          slug: perm.slug,
          description: perm.description,
          module_id: moduleRecord.id,
          module: mod.slug,
          vendor_id: null,
          is_active: 1,
        },
      });

      if (created) permissionsCreated++;
    }
  }

  console.log(`Vendor modules seeded: ${modulesCreated} modules, ${permissionsCreated} permissions created.`);
};

module.exports = { seedVendorModules, staffModules };
