import { beijingDate } from './time.ts';

export type ChangeKind = 'feature' | 'fix' | 'upstream';
export const CHANGE_KIND_OPTIONS = {
  feature: { label: '功能更新', description: '本站新增或扩展的功能；引用上游作参考不等于上游同步。' },
  fix: { label: '问题修复', description: '本站自身问题的修复；按实际来源判断，不按标题中的关键词判断。' },
  upstream: { label: '上游同步', description: '有提交证据的完整合并、选择性适配或已提交的上游审查；明确实际采用范围。' },
} as const;
export interface ChangeSource { label: string; url: string }
export interface UpstreamCommit { sha: string; at: string; title: string; url: string }
export interface ChangeRelease {
  id: string;
  at: string;
  basis: 'commit' | 'integration' | 'record';
  kind: ChangeKind;
  title: string;
  body: string[];
  sources: ChangeSource[];
  upstream?: { repository: string; base: string; head: string; compareUrl: string; commits: UpstreamCommit[] };
}
export interface Changelog {
  schemaVersion: 1;
  timeZone: 'Asia/Shanghai';
  latestVersion: string;
  releases: ChangeRelease[];
}

const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^(sea-monsters|KKKKhazix)\/AIHOT$/;
function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`Invalid changelog: ${message}`);
}
function object(value: unknown, keys: string[], name: string): asserts value is Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), name);
  requireValue(Object.keys(value).every(key => keys.includes(key)), `${name} contains unknown fields`);
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function instant(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value), 'timestamps must be explicit UTC instants');
  requireValue(Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value, 'invalid timestamp');
}
function sourceUrl(value: unknown): asserts value is string {
  requireValue(typeof value === 'string', 'source URL');
  const url = new URL(value);
  requireValue(url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.search && !url.hash, 'sources must be clean HTTPS GitHub URLs');
  requireValue(/^\/(sea-monsters|KKKKhazix)\/AIHOT\/(commit\/[a-f0-9]{40}|compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}|blob\/(main|[a-f0-9]{40})\/(docs\/[a-z-]+\.md|industry\/changelog\.json))$/.test(url.pathname), 'unsupported source path');
}

/** Validate checked-in release evidence at build time and on either server runtime. No network calls. */
export function validateChangelog(value: unknown): Changelog {
  object(value, ['schemaVersion', 'timeZone', 'latestVersion', 'releases'], 'document');
  requireValue(value.schemaVersion === 1 && value.timeZone === 'Asia/Shanghai', 'schema/time zone');
  instant(value.latestVersion);
  requireValue(Array.isArray(value.releases) && value.releases.length > 0, 'releases');
  const ids = new Set<string>();
  let previous = Infinity;
  for (const release of value.releases) {
    object(release, ['id', 'at', 'basis', 'kind', 'title', 'body', 'sources', 'upstream'], 'release');
    requireValue(typeof release.id === 'string' && /^[a-z0-9-]+$/.test(release.id) && !ids.has(release.id), 'unique release ID');
    ids.add(release.id);
    instant(release.at);
    requireValue(Date.parse(release.at) <= previous, 'releases must be newest first');
    previous = Date.parse(release.at);
    requireValue(['commit', 'integration', 'record'].includes(String(release.basis)), 'date basis');
    requireValue(typeof release.kind === 'string' && Object.hasOwn(CHANGE_KIND_OPTIONS, release.kind), 'change kind: feature（功能更新） / fix（问题修复） / upstream（上游同步）; choose by actual provenance');
    requireValue(nonempty(release.title) && Array.isArray(release.body) && release.body.length > 0 && release.body.every(nonempty), 'release copy');
    requireValue(Array.isArray(release.sources) && release.sources.length > 0, 'release sources');
    for (const source of release.sources) {
      object(source, ['label', 'url'], 'source');
      requireValue(nonempty(source.label), 'source label');
      sourceUrl(source.url);
    }
    if (release.kind === 'upstream') {
      // A selective adaptation/review keeps its verified maintenance date. It is not merge evidence.
      if (release.basis === 'record' && release.upstream === undefined) {
        requireValue(release.sources.some(source => /^https:\/\/github\.com\/KKKKhazix\/AIHOT\/(commit|compare)\//.test(source.url)), 'upstream maintenance record requires upstream commit or comparison evidence');
        requireValue(release.sources.some(source => /^https:\/\/github\.com\/sea-monsters\/AIHOT\/blob\/(main|[a-f0-9]{40})\/docs\//.test(source.url)), 'upstream maintenance record requires a fork review document');
        continue;
      }
      requireValue(release.basis === 'integration', 'upstream uses fork integration date');
      const up = release.upstream;
      object(up, ['repository', 'base', 'head', 'compareUrl', 'commits'], 'upstream');
      requireValue(typeof up.repository === 'string' && REPOSITORY.test(up.repository), 'upstream repository');
      requireValue(typeof up.base === 'string' && SHA.test(up.base) && typeof up.head === 'string' && SHA.test(up.head), 'upstream range');
      sourceUrl(up.compareUrl);
      requireValue(up.compareUrl === `https://github.com/${up.repository}/compare/${up.base}...${up.head}`, 'upstream comparison matches range');
      requireValue(Array.isArray(up.commits) && up.commits.length > 0, 'upstream commits');
      const shas = new Set<string>();
      for (const commit of up.commits) {
        object(commit, ['sha', 'at', 'title', 'url'], 'upstream commit');
        requireValue(typeof commit.sha === 'string' && SHA.test(commit.sha) && !shas.has(commit.sha), 'unique upstream commit');
        shas.add(commit.sha);
        instant(commit.at);
        requireValue(Date.parse(commit.at) <= Date.parse(release.at), 'upstream commit cannot follow integration');
        requireValue(nonempty(commit.title), 'upstream commit title');
        sourceUrl(commit.url);
        requireValue(commit.url === `https://github.com/${up.repository}/commit/${commit.sha}`, 'upstream source identity');
      }
      requireValue(shas.has(up.head) && !shas.has(up.base), 'upstream range excludes base and includes head');
    } else requireValue(release.upstream === undefined && release.basis !== 'integration', 'only upstream entries contain merge evidence');
  }
  requireValue(value.latestVersion === (value.releases[0] as ChangeRelease).at, 'latestVersion must match newest entry');
  return value as unknown as Changelog;
}

/** Calendar grouping is fixed UTC+08, independent of browser/server locale. */
export function changelogDays(releases: ChangeRelease[], kind: ChangeKind | null = null) {
  const groups = new Map<string, ChangeRelease[]>();
  for (const entry of [...releases].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    if (kind && entry.kind !== kind) continue;
    const date = beijingDate(entry.at);
    groups.set(date, [...(groups.get(date) ?? []), entry]);
  }
  return [...groups].map(([date, entries]) => ({ date, entries }));
}
