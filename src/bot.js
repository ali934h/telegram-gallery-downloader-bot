/**
 * Telegram Bot Logic
 */

const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');
const Logger = require('./utils/logger');
const FileManager = require('./utils/fileManager');
const strategyEngine = require('./scrapers/strategyEngine');
const JsdomScraper = require('./scrapers/jsdomScraper');
const ImageDownloader = require('./downloaders/imageDownloader');
const ZipCreator = require('./downloaders/zipCreator');

const STATE = { IDLE: 'idle', PROCESSING: 'processing' };
const UPDATE_INTERVAL_MS = 5000;
const userSessions = new Map();

const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(process.cwd(), 'downloads');
const DOWNLOAD_BASE_URL = process.env.DOWNLOAD_BASE_URL || 'http://localhost:3000/downloads';

class TelegramBot {
  constructor(token) {
    this.bot = new Telegraf(token, {
      telegram: { apiRoot: 'https://api.telegram.org', webhookReply: true }
    });
    this.bot.telegram.options = { ...this.bot.telegram.options, timeout: 300000 };
    this.ensureDownloadsDir();
    this.setupHandlers();
  }

  ensureDownloadsDir() {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
      Logger.info(`Downloads directory created: ${DOWNLOADS_DIR}`);
    }
  }

  getUserSession(userId) {
    if (!userSessions.has(userId)) userSessions.set(userId, { state: STATE.IDLE });
    return userSessions.get(userId);
  }

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

  async updateStatus(ctx, messageId, text) {
    await this.retryWithBackoff(() =>
      ctx.telegram.editMessageText(ctx.chat.id, messageId, null, text)
    ).catch(() => {});
  }

  /**
   * Get list of ZIP files sorted by date desc
   */
  getDownloadedFiles() {
    if (!fs.existsSync(DOWNLOADS_DIR)) return [];
    return fs.readdirSync(DOWNLOADS_DIR)
      .filter(f => f.endsWith('.zip'))
      .map(name => {
        const filePath = path.join(DOWNLOADS_DIR, name);
        const stats = fs.statSync(filePath);
        return { name, size: stats.size, date: stats.mtime };
      })
      .sort((a, b) => b.date - a.date);
  }

  /**
   * Build the main /files list message + keyboard
   */
  buildFilesListMessage() {
    const files = this.getDownloadedFiles();
    if (files.length === 0) return { text: 'No downloaded files found.', keyboard: null };

    const totalSize = FileManager.formatBytes(files.reduce((sum, f) => sum + f.size, 0));
    let msg = `🗂 Downloaded ZIP files (${files.length} total, ${totalSize}):\n\n`;
    files.forEach((f, i) => {
      const size = FileManager.formatBytes(f.size);
      const date = f.date.toISOString().slice(0, 16).replace('T', ' ');
      msg += `${i + 1}. ${f.name}\n    ${size}  |  ${date}\n\n`;
    });

    // One button per file (tap to manage)
    const buttons = files.map((f, i) =>
      [Markup.button.callback(`📂 ${i + 1}. ${f.name.substring(0, 38)}`, `file:${f.name}`)]
    );
    // Manage All button at bottom
    buttons.push([Markup.button.callback('⚙️ Manage All Files', 'manage_all')]);

    return { text: msg, keyboard: Markup.inlineKeyboard(buttons) };
  }

  setupHandlers() {
    // /start
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
        'Commands:\n' +
        '  /files - Manage downloaded ZIP files\n' +
        '  /help  - How to use\n\n' +
        'Supported sites:\n' +
        strategyEngine.getSupportedDomains().map(d => `  - ${d}`).join('\n')
      );
    });

    // /help
    this.bot.command('help', (ctx) => {
      ctx.reply(
        'How to use:\n\n' +
        '1. Send one or more gallery URLs, one per line:\n\n' +
        '   https://example.com/gallery/gallery-one\n' +
        '   https://example.com/gallery/gallery-two\n\n' +
        '2. Wait while the bot downloads and packages all images.\n\n' +
        '3. Receive your ZIP download link.\n\n' +
        'Commands:\n' +
        '  /files  - View and manage downloaded ZIP files\n' +
        '  /cancel - Cancel current operation\n\n' +
        'Supported sites:\n' +
        strategyEngine.getSupportedDomains().map(d => `  - ${d}`).join('\n')
      );
    });

    // /cancel
    this.bot.command('cancel', (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      if (session.state === STATE.PROCESSING) {
        ctx.reply('A job is currently running. Please wait for it to finish.');
      } else {
        session.state = STATE.IDLE;
        ctx.reply('Ready. Send me gallery URLs to start.');
      }
    });

    // /files — main file manager
    this.bot.command('files', (ctx) => {
      const { text, keyboard } = this.buildFilesListMessage();
      if (keyboard) {
        ctx.reply(text, keyboard);
      } else {
        ctx.reply(text);
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // Callback: open single file management menu
    this.bot.action(/^file:(.+)$/, async (ctx) => {
      const fileName = ctx.match[1];
      const filePath = path.join(DOWNLOADS_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        await ctx.answerCbQuery('File not found.');
        return;
      }

      const stats = fs.statSync(filePath);
      const size = FileManager.formatBytes(stats.size);
      const date = stats.mtime.toISOString().slice(0, 16).replace('T', ' ');
      const downloadUrl = `${DOWNLOAD_BASE_URL}/${fileName}`;

      const msg =
        `📂 File Details:\n\n` +
        `Name: ${fileName}\n` +
        `Size: ${size}\n` +
        `Date: ${date}\n\n` +
        `Link:\n\`${downloadUrl}\``;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔗 Copy Download Link', `link:${fileName}`)],
        [Markup.button.callback('🗑 Delete This File', `confirm_del:${fileName}`)],
        [Markup.button.callback('⬅️ Back to List', 'back_to_list')]
      ]);

      await ctx.answerCbQuery();
      await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...keyboard });
    });

    // Callback: send download link as separate copyable message
    this.bot.action(/^link:(.+)$/, async (ctx) => {
      const fileName = ctx.match[1];
      const downloadUrl = `${DOWNLOAD_BASE_URL}/${fileName}`;
      await ctx.answerCbQuery('Link sent!');
      await ctx.reply(`\`${downloadUrl}\``, { parse_mode: 'Markdown' });
    });

    // Callback: confirm delete single file
    this.bot.action(/^confirm_del:(.+)$/, async (ctx) => {
      const fileName = ctx.match[1];
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `⚠️ Are you sure you want to delete:\n\n${fileName}?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Yes, Delete', `do_del:${fileName}`)],
          [Markup.button.callback('❌ Cancel', `file:${fileName}`)]
        ])
      );
    });

    // Callback: execute single file delete
    this.bot.action(/^do_del:(.+)$/, async (ctx) => {
      const fileName = ctx.match[1];
      const filePath = path.join(DOWNLOADS_DIR, fileName);

      try {
        await FileManager.deleteFile(filePath);
        Logger.info(`File deleted: ${fileName}`);
        await ctx.answerCbQuery('File deleted.');

        // Go back to updated file list
        const files = this.getDownloadedFiles();
        if (files.length === 0) {
          await ctx.editMessageText('✅ File deleted. No more files.');
        } else {
          const { text, keyboard } = this.buildFilesListMessage();
          await ctx.editMessageText(text, keyboard);
        }
      } catch (error) {
        Logger.error(`Failed to delete file: ${fileName}`, { error: error.message });
        await ctx.answerCbQuery('Failed to delete file.');
      }
    });

    // Callback: back to file list
    this.bot.action('back_to_list', async (ctx) => {
      await ctx.answerCbQuery();
      const { text, keyboard } = this.buildFilesListMessage();
      if (keyboard) {
        await ctx.editMessageText(text, keyboard);
      } else {
        await ctx.editMessageText(text);
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // Callback: manage all files menu
    this.bot.action('manage_all', async (ctx) => {
      const files = this.getDownloadedFiles();
      const totalSize = FileManager.formatBytes(files.reduce((sum, f) => sum + f.size, 0));
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `⚙️ Manage All Files\n\n` +
        `Total: ${files.length} file(s), ${totalSize}\n\n` +
        `This will permanently delete all downloaded ZIP files.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🗑 Delete ALL Files', 'confirm_del_all')],
          [Markup.button.callback('⬅️ Back to List', 'back_to_list')]
        ])
      );
    });

    // Callback: confirm delete all
    this.bot.action('confirm_del_all', async (ctx) => {
      const files = this.getDownloadedFiles();
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `⚠️ Are you sure you want to delete ALL ${files.length} file(s)?\n\nThis cannot be undone.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Yes, Delete All', 'do_del_all')],
          [Markup.button.callback('❌ Cancel', 'manage_all')]
        ])
      );
    });

    // Callback: execute delete all
    this.bot.action('do_del_all', async (ctx) => {
      const files = this.getDownloadedFiles();
      let deleted = 0;

      for (const f of files) {
        try {
          await FileManager.deleteFile(path.join(DOWNLOADS_DIR, f.name));
          deleted++;
        } catch (error) {
          Logger.error(`Failed to delete file: ${f.name}`, { error: error.message });
        }
      }

      Logger.info(`Bulk delete: ${deleted}/${files.length} files removed`);
      await ctx.answerCbQuery(`Deleted ${deleted} file(s).`);
      await ctx.editMessageText(`✅ Done. ${deleted} file(s) deleted.`);
    });

    // ────────────────────────────────────────────────────────────────────
    // Text message handler — gallery URLs
    this.bot.on('text', async (ctx) => {
      const session = this.getUserSession(ctx.from.id);

      if (session.state === STATE.PROCESSING) {
        ctx.reply('Already processing a job. Please wait until it finishes.');
        return;
      }

      const lines = ctx.message.text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('http'));

      if (lines.length === 0) {
        ctx.reply('No valid URLs found.\n\nPlease send gallery URLs starting with http:// or https://, one per line.');
        return;
      }

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
      ctx.reply('An unexpected error occurred. Please try again or send /start to reset.').catch(() => {});
      const session = this.getUserSession(ctx.from?.id);
      if (session) session.state = STATE.IDLE;
    });
  }

  async processGalleries(ctx, urls) {
    const session = this.getUserSession(ctx.from.id);
    session.state = STATE.PROCESSING;

    const statusMsg = await ctx.reply('Starting... please wait.');
    const msgId = statusMsg.message_id;
    let tempDir = null;
    let zipPath = null;

    try {
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
        await this.updateStatus(ctx, msgId, `Extracting images... (${i + 1}/${urls.length} galleries done)`);
      }

      const totalImages = galleries.reduce((sum, g) => sum + g.urls.length, 0);
      if (totalImages === 0) throw new Error('No images found in any of the provided galleries.');

      await this.updateStatus(ctx, msgId,
        `Found ${totalImages} images across ${galleries.length} ${galleries.length === 1 ? 'gallery' : 'galleries'}.\nDownloading...`
      );

      tempDir = await FileManager.createTempDir('galleries');
      let lastUpdateTime = 0;

      const downloadResult = await ImageDownloader.downloadMultipleGalleries(
        galleries, tempDir,
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

      if (downloadResult.successImages === 0) throw new Error('Failed to download any images.');

      await this.updateStatus(ctx, msgId, 'Creating ZIP archive...');
      const archiveName = `galleries_${ctx.from.id}`;
      zipPath = await ZipCreator.createZip(tempDir, archiveName, DOWNLOADS_DIR);

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

      await this.retryWithBackoff(() =>
        ctx.telegram.deleteMessage(ctx.chat.id, msgId)
      ).catch(() => {});

      Logger.info(`Job complete for user ${ctx.from.id}: ${zipFileName}`);

    } catch (error) {
      Logger.error('Gallery processing failed', { error: error.message, user: ctx.from.id });
      await this.updateStatus(ctx, msgId, `Error: ${error.message}\n\nPlease check your URLs and try again.`);
    } finally {
      if (tempDir) await FileManager.deleteDir(tempDir).catch(() => {});
      session.state = STATE.IDLE;
    }
  }

  async initialize() {
    await strategyEngine.loadStrategies();
    Logger.info('Bot initialized successfully');
  }

  async startWebhook(webhookDomain, webhookPath) {
    await this.initialize();
    await this.bot.telegram.setWebhook(`${webhookDomain}${webhookPath}`);
    Logger.info(`Webhook set: ${webhookDomain}${webhookPath}`);
    return this.bot;
  }

  async startPolling() {
    await this.initialize();
    await this.bot.launch();
    Logger.info('Bot started with polling');
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }
}

module.exports = TelegramBot;
