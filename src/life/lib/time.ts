// Timezone helpers for the Life app.
// Default tz: Asia/Kolkata. Per-user override stored on life_users.timezone.
//
// Why string dates: "today" / scheduled_for use YYYY-MM-DD strings in the
// USER'S timezone so queries don't drift across UTC midnight.

const DEFAULT_TZ = 'Asia/Kolkata'

export function getUserTz(tz?: string | null): string {
  return tz && tz.length > 0 ? tz : DEFAULT_TZ
}

/** Returns YYYY-MM-DD for `date` interpreted in `tz`. */
export function localDateString(date: Date = new Date(), tz?: string | null): string {
  const z = getUserTz(tz)
  // en-CA returns YYYY-MM-DD natively
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: z,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function todayLocal(tz?: string | null): string {
  return localDateString(new Date(), tz)
}

export function yesterdayLocal(tz?: string | null): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDateString(d, tz)
}

export function tomorrowLocal(tz?: string | null): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return localDateString(d, tz)
}

/** Returns 0-23 hour-of-day in the user's tz. */
export function localHour(date: Date = new Date(), tz?: string | null): number {
  const z = getUserTz(tz)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: z,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '0'
  return parseInt(h, 10) % 24
}

/** True if we are at-or-past the user's EOD hour (default 23 = 11 PM). */
export function isAfterEod(eodHour = 23, tz?: string | null): boolean {
  return localHour(new Date(), tz) >= eodHour
}

/** Pretty label for a YYYY-MM-DD string ("Today", "Yesterday", "Mon, Apr 7"). */
export function prettyDate(yyyyMmDd: string, tz?: string | null): string {
  const today = todayLocal(tz)
  const yesterday = yesterdayLocal(tz)
  const tomorrow = tomorrowLocal(tz)
  if (yyyyMmDd === today) return 'Today'
  if (yyyyMmDd === yesterday) return 'Yesterday'
  if (yyyyMmDd === tomorrow) return 'Tomorrow'
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

/** Format a timestamptz as HH:mm in user tz. */
export function localTime(iso: string, tz?: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: getUserTz(tz),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}
