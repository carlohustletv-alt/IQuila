// SPDX-FileCopyrightText: 2026 carlohustletv
// SPDX-License-Identifier: GPL-3.0-only

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sourceExtensions = /\.(?:ts|tsx|js|mjs|kt|kts|sql|css|gradle)$/;
const sourceRoots = /^(?:apps|packages|scripts|supabase)\//;
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const sourceFiles = files.filter((file) => sourceExtensions.test(file));
const uncovered = sourceFiles.filter((file) => !sourceRoots.test(file));
const manifest = readFileSync("REUSE.toml", "utf8");
const license = readFileSync("LICENSE", "utf8");

if (!manifest.includes("SPDX-License-Identifier = \"GPL-3.0-only\"") || !license.includes("GNU General Public License") || !license.includes("version 3")) {
  throw new Error("GPL-3.0-only repository metadata is incomplete.");
}
if (uncovered.length) {
  throw new Error(`Source outside GPL-covered roots:\n${uncovered.join("\n")}`);
}

console.log(`GPL-3.0-only REUSE coverage verified for ${sourceFiles.length} source files.`);
