const path = require("node:path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const defaultConfig = getDefaultConfig(projectRoot);

module.exports = mergeConfig(defaultConfig, {
  watchFolders: [workspaceRoot],
  resolver: {
    extraNodeModules: {
      react: path.resolve(workspaceRoot, "node_modules/react"),
      "react-native": path.resolve(workspaceRoot, "node_modules/react-native")
    },
    nodeModulesPaths: [
      path.resolve(workspaceRoot, "node_modules")
    ]
  }
});
