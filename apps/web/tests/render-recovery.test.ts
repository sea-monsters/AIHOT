/// <reference lib="dom" />
// A render failure in an old tab may recover once after a new build, without hiding current failures.
// The document knows its build by its route manifest (/assets/manifest-<version>.js); a server that no
// longer has that file runs another build.
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { createEditGuard, createRenderErrorHandler, noteRecoveryNavigation } from "../app/lib/render-recovery.ts";

const KEY = "aihot-render-recovery-release";
const MANIFEST = "/assets/manifest-1a2b3c4d.js";
const ORIGIN = "https://news.example.com";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  mock.restoreAll();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function browser(path = "/topics/openai?page=2#chronicle", stored = new Map<string, string>()) {
  const location = { href: `${ORIGIN}${path}`, reload: mock.fn() };
  const sessionStorage = {
    getItem: mock.fn((key: string) => stored.get(key) ?? null),
    setItem: mock.fn((key: string, value: string) => { stored.set(key, value); }),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, sessionStorage } });
  const fetch = mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  const log = mock.method(console, "error", () => {});
  return { location, sessionStorage, stored, fetch, log };
}

function errorInfo(path = "/topics/openai?page=2#chronicle", render = true) {
  const url = new URL(path, ORIGIN);
  return {
    location: { pathname: url.pathname, search: url.search, hash: url.hash, state: null, key: "topic" },
    params: {}, pattern: "/topics/:slug",
    ...(render ? { errorInfo: { componentStack: "at TopicRoute" } } : {}),
  };
}

test("an old document render failure checks its build and reloads its exact URL once", async () => {
  const b = browser();
  const error = new TypeError("Cannot read properties of undefined (reading 'length')");
  const info = errorInfo();
  const onError = createRenderErrorHandler(MANIFEST);
  await onError(error, info);
  assert.equal(b.fetch.mock.calls.length, 1);
  assert.equal(b.fetch.mock.calls[0]!.arguments[0], MANIFEST);
  assert.equal(b.fetch.mock.calls[0]!.arguments[1]?.method, "HEAD");
  assert.equal(b.fetch.mock.calls[0]!.arguments[1]?.cache, "no-store");
  assert.equal(b.location.reload.mock.calls.length, 1);
  assert.equal(b.location.href, `${ORIGIN}/topics/openai?page=2#chronicle`);
  assert.equal(b.stored.get(KEY), MANIFEST);
  assert.equal(b.log.mock.calls[0]!.arguments[0], error, "the original failure remains in the console");
  await onError(error, info);
  await createRenderErrorHandler(MANIFEST)(error, info); // A cache can return the same old HTML after reload.
  await createRenderErrorHandler("/assets/manifest-other.js")(error, info);
  assert.equal(b.location.reload.mock.calls.length, 1);
  assert.equal(b.fetch.mock.calls.length, 1, "alternating stale builds cannot create a reload loop");
});

test("the current build and unsuccessful checks keep the error page", async () => {
  const replies = [
    () => new Response("export default {}"),
    () => new Response(null, { status: 304 }),
    () => new Response(null, { status: 503 }),
    () => new Response("<html>challenge</html>", { status: 403 }),
    () => { throw new TypeError("Failed to fetch"); },
  ];
  for (const reply of replies) {
    const b = browser();
    b.fetch.mock.mockImplementation(async () => reply());
    await createRenderErrorHandler(MANIFEST)(new TypeError("render failed"), errorInfo());
    assert.equal(b.location.reload.mock.calls.length, 0);
    assert.equal(b.stored.size, 0);
    mock.restoreAll();
  }
});

test("route responses, loader/network failures, admin pages and documents without a build never check", async () => {
  const b = browser();
  const onError = createRenderErrorHandler(MANIFEST);
  for (const status of [404, 503]) {
    await onError({ status, statusText: "Error", internal: false, data: {} }, errorInfo());
  }
  await onError(new TypeError("Failed to fetch"), errorInfo(undefined, false));
  for (const path of ["/admin", "/admin/content/1"]) {
    b.location.href = `${ORIGIN}${path}`;
    await onError(new Error("admin render failed"), errorInfo(path));
  }
  b.location.href = `${ORIGIN}/topics/openai?page=2#chronicle`;
  for (const manifest of [null, ""]) {
    await createRenderErrorHandler(manifest)(new Error("render failed"), errorInfo());
  }
  assert.equal(b.fetch.mock.calls.length, 0);
  assert.equal(b.location.reload.mock.calls.length, 0);
});

test("blocked storage never risks an automatic reload loop", async () => {
  for (const method of ["getItem", "setItem"] as const) {
    const b = browser();
    b.sessionStorage[method].mock.mockImplementation(() => { throw new Error("storage disabled"); });
    await createRenderErrorHandler(MANIFEST)(new Error("render failed"), errorInfo());
    assert.equal(b.location.reload.mock.calls.length, 0);
    mock.restoreAll();
  }
  const b = browser();
  Object.defineProperty(window, "sessionStorage", { get() { throw new Error("storage disabled"); } });
  await createRenderErrorHandler(MANIFEST)(new Error("render failed"), errorInfo());
  assert.equal(b.location.reload.mock.calls.length, 0);
});

test("settings, feedback, edited inputs and unsafe manifest URLs never auto-reload", async () => {
  const b = browser();
  for (const path of ["/settings", "/settings/provider", "/feedback"]) {
    b.location.href = `${ORIGIN}${path}`;
    await createRenderErrorHandler(MANIFEST)(new Error("render failed"), errorInfo(path));
  }
  b.location.href = `${ORIGIN}/topics/openai?page=2#chronicle`;
  for (const manifest of ["https://evil.example/assets/manifest-a.js", "//evil.example/a.js", "/api/health", "javascript:alert(1)", MANIFEST + "?query=1"]) {
    await createRenderErrorHandler(manifest)(new Error("render failed"), errorInfo());
  }
  const target = new EventTarget();
  const unedited = createEditGuard(target);
  assert.equal(unedited(), true);
  target.dispatchEvent(new Event("input"));
  assert.equal(unedited(), false, "input remains protected after its form is unmounted");
  await createRenderErrorHandler(MANIFEST, unedited)(new Error("render failed"), errorInfo());
  assert.equal(b.fetch.mock.calls.length, 0);
  assert.equal(b.location.reload.mock.calls.length, 0);
});

test("concurrent errors share one check and newer navigation or edits cancel recovery", async () => {
  for (const mode of ["navigation", "returned-navigation", "boundary-mount", "edit", "unchanged"]) {
    const b = browser();
    let resolve!: (value: Response) => void;
    b.fetch.mock.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    let unedited = true;
    const handler = createRenderErrorHandler(MANIFEST, () => unedited);
    const first = handler(new Error("first"), errorInfo());
    await handler(new Error("second"), errorInfo());
    assert.equal(b.fetch.mock.calls.length, 1);
    if (mode === "navigation") b.location.href = ORIGIN + "/hot";
    if (mode === "edit") unedited = false;
    if (mode === "returned-navigation") { noteRecoveryNavigation(); noteRecoveryNavigation(); }
    if (mode === "boundary-mount") noteRecoveryNavigation(errorInfo().location.key);
    resolve(new Response(null, {status:404}));
    await first;
    assert.equal(b.location.reload.mock.calls.length, ["unchanged","boundary-mount"].includes(mode) ? 1 : 0);
    assert.equal(b.stored.size, ["unchanged","boundary-mount"].includes(mode) ? 1 : 0);
    mock.restoreAll();
  }
});

test('React caught metadata render failures share bounded recovery, but unknown callbacks do nothing', async () => {
  const {caughtRenderRecovery}=await import('../app/lib/render-recovery.ts');
  const b=browser();const recover=createRenderErrorHandler(MANIFEST);const caught=caughtRenderRecovery(recover);
  await caught(new Error('unknown'),{});assert.equal(b.fetch.mock.calls.length,0);
  await caught({status:503,statusText:'Error',internal:false,data:{}},{componentStack:'at Meta'});assert.equal(b.fetch.mock.calls.length,0);
  b.fetch.mock.mockImplementation(async()=>new Response(null,{status:200}));
  await caught(new Error('ordinary current build failure'),{componentStack:'at Meta'});assert.equal(b.location.reload.mock.calls.length,0);
  b.fetch.mock.mockImplementation(async()=>new Response(null,{status:404}));
  await caught(new Error('obsolete Meta failure'),{componentStack:'at Meta'});assert.equal(b.location.reload.mock.calls.length,1);
  await caught(new Error('again'),{componentStack:'at Meta'});assert.equal(b.location.reload.mock.calls.length,1);
});

test('metadata recovery keeps form, hidden-document and navigation cancellation guards',async()=>{
 const {caughtRenderRecovery}=await import('../app/lib/render-recovery.ts');
 for(const safe of [false,true]){
  const b=browser();let resolve!:(value:Response)=>void;b.fetch.mock.mockImplementation(()=>new Promise<Response>(done=>resolve=done));
  const target=new EventTarget();const unedited=createEditGuard(target);const caught=caughtRenderRecovery(createRenderErrorHandler(MANIFEST,()=>safe&&unedited()));
  const pending=caught(new Error('Meta failure'),{componentStack:'at Meta'});
  if(!safe){await pending;assert.equal(b.fetch.mock.calls.length,0)}else{target.dispatchEvent(new Event('change'));noteRecoveryNavigation();resolve(new Response(null,{status:404}));await pending;assert.equal(b.location.reload.mock.calls.length,0)}
  mock.restoreAll();
 }
});
