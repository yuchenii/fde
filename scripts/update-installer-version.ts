#!/usr/bin/env bun
/**
 * Update version number in installer.nsi
 * This script is cross-platform (macOS, Linux, Windows)
 * Usage: bun run scripts/update-installer-version.ts <version>
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const version = process.argv[2];

if (!version) {
  console.error("Usage: bun run scripts/update-installer-version.ts <version>");
  process.exit(1);
}

const installerPath = join(import.meta.dir, "installer.nsi");

try {
  let content = readFileSync(installerPath, "utf-8");

  // Replace PRODUCT_VERSION
  const versionRegex = /(!define PRODUCT_VERSION )".*"/;
  const newContent = content.replace(versionRegex, `$1"${version}"`);

  if (content === newContent) {
    console.log("⚠️  Version already up to date or pattern not found");
  } else {
    writeFileSync(installerPath, newContent);
    console.log(`✅ Updated installer.nsi to version ${version}`);
  }
} catch (error: any) {
  console.error(`❌ Failed to update installer.nsi: ${error.message}`);
  process.exit(1);
}
