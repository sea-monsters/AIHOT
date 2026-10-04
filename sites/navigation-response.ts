// React Router turbo-stream does not require text/x-script. Avoid download-manager interception.
// Only the framework's exact navigation MIME changes; bodies, status and private headers are retained.
export function navigationResponse(request: Request, response: Response): Response {
  if (!new URL(request.url).pathname.endsWith('.data') || response.headers.get('Content-Type') !== 'text/x-script' || response.headers.has('Content-Disposition')) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
