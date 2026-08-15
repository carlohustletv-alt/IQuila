import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const reactVersion = require(resolve(root, "node_modules/react/package.json")).version;
const reactNativeVersion = require(resolve(root, "node_modules/react-native/package.json")).version;
const rendererPath = resolve(
  root,
  "node_modules/react-native/Libraries/Renderer/implementations/ReactNativeRenderer-dev.js"
);
const rendererSource = readFileSync(rendererPath, "utf8");
const rendererMatch = rendererSource.match(/react-native-renderer:\s+([0-9.]+)/);
const rendererVersion = rendererMatch?.[1];
const nestedReactPaths = [
  resolve(root, "apps/mobile/node_modules/react/package.json"),
  resolve(root, "node_modules/react-native/node_modules/react/package.json")
].filter(existsSync);

if (!rendererVersion) {
  throw new Error("Could not determine React Native renderer version");
}

if (reactVersion !== rendererVersion) {
  throw new Error(`React ${reactVersion} does not match React Native renderer ${rendererVersion}`);
}

if (nestedReactPaths.length) {
  throw new Error(`Duplicate React installations found: ${nestedReactPaths.join(", ")}`);
}

console.log(`Mobile runtime compatible: React ${reactVersion}, React Native ${reactNativeVersion}`);
