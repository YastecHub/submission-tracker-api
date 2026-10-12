export interface CsvRecord {
  /** 1-based line number where the record starts (for error messages). */
  line: number;
  values: string[];
}

/**
 * Small RFC 4180 CSV reader. It walks the text once, character by character, and
 * yields one record at a time, so callers can stop early on row limits.
 * Supports quoted fields, escaped quotes (""), commas/newlines inside quotes,
 * CRLF or LF endings and a UTF-8 BOM. Blank lines and lines starting with "#" are skipped.
 */
export function* parseCsv(text: string): Generator<CsvRecord> {
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  while (index < text.length) {
    const startLine = line;
    // Skip comment lines.
    if (text[index] === '#') {
      while (index < text.length && text[index] !== '\n') index += 1;
      index += 1;
      line += 1;
      continue;
    }
    const values: string[] = [];
    let field = '';
    let inQuotes = false;
    let ended = false;
    while (index < text.length && !ended) {
      const char = text[index];
      if (inQuotes) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 2;
            continue;
          }
          inQuotes = false;
          index += 1;
          continue;
        }
        if (char === '\n') line += 1;
        field += char;
        index += 1;
        continue;
      }
      if (char === '"' && field.trim() === '') {
        field = '';
        inQuotes = true;
      } else if (char === ',') {
        values.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        line += 1;
        ended = true;
      } else {
        field += char;
      }
      index += 1;
    }
    values.push(field);
    if (values.length === 1 && values[0].trim() === '') continue;
    yield { line: startLine, values: values.map((value) => value.trim()) };
  }
}

/** Escapes one CSV value for output. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}
