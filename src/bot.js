/**
 * Telegram Bot Logic
 * Accepts one or more gallery URLs from the user,
 * downloads all images in parallel, and returns a ZIP download link.
 */

const { Telegraf } = require('telegraf');
const path = require('path');
const fs = require('fs');
const Logger = require('./utils/logger');
const FileManager = require('./utils/fileManager');
const strategyEngine = require('./scrapers/strategyEngine');
const JsdomScraper = require('./scrapers/jsdomScraper');
const ImageDownloader = require('./downloaders/imageDownloader');
const ZipCreator = require('./downloaders/zipCreator');

// Bot states
const STATE = {
  IDLE: 'idle',
  PROCESSING: 'processing'
};

// Update interval for Telegram status messages (5 seconds)
const UPDATE_INTERVAL_MS = 5000;

// User sessions
const userSessions = new Map();

// Downloads directory (served via static)
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(process.cwd(), 'downloads');
const DOWNLOAD_BASE_URL = process.env.DOWNLOAD_BASE_URL || 'http://localhost:3000/downloads';

class TelegramBot {
  constructor(token) {
    this.bot = new Telegraf(token, {
      telegram: {
        apiRoot: 'https://api.telegram.org',
        webhookReply: true
      }
    });

    this.bot.telegram.options = {
      ...this.bot.telegram.options,
      timeout: 300000 // 5 minutes
    };

    this.ensureDownloadsDir();
    this.setupHandlers();
  }

  /**
   * Ensure downloads directory exists
   */
  ensureDownloadsDir() {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
      Logger.info(`Downloads directory created: ${DOWNLOADS_DIR}`);
    }
  }

  /**
   * Get or create user session
   * @param {number} userId
   * @returns {Object} session
   */
  getUserSession(userId) {
    if (!userSessions.has(userId)) {
      userSessions.set(userId, { state: STATE.IDLE });
    }
    return userSessions.get(userId);
  }

  /**
   * Retry with exponential backoff (handles Telegram 429 rate limits)
   * @param {Function} fn
   * @param {number} maxRetries
   * @param {number} baseDelay
   * @returns {Promise<any>}
   */
  async retryWithBackoff(fn, maxRetries = 5, baseDelay = 1000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isRateLimit = error.message && (
          error.message.includes('429') ||
          error.message.includes('Too Many Requests') ||
          error.message.includes('retry after')
        );

        if (!isRateLimit || attempt === maxRetries) throw error;

        let delay = baseDelay * Math.pow(2, attempt);
        const match = error.message.match(/retry after (\d+)/);
        if (match) delay = Math.max(delay, parseInt(match[1]) * 1000);

        Logger.warn(`Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Edit status message safely (swallows errors)
   * @param {Context} ctx
   * @param {number} messageId
   * @param {string} text
   */
  async updateStatus(ctx, messageId, text) {
    await this.retryWithBackoff(() =>
      ctx.telegram.editMessageText(ctx.chat.id, messageId, null, text)
    ).catch(() => {});
  }

  /**
   * Setup all bot handlers
   */
  setupHandlers() {
    // /start command
    this.bot.start((ctx) => {
      const session = this.getUserSession(ctx.from.id);
      session.state = STATE.IDLE;
      Logger.info(`User started bot: ${ctx.from.id}`);

      ctx.reply(
        'Welcome to Gallery Downloader Bot!\n\n' +
        'Send me one or more gallery URLs (one per line) and I will:\n' +
        '  1. Extract all images from each gallery\n' +
        '  2. Download them in parallel\n' +
        '  3. Package everything into a ZIP file\n' +
        '  4. Send you a download link\n\n' +
        'Supported sites:\n' +
        strategyEngine.getSupportedDomains().map(d => `  - ${d}`).join('\n') + '\n\n' +
        'Use /help for more info.'
      );
    });

    // /help command
    this.bot.command('help', (ctx) => {
      ctx.reply(
        'How to use:\n\n' +
        '1. Send one or more gallery URLs, one per line:\n\n' +
        '   https://example.com/gallery/gallery-one\n' +
        '   https://example.com/gallery/gallery-two\n\n' +
        '2. Wait while the bot downloads and packages all images.\n\n' +
        '3. Receive your ZIP download link (valid for 24 hours).\n\n' +
        'Supported sites:\n' +
        strategyEngine.getSupportedDomains().map(d => `  - ${d}`).join('\n')
      );
    });

    // /cancel command
    this.bot.command('cancel', (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      if (session.state === STATE.PROCESSING) {
        ctx.reply('A job is currently running. Please wait for it to finish.');
      } else {
        session.state = STATE.IDLE;
        ctx.reply('Ready. Send me gallery URLs to start.');
      }
    });

    // Text message handler — receives gallery URLs
    this.bot.on('text', async (ctx) => {
      const session = this.getUserSession(ctx.from.id);

      if (session.state === STATE.PROCESSING) {
        ctx.reply('Already processing a job. Please wait until it finishes.');
        return;
      }

      // Parse URLs from message (one per line)
      const lines = ctx.message.text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('http'));

      if (lines.length === 0) {
        ctx.reply(
          'No valid URLs found.\n\n' +
          'Please send gallery URLs starting with http:// or https://, one per line.'
        );
        return;
      }

      // Validate all URLs are supported
      const unsupported = lines.filter(url => !strategyEngine.isSupported(url));
      if (unsupported.length > 0) {
        ctx.reply(
          `The following URLs are not supported:\n${unsupported.map(u => `  - ${u}`).join('\n')}\n\n` +
          'Supported sites:\n' +
          strategyEngine.getSupportedDomains().map(d => `  - ${d}`).join('\n')
        );
        return;
      }

      await this.processGalleries(ctx, lines);
    });

    // Error handler
    this.bot.catch((err, ctx) => {
      Logger.error('Unhandled bot error', { error: err.message, user: ctx.from?.id });
      ctx.reply('An unexpected error occurred. Please try again or send /start to reset.')
        .catch(() => {});
      const session = this.getUserSession(ctx.from?.id);
      if (session) session.state = STATE.IDLE;
    });
  }

  /**
   * Main processing pipeline:
   * Parse URLs -> Extract images -> Download -> ZIP -> Send link
   *
   * @param {Context} ctx - Telegram context
   * @param {Array<string>} urls - Gallery URLs
   */
  async processGalleries(ctx, urls) {
    const session = this.getUserSession(ctx.from.id);
    session.state = STATE.PROCESSING;

    const statusMsg = await ctx.reply('Starting... please wait.');
    const msgId = statusMsg.message_id;

    let tempDir = null;
    let zipPath = null;

    try {
      // ── Step 1: Extract image URLs from each gallery ──────────────────────
      await this.updateStatus(ctx, msgId,
        `Extracting images from ${urls.length} ${urls.length === 1 ? 'gallery' : 'galleries'}...`
      );

      const galleries = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const strategy = strategyEngine.getStrategy(url);
        const galleryName = JsdomScraper.extractGalleryName(url);

        try {
          const imageUrls = await JsdomScraper.extractImages(url, strategy);
          galleries.push({ name: galleryName, urls: imageUrls });
          Logger.info(`Gallery ${i + 1}/${urls.length} extracted: ${galleryName} (${imageUrls.length} images)`);
        } catch (err) {
          Logger.warn(`Failed to extract gallery: ${url}`, { error: err.message });
          galleries.push({ name: galleryName, urls: [] });
        }

        await this.updateStatus(ctx, msgId,
          `Extracting images... (${i + 1}/${urls.length} galleries done)`
        );
      }

      const totalImages = galleries.reduce((sum, g) => sum + g.urls.length, 0);

      if (totalImages === 0) {
        throw new Error('No images found in any of the provided galleries.');
      }

      await this.updateStatus(ctx, msgId,
        `Found ${totalImages} images across ${galleries.length} ${galleries.length === 1 ? 'gallery' : 'galleries'}.\nDownloading...`
      );

      // ── Step 2: Download all images ───────────────────────────────────────
      tempDir = await FileManager.createTempDir('galleries');

      let lastUpdateTime = 0;

      const downloadResult = await ImageDownloader.downloadMultipleGalleries(
        galleries,
        tempDir,
        (progress) => {
          const now = Date.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL_MS) {
            lastUpdateTime = now;
            this.updateStatus(ctx, msgId,
              `Downloading gallery ${progress.completedGalleries + 1}/${progress.totalGalleries}\n` +
              `Current: ${progress.galleryName}\n` +
              `Progress: ${progress.galleryProgress.current}/${progress.galleryProgress.total} images`
            ).catch(() => {});
          }
        }
      );

      if (downloadResult.successImages === 0) {
        throw new Error('Failed to download any images.');
      }

      // ── Step 3: Create ZIP archive ────────────────────────────────────────
      await this.updateStatus(ctx, msgId, 'Creating ZIP archive...');

      const archiveName = `galleries_${ctx.from.id}`;
      zipPath = await ZipCreator.createZip(tempDir, archiveName, DOWNLOADS_DIR);

      // ── Step 4: Send download link only (monospace = tap to copy) ─────────
      await this.updateStatus(ctx, msgId, 'Generating download link...');

      const zipFileName = path.basename(zipPath);
      const downloadUrl = `${DOWNLOAD_BASE_URL}/${zipFileName}`;
      const stats = fs.statSync(zipPath);
      const fileSize = FileManager.formatBytes(stats.size);

      await this.retryWithBackoff(() =>
        ctx.reply(
          `✅ Done! ${downloadResult.totalGalleries} ${downloadResult.totalGalleries === 1 ? 'gallery' : 'galleries'}, ` +
          `${downloadResult.successImages} images, ${fileSize}\n\n` +
          `\`${downloadUrl}\``,
          { parse_mode: 'Markdown' }
        )
      );

      // Delete status message
      await this.retryWithBackoff(() =>
        ctx.telegram.deleteMessage(ctx.chat.id, msgId)
      ).catch(() => {});

      Logger.info(`Job complete for user ${ctx.from.id}: ${zipFileName}`);

    } catch (error) {
      Logger.error('Gallery processing failed', { error: error.message, user: ctx.from.id });
      await this.updateStatus(ctx, msgId,
        `Error: ${error.message}\n\nPlease check your URLs and try again.`
      );
    } finally {
      // Cleanup temp directory regardless of success or failure
      if (tempDir) {
        await FileManager.deleteDir(tempDir).catch(() => {});
      }
      session.state = STATE.IDLE;
    }
  }

  /**
   * Initialize bot (load strategies)
   */
  async initialize() {
    await strategyEngine.loadStrategies();
    Logger.info('Bot initialized successfully');
  }

  /**
   * Start bot with webhook (production)
   * @param {string} webhookDomain
   * @param {string} webhookPath
   * @returns {Telegraf} bot instance
   */
  async startWebhook(webhookDomain, webhookPath) {
    await this.initialize();
    await this.bot.telegram.setWebhook(`${webhookDomain}${webhookPath}`);
    Logger.info(`Webhook set: ${webhookDomain}${webhookPath}`);
    return this.bot;
  }

  /**
   * Start bot with polling (development)
   */
  async startPolling() {
    await this.initialize();
    await this.bot.launch();
    Logger.info('Bot started with polling');
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }
}

module.exports = TelegramBot;
