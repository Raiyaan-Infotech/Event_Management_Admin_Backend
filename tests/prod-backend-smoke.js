const dotenv = require('dotenv');
const http = require('http');

dotenv.config({ path: '.env.production', override: true });
process.env.NODE_ENV = 'production';
process.env.PORT = process.env.SMOKE_PORT || '5099';

const app = require('../src/app');
const { sequelize, Vendor } = require('../src/models');
const websiteBuilderService = require('../src/services/vendorWebsiteBuilder.service');

const REQUIRED_HEADER_COLUMNS = [
  'header_color',
  'show_social_icons',
  'show_login',
  'show_signin',
  'mobile',
  'email',
];

async function requestHealth(port) {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) {
    throw new Error(`/health returned ${response.status}`);
  }
  return response.json();
}

async function main() {
  const port = Number(process.env.PORT);
  await sequelize.authenticate();

  const missingTables = await websiteBuilderService.getMissingTables();
  if (missingTables.length) {
    throw new Error(`Missing website builder tables: ${missingTables.join(', ')}`);
  }

  const basicInfoColumns = await sequelize
    .getQueryInterface()
    .describeTable('vendor_website_basic_information');
  const missingColumns = REQUIRED_HEADER_COLUMNS.filter(
    (column) => !basicInfoColumns[column],
  );
  if (missingColumns.length) {
    throw new Error(`Missing header columns: ${missingColumns.join(', ')}`);
  }

  const vendor = await Vendor.findOne({
    where: { status: 'active' },
    order: [['id', 'ASC']],
  });

  let payloadResult = 'skipped-no-active-vendor';
  if (vendor) {
    const payload = await websiteBuilderService.getBuilderPayload(vendor.toJSON());
    if (!payload.schemaReady) {
      throw new Error(
        `Builder payload schemaReady=false; missing=${(payload.missingTables || []).join(', ')}`,
      );
    }
    payloadResult = `ok-vendor-${vendor.id}`;
  }

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  try {
    const health = await requestHealth(port);
    console.log(`db=ok host=${process.env.DB_HOST} name=${process.env.DB_NAME}`);
    console.log('websiteBuilderTables=ok');
    console.log(`headerColumns=ok ${REQUIRED_HEADER_COLUMNS.join(',')}`);
    console.log(`builderPayload=${payloadResult}`);
    console.log(`health=${health.status}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
  }
}

main().catch(async (error) => {
  console.error(error.message);
  try {
    await sequelize.close();
  } catch {
    // ignore close errors during smoke failure
  }
  process.exit(1);
});
