/**
 * Stack Trace Parser - Extracts root cause from error stack
 * Filters out node_modules and internal Node files to show only user code
 */

/**
 * Parse a stack trace string and extract the root cause (first user code frame)
 * @param {Error|string} error - Error object or stack trace string
 * @returns {Object} { file, line, column, function, stack }
 */
export function getRootCause(error) {
  const defaultResult = {
    file: "unknown",
    line: 0,
    column: 0,
    function: "unknown",
    stack: ""
  };

  try {
    const stackString = error?.stack || error || "";
    if (!stackString) return defaultResult;

    const lines = stackString.split("\n");

    // Find first stack frame from user code (src/ directory)
    for (const line of lines) {
      // Parse line like "  at functionName (path/to/file.js:123:45)"
      const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);

      if (match) {
        const [, functionName, filePath, lineNum, colNum] = match;

        // Skip node_modules and internal Node.js files
        if (filePath.includes("node_modules") || filePath.includes("internal/")) {
          continue;
        }

        // Keep user code files (contain src/ or relative paths)
        if (filePath.includes("src") || !filePath.includes("node_modules")) {
          return {
            file: filePath,
            line: parseInt(lineNum, 10),
            column: parseInt(colNum, 10),
            function: functionName.trim(),
            stack: line.trim() // Return just this frame as single-line stack
          };
        }
      }
    }

    // Fallback: return first relevant frame even if not from src/
    for (const line of lines) {
      const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
      if (match && !line.includes("node_modules")) {
        const [, functionName, filePath, lineNum, colNum] = match;
        if (!filePath.includes("internal/")) {
          return {
            file: filePath,
            line: parseInt(lineNum, 10),
            column: parseInt(colNum, 10),
            function: functionName.trim(),
            stack: line.trim()
          };
        }
      }
    }

    return defaultResult;
  } catch (err) {
    // If parsing fails, return default
    return defaultResult;
  }
}

export default { getRootCause };
