// Pure scheduling helper, kept separate from nightly-verify.ts so it can be unit-tested without
// pulling in db/index.ts's module-scope config() call (which requires DATABASE_URL).

// Wall-clock parts of `instant` as observed in `timeZone`. Uses Intl (ICU), which carries its own
// tz database inside the Node binary, so this resolves named zones even on the alpine runtime
// image (which ships no OS tzdata) and never depends on the container's ambient TZ.
type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number };

const zonedParts = (instant: Date, timeZone: string): ZonedParts => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const { type, value } of dtf.formatToParts(instant)) {
    if (type !== 'literal') map[type] = Number(value);
  }
  return {
    year: map['year']!,
    month: map['month']!,
    day: map['day']!,
    hour: map['hour']!,
    minute: map['minute']!,
  };
};

// Milliseconds to add to a UTC-epoch built from a zone's wall-clock parts to recover the true
// instant: instant = Date.UTC(wallParts) - zoneOffsetMs(instant). Derived by formatting the
// instant in the zone and diffing against the same fields read as if they were UTC.
const zoneOffsetMs = (instant: Date, timeZone: string): number => {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asIfUtc - instant.getTime();
};

// Converts wall-clock HH:MM on a given calendar day in `timeZone` to a real instant (ms since
// epoch). The offset is resolved twice: once from a reference instant, then again at the candidate
// instant, so a target that lands on the other side of a DST transition still gets the correct
// offset. On the twice-a-year transition days a nightly target can be off by up to an hour, which
// is immaterial for an overnight verification job.
const wallClockInstant = (
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  reference: Date,
): number => {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallAsUtc - zoneOffsetMs(reference, timeZone);
  instant = wallAsUtc - zoneOffsetMs(new Date(instant), timeZone);
  return instant;
};

// Returns ms until the next occurrence of `chainVerifyTime` (HH:MM, validated by config.ts) in
// `timeZone`: today if that wall-clock time has not passed there yet, tomorrow otherwise. The job
// time is documented as lab-local, so the zone is explicit here rather than inherited from the
// process TZ (which is UTC on the alpine image).
export const msUntilNext = (
  chainVerifyTime: string,
  timeZone: string,
  now: Date = new Date(),
): number => {
  const [hoursStr, minutesStr] = chainVerifyTime.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);

  const today = zonedParts(now, timeZone);
  let targetMs = wallClockInstant(
    timeZone,
    today.year,
    today.month,
    today.day,
    hours,
    minutes,
    now,
  );

  if (targetMs <= now.getTime()) {
    // Advance one calendar day in the zone (add 24h to the zone-midnight epoch, then re-read the
    // parts so month/year roll over correctly), and rebuild the target on that day.
    const nextDay = zonedParts(new Date(targetMs + 24 * 60 * 60 * 1000), timeZone);
    targetMs = wallClockInstant(
      timeZone,
      nextDay.year,
      nextDay.month,
      nextDay.day,
      hours,
      minutes,
      now,
    );
  }

  return targetMs - now.getTime();
};
