/** Quote CSV fields and neutralize spreadsheet formulas in untrusted text. */
export function csvField(value: unknown): string {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && /^[\s]*[=+@\-]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
