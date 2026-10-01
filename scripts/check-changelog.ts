import { CHANGELOG } from '../industry/changelog.ts';
import { changelogDays } from '../packages/contracts/src/changelog.ts';
console.log(`Changelog OK: ${CHANGELOG.releases.length} releases across ${changelogDays(CHANGELOG.releases).length} UTC+08 days; newest ${CHANGELOG.latestVersion}`);
