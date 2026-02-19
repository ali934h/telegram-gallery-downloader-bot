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
}

// Export singleton instance
module.exports = new StrategyEngine();
