import { CHANGE_KIND_OPTIONS, changelogDays } from '../packages/contracts/src/changelog.ts';

if (process.argv.includes('--help')) {
  console.log('编写 industry/changelog.json 时显式选择 kind：');
  for (const [kind, option] of Object.entries(CHANGE_KIND_OPTIONS)) console.log(`  ${kind}（${option.label}）：${option.description}`);
  console.log('完整合并使用 integration 和完整 upstream 范围；择取/审查可用 record，须同时附上游 commit/compare 与本站审查文档。日期和采用范围据实记录。详见 docs/changelog.md。');
} else {
  const { CHANGELOG } = await import('../industry/changelog.ts');
  const counts = Object.fromEntries(Object.keys(CHANGE_KIND_OPTIONS).map(kind => [kind, CHANGELOG.releases.filter(entry => entry.kind === kind).length]));
  console.log(`Changelog OK: ${CHANGELOG.releases.length} releases across ${changelogDays(CHANGELOG.releases).length} UTC+08 days; newest ${CHANGELOG.latestVersion}; kinds ${JSON.stringify(counts)}`);
}
