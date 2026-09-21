/**
 * Bound a promise that may never settle.
 *
 * The SDK's daemon-broker spawn path can wedge without rejecting: a scope whose
 * broker child dies before writing its socket left the request hanging for
 * minutes in an audit probe (23-35s in normal use), while a live broker answers
 * in milliseconds. Racing the work against a deadline turns that into a bounded,
 * explainable failure instead of a request that looks like a Grove outage.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
