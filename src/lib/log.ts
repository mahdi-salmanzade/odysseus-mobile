/**
 * Dev-only console logging for diagnosing connectivity/pairing.
 *
 * `dlog` is a no-op in release builds (`__DEV__` is false), so these stay out of
 * production. In a dev build the lines show up in the Metro bundler terminal and
 * in Xcode/Console.app device logs, tagged `[ody:<tag>]` for easy filtering.
 */
export function dlog(tag: string, ...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[ody:${tag}]`, ...args);
  }
}
