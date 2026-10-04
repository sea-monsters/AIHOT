// Never serialize the exception, request URL, headers, cause or stack: these may contain credentials.
import { isRouteErrorResponse } from "react-router";
import { siteContext } from "../../../../sites/context.ts";
import { writeLog } from "../../../../sites/runtime-logs.ts";
const reported = new WeakSet<Request>();
export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted || reported.has(request)) return;
  if (isRouteErrorResponse(error) && error.status < 500) return;
  reported.add(request);
  const record = { component: 'server', event: 'unexpected_exception', severity: 'error', outcome: 'failed', errorCode: 'unexpected_error', httpStatus: 500 };
  const context = siteContext.getStore();
  if (context?.env?.DB) {
    const task = writeLog(context.env.DB, record);
    if (context.waitUntil) context.waitUntil(task);
    return task;
  }
  // Local/non-Sites rendering still reports a useful fixed marker, without raw exception details.
  console.error(JSON.stringify(record));
}
