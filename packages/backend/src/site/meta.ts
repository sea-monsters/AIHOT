// Small site-wide facts for the web shell (e.g. the changelog red-dot anchor).
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.ts";
import { validateChangelog, type Changelog } from '@aihot/contracts/changelog';

let changelogCache: Changelog | null = null;

/** Changelog is published as a data file in the industry pack (industry/changelog.json), newest first. */
export function loadChangelog() {
  if (!changelogCache) {
    const file = process.env.AIHOT_CHANGELOG_FILE || path.join(REPO_ROOT, "industry/changelog.json");
    changelogCache = validateChangelog(JSON.parse(readFileSync(file, "utf8")));
  }
  return changelogCache;
}

export function siteMeta() {
  return { changelogVersion: loadChangelog().latestVersion };
}
