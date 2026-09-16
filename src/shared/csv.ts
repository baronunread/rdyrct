function field(value: string, protectFormulas: boolean): string {
  const guarded = protectFormulas && /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(
  rows: readonly (readonly string[])[],
  { protectFormulas = true }: { protectFormulas?: boolean } = {},
): string {
  return rows
    .map((row) => row.map((value) => field(value, protectFormulas)).join(","))
    .join("\r\n");
}
