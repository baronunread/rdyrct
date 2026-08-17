/**
 * Number formatting on `Intl`, pinned to English like `dates.ts`.
 *
 * No grouping separator at all: 50000 reads 50k. `toLocaleString()` with no
 * locale takes the browser's, so the same page said 1,234 clicks here and
 * 1.234 clicks there, and a dot that means "thousands" to one reader means
 * "decimal point" to the next. Compact notation sidesteps the argument and
 * is shorter, which is what a stat tile wants.
 *
 * One decimal place, so 8412 is 8.4k rather than 8k: the digit is worth the
 * character. Anything under a thousand is left alone.
 */
const NUMBER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
});

/**
 * Plausible's shape: 412, 1.1k, 50k, 123.5k, 1.2M, 3.4B. Lowercase k against
 * uppercase M and B is theirs too, and it reads better than 50K in a tile.
 */
export function formatNumber(value: number): string {
  return NUMBER.format(value).replace("K", "k");
}
