/**
 * File Cleanup Utility - Handles deletion of uploaded files
 * Provides safe file deletion with error handling
 */

import fs from "fs/promises";
import path from "path";
import logger from "../logger/winston.logger.js";

/**
 * Delete a single file from the filesystem
 * @param {string} filePath - Full or relative path to file
 * @returns {Promise<boolean>} true if deleted, false if error
 */
export async function deleteFile(filePath) {
  try {
    if (!filePath) return false;

    // Verify file exists before attempting deletion
    try {
      await fs.access(filePath);
    } catch {
      // File doesn't exist, no error needed
      logger.debug("File does not exist, skipping deletion", { file: filePath });
      return true;
    }

    // Delete the file
    await fs.unlink(filePath);
    logger.debug("File deleted successfully", { file: filePath });
    return true;
  } catch (error) {
    logger.error("Failed to delete file", {
      file: filePath,
      error: error.message,
      code: error.code
    });
    throw error;
  }
}

/**
 * Delete multiple files from the filesystem
 * @param {string[]} filePaths - Array of file paths to delete
 * @returns {Promise<Object>} { deleted: number, failed: number, errors: [] }
 */
export async function deleteMultipleFiles(filePaths) {
  const results = {
    deleted: 0,
    failed: 0,
    errors: []
  };

  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return results;
  }

  for (const filePath of filePaths) {
    try {
      const deleted = await deleteFile(filePath);
      if (deleted) {
        results.deleted++;
      }
    } catch (error) {
      results.failed++;
      results.errors.push({
        file: filePath,
        error: error.message
      });
    }
  }

  if (results.failed > 0) {
    logger.error("Some files failed to delete", {
      deleted: results.deleted,
      failed: results.failed,
      errors: results.errors
    });
  }

  return results;
}

/**
 * Delete file from multer upload with timeout protection
 * @param {string} filePath - Path to file from multer
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns {Promise<boolean>}
 */
export async function deleteFileWithTimeout(filePath, timeoutMs = 5000) {
  try {
    return await Promise.race([
      deleteFile(filePath),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("File deletion timeout")),
          timeoutMs
        )
      )
    ]);
  } catch (error) {
    logger.error("File cleanup timeout or error", {
      file: filePath,
      timeout: timeoutMs,
      error: error.message
    });
    // Don't throw - allow request to proceed even if cleanup fails
    return false;
  }
}

export default {
  deleteFile,
  deleteMultipleFiles,
  deleteFileWithTimeout
};
