// A public render error can outlive its deployment: replace an outdated document once per tab. A
// document is outdated when the server no longer has its build: every build replaces the client assets,
// and the build's route manifest (/assets/manifest-<version>.js) is named after it.
import { isRouteErrorResponse, type ClientOnErrorFunction } from "react-router";

const RECOVERY_RELEASE_KEY = "aihot-render-recovery-release";
let navigationEpoch = 0;
let locationKey: string | null = null;
export function noteRecoveryNavigation(key?: string) {
  if (key !== undefined && key === locationKey) return;
  if (key !== undefined) locationKey = key;
  navigationEpoch += 1;
}

export function createRenderErrorHandler(documentManifest: string | null, canRecover: () => boolean = () => true) {
  let checking = false;
  return async (error: unknown, info: Parameters<ClientOnErrorFunction>[1]) => {
    console.error(error, info);
    if (!info.errorInfo || isRouteErrorResponse(error) || /^\/(?:admin|settings|feedback)(?:\/|$)/.test(info.location.pathname)
      || !documentManifest || !/^\/assets\/manifest-[a-zA-Z0-9_-]+\.js$/.test(documentManifest) || checking || !canRecover()) return;
    const { pathname, search, hash } = info.location;
    const failedUrl = new URL(pathname + search + hash, window.location.href).href;
    if (window.location.href !== failedUrl) return;
    const currentKey = window.history?.state?.key;
    if (currentKey && currentKey !== info.location.key) return;
    // The error fallback mounting for this same key is not another navigation.
    noteRecoveryNavigation(info.location.key);
    const startedAt = navigationEpoch;
    checking = true;
    try {
      // If storage is blocked, manual reload stays available without risking a reload loop.
      const storage = window.sessionStorage;
      // One automatic recovery per tab, even if a cache alternates between stale documents.
      if (storage.getItem(RECOVERY_RELEASE_KEY)) return;
      // Only a missing build counts; the same build answering, an error or no answer leave the page alone.
      const response = await fetch(documentManifest, { method: "HEAD", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (response.status !== 404) return;
      if (window.location.href !== failedUrl || navigationEpoch !== startedAt || !canRecover()) return;
      storage.setItem(RECOVERY_RELEASE_KEY, documentManifest);
      window.location.reload();
    } catch {
      // An unavailable check or storage must leave the original error and retry visible.
    } finally {
      checking = false;
    }
  };
}

/** Conservatively keep any edited input safe, even if a render error already unmounted its form. */
export function createEditGuard(target: EventTarget): () => boolean {
  let edited = false;
  const mark = () => { edited = true; };
  target.addEventListener("input", mark, { capture: true });
  target.addEventListener("change", mark, { capture: true });
  return () => !edited;
}
