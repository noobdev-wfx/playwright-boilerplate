import fs from "fs";
import path from "path";
import { getPathHelpers } from "./paths.js";

const { __dirname } = getPathHelpers(import.meta.url);
const defaultVideosDir = path.resolve(__dirname, "../videos");

async function renameVideoFile(page, testName, videosDir = defaultVideosDir) {
  const video = page.video();
  if (!video) {
    console.error("❌ No video recording found on this page.");
    return;
  }

  const videoPath = await video.path();
  if (!videoPath) {
    console.error("❌ Video path is undefined.");
    return;
  }

  const destDir = path.resolve(videosDir);
  const destPath = path.join(destDir, `${testName}.webm`);

  try {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }

    fs.renameSync(videoPath, destPath);
  } catch (err) {
    console.error(`❌ Failed to rename video: ${err.message}`);
    return null;
  }

  return destPath;
}

export default renameVideoFile;
