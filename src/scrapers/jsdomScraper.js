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
   * Resolve protocol-relative or relative URLs to absolute ones.
   * e.g. "//s3.example.com/image.jpg" => "https://s3.example.com/image.jpg"
   */
  static resolveUrl(imgUrl, pageUrl) {
    if (!imgUrl) return null;
    // Protocol-relative
    if (imgUrl.startsWith('//')) return 'https:' + imgUrl;
    // Already absolute
    if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) return imgUrl;
    // Relative path — resolve against page origin
    try {
      return new URL(imgUrl, pageUrl).href;
    } catch (_) {
      return null;
    }
  }

  /**
   * Sleep helper for retry delays
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch HTML content from URL with optional custom headers from strategy
   * Includes retry logic for ECONNRESET and similar errors
   * @param {string} url - URL to fetch
   * @param {Object} customHeaders - Optional custom headers from strategy
   * @param {number} retries - Number of retry attempts (default: 3)
   */
  static async fetchHTML(url, customHeaders = {}, retries = 3) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      // Merge custom headers (overrides defaults)
      ...customHeaders
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        Logger.debug(`Fetching HTML from: ${url} (attempt ${attempt}/${retries})`);
        
        const response = await axios.get(url, {
          headers,
          timeout: 30000,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 300
        });
        
        Logger.debug(`HTML fetched successfully (${response.data.length} bytes)`);
        return response.data;
        
      } catch (error) {
        const isRetryable = 
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND' ||
          error.message.includes('socket hang up') ||
          (error.response && error.response.status >= 500);

        if (isRetryable && attempt < retries) {
          const delay = 2000 * attempt; // 2s, 4s, 6s
          Logger.warn(`Request failed (${error.message}), retrying in ${delay}ms... (${attempt}/${retries})`);
          await this.sleep(delay);
          continue;
        }

        Logger.error(`Failed to fetch HTML from: ${url}`, { error: error.message });
        throw new Error(`HTTP request failed: ${error.message}`);
      }
    }
  }

  /**
   * Filter out thumbnail and low-quality images based on patterns
   */
  static filterImages(urls, filterPatterns = []) {
    if (!filterPatterns || filterPatterns.length === 0) return urls;
    const filtered = urls.filter(url =>
      !filterPatterns.some(pattern => url.includes(pattern))
    );
    Logger.debug(`Filtered ${urls.length - filtered.length} images (${filtered.length} remaining)`);
    return filtered;
  }

  /**
   * Extract image URLs from gallery page
   */
  static async extractImages(url, strategy) {
    try {
      Logger.info(`Extracting images from gallery: ${url}`);
      
      // Use custom headers from strategy if available
      const customHeaders = strategy.headers || {};
      const html = await this.fetchHTML(url, customHeaders);
      
      const dom = new JSDOM(html);
      const document = dom.window.document;

      const selector = strategy.images.selector;
      const attr = strategy.images.attr;
      const elements = document.querySelectorAll(selector);

      Logger.debug(`Found ${elements.length} elements matching selector: ${selector}`);

      const urls = [];
      elements.forEach(element => {
        const raw = element.getAttribute(attr);
        const resolved = this.resolveUrl(raw, url);
        if (resolved) urls.push(resolved);
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
