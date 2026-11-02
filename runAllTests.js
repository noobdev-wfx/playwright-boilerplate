import { spawn } from "child_process";
import createLogger from "./utils/logger.js";

const popupImport = "tests/Popup";
const flowsImport = "tests/Flows";
const beaconsImport = "tests/Beacons";

const testFiles = [
  // Beacons
  `${beaconsImport}/Beacons.js`,
  // Flows
  `${flowsImport}/WelcomeTourFlow.js`,
  `${flowsImport}/FlowsById.js`,
  // Popups
  `${popupImport}/WriteRequestPopup.js`,
];

(async () => {
  const results = [];
  const logger = createLogger("Test_Cases_Summary");
  logger.log("[INFO] Test Execution Started");

  for (const file of testFiles) {
    logger.log(`[INFO] Running ${file}`);

    const result = await new Promise((resolve) => {
      const proc = spawn("node", [file], { stdio: "inherit" });
      proc.on("exit", (code) => {
        const status = code === 0 ? "PASSED" : "FAILED";
        logger.log(`[INFO] ${status}: ${file}`);
        resolve({ file, status });
      });
    });
    results.push(result);

    // All tests share one persistent Chrome profile (loginConfig/tmp-user).
    // A brief pause lets the OS fully release its profile lock before the
    // next test launches a browser against it.
    await new Promise((r) => setTimeout(r, 3000));
  }

  logger.log("[INFO] \nSummary:");

  results.forEach(({ file, status }) => {
    logger.log(`[INFO] ${status}: ${file}`);
  });

  const failedTests = results.filter((r) => r.status === "FAILED");
  if (failedTests.length > 0) {
    logger.log(`[FAILED] ${failedTests.length} test(s) failed.`);
    process.exit(1);
  } else {
    logger.log("[INFO] All tests passed.");
  }
})();
