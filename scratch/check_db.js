const { VendorSocialLink } = require('./src/models');
const { sequelize } = require('./src/models');

async function checkDb() {
  try {
    const links = await VendorSocialLink.findAll();
    console.log('--- Vendor Social Links Data ---');
    console.log(JSON.stringify(links, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Error fetching data:', error);
    process.exit(1);
  }
}

checkDb();
