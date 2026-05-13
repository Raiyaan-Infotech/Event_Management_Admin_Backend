require('dotenv').config();  // ← MUST be first

const app = require('./app');
const { isInstalled, checkInstalledFromDB } = require('./middleware/setup');
const http = require('http');
const { Server } = require('socket.io');
const { attachChatSocket } = require('./sockets/chat.socket');

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

    const server = http.createServer(app);
    const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3004')
      .split(',')
      .map((origin) => origin.trim());
    const io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        credentials: true,
      },
    });

    attachChatSocket(io);
    app.set('io', io);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);

    });
  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
}

startServer();
