/**
 * scrape/trim.ts — shrink page markdown around price tokens before LLM extraction,
 * keeping the title/head and ±window chars around every ₹ / "Rs" token.
 */
export function trimMarkdown(md: string, maxChars = 12_000, window = 800): string {
  if (md.length <= maxChars) return md;
  const head = md.slice(0, 1500);
  const ranges: Array<[number, number]> = [[0, 1500]];
  const re = /(₹|\brs\.?\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const start = Math.max(0, m.index - window);
    const end = Math.min(md.length, m.index + window);
    ranges.push([start, end]);
  }
  // merge overlapping ranges
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  let out = "";
  for (const [s, e] of merged) {
    if (out.length + (e - s) > maxChars) {
      out += md.slice(s, s + Math.max(0, maxChars - out.length));
      break;
    }
    out += md.slice(s, e) + "\n…\n";
  }
  return out || head;
}
