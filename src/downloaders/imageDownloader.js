/**
 * Image Downloader
 * Downloads images from URLs with retry logic and error handling
 * Supports parallel downloads with concurrency control
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('../utils/logger');

class ImageDownloader {
  /**
   * Download a single image
   * @param {string} url - Image URL
   * @param {string} outputPath - Output file path
   * @param {number} retries - Number of retries
   * @returns {boolean} Success status
   */
  static async downloadImage(url, outputPath, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        Logger.debug(`Downloading image (attempt ${attempt}/${retries}): ${url}`);

        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Referer': new URL(url).origin
          },
          timeout: 30000,
          maxRedirects: 5
        });

        await fs.writeFile(outputPath, response.data);
        Logger.debug(`Image downloaded successfully: ${path.basename(outputPath)}`);
        return true;
      } catch (error) {
        Logger.warn(
          `Download attempt ${attempt} failed for: ${url}`,
          { error: error.message }
        );

        if (attempt === retries) {
          Logger.error(`Failed to download image after ${retries} attempts: ${url}`);
          return false;
        }

        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    return false;
  }

  /**
   * Generate filename from URL
   * @param {string} url - Image URL
   * @param {number} index - Image index
   * @returns {string} Filename
   */
  static generateFilename(url, index) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const extension = path.extname(pathname) || '.jpg';
      const basename = path.basename(pathname, extension);
      const cleanName = basename.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
      return `${String(index).padStart(3, '0')}_${cleanName}${extension}`;
    } catch (error) {
      return `image_${String(index).padStart(3, '0')}.jpg`;
    }
  }

  /**
   * Download multiple images with concurrency control
   * @param {Array} urls - Array of image URLs
   * @param {string} outputDir - Output directory
   * @param {number} concurrency - Max parallel downloads
   * @param {Function} progressCallback - Progress callback function
   * @returns {Object} Download results
   */
  static async downloadImages(urls, outputDir, concurrency = 5, progressCallback = null) {
    Logger.info(`Starting download of ${urls.length} images`);

    const results = {
      total: urls.length,
      success: 0,
      failed: 0,
      files: []
    };

    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);

      const promises = batch.map(async (url, batchIndex) => {
        const index = i + batchIndex + 1;
        const filename = this.generateFilename(url, index);
        const outputPath = path.join(outputDir, filename);

        const success = await this.downloadImage(url, outputPath);

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

    Logger.info(
      `Download completed: ${results.success} succeeded, ${results.failed} failed`
    );

    return results;
  }

  /**
   * Download images from multiple galleries
   * @param {Array} galleries - Array of {name, urls} objects
   * @param {string} baseOutputDir - Base output directory
   * @param {Function} progressCallback - Progress callback
   * @returns {Object} Download results
   */
  static async downloadMultipleGalleries(galleries, baseOutputDir, progressCallback = null) {
    Logger.info(`Downloading ${galleries.length} galleries`);

    const results = {
      totalGalleries: galleries.length,
      completedGalleries: 0,
      totalImages: 0,
      successImages: 0,
      failedImages: 0,
      galleries: []
    };

    for (const gallery of galleries) {
      Logger.info(`Processing gallery: ${gallery.name}`);

      const galleryDir = path.join(baseOutputDir, gallery.name);
      await fs.mkdir(galleryDir, { recursive: true });

      const galleryResult = await this.downloadImages(
        gallery.urls,
        galleryDir,
        5,
        (progress) => {
          if (progressCallback) {
            progressCallback({
              galleryName: gallery.name,
              galleryProgress: progress,
              completedGalleries: results.completedGalleries,
              totalGalleries: results.totalGalleries
            });
          }
        }
      );

      results.completedGalleries++;
      results.totalImages += galleryResult.total;
      results.successImages += galleryResult.success;
      results.failedImages += galleryResult.failed;
      results.galleries.push({
        name: gallery.name,
        ...galleryResult
      });
    }

    Logger.info(
      `All galleries downloaded: ${results.successImages}/${results.totalImages} images succeeded`
    );

    return results;
  }
}

module.exports = ImageDownloader;
