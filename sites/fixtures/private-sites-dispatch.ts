// Test-only private dispatcher. Authenticate at the platform boundary, then
// consume the service header without fabricating a visitor identity/consent.
export const PRIVATE_SITES_TEST_TOKEN='SYNTHETIC_CONSUMED_BY_PRIVATE_DISPATCH';
export function privateSitesDispatch(application:(request:Request)=>Promise<Response>,origin='https://fixture.chatgpt.site'){
 return async(input:Request|string|URL,init?:RequestInit)=>{
  const request=new Request(input,init);
  if(new URL(request.url).origin!==origin||request.headers.get('OAI-Sites-Authorization')!=='Bearer '+PRIVATE_SITES_TEST_TOKEN)return Response.json({error:'Private dispatch rejected'},{status:403});
  const headers=new Headers(request.headers);headers.delete('OAI-Sites-Authorization');
  return application(new Request(request,{headers}));
 };
}
