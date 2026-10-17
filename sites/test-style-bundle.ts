import {createRequire} from 'node:module';
import type {Loader,Plugin} from 'esbuild';
// SSR assertions execute JS in Node, while styles are still parsed and emitted
// as CSS by esbuild. Package externalization must not leave a Node CSS import.
export const testStylePlugin:Plugin={name:'test-style-bundle',setup(build){build.onResolve({filter:/\.css$/},args=>({path:createRequire(args.importer||import.meta.url).resolve(args.path),external:false}));}};
export const testStyleLoaders:Record<string,Loader>={'.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'};
