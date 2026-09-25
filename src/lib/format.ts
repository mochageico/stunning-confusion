// ============================================================================
// Dates and durations, written the same way everywhere.
//
// Before this, each screen formatted its own: "2026-09-20" in one place,
// "Sep 20, 2026" in another, "312 seconds" next to "05:12" for the same
// recording. These are the only shapes a date or a length of time takes in
// visible copy.
// ============================================================================

const DAY_MS = 86400000;

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * A calendar date.
 *
 *   'short'    Sep 20            (adds the year when it isn't this year: Sep 20, 2025)
 *   'long'     Saturday, September 20
 *   'relative' Today / Yesterday / Tomorrow, else the 'short' form
 *
 * Accepts a Date, an ISO string, or epoch milliseconds. An unparseable value
 * comes back as an empty string rather than "Invalid Date".
 */
export function formatDate(
  value: Date | string | number,
  style: 'short' | 'long' | 'relative' = 'short',
  now: Date = new Date()
): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';

  if (style === 'relative') {
    const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);
    if (days === 0) return 'Today';
    if (days === -1) return 'Yesterday';
    if (days === 1) return 'Tomorrow';
  }
  if (style === 'long') {
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      ...(d.getFullYear() === now.getFullYear() ? null : { year: 'numeric' }),
    });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? null : { year: 'numeric' }),
  });
}

/**
 * How long ago something happened, for feeds: "Just now", "5 min ago",
 * "3 hr ago", "Yesterday", then the 'short' date.
 */
export function formatTimeAgo(value: Date | string | number, now: Date = new Date()): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const minutes = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return formatDate(d, 'relative', now);
}

/**
 * A length of time, from seconds.
 *
 *   'clock'  5:12, 0:45, 1:02:03   player positions and recording lengths
 *   'words'  5 min 12 sec, 45 sec, 1 hr 5 min   prose and summaries
 *   'short'  5m, 45s, 1h 5m   tight spots such as a stat tile
 */
export function formatDuration(totalSeconds: number, style: 'clock' | 'words' | 'short' = 'clock'): string {
  const s = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  if (style === 'clock') {
    const ss = String(seconds).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
  }

  const [h, m, sec] = style === 'words' ? [' hr', ' min', ' sec'] : ['h', 'm', 's'];
  // Seconds only matter while the whole thing is under an hour.
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}${h}`);
  if (minutes > 0) parts.push(`${minutes}${m}`);
  if (hours === 0 && (seconds > 0 || parts.length === 0)) parts.push(`${seconds}${sec}`);
  return parts.join(' ');
}
