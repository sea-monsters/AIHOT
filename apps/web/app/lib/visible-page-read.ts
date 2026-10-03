/** Browser-only acknowledgement gate. Cleanup cancels navigation before the next paint. */
export function observeVisiblePage(read:()=>Promise<boolean>,doc:Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>&{prerendering?:boolean}=document,win:Pick<Window,'addEventListener'|'removeEventListener'|'requestAnimationFrame'|'cancelAnimationFrame'>=window){
 let sent=false,frame=0,disposed=false;
 const mark=()=>{if(disposed||sent||doc.visibilityState!=='visible'||doc.prerendering)return;win.cancelAnimationFrame(frame);frame=win.requestAnimationFrame(()=>{if(disposed||sent||doc.visibilityState!=='visible'||doc.prerendering)return;sent=true;void read().then(ok=>{if(!ok)sent=false}).catch(()=>{sent=false})})};
 mark();doc.addEventListener('visibilitychange',mark);doc.addEventListener('prerenderingchange',mark);win.addEventListener('focus',mark);
 return()=>{disposed=true;win.cancelAnimationFrame(frame);doc.removeEventListener('visibilitychange',mark);doc.removeEventListener('prerenderingchange',mark);win.removeEventListener('focus',mark)};
}
