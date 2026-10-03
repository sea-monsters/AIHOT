import assert from 'node:assert/strict';
import {afterEach,test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {applyTheme,KEYS,syncThemePreference,THEME_BOOT_SCRIPT,THEME_COLOR} from '../app/lib/local-state.ts';
const original=new Map(['window','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
afterEach(()=>{for(const [k,d] of original)d?Object.defineProperty(globalThis,k,d):Reflect.deleteProperty(globalThis,k);});
function browser(pref:string|null=null){
 const stored=new Map<string,string>();if(pref)stored.set(KEYS.theme,pref);
 const attributes=new Map<string,string>();
 const meta=[{media:'(prefers-color-scheme: light)',content:THEME_COLOR.light as string},{media:'(prefers-color-scheme: dark)',content:THEME_COLOR.dark as string}];
 const events=new EventTarget();const query={matches:false,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
 const localStorage={getItem:(key:string)=>stored.get(key)??null};
 const window={localStorage,matchMedia:()=>query};const document={documentElement:{setAttribute:(k:string,v:string)=>attributes.set(k,v)},querySelectorAll:()=>meta};
 Object.defineProperty(globalThis,'window',{configurable:true,value:window});Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 return {stored,attributes,meta,query,events,window,document,localStorage};
}
test('system theme updates while following system, but never replaces an explicit current or legacy choice',()=>{
 const b=browser();const cleanup=syncThemePreference();assert.equal(b.attributes.get('data-theme'),'light');
 b.query.matches=true;b.events.dispatchEvent(new Event('change'));assert.equal(b.attributes.get('data-theme'),'dark');
 for(const explicit of ['light','"light"']){b.stored.set(KEYS.theme,explicit);b.events.dispatchEvent(new Event('change'));assert.equal(b.attributes.get('data-theme'),'light');assert.deepEqual(b.meta.map(m=>m.content),[THEME_COLOR.light,THEME_COLOR.light]);}
 b.stored.delete(KEYS.theme);b.events.dispatchEvent(new Event('change'));assert.equal(b.attributes.get('data-theme'),'dark');assert.deepEqual(b.meta.map(m=>m.content),[THEME_COLOR.light,THEME_COLOR.dark]);
 cleanup();b.query.matches=false;b.events.dispatchEvent(new Event('change'));assert.equal(b.attributes.get('data-theme'),'dark');
});
test('cross-tab preference re-sync and first paint share HKIS colors without replacing legacy values',()=>{
 for(const pref of ['dark','"dark"','light','"light"']){const b=browser(pref);runInNewContext(THEME_BOOT_SCRIPT,b);const expected=pref.includes('dark')?'dark':'light';assert.equal(b.attributes.get('data-theme'),expected);assert.deepEqual(b.meta.map(m=>m.content),[THEME_COLOR[expected],THEME_COLOR[expected]]);assert.equal(b.stored.get(KEYS.theme),pref);const cleanup=syncThemePreference();assert.equal(b.attributes.get('data-theme'),expected);cleanup();}
 const b=browser('dark');let cleanup=syncThemePreference();cleanup();b.stored.set(KEYS.theme,'light');cleanup=syncThemePreference();assert.equal(b.attributes.get('data-theme'),'light');cleanup();
});
test('blocked storage and unavailable system query degrade to readable light appearance',()=>{
 const b=browser();Object.defineProperty(b.window,'localStorage',{get(){throw Error('blocked');}});b.window.matchMedia=()=>{throw Error('unavailable');};assert.doesNotThrow(()=>syncThemePreference()());assert.equal(b.attributes.get('data-theme'),'light');applyTheme('dark',false);assert.equal(b.attributes.get('data-theme'),'dark');
});
