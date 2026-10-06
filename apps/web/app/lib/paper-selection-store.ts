/** One ephemeral selection scope; no persistence or reading-state writes. */
export function createPaperSelectionStore(ids:readonly string[]){
 const list=[...new Set(ids)],idSet=new Set(list),listeners=new Set<()=>void>();
 let selected:ReadonlySet<string>=new Set<string>();
 const setSelected=(next:ReadonlySet<string>)=>{
  const valid=new Set([...next].filter(id=>idSet.has(id)));
  if(valid.size===selected.size&&[...valid].every(id=>selected.has(id)))return;
  selected=valid;for(const listener of listeners)listener();
 };
 return {ids:list,idSet,getSnapshot:()=>selected,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},setSelected,toggle(id:string,value:boolean){if(!idSet.has(id)||selected.has(id)===value)return;const next=new Set(selected);value?next.add(id):next.delete(id);setSelected(next)}};
}
export type PaperSelectionStore=ReturnType<typeof createPaperSelectionStore>;
