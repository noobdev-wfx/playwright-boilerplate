import fs from "fs";
import path from "path";
import createLogger from "./logger";
import { getPathHelpers } from "./paths.js";

function checkLoginSession() {
  const { __dirname } = getPathHelpers(import.meta.url);
  const sessionPath = path.resolve(__dirname, "../storage/login.json");
  const logger = createLogger("Session_Tracker");

  if (!fs.existsSync(sessionPath)) {
    logger.log(
      "[FAILED] No login session found. You may need to run `npm run login` first."
    );
  } else {
    logger.log("[PASSED] Login session found.");
  }
}

export default checkLoginSession;
