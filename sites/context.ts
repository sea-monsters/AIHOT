import {AsyncLocalStorage} from 'node:async_hooks';
// Shared between the React Router SSR bundle and the outer Worker bundle.
const key=Symbol.for('myhot.sites.request-context');
const registry=globalThis as any;
export const siteContext:AsyncLocalStorage<any>=registry[key]??=new AsyncLocalStorage<any>();
