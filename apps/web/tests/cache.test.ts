// Run after `npm run build -w @aihot/web`. Real production server/router, synthetic loopback API only.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { UNSAFE_decodeViaTurboStream as decodeViaTurboStream } from "react-router";
import { UPDATE_PAGES, type PageRevision, type UpdatePageKey } from "@aihot/contracts/navigation-updates";
import type { SiteItemDetail } from "@aihot/contracts/site";
import type { DailyData } from "../app/components/PaperDaily.tsx";
import { releaseBoundCache } from "../app/lib/api.server.ts";

let web: ChildProcess;
let origin: string;
let logs = "";
let metaDelayMs = 0;
let dailyStatus = 200;
let navigationStatus = 200;
let revisionSequence: number[] = [];
const latestDate = "2026-10-05";
const siteMeta = { changelogVersion: "2026-10-06T04:00:00Z" };
const apiRequests: Array<{ path: string; method: string | undefined; cookie: string | undefined }> = [];

function pageRevision(key: UpdatePageKey): PageRevision {
  return { key, revision: 42, version: UPDATE_PAGES.find((page) => page.key === key)!.version,
    ...(["home", "daily"].includes(key) ? { latestDate } : {}) };
}

function dailyData(date = latestDate, month = date.slice(0, 7)): DailyData {
  return { today: "2026-10-06", date, month, invalidDate: false, days: [], report: null,
    window: { sourceDate: "2026-10-04" }, schedule: { enabled: false },
    limits: { callsPerRun: 2, groupsPerCall: 4 }, timezone: "Asia/Shanghai" };
}

const item: SiteItemDetail = {
  id: "long-lived", revision: 1, title: "Synthetic legacy article", originalTitle: null,
  summary: "Synthetic source summary", reason: null,
  source: { id: "fixture", name: "Fixture source", kind: "rss", firstParty: false, iconUrl: null },
  links: { aihot: "/items/long-lived", original: "https://example.test/article" },
  publishedAt: "2026-10-05T00:00:00Z", discoveredAt: "2026-10-05T00:00:00Z", timelineAt: "2026-10-05T00:00:00Z",
  category: null, tags: [], score: null, selected: false, channel: "news", story: null, x: null,
  readingMode: "summary-only", author: null, language: "en", body: null, outline: [], relatedStories: [],
  indexable: false, markdownAvailable: false, group: null, hasTranslation: false, bodyLanguage: "original",
};

const api = createServer((req, res) => {
  const url = new URL(req.url!, "http://api.local");
  apiRequests.push({ path: url.pathname + url.search, method: req.method, cookie: req.headers.cookie });
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/api/site/meta") {
    const respond = () => res.end(JSON.stringify(siteMeta));
    return metaDelayMs ? setTimeout(respond, metaDelayMs) : respond();
  }
  if (url.pathname === "/api/site/navigation-updates/content") {
    const page = UPDATE_PAGES.find((entry) => entry.key === url.searchParams.get("key"));
    res.statusCode = page ? navigationStatus : 404;
    return res.end(JSON.stringify(res.statusCode === 200
      ? { ...pageRevision(page!.key), revision: revisionSequence.shift() ?? 42 }
      : { code: "unavailable" }));
  }
  if (url.pathname === "/api/site/research/daily") {
    res.statusCode = dailyStatus;
    // Even an erroneously public upstream response must not make a private page cacheable.
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600, stale-while-revalidate=120");
    res.setHeader("X-Accel-Expires", `@${Math.floor(Date.now() / 1000) + 600}`);
    const date = url.searchParams.get("latest") === "1" ? latestDate : url.searchParams.get("date") || latestDate;
    return res.end(JSON.stringify(dailyStatus === 200
      ? dailyData(date, url.searchParams.get("month") || date.slice(0, 7)) : { code: "unavailable" }));
  }
  if (url.pathname === "/api/site/items/long-lived") return res.end(JSON.stringify(item));
  if (url.pathname === "/api/site/echo-client") return res.end(JSON.stringify({ forwarded: req.headers["x-forwarded-for"], real: req.headers["x-real-ip"] }));
  if (url.pathname === "/api/site/stories/merged") {
    res.statusCode = 308;
    return res.end(JSON.stringify({ mergedInto: "surviving-story" }));
  }
  res.statusCode = url.pathname.startsWith("/api/admin/") ? 401 : 404;
  res.end(JSON.stringify({ code: "not_found" }));
});

before(async () => {
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  web = spawn(process.execPath, [fileURLToPath(new URL("../server.ts", import.meta.url))], {
    env: { ...process.env, WEB_PORT: "0", TRUST_PROXY: "false", API_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`web did not start: ${logs}`)), 15_000);
    web.on("exit", () => { clearTimeout(timeout); reject(new Error(`web exited: ${logs}`)); });
    web.stderr!.on("data", (chunk) => { logs += String(chunk); });
    web.stdout!.on("data", (chunk) => {
      logs += String(chunk);
      const match = logs.match(/"msg":"web started","port":(\d+)/);
      if (match) {
        origin = `http://127.0.0.1:${match[1]}`;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
});

after(async () => {
  if (web && web.exitCode === null) {
    web.kill("SIGTERM");
    await once(web, "exit");
  }
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

function assertPrivate(res: Response) {
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.equal(res.headers.get("X-Accel-Expires"), "0");
  assert.equal(res.headers.get("Expires"), null);
  assert.equal(res.headers.get("Set-Cookie"), null);
}

async function navigationData(res: Response) {
  assert.ok(res.body);
  const decoded = await decodeViaTurboStream(res.body, globalThis);
  await decoded.done;
  return decoded.value;
}

test("home route subsets include complete root, daily and revision data without public caching", async () => {
  for (const query of ["", "?_routes=root", "?_routes=routes%2Fhome", "?_routes=unknown"]) {
    const start = apiRequests.length;
    const res = await fetch(`${origin}/_.data${query}`);
    assert.equal(res.status, 200);
    assertPrivate(res);
    assert.deepEqual(await navigationData(res), {
      root: { data: siteMeta }, "routes/home": { data: { ...dailyData(), pageUpdate: pageRevision("home") } },
    });
    const requests = apiRequests.slice(start);
    assert.equal(requests.filter((req) => req.path === "/api/site/research/daily?latest=1").length, 1);
    assert.equal(requests.filter((req) => req.path === "/api/site/navigation-updates/content?key=home").length, 2);
    assert.ok(requests.every((req) => req.method === "GET"));
    assert.ok(requests.every((req) => !req.path.includes("timeline") && !req.path.includes("/seen")));
  }
});

test("home HTML and HEAD stay private and noindex; q no longer redirects to all", async () => {
  for (const pathname of ["/", "/?q=search"]) {
    const res = await fetch(origin + pathname, { redirect: "manual" });
    assert.equal(res.status, 200);
    assertPrivate(res);
    assert.equal(res.headers.get("Location"), null);
    const body = await res.text();
    assert.match(body, /最新进展简报/);
    assert.match(body, /name="robots" content="noindex, nofollow"/);
  }
  const data = await fetch(`${origin}/_.data?q=search&_routes=root`, { redirect: "manual" });
  assert.equal(data.status, 200);
  assertPrivate(data);
  assert.deepEqual(await navigationData(data), {
    root: { data: siteMeta }, "routes/home": { data: { ...dailyData(), pageUpdate: pageRevision("home") } },
  });
  const head = await fetch(origin + "/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assertPrivate(head);
  assert.equal(await head.text(), "");
});

test("daily date filters retain complete navigation data and their actual revision snapshot", async () => {
  for (const date of [latestDate, "2026-09-28"]) {
    const res = await fetch(`${origin}/daily.data?date=${date}&_routes=root`);
    assert.equal(res.status, 200);
    assertPrivate(res);
    assert.deepEqual(await navigationData(res), {
      root: { data: siteMeta }, "daily-latest": { data: { ...dailyData(date), pageUpdate: pageRevision("daily") } },
    });
  }
});

test("sites-info navigation is private and complete for about and feedback, with or without cookies", async () => {
  for (const key of ["about", "feedback"] as const) {
    let plain: unknown;
    for (const cookie of [undefined, "admin_session=private; aihot_vid=reader"]) {
      const start = apiRequests.length;
      const res = await fetch(`${origin}/${key}.data?_routes=root`, { headers: cookie ? { cookie } : {} });
      assert.equal(res.status, 200);
      assertPrivate(res);
      const result = await navigationData(res) as Record<string, { data: { pageUpdate: PageRevision | null } }>;
      const pageUpdate = result[`sites-${key}`]!.data.pageUpdate;
      // An unavailable route revision stays null; it must never remove the matched loader data.
      if (pageUpdate !== null) assert.deepEqual(pageUpdate, pageRevision(key));
      assert.deepEqual(result, { root: { data: siteMeta }, [`sites-${key}`]: { data: { pageUpdate } } });
      if (cookie) assert.deepEqual(result, plain);
      else plain = result;
      assert.ok(apiRequests.slice(start).every((req) => !req.cookie));
    }
  }
});

test("changed or unavailable revision snapshots cannot acknowledge newer content", async () => {
  for (const unavailable of [false, true]) {
    revisionSequence = unavailable ? [] : [41, 42];
    navigationStatus = unavailable ? 503 : 200;
    try {
      const res = await fetch(`${origin}/_.data?_routes=root`);
      assert.equal(res.status, 200);
      assertPrivate(res);
      assert.deepEqual(await navigationData(res), {
        root: { data: siteMeta }, "routes/home": { data: { ...dailyData(), pageUpdate: null } },
      });
    } finally {
      revisionSequence = [];
      navigationStatus = 200;
    }
  }
});

test("slow sibling metadata cannot turn a private page or navigation response into a cache entry", async () => {
  metaDelayMs = 40;
  try {
    for (const pathname of ["/", "/_.data?_routes=routes%2Fhome", "/about.data?_routes=root"]) {
      const res = await fetch(origin + pathname);
      assert.equal(res.status, 200);
      assertPrivate(res);
      await res.text();
    }
  } finally {
    metaDelayMs = 0;
  }
});

test("missing routes cannot be hidden by root-only requests; errors and redirects stay uncached", async () => {
  for (const pathname of ["/items/missing.data?_routes=root", "/does-not-exist.data?_routes=root", "/items/missing"]) {
    const res = await fetch(origin + pathname);
    assert.equal(res.status, 404, pathname);
    assertPrivate(res);
    await res.text();
  }
  const redirect = await fetch(`${origin}/story/merged.data?_routes=root`);
  assert.equal(redirect.status, 202);
  assertPrivate(redirect);
  assert.match(await redirect.text(), /\/story\/surviving-story/);
  const document = await fetch(`${origin}/story/merged`, { redirect: "manual" });
  assert.equal(document.status, 308);
  assertPrivate(document);
  assert.equal(document.headers.get("Location"), "/story/surviving-story");
  await document.text();
});

test("a failed daily read stays private for HTML and navigation", async () => {
  dailyStatus = 503;
  try {
    for (const pathname of ["/", "/_.data?_routes=root"]) {
      const res = await fetch(origin + pathname);
      assert.equal(res.status, 500);
      assertPrivate(res);
      const body = await res.text();
      if (pathname === "/") assert.match(body, /name="robots" content="noindex/);
    }
  } finally {
    dailyStatus = 200;
  }
});

test("admin data and actions never become public cache entries", async () => {
  const admin = await fetch(`${origin}/admin/sources.data?_routes=admin-layout`);
  assert.equal(admin.status, 202);
  assertPrivate(admin);
  assert.match(await admin.text(), /admin\/login/);
  const action = await fetch(`${origin}/hot.data`, { method: "POST" });
  assert.equal(action.status, 405);
  assertPrivate(action);
  await action.text();
});

test("releaseBoundCache caps TTL at the earliest release or upstream deadline", () => {
  const now = Date.parse("2026-09-28T00:00:00Z");
  const upstream = new Headers({ "X-Accel-Expires": `@${now / 1000 + 7}` });
  assert.deepEqual(releaseBoundCache(new Date(now + 20_000).toISOString(), 30, now + 2_000, upstream), {
    "Cache-Control": "public, max-age=0, s-maxage=5", "X-Accel-Expires": upstream.get("X-Accel-Expires"),
  });
  assert.deepEqual(releaseBoundCache(new Date(now + 7_000).toISOString(), 30, now), {
    "Cache-Control": "public, max-age=0, s-maxage=7", "X-Accel-Expires": `@${now / 1000 + 7}`,
  });
  assert.deepEqual(releaseBoundCache(null, 30, now), {
    "Cache-Control": "public, max-age=0, s-maxage=30", "X-Accel-Expires": `@${now / 1000 + 30}`,
  });
});

test("expired or forbidden upstream freshness cannot be extended", () => {
  const now = Date.parse("2026-09-28T00:00:00Z");
  const uncached = { "Cache-Control": "no-cache", "X-Accel-Expires": "0" };
  assert.deepEqual(releaseBoundCache(new Date(now - 1_000).toISOString(), 30, now), uncached);
  for (const upstream of [
    new Headers({ "X-Accel-Expires": `@${now / 1000 - 1}` }),
    new Headers({ "X-Accel-Expires": "0" }),
    new Headers({ "Cache-Control": "no-cache" }),
    new Headers({ "Cache-Control": "private, no-store" }),
  ]) assert.deepEqual(releaseBoundCache(new Date(now + 20_000).toISOString(), 30, now, upstream), uncached);
});

test("legacy public item route subsets remain complete and do not forward visitor cookies", async () => {
  for (const query of ["", "?_routes=root", "?_routes=routes%2Fitem", "?_routes=unknown"]) {
    const start = apiRequests.length;
    const res = await fetch(`${origin}/items/long-lived.data${query}`, { headers: { cookie: "admin_session=private; aihot_vid=reader" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "public, max-age=300, s-maxage=600, must-revalidate");
    assert.equal(res.headers.get("Set-Cookie"), null);
    assert.equal(Date.parse(res.headers.get("Date")!) / 1000 + 600, Number(res.headers.get("X-Accel-Expires")!.slice(1)));
    assert.deepEqual(await navigationData(res), { root: { data: siteMeta }, "routes/item": { data: { item } } });
    assert.ok(apiRequests.slice(start).every((req) => !req.cookie));
  }
});

test("legacy public HTML caps browser freshness and preserves noindex; HKIS info and login stay private", async () => {
  const article = await fetch(`${origin}/items/long-lived`);
  assert.equal(article.status, 200);
  assert.equal(article.headers.get("Cache-Control"), "public, max-age=300, s-maxage=600, must-revalidate");
  assert.doesNotMatch(article.headers.get("Cache-Control")!, /stale/);
  assert.match(await article.text(), /name="robots" content="noindex/);
  for (const pathname of ["/about", "/feedback", "/admin/login"]) {
    const res = await fetch(origin + pathname);
    assert.equal(res.status, 200);
    assertPrivate(res);
    if (pathname === "/admin/login") assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
    else assert.match(await res.text(), /name="robots" content="noindex, nofollow"/);
    if (pathname === "/admin/login") await res.text();
  }
});

test("a visitor cannot name its own address to the api without a trusted proxy in front", async () => {
  const res = await fetch(`${origin}/api/site/echo-client`, { headers: { "X-Forwarded-For": "6.6.6.6", "X-Real-IP": "6.6.6.6" } });
  assert.deepEqual(await res.json(), { forwarded: "127.0.0.1", real: "127.0.0.1" });
});
