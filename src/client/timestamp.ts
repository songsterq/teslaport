const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Recent arrivals are shown relative, because the question the car screen
 * answers most often is "is this the one I just sent?". Anything older gets an
 * absolute time, which cannot go stale while the page sits open for hours.
 */
const JUST_NOW = 45_000;

/**
 * Intl inserts U+202F (narrow no-break space) before AM/PM on newer ICU and an
 * ordinary space on older ones. The car's Chromium is of unknown vintage, so
 * normalise rather than letting the rendered string depend on it.
 */
function normalise(text: string): string {
  return text.replace(/[  ]/g, " ");
}

function timeOfDay(value: Date, locale?: string): string {
  return normalise(value.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }));
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * `now` is a parameter rather than a call to `Date.now()` so the caller can
 * restamp a whole list against a single instant, and so this stays testable.
 */
export function formatReceivedAt(ts: number, now: number, locale?: string): string {
  const then = new Date(ts);
  const current = new Date(now);
  const elapsed = now - ts;

  // Negative elapsed means the sender's clock runs ahead of this one. Say
  // "Just now" rather than rendering a link that arrived in the future.
  if (elapsed < JUST_NOW) return "Just now";

  if (elapsed < HOUR) {
    // Clamped at both ends: 46 seconds is not "0 min ago", and 59.7 minutes is
    // not "60 min ago".
    const minutes = Math.min(59, Math.max(1, Math.floor(elapsed / MINUTE)));
    return `${minutes} min ago`;
  }

  if (sameDay(then, current)) return timeOfDay(then, locale);

  const yesterday = new Date(current);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(then, yesterday)) return `Yesterday ${timeOfDay(then, locale)}`;

  const date = normalise(then.toLocaleDateString(locale, { month: "short", day: "numeric" }));
  return `${date}, ${timeOfDay(then, locale)}`;
}
