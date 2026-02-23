/**
 * Strategy Engine
 * Loads and manages site-specific scraping strategies
 * Provides strategy lookup by domain
 */

const fs = require('fs').promises;
const path = require('path');
const Logger = require('../utils/logger');

class StrategyEngine {
  constructor() {
    this.strategies = {};
    this.loaded = false;
  }

  /**
   * Load strategies from JSON config file
   */
  async loadStrategies() {
    try {
      const configPath = path.join(__dirname, '../config/siteStrategies.json');
      const data = await fs.readFile(configPath, 'utf8');
      this.strategies = JSON.parse(data);

      // Remove comment fields
      delete this.strategies._comment;
      delete this.strategies._structure;

      this.loaded = true;
      Logger.info(`Loaded ${Object.keys(this.strategies).length} site strategies`);
    } catch (error) {
      Logger.error('Failed to load site strategies', { error: error.message });
      throw new Error('Could not load site strategies configuration');
    }
  }

  /**
   * Extract domain from URL
   * @param {string} url - Full URL
   * @returns {string} Domain name
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (error) {
      Logger.error('Invalid URL provided', { url });
      throw new Error('Invalid URL format');
    }
  }

  /**
   * Get strategy for a specific URL
   * @param {string} url - URL to get strategy for
   * @returns {Object} Strategy object or null
   */
  getStrategy(url) {
    if (!this.loaded) {
      throw new Error('Strategies not loaded. Call loadStrategies() first.');
    }

    const domain = this.extractDomain(url);
    const strategy = this.strategies[domain];

    if (!strategy) {
      Logger.warn(`No strategy found for domain: ${domain}`);
      return null;
    }

    Logger.debug(`Strategy found for domain: ${domain}`, { strategy: strategy.name });
    return strategy;
  }

  /**
   * Get all available strategies
   * @returns {Object} All strategies
   */
  getAllStrategies() {
    if (!this.loaded) {
      throw new Error('Strategies not loaded. Call loadStrategies() first.');
    }
    return this.strategies;
  }

  /**
   * Get list of all supported domains
   * @returns {Array} Array of domain names
   */
  getSupportedDomains() {
    if (!this.loaded) {
      throw new Error('Strategies not loaded. Call loadStrategies() first.');
    }
    return Object.keys(this.strategies);
  }

  /**
   * Check if a domain is supported
   * @param {string} url - URL to check
   * @returns {boolean} True if supported
   */
  isSupported(url) {
    try {
      const domain = this.extractDomain(url);
      return domain in this.strategies;
    } catch (error) {
      return false;
    }
  }

  /**
   * Try all strategies on a URL and return the first one that finds >= minImages
   * @param {string} url - URL to test
   * @param {Object} JsdomScraper - JsdomScraper class
   * @param {number} minImages - Minimum number of images to consider success (default: 5)
   * @returns {Promise<Object|null>} {strategy, images} or null if none worked
   */
  async findWorkingStrategy(url, JsdomScraper, minImages = 5) {
    if (!this.loaded) {
      throw new Error('Strategies not loaded. Call loadStrategies() first.');
    }

    const domain = this.extractDomain(url);
    Logger.info(`Testing strategies for unsupported domain: ${domain}`);

    const strategyEntries = Object.entries(this.strategies);

    for (const [strategyDomain, strategy] of strategyEntries) {
      try {
        Logger.debug(`Testing ${strategy.name} strategy on ${domain}...`);
        
        const images = await JsdomScraper.extractImages(url, strategy);
        
        if (images && images.length >= minImages) {
          Logger.info(`✓ Strategy '${strategy.name}' found ${images.length} images for ${domain}`);
          return { strategy, images };
        } else {
          Logger.debug(`✗ Strategy '${strategy.name}' found only ${images ? images.length : 0} images (need ${minImages})`);
        }
      } catch (error) {
        Logger.debug(`✗ Strategy '${strategy.name}' failed: ${error.message}`);
      }
    }

    Logger.warn(`No working strategy found for ${domain} after testing ${strategyEntries.length} strategies`);
    return null;
  }
}

// Export singleton instance
module.exports = new StrategyEngine();
