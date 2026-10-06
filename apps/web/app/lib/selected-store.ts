type Store<T>={getSnapshot:()=>T;subscribe:(listener:()=>void)=>()=>void};
/** A stable projection: unrelated store changes don't invalidate a control's snapshot. */
export function selectStore<T,S>(store:Store<T>,select:(snapshot:T)=>S,equal:(a:S,b:S)=>boolean=Object.is){
  let value=select(store.getSnapshot());
  const getSnapshot=()=>{const next=select(store.getSnapshot());if(!equal(value,next))value=next;return value};
  return {getSnapshot,subscribe(listener:()=>void){let previous=getSnapshot();return store.subscribe(()=>{const next=getSnapshot();if(!Object.is(previous,next)){previous=next;listener()}})}};
}
