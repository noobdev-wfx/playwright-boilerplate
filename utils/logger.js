import fs from "fs";
import path from "path";
import { getPathHelpers } from "./paths.js";

function createLogger(testName) {
  const { __dirname } = getPathHelpers(import.meta.url);
  const logsDir = path.resolve(__dirname, "../logs");

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }

  const logFilePath = path.join(logsDir, `${testName}.log`);
  let logStream = fs.createWriteStream(logFilePath, { flags: "w" });

  function log(message) {
    const timestamp = new Date().toISOString();
    logStream.write(`[${timestamp}] ${message}\n`);
  }

  function close() {
    logStream.end();
  }

  return { log, close };
}

export default createLogger;
