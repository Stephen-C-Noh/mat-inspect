// Pure scheduling helper, kept separate from nightly-verify.ts so it can be unit-tested without
// pulling in db/index.ts's module-scope config() call (which requires DATABASE_URL).

// Parses "HH:MM" (validated by config.ts's regex) and returns ms until the next occurrence:
// today if that time hasn't passed yet, tomorrow otherwise.
export const msUntilNext = (chainVerifyTime: string, now: Date = new Date()): number => {
  const [hoursStr, minutesStr] = chainVerifyTime.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);

  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
};
