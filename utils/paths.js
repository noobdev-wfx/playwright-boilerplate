import { fileURLToPath } from "url";
import { dirname } from "path";
/**
 * Utility to get __filename and __dirname in ES Modules
 * @param importMetaUrl typically import.meta.url
 */
export function getPathHelpers(importMetaUrl) {
  const __filename = fileURLToPath(importMetaUrl);
  const __dirname = dirname(__filename);
  return { __filename, __dirname };
}
