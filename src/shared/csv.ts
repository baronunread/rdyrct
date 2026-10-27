/** CSV writing, shared by the analytics export (#78, in the browser) and the
 * links export (#75, in the Worker). */

/** One field, quoted only when it has to be. */
function field(value: string): string {
  // A leading =, +, - or @ is a formula to Excel and Sheets, so a referrer
  // like "=cmd|..." would run on open. Prefixing a quote makes it text.
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** One row, without its line break. */
export function csvRow(row: readonly string[]): string {
  return row.map(field).join(",");
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  // CRLF, which is what RFC 4180 says and what Excel wants.
  return rows.map(csvRow).join("\r\n");
}
