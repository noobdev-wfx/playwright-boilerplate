import path from "path";
import { getPathHelpers } from "./utils/paths";

const { __dirname } = getPathHelpers(import.meta.url);
const extensionPath = path.resolve(__dirname, "whatfix-extension");

const playwrightConfig = {
  use: {
    headless: false,
    storageState: "./storage/login.json",
    contextOptions: {
      args: [
        "--disable-session-crashed-bubble",
        "--disable-infobars",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    },
  },
};

export default playwrightConfig;
