/** A duration as it reads in a trace: milliseconds under a second, then seconds. */
export function formatDuration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1000).toFixed(1)}s`
}
