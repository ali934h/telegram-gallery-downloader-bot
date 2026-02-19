/**
 * Logger Utility
 * Provides consistent logging across the application
 * Logs include timestamps and severity levels
 */

const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

class Logger {
  /**
   * Format timestamp for logs
   * @returns {string} Formatted timestamp
   */
  static getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Format log message
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   * @returns {string} Formatted log message
   */
  static formatMessage(level, message, meta = {}) {
    const timestamp = this.getTimestamp();
    const metaStr = Object.keys(meta).length > 0 ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
  }

  /**
   * Log info message
   * @param {string} message - Message to log
   * @param {Object} meta - Additional metadata
   */
  static info(message, meta = {}) {
    console.log(this.formatMessage(LOG_LEVELS.INFO, message, meta));
  }

  /**
   * Log warning message
   * @param {string} message - Message to log
   * @param {Object} meta - Additional metadata
   */
  static warn(message, meta = {}) {
    console.warn(this.formatMessage(LOG_LEVELS.WARN, message, meta));
  }

  /**
   * Log error message
   * @param {string} message - Message to log
   * @param {Object} meta - Additional metadata
   */
  static error(message, meta = {}) {
    console.error(this.formatMessage(LOG_LEVELS.ERROR, message, meta));
  }

  /**
   * Log debug message (only in development)
   * @param {string} message - Message to log
   * @param {Object} meta - Additional metadata
   */
  static debug(message, meta = {}) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage(LOG_LEVELS.DEBUG, message, meta));
    }
  }
}

module.exports = Logger;
