// No grouping separator: `toLocaleString()` takes the browser's locale, so one page said
// 1,234 and 1.234 and a dot means "thousands" to one reader and "decimal" to the next.
// One decimal place, so 8412 is 8.4k rather than 8k.
const NUMBER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
});

// Plausible's shape: 412, 1.1k, 50k, 123.5k, 1.2M, 3.4B.
export function formatNumber(value: number): string {
  return NUMBER.format(value).replace("K", "k");
}

const WHOLE = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 0,
});

export function formatNumberShort(value: number): string {
  const full = formatNumber(value);
  return full.length <= 4 ? full : WHOLE.format(value).replace("K", "k");
}
