/**
 * JSDOM Scraper
 * Fast HTML parsing using jsdom for gallery image extraction
 * Uses CSS selectors from strategy configuration
 */

const axios = require('axios');
const { JSDOM } = require('jsdom');
const { SocksProxyAgent } = require('socks-proxy-agent');
const Logger = require('../utils/logger');

class JsdomScraper {
  /**
   * Resolve protocol-relative or relative URLs to absolute ones.
   */
  static resolveUrl(imgUrl, pageUrl) {
    if (!imgUrl) return null;
    if (imgUrl.startsWith('//')) return 'https:' + imgUrl;
    if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) return imgUrl;
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
   * Get proxy agent if PROXY_URL is set and strategy requires it
   * @param {boolean} useProxy - Whether this strategy requires proxy
   */
  static getProxyAgent(useProxy = false) {
    if (!useProxy) return null;

    const proxyUrl = process.env.PROXY_URL;
    if (!proxyUrl) {
      Logger.warn('Strategy requires proxy but PROXY_URL is not set');
      return null;
    }

    try {
      if (proxyUrl.startsWith('socks://') || proxyUrl.startsWith('socks5://')) {
        return new SocksProxyAgent(proxyUrl);
      }
      return null;
    } catch (error) {
      Logger.warn(`Invalid proxy URL: ${proxyUrl}`, { error: error.message });
      return null;
    }
  }

  /**
   * Fetch HTML content from URL with optional custom headers and proxy
   * @param {string} url - URL to fetch
   * @param {Object} customHeaders - Optional custom headers from strategy
   * @param {boolean} useProxy - Whether to use proxy for this request
   * @param {number} retries - Number of retry attempts
   */
  static async fetchHTML(url, customHeaders = {}, useProxy = false, retries = 3) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...customHeaders
    };

    const proxyAgent = this.getProxyAgent(useProxy);
    const axiosConfig = {
      headers,
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300
    };

    // Add proxy agent if available
    if (proxyAgent) {
      axiosConfig.httpAgent = proxyAgent;
      axiosConfig.httpsAgent = proxyAgent;
      Logger.debug(`Using proxy for: ${url}`);
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        Logger.debug(`Fetching HTML from: ${url} (attempt ${attempt}/${retries})`);
        
        const response = await axios.get(url, axiosConfig);
        
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
          const delay = 2000 * attempt;
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
   * Filter out thumbnail and low-quality images
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
      
      const customHeaders = strategy.headers || {};
      const useProxy = strategy.useProxy || false;
      const html = await this.fetchHTML(url, customHeaders, useProxy);
      
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
