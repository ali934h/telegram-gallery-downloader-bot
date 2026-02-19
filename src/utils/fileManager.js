/**
 * File Manager Utility
 * Handles file system operations and cleanup
 * Manages temporary directories and file deletion
 */

const fs = require('fs').promises;
const path = require('path');
const Logger = require('./logger');

class FileManager {
  /**
   * Create directory if it doesn't exist
   * @param {string} dirPath - Directory path to create
   */
  static async ensureDir(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      Logger.debug(`Directory ensured: ${dirPath}`);
    } catch (error) {
      Logger.error(`Failed to create directory: ${dirPath}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Delete file
   * @param {string} filePath - File path to delete
   */
  static async deleteFile(filePath) {
    try {
      await fs.unlink(filePath);
      Logger.debug(`File deleted: ${filePath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        Logger.error(`Failed to delete file: ${filePath}`, { error: error.message });
      }
    }
  }

  /**
   * Delete directory and all its contents recursively
   * @param {string} dirPath - Directory path to delete
   */
  static async deleteDir(dirPath) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      Logger.debug(`Directory deleted: ${dirPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        Logger.error(`Failed to delete directory: ${dirPath}`, { error: error.message });
      }
    }
  }

  /**
   * Create a unique temporary directory
   * @param {string} prefix - Prefix for directory name
   * @returns {string} Path to created directory
   */
  static async createTempDir(prefix = 'temp') {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const dirName = `${prefix}_${timestamp}_${randomStr}`;
    const dirPath = path.join(process.cwd(), 'temp', dirName);

    await this.ensureDir(dirPath);
    Logger.info(`Temporary directory created: ${dirName}`);

    return dirPath;
  }

  /**
   * Clean up old temporary directories (older than 1 hour)
   */
  static async cleanupOldTempDirs() {
    const tempDir = path.join(process.cwd(), 'temp');

    try {
      await this.ensureDir(tempDir);

      const entries = await fs.readdir(tempDir, { withFileTypes: true });
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(tempDir, entry.name);
          const stats = await fs.stat(dirPath);
          const age = now - stats.mtimeMs;

          if (age > oneHour) {
            await this.deleteDir(dirPath);
            Logger.info(`Cleaned up old temp directory: ${entry.name}`);
          }
        }
      }
    } catch (error) {
      Logger.error('Failed to cleanup old temp directories', { error: error.message });
    }
  }

  /**
   * Get file size in bytes
   * @param {string} filePath - File path
   * @returns {number} File size in bytes
   */
  static async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      Logger.error(`Failed to get file size: ${filePath}`, { error: error.message });
      return 0;
    }
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Bytes to format
   * @returns {string} Formatted string (e.g., "1.5 MB")
   */
  static formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = FileManager;
