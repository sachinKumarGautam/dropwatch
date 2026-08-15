/**
 * festival.ts — hardcoded India mega-sale calendar + buy-now-vs-wait advice.
 * Windows are MM-DD, year-agnostic. Used to damp the deal score near big sales
 * and to write the "why now" buy/wait line.
 */
import type { DealScore, Platform } from "./types.js";

export interface FestivalWindow {
  name: string;
  start: string; // MM-DD
  end: string; // MM-DD
  platforms: "all" | Platform[];
  magnitude: 1 | 2 | 3;
}

export const FESTIVALS: FestivalWindow[] = [
  { name: "Republic Day Sale", start: "01-20", end: "01-26", platforms: "all", magnitude: 2 },
  { name: "Summer / Big Saving Days", start: "05-01", end: "05-08", platforms: "all", magnitude: 2 },
  { name: "Amazon Prime Day", start: "07-12", end: "07-14", platforms: ["amazon_in"], magnitude: 2 },
  { name: "Freedom / Independence Day Sale", start: "08-06", end: "08-15", platforms: "all", magnitude: 2 },
  { name: "Big Billion Days & Great Indian Festival", start: "09-25", end: "10-10", platforms: "all", magnitude: 3 },
  { name: "Diwali Sale", start: "10-15", end: "11-05", platforms: "all", magnitude: 3 },
  { name: "Black Friday", start: "11-24", end: "11-30", platforms: "all", magnitude: 1 },
  { name: "Year-End Clearance", start: "12-20", end: "12-31", platforms: "all", magnitude: 1 },
];

const DAY = 86_400_000;

function atYear(mmdd: string, year: number): number {
  const [m, d] = mmdd.split("-").map(Number);
  return Date.UTC(year, (m ?? 1) - 1, d ?? 1);
}

export interface ActiveWindow extends FestivalWindow {
  startsInDays: number; // 0 if currently active
}

/**
 * The festival window that is active now, or the nearest one starting within
 * `horizonDays`. Returns null if nothing is close.
 */
export function activeOrUpcomingWindow(
  now: Date,
  horizonDays = 21,
): ActiveWindow | null {
  const t = now.getTime();
  const year = now.getUTCFullYear();
  let best: ActiveWindow | null = null;
  for (const f of FESTIVALS) {
    for (const y of [year - 1, year, year + 1]) {
      const start = atYear(f.start, y);
      const end = atYear(f.end, y) + DAY - 1; // inclusive end-of-day
      if (t >= start && t <= end) {
        return { ...f, startsInDays: 0 };
      }
      if (start > t) {
        const days = Math.ceil((start - t) / DAY);
        if (days <= horizonDays && (!best || days < best.startsInDays)) {
          best = { ...f, startsInDays: days };
        }
      }
    }
  }
  return best;
}

/**
 * One-line buy/wait advice. null when there's nothing useful to say.
 */
export function buyWaitAdvice(
  score: DealScore,
  win: ActiveWindow | null,
): string | null {
  if (!win) {
    if (score.total >= 70)
      return "Buy: strong deal and no major sale on the near horizon.";
    return null;
  }
  if (win.startsInDays === 0) {
    if (score.total >= 70)
      return `Buy: inside the ${win.name} window and this clears the bar.`;
    return `Hold: ${win.name} is live — better prices may still appear before it ends.`;
  }
  // upcoming
  if (win.magnitude >= 2 && score.total < 70 && !score.bypass) {
    return `Wait: ${win.name} starts in ${win.startsInDays}d — historically deeper cuts.`;
  }
  if (score.bypass === "price_error") return "Buy now: possible price error — may be pulled.";
  if (score.total >= 70)
    return `Buy: strong deal now; ${win.name} (in ${win.startsInDays}d) rarely beats this.`;
  return null;
}
