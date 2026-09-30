import { captureException } from '@sentry/core';

/** Decides whether a thrown value should become a Sentry issue. */
export type ShouldHandleError = (error: unknown) => boolean;

/**
 * Skip 3xx and 4xx errors, capture everything else.
 *
 * Mirrors `@sentry/hono`'s default so the two SDKs behave alike: anything carrying a numeric `status`
 * in the redirect or client error range is an expected outcome rather than a fault. Such requests
 * still produce spans, so they stay visible in tracing.
 */
export function defaultShouldHandleError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return true;
  }

  const status = (error as { status?: unknown }).status;

  return !(typeof status === 'number' && status >= 300 && status < 500);
}

// The filter is configured on the integration at `Sentry.init()`, but the subscribers that read it are
// installed earlier, by `--import @sentry/remix/v3/node`. Holding it in module scope lets the request
// path read whatever is current rather than capture a value that does not exist yet.
let shouldHandleError: ShouldHandleError = defaultShouldHandleError;

/** @internal Set by the integration during `Sentry.init()`. */
export function setShouldHandleError(filter: ShouldHandleError | undefined): void {
  shouldHandleError = filter ?? defaultShouldHandleError;
}

/**
 * Report an error unless it is an aborted request or filtered out.
 *
 * An app that hands `router.fetch` straight to `createRequestListener` offers a router failure here
 * twice, once from the Sentry middleware and again from the listener's `onError`. That needs no
 * de-duplication: `captureException` marks the value `__sentry_captured__` and ignores the second
 * report of the same object. Only a thrown primitive cannot be marked, and may be reported twice.
 *
 * @returns whether the error was captured.
 */
export function captureRequestError(error: unknown, request: Request | undefined, mechanism: string): boolean {
  if (request && isRequestAbort(error, request)) {
    return false;
  }

  if (!shouldHandleError(error)) {
    return false;
  }

  captureException(error, { mechanism: { handled: false, type: mechanism } });
  return true;
}

/**
 * Whether a rejection is the client giving up rather than the app failing.
 *
 * `raceRequestAbort` in `@remix-run/fetch-router` settles every handler and middleware against the
 * request signal, rejecting with `signal.reason` when the connection drops. Without this check a user
 * navigating away mid request produces an issue, which on a busy route buries the real errors. This is
 * the same comparison `node-fetch-server` makes in its own `isRequestAbortError`.
 */
export function isRequestAbort(error: unknown, request: Request): boolean {
  return request.signal.aborted && error === request.signal.reason;
}
