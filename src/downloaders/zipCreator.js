/**
 * ZIP Creator
 * Creates ZIP archives using the 'archiver' Node.js package.
 * No system 'zip' binary required.
 */

const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const Logger = require('../utils/logger');

class ZipCreator {
  /**
   * Create a ZIP archive from a source directory.
   *
   * @param {string} sourceDir   - Directory containing gallery subfolders
   * @param {string} archiveName - Base name for the output ZIP (no extension)
   * @param {string} outputDir   - Directory to save the ZIP file
   * @returns {Promise<string>}  Full path to the created ZIP file
   */
  static async createZip(sourceDir, archiveName, outputDir) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const zipFileName = `${archiveName}_${Date.now()}.zip`;
    const zipFilePath = path.join(outputDir, zipFileName);

    Logger.info(`Creating ZIP archive: ${zipFileName}`);

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', () => {
        const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
        Logger.info(`ZIP archive created: ${zipFileName} (${sizeMB} MB)`);
        resolve(zipFilePath);
      });

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          Logger.warn(`ZIP warning: ${err.message}`);
        } else {
          reject(err);
        }
      });

      archive.on('error', (err) => {
        Logger.error('Failed to create ZIP archive', { error: err.message });
        reject(err);
      });

      archive.pipe(output);
      // Add all contents of sourceDir recursively
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }
}

module.exports = ZipCreator;
