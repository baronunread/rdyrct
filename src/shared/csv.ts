function field(value: string): string {
  // A leading =, +, - or @ is a formula to Excel and Sheets: a quote makes it text.
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function csvRow(row: readonly string[]): string {
  return row.map(field).join(",");
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  // CRLF: RFC 4180, and what Excel wants.
  return rows.map(csvRow).join("\r\n");
}
