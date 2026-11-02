process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import fs from "fs";
import fse from "fs-extra";
import https from "https";
import path from "path";
import unzipper from "unzipper";
import createLogger from "./utils/logger.js";
import { getPathHelpers } from "./utils/paths.js";

const { __dirname } = getPathHelpers(import.meta.url);
const extensionUrl = "https://github.com/noobdev-wfx/base-playwright-zeel/releases/download/V1/c6e97106-4bb3-4091-bf30-2c0b0222f41b.zip";

const zipPath = path.join(__dirname, "latest-extension.zip");
const extractTemp = path.join(__dirname, "tmp-extract");
const finalPath = path.join(__dirname, "whatfix-extension");
const logger = createLogger("Extension_Installer");

function downloadExtension(url = extensionUrl) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(zipPath);
    const options = {
      headers: { "User-Agent": "whatfix-automation-script" },
    };
    logger.log("Starting extension download...");
    https
      .get(url, options, (res) => {
        if (res.statusCode === 302 && res.headers.location) {
          logger.log("Redirected to new download URL");
          return downloadExtension(res.headers.location)
            .then(resolve)
            .catch(reject);
        }
        if (res.statusCode !== 200) {
          logger.log("Download failed with status " + res.statusCode);
          return reject(new Error(`Download failed: ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
          logger.log("Extension ZIP downloaded successfully");
        });
      })
      .on("error", (err) => {
        logger.log("Error downloading extension: " + err.message);
        reject(err);
      });
  });
}

async function extractAndFlatten() {
  logger.log("Extracting ZIP file...");

  fse.emptyDirSync(extractTemp);
  fse.emptyDirSync(finalPath);

  await fs
    .createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: extractTemp }))
    .promise();

  const entries = fs.readdirSync(extractTemp).filter((d) => d !== "__MACOSX");

  if (
    entries.length === 1 &&
    fs.lstatSync(path.join(extractTemp, entries[0])).isDirectory()
  ) {
    // Case 1: zip had a parent folder
    fse.copySync(path.join(extractTemp, entries[0]), finalPath);
  } else {
    // Case 2: files directly at root
    entries.forEach((entry) => {
      fse.copySync(path.join(extractTemp, entry), path.join(finalPath, entry));
    });
  }

  logger.log("Extension extracted to: " + finalPath);
}

(async () => {
  try {
    console.log("📥 Downloading extension...");
    logger.log("Starting extension installation process...");
    await downloadExtension();
    await extractAndFlatten();
    console.log("✅ Whatfix extension ready at:", finalPath);
    logger.log("Extension setup completed successfully.");
  } catch (e) {
    console.error("❌ Failed:", e.message);
    logger.log("Extension setup failed: " + e.message);
  }
})();
