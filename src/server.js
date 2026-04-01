require('dotenv').config();  // ← MUST be first

const app = require('./app');
const { isInstalled, checkInstalledFromDB } = require('./middleware/setup');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Now DB env vars are loaded, this will work
    // Verify DB connection
    const { sequelize } = require('./models');
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    /* Original Logic (Commented for future use):
    await checkInstalledFromDB();
    if (isInstalled()) {
      const { sequelize } = require('./models');
      await sequelize.authenticate();
      console.log('Database connection established successfully.');
    } else {
      console.log('[Setup] Application not yet installed. Starting in setup mode...');
      console.log('[Setup] Visit /install to begin setup.');
    }
    */

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);

    });
  } catch (error) {
    console.error('Unable to start server:', error);
  }
}

startServer();