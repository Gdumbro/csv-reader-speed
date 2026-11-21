// Fast drop-in for make.fun's csv-reader 1.0.0.
//
// Written from the RULES.txt specification only. Parses the text once,
// left to right, with commas and double quotes, reproducing csv-reader's
// reading of {text, header} as {columns, rows, errors} exactly, including
// its broken-input behaviour (BOM, CRLF, stray CR, quoted fields, doubled
// quotes, quote junk, unterminated quotes, short/long rows).
//
// Speed notes: the hot path never loops per character. Unquoted fields are
// found with indexOf for the next delimiter; quoted fields are found with
// indexOf for the next quote ("" escapes skipped in the same scan); field
// values are substrings, never built character by character. Lone CRs are
// located once per case by a single regex pass, so the hot path never scans
// for them; only a field that actually holds one takes the slow path.

export function run(input) {
  const text = input.text;
  const header = input.header;
  const n = text.length;
  let i = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1; // drop a leading BOM

  // Positions of lone CRs (a CR not followed by LF), in order. A lone CR
  // inside quotes is content, read as LF; the pointer below is advanced
  // past quoted spans, so it only ever points at a lone CR in unquoted
  // text, where it is a stray CR.
  const loneCR = [];
  {
    const re = /\r(?!\n)/g;
    let m;
    while ((m = re.exec(text)) !== null) loneCR.push(m.index);
  }
  let crPtr = 0;

  const errors = [];
  const records = [];
  let line = 1; // 1-based line of the character at i
  let width = -1; // the first record's field count; it sets the width

  while (i < n) {
    // A line left with no characters is no record.
    const c0 = text.charCodeAt(i);
    if (c0 === 10) {
      i++;
      line++;
      continue;
    }
    if (c0 === 13 && i + 1 < n && text.charCodeAt(i + 1) === 10) {
      i += 2;
      line++;
      continue;
    }

    const recStartLine = line;
    const recIdx = records.length;
    // An error's row is its record's index in rows, null for the header.
    const row = header ? (recIdx === 0 ? null : recIdx - 1) : recIdx;
    const fields = [];

    // ---- parse one record, field by field ----
    for (;;) {
      while (crPtr < loneCR.length && loneCR[crPtr] < i) crPtr++;
      let field;
      if (i < n && text.charCodeAt(i) === 34) {
        // ---- quoted field ----
        let q = text.indexOf('"', i + 1);
        let escaped = false;
        while (q !== -1 && q + 1 < n && text.charCodeAt(q + 1) === 34) {
          escaped = true; // "" inside quotes is one literal quote
          q = text.indexOf('"', q + 2);
        }
        if (q === -1) {
          // A quote that never closes is a literal character; the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recStartLine, row });
          const r = parseUnquoted(text, i + 1, n, errors, recStartLine, row);
          field = '"' + r.value;
          i = r.end;
        } else {
          let content = text.substring(i + 1, q);
          const hasBreak = content.indexOf('\n') !== -1 || content.indexOf('\r') !== -1;
          if (hasBreak) {
            // Each CRLF or lone CR inside quotes reads as LF, and every
            // LF, CRLF and lone CR inside quotes counts as a line.
            const breaks = content.match(/\r\n|\r|\n/g);
            if (breaks) line += breaks.length;
            content = content.replace(/\r\n?/g, '\n');
          }
          if (escaped) content = content.replace(/""/g, '"');

          // What follows the closing quote, up to the next comma or line
          // break, is appended as it stands.
          const j = q + 1;
          const cj = text.indexOf(',', j);
          const nj = text.indexOf('\n', j);
          let jEnd = -1;
          if (cj !== -1) jEnd = cj;
          if (nj !== -1 && (jEnd === -1 || nj < jEnd)) jEnd = nj;
          if (jEnd === -1) jEnd = n;
          let junk = text.substring(j, jEnd);
          // A CR right before the LF is the CRLF line break, not junk.
          if (jEnd < n && text.charCodeAt(jEnd) === 10 && jEnd > j && text.charCodeAt(jEnd - 1) === 13) {
            junk = junk.slice(0, -1);
          }
          if (junk.length > 0) {
            errors.push({ code: 'quote_junk', line: recStartLine, row });
            field = content + junk;
          } else {
            field = content;
          }
          i = jEnd;
        }
      } else {
        // ---- unquoted field: ends at the next comma, LF, or end of text,
        // unless a lone CR sits inside it (then it is a stray CR). ----
        const c = text.indexOf(',', i);
        const nl = text.indexOf('\n', i);
        let e = -1;
        let kind = 0; // 0 = end of text, 1 = comma, 2 = LF
        if (c !== -1) {
          e = c;
          kind = 1;
        }
        if (nl !== -1 && (e === -1 || nl < e)) {
          e = nl;
          kind = 2;
        }
        const end = e === -1 ? n : e;
        if (crPtr < loneCR.length && loneCR[crPtr] < end) {
          // Rare slow path: the field holds a lone CR.
          const r = parseUnquoted(text, i, n, errors, recStartLine, row);
          field = r.value;
          i = r.end;
        } else if (kind === 0) {
          field = text.substring(i);
          i = n;
        } else if (kind === 2 && e > i && text.charCodeAt(e - 1) === 13) {
          // LF with a CR right before it is a CRLF line break: the CR is
          // not part of the field.
          field = text.substring(i, e - 1);
          i = e;
        } else {
          field = text.substring(i, e);
          i = e;
        }
      }
      fields.push(field);

      if (i < n && text.charCodeAt(i) === 44) {
        i++; // comma: another field follows
        continue;
      }
      break; // line break or end of text: the record ends
    }

    // ---- the record ends: consume its line break ----
    if (i < n && text.charCodeAt(i) === 10) {
      i++;
      line++;
    } else if (i < n && text.charCodeAt(i) === 13 && i + 1 < n && text.charCodeAt(i + 1) === 10) {
      i += 2;
      line++;
    }
    // (otherwise the record ends at the end of the text)

    // ---- short / long row, against the first record's width ----
    if (width === -1) {
      width = fields.length; // the first record sets the width
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: recStartLine, row, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recStartLine, row, extra: fields.slice(width) });
      fields.length = width;
    }
    records.push(fields);
  }

  const columns = header ? (records.length ? records[0] : null) : null;
  const rows = header ? records.slice(1) : records;
  return { columns, rows, errors };
}

// Parse an unquoted field starting at p. Returns {value, end} with end at
// the delimiter (comma, LF, the CR of a CRLF, or the end of the text).
// A CR not followed by LF is dropped and reported as stray_cr. `line` is
// the record's start line, which every error of the record carries.
function parseUnquoted(text, p, n, errors, line, row) {
  const c = text.indexOf(',', p);
  const nl = text.indexOf('\n', p);
  const r = text.indexOf('\r', p);
  let e = -1;
  let kind = 0; // 0 = end of text, 1 = comma, 2 = LF, 3 = CR
  if (c !== -1) {
    e = c;
    kind = 1;
  }
  if (nl !== -1 && (e === -1 || nl < e)) {
    e = nl;
    kind = 2;
  }
  if (r !== -1 && (e === -1 || r < e)) {
    e = r;
    kind = 3;
  }
  if (kind === 0) return { value: text.substring(p), end: n };
  if (kind === 1) return { value: text.substring(p, e), end: e };
  if (kind === 2) return { value: text.substring(p, e), end: e };
  // kind 3: a CR. CRLF ends the record; a lone CR is dropped (stray_cr)
  // and the field goes on.
  if (e + 1 < n && text.charCodeAt(e + 1) === 10) {
    return { value: text.substring(p, e), end: e };
  }
  const segs = [text.substring(p, e)];
  errors.push({ code: 'stray_cr', line, row });
  let q = e + 1;
  for (;;) {
    const c2 = text.indexOf(',', q);
    const n2 = text.indexOf('\n', q);
    const r2 = text.indexOf('\r', q);
    let e2 = -1;
    let k2 = 0;
    if (c2 !== -1) {
      e2 = c2;
      k2 = 1;
    }
    if (n2 !== -1 && (e2 === -1 || n2 < e2)) {
      e2 = n2;
      k2 = 2;
    }
    if (r2 !== -1 && (e2 === -1 || r2 < e2)) {
      e2 = r2;
      k2 = 3;
    }
    if (k2 === 0) {
      segs.push(text.substring(q));
      return { value: segs.join(''), end: n };
    }
    if (k2 === 1) {
      segs.push(text.substring(q, e2));
      return { value: segs.join(''), end: e2 };
    }
    if (k2 === 2) {
      segs.push(text.substring(q, e2));
      return { value: segs.join(''), end: e2 };
    }
    if (e2 + 1 < n && text.charCodeAt(e2 + 1) === 10) {
      segs.push(text.substring(q, e2));
      return { value: segs.join(''), end: e2 };
    }
    segs.push(text.substring(q, e2));
    errors.push({ code: 'stray_cr', line, row });
    q = e2 + 1;
  }
}
