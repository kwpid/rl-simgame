export interface SimDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // no leap-year handling, hobby sim

export function addDays(date: SimDate, count: number): SimDate {
  let { year, month, day } = date;
  for (let i = 0; i < count; i++) {
    day++;
    const max = DAYS_IN_MONTH[month - 1];
    if (day > max) {
      day = 1;
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
  }
  return { year, month, day };
}

/** Returns 12-hour "H:MM AM/PM" formatting. `minute` defaults to 0 for callers that only track whole hours. */
export function formatClockHour(hour: number, minute = 0): string {
  const h = ((hour % 24) + 24) % 24;
  const period = h < 12 ? "AM" : "PM";
  let displayHour = h % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
}

export function formatSimDate(date: SimDate): string {
  return `${date.month}/${date.day}/${date.year}`;
}

/** Serial day number (arbitrary epoch, only useful for differences), for `daysBetween`. */
function toSerialDay(date: SimDate): number {
  let total = date.day;
  for (let m = 0; m < date.month - 1; m++) total += DAYS_IN_MONTH[m];
  total += date.year * 365; // no leap years, hobby sim, fine for a difference over a few months
  return total;
}

/** b - a, in whole days. Negative if b is before a. */
export function daysBetween(a: SimDate, b: SimDate): number {
  return toSerialDay(b) - toSerialDay(a);
}
