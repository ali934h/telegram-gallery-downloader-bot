/**
 * Application Entry Point
 * HTTPS server in production (webhook) or HTTP with polling in development
 * Serves downloaded ZIP files as static files
 */

require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('./bot');
const Logger = require('./utils/logger');
const FileManager = require('./utils/fileManager');

// Configuration
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(process.cwd(), 'downloads');
const SSL_CERT = process.env.SSL_CERT;
const SSL_KEY = process.env.SSL_KEY;

// Validate required environment variables
if (!BOT_TOKEN) {
  Logger.error('BOT_TOKEN is not set in environment variables');
  process.exit(1);
}

if (NODE_ENV === 'production') {
  if (!WEBHOOK_DOMAIN) {
    Logger.error('WEBHOOK_DOMAIN is required in production mode');
    process.exit(1);
  }
  if (!SSL_CERT || !SSL_KEY) {
    Logger.error('SSL_CERT and SSL_KEY paths are required in production mode');
    process.exit(1);
  }
  if (!fs.existsSync(SSL_CERT) || !fs.existsSync(SSL_KEY)) {
    Logger.error('SSL certificate or key file not found', { cert: SSL_CERT, key: SSL_KEY });
    process.exit(1);
  }
}

// Create Express app
const app = express();
app.use(express.json());

// Serve ZIP files as static downloads
app.use('/downloads', express.static(DOWNLOADS_DIR));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    service: 'Telegram Gallery Downloader Bot',
    version: '1.0.0',
    status: 'running'
  });
});

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN);

// Cleanup scheduler: remove old temp dirs every hour
function scheduleCleanup() {
  setInterval(async () => {
    Logger.info('Running scheduled cleanup...');
    await FileManager.cleanupOldTempDirs();
  }, 60 * 60 * 1000);
}

// Start in production mode (HTTPS + webhook)
if (NODE_ENV === 'production') {
  const webhookPath = `${WEBHOOK_PATH}/${BOT_TOKEN}`;
  const webhookUrl = `${WEBHOOK_DOMAIN}${webhookPath}`;

  // Load SSL certificates
  const sslOptions = {
    cert: fs.readFileSync(SSL_CERT),
    key: fs.readFileSync(SSL_KEY)
  };

  bot.startWebhook(WEBHOOK_DOMAIN, webhookPath)
    .then((botInstance) => {
      app.use(botInstance.webhookCallback(webhookPath));

      // Create HTTPS server
      const server = https.createServer(sslOptions, app);

      server.listen(HTTPS_PORT, () => {
        Logger.info(`HTTPS server started in PRODUCTION mode on port ${HTTPS_PORT}`);
        Logger.info(`Webhook URL: ${webhookUrl}`);
        Logger.info(`Downloads served at: ${WEBHOOK_DOMAIN}/downloads`);
        scheduleCleanup();
      });

      server.on('error', (error) => {
        Logger.error('HTTPS server error', { error: error.message });
        process.exit(1);
      });
    })
    .catch((error) => {
      Logger.error('Failed to start bot in production mode', { error: error.message });
      process.exit(1);
    });

// Start in development mode (HTTP + polling)
} else {
  bot.startPolling()
    .then(() => {
      Logger.info('Bot started in DEVELOPMENT mode with polling');

      const server = http.createServer(app);
      server.listen(PORT, () => {
        Logger.info(`HTTP server running on port ${PORT}`);
        Logger.info(`Downloads served at: http://localhost:${PORT}/downloads`);
        scheduleCleanup();
      });
    })
    .catch((error) => {
      Logger.error('Failed to start bot in development mode', { error: error.message });
      process.exit(1);
    });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  Logger.info('SIGTERM received: shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  Logger.info('SIGINT received: shutting down gracefully');
  process.exit(0);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  Logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  Logger.error('Unhandled promise rejection', { reason: String(reason) });
});
