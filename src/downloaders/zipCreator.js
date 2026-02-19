/**
 * ZIP Creator
 * Creates ZIP archives from directories using the system 'zip' command
 * Requires 'zip' to be installed on the server (apt install zip)
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const Logger = require('../utils/logger');

class ZipCreator {
  /**
   * Run a shell command and return a promise
   * @param {string} command - Command to execute
   * @param {Array} args - Command arguments
   * @param {Object} options - execFile options
   * @returns {Promise<{stdout, stderr}>}
   */
  static runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(command, args, options, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command failed: ${error.message}\nStderr: ${stderr}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /**
   * Create a ZIP archive from a source directory
   * The archive will contain all gallery subfolders with their images.
   *
   * @param {string} sourceDir - Directory containing gallery subfolders
   * @param {string} archiveName - Base name for the output ZIP file (no extension)
   * @param {string} outputDir - Directory to save the ZIP file
   * @returns {Promise<string>} Full path to the created ZIP file
   */
  static async createZip(sourceDir, archiveName, outputDir) {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const zipFileName = `${archiveName}_${Date.now()}.zip`;
    const zipFilePath = path.join(outputDir, zipFileName);

    Logger.info(`Creating ZIP archive: ${zipFileName}`);
    Logger.debug(`Source directory: ${sourceDir}`);
    Logger.debug(`Output path: ${zipFilePath}`);

    try {
      // zip -r <output.zip> . (run from inside sourceDir)
      await this.runCommand(
        'zip',
        ['-r', zipFilePath, '.'],
        { cwd: sourceDir }
      );

      // Verify the file was created
      if (!fs.existsSync(zipFilePath)) {
        throw new Error('ZIP file was not created');
      }

      const stats = fs.statSync(zipFilePath);
      Logger.info(`ZIP archive created: ${zipFileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

      return zipFilePath;
    } catch (error) {
      Logger.error('Failed to create ZIP archive', { error: error.message });
      throw error;
    }
  }
}

module.exports = ZipCreator;
