// React Router's default bootstrap, with one recovery path for obsolete public documents.
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { createEditGuard, createRenderErrorHandler, noteRecoveryNavigation } from "./lib/render-recovery.ts";

// Capture once before hydration: the build this document was rendered from (its route manifest file).
// The development server has no build to replace.
const documentManifest = import.meta.env.DEV ? null : (window as { __reactRouterManifest?: { url?: string } }).__reactRouterManifest?.url ?? null;
const unedited = createEditGuard(document);
window.addEventListener("popstate", () => noteRecoveryNavigation());
const onError = createRenderErrorHandler(documentManifest, () => document.visibilityState === "visible" && unedited());

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter onError={onError} />
    </StrictMode>,
  );
});
