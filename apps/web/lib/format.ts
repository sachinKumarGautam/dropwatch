export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return "—";
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const s = whole.toString();
  let grouped: string;
  if (s.length <= 3) grouped = s;
  else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  return `${neg ? "-" : ""}₹${grouped}`;
}

export function pct(frac: number, digits = 1): string {
  return `${(frac * 100).toFixed(digits)}%`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = Date.now() - Date.parse(iso);
  const m = Math.round(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

export const PLATFORM_LABEL: Record<string, string> = {
  amazon_in: "Amazon",
  flipkart: "Flipkart",
  croma: "Croma",
  nykaa: "Nykaa",
  samsung_in: "Samsung",
  other: "Other",
};

export function scoreColor(score: number): string {
  if (score >= 70) return "var(--good)";
  if (score >= 55) return "var(--warn)";
  return "var(--muted)";
}

export const FREQ_OPTIONS: { label: string; minutes: number }[] = [
  { label: "hourly", minutes: 60 },
  { label: "every 3h", minutes: 180 },
  { label: "every 6h", minutes: 360 },
  { label: "every 12h", minutes: 720 },
  { label: "daily", minutes: 1440 },
  { label: "every 2 days", minutes: 2880 },
  { label: "weekly", minutes: 10080 },
];

export function freqLabel(minutes: number | null | undefined): string {
  if (minutes == null) return "inherit";
  const f = FREQ_OPTIONS.find((o) => o.minutes === minutes);
  if (f) return f.label;
  if (minutes % 1440 === 0) return `every ${minutes / 1440}d`;
  if (minutes % 60 === 0) return `every ${minutes / 60}h`;
  return `${minutes}m`;
}

export function ageDays(createdAt: string): string {
  const d = Math.floor((Date.now() - Date.parse(createdAt)) / 86_400_000);
  if (d <= 0) return "added today";
  if (d === 1) return "added 1 day ago";
  return `added ${d} days ago`;
}
