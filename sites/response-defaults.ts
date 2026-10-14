/** Add missing response defaults without changing the route's content or private response policy. */
export function responseDefaults(response: Response): Response {
  if (response.headers.has('X-Content-Type-Options')) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
