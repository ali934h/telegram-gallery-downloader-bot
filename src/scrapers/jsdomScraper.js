/**
 * JSDOM Scraper
 * Fast HTML parsing using jsdom for gallery image extraction
 * Uses CSS selectors from strategy configuration
 */

const axios = require('axios');
const { JSDOM } = require('jsdom');
const Logger = require('../utils/logger');

class JsdomScraper {
  /**
   * Fetch HTML content from URL
   * @param {string} url - URL to fetch
   * @returns {string} HTML content
   */
  static async fetchHTML(url) {
    try {
      Logger.debug(`Fetching HTML from: ${url}`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: 30000
      });

      Logger.debug(`HTML fetched successfully (${response.data.length} bytes)`);
      return response.data;
    } catch (error) {
      Logger.error(`Failed to fetch HTML from: ${url}`, { error: error.message });
      throw new Error(`HTTP request failed: ${error.message}`);
    }
  }

  /**
   * Filter out thumbnail and low-quality images based on patterns
   * @param {Array} urls - Array of image URLs
   * @param {Array} filterPatterns - Patterns to filter out
   * @returns {Array} Filtered URLs
   */
  static filterImages(urls, filterPatterns = []) {
    if (!filterPatterns || filterPatterns.length === 0) {
      return urls;
    }

    const filtered = urls.filter(url => {
      return !filterPatterns.some(pattern => url.includes(pattern));
    });

    Logger.debug(`Filtered ${urls.length - filtered.length} images (${filtered.length} remaining)`);
    return filtered;
  }

  /**
   * Extract image URLs from gallery page
   * @param {string} url - Gallery URL
   * @param {Object} strategy - Strategy configuration for the site
   * @returns {Array} Array of image URLs
   */
  static async extractImages(url, strategy) {
    try {
      Logger.info(`Extracting images from gallery: ${url}`);

      const html = await this.fetchHTML(url);
      const dom = new JSDOM(html);
      const document = dom.window.document;

      const selector = strategy.images.selector;
      const attr = strategy.images.attr;
      const elements = document.querySelectorAll(selector);

      Logger.debug(`Found ${elements.length} elements matching selector: ${selector}`);

      const urls = [];
      elements.forEach(element => {
        const imgUrl = element.getAttribute(attr);
        if (imgUrl) {
          urls.push(imgUrl);
        }
      });

      const filteredUrls = this.filterImages(urls, strategy.images.filterPatterns);
      const uniqueUrls = [...new Set(filteredUrls)];

      Logger.info(`Extracted ${uniqueUrls.length} unique images from gallery`);
      return uniqueUrls;
    } catch (error) {
      Logger.error(`Failed to extract images from: ${url}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Extract gallery name from URL
   * @param {string} url - Gallery URL
   * @returns {string} Gallery name
   */
  static extractGalleryName(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part);
      const galleryName = pathParts[pathParts.length - 1] || 'gallery';
      return galleryName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    } catch (error) {
      return 'gallery';
    }
  }
}

module.exports = JsdomScraper;
