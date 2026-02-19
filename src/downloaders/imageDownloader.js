/**
 * Image Downloader
 * Supports parallel downloads with concurrency control and AbortSignal
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('../utils/logger');

class ImageDownloader {
  static async downloadImage(url, outputPath, retries = 3, signal = null) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      if (signal && signal.aborted) return false;

      try {
        Logger.debug(`Downloading image (attempt ${attempt}/${retries}): ${url}`);

        const response = await axios({
          method: 'GET',
          url,
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Referer': new URL(url).origin
          },
          timeout: 30000,
          maxRedirects: 5,
          signal: signal || undefined
        });

        await fs.writeFile(outputPath, response.data);
        return true;
      } catch (error) {
        // Aborted — stop immediately, don't retry
        if (
          error.code === 'ERR_CANCELED' ||
          (signal && signal.aborted)
        ) return false;

        Logger.warn(`Download attempt ${attempt} failed for: ${url}`, { error: error.message });
        if (attempt === retries) {
          Logger.error(`Failed to download after ${retries} attempts: ${url}`);
          return false;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    return false;
  }

  static generateFilename(url, index) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const extension = path.extname(pathname) || '.jpg';
      const basename = path.basename(pathname, extension);
      const cleanName = basename.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
      return `${String(index).padStart(3, '0')}_${cleanName}${extension}`;
    } catch {
      return `image_${String(index).padStart(3, '0')}.jpg`;
    }
  }

  /**
   * @param {AbortSignal} [signal]
   * @param {number} [concurrency] - Max parallel downloads (default 5)
   */
  static async downloadImages(urls, outputDir, concurrency = 5, progressCallback = null, signal = null) {
    Logger.info(`Starting download of ${urls.length} images with concurrency ${concurrency}`);

    const results = { total: urls.length, success: 0, failed: 0, files: [] };

    for (let i = 0; i < urls.length; i += concurrency) {
      if (signal && signal.aborted) break;

      const batch = urls.slice(i, i + concurrency);
      const promises = batch.map(async (url, batchIndex) => {
        if (signal && signal.aborted) return;

        const index = i + batchIndex + 1;
        const filename = this.generateFilename(url, index);
        const outputPath = path.join(outputDir, filename);

        const success = await this.downloadImage(url, outputPath, 3, signal);

        if (success) {
          results.success++;
          results.files.push(outputPath);
        } else {
          results.failed++;
        }

        if (progressCallback) {
          progressCallback({
            current: results.success + results.failed,
            total: results.total,
            success: results.success,
            failed: results.failed
          });
        }
      });

      await Promise.all(promises);
    }

    Logger.info(`Download completed: ${results.success} succeeded, ${results.failed} failed`);
    return results;
  }

  /**
   * @param {AbortSignal} [signal]
   * @param {number} [concurrency] - Max parallel downloads per gallery (default 5)
   */
  static async downloadMultipleGalleries(galleries, baseOutputDir, progressCallback = null, signal = null, concurrency = 5) {
    Logger.info(`Downloading ${galleries.length} galleries with concurrency ${concurrency}`);

    const results = {
      totalGalleries: galleries.length,
      completedGalleries: 0,
      totalImages: 0,
      successImages: 0,
      failedImages: 0,
      galleries: [],
      cancelled: false
    };

    for (const gallery of galleries) {
      if (signal && signal.aborted) {
        results.cancelled = true;
        break;
      }

      Logger.info(`Processing gallery: ${gallery.name}`);
      const galleryDir = path.join(baseOutputDir, gallery.name);
      await fs.mkdir(galleryDir, { recursive: true });

      const galleryResult = await this.downloadImages(
        gallery.urls,
        galleryDir,
        concurrency,
        (progress) => {
          if (progressCallback) {
            progressCallback({
              galleryName: gallery.name,
              galleryProgress: progress,
              completedGalleries: results.completedGalleries,
              totalGalleries: results.totalGalleries
            });
          }
        },
        signal
      );

      results.completedGalleries++;
      results.totalImages += galleryResult.total;
      results.successImages += galleryResult.success;
      results.failedImages += galleryResult.failed;
      results.galleries.push({ name: gallery.name, ...galleryResult });

      if (signal && signal.aborted) {
        results.cancelled = true;
        break;
      }
    }

    Logger.info(`All galleries downloaded: ${results.successImages}/${results.totalImages} images succeeded`);
    return results;
  }
}

module.exports = ImageDownloader;
