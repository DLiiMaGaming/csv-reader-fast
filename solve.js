// csv-reader-fast 1.0.0 — a faster drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly csv-reader 1.0.0's answer for every {text, header}:
// {columns, rows, errors}, with the same broken-row policy (stray_cr, quote_junk,
// unterminated_quote, short_row, long_row), the same error order and the same
// line/row numbering. It is a fresh implementation, written from the RULES text
// and checked against the reference reader case by case; it does not import or
// copy csv-reader's code.
//
// Speed strategy — one pass, indexOf/slice scanning, no per-character loop:
//  * Fast path: a record that sits on one line with no quote and no stray CR is
//    sliced once and split(',') in one go. That is nearly every record.
//  * Slow path (records holding quotes or stray CRs): fields are scanned with
//    indexOf for the next comma / LF / CR / quote, slices only, and quoted
//    segments are folded (CRLF and lone CR inside quotes become LF) only when
//    they actually hold a line break.
//  * Minimal allocation: fields are slices of the input text; nothing is built
//    a character at a time and no regex runs per field.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Fold a quoted segment's line breaks: CRLF and a lone CR inside quotes each
  // become one LF, and the line count moves by the breaks it held.
  function fold(seg) {
    const m = seg.match(/\r\n|\r|\n/g);
    if (m !== null) line += m.length;
    return seg.replace(/\r\n?/g, '\n');
  }

  // Read an unquoted field starting at p, with the value built so far in val.
  // Writes into `unq` and returns it: {value, ended, pos, added}, where added
  // counts the characters kept from the text (a dropped stray CR is not
  // counted). A stray CR never ends a field, so the field always ends at the
  // next comma, line break or end of text; any CR before that is dropped
  // (stray_cr) in one go. `unq` is one scratch object, reused, so no array
  // is allocated per field.
  const unq = { value: '', ended: 0, pos: 0, added: 0 };
  function readUnq(p, val) {
    let value = val;
    let added = 0;
    const ci = text.indexOf(',', p);
    const li = text.indexOf('\n', p);
    if (ci === -1 && li === -1) {
      const seg = text.slice(p);
      const ri = seg.indexOf('\r');
      if (ri === -1) {
        value += seg;
        added += seg.length;
      } else {
        const parts = seg.split('\r');
        for (let i = 0; i < parts.length - 1; i++) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        }
        const joined = parts.join('');
        value += joined;
        added += joined.length;
      }
      unq.value = value;
      unq.ended = END;
      unq.pos = n;
      unq.added = added;
      return unq;
    }
    if (ci !== -1 && (li === -1 || ci < li)) {
      const seg = text.slice(p, ci);
      const ri = seg.indexOf('\r');
      if (ri === -1) {
        value += seg;
        added += seg.length;
      } else {
        const parts = seg.split('\r');
        for (let i = 0; i < parts.length - 1; i++) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        }
        const joined = parts.join('');
        value += joined;
        added += joined.length;
      }
      unq.value = value;
      unq.ended = COMMA;
      unq.pos = ci + 1;
      unq.added = added;
      return unq;
    }
    // The line break is nearer (or there is no comma left): a CR just before
    // it is the CRLF half, not part of the field.
    let end = li;
    if (li > p && text.charCodeAt(li - 1) === 13) end = li - 1;
    const seg = text.slice(p, end);
    const ri = seg.indexOf('\r');
    if (ri === -1) {
      value += seg;
      added += seg.length;
    } else {
      const parts = seg.split('\r');
      for (let i = 0; i < parts.length - 1; i++) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      }
      const joined = parts.join('');
      value += joined;
      added += joined.length;
    }
    line += 1;
    unq.value = value;
    unq.ended = BREAK;
    unq.pos = li + 1;
    unq.added = added;
    return unq;
  }

  // Finish one record's fields: a line left with no characters is no record,
  // otherwise the width check (short_row pads, long_row cuts) and the push.
  function finish(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the whole record sits on one line with no quote and no stray
    // CR (a trailing CR of a CRLF line break is not one). Slice it once and
    // split it; the slice is also what the quote/CR checks run on, so no scan
    // ever runs past the end of this line.
    const eol = text.indexOf('\n', pos);
    const lineEnd = eol === -1 ? n : eol;
    let segEnd = lineEnd;
    if (eol !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13) segEnd = lineEnd - 1;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      const fields = seg.split(',');
      pos = eol === -1 ? n : eol + 1;
      line += 1;
      finish(fields, false);
      continue;
    }

    // Slow path: field by field.
    const fields = [];
    let quoted = false;
    let ended = COMMA;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        const openLine = line;
        let start = pos + 1;
        let value = '';
        let closed = -1;
        while (true) {
          const q = text.indexOf('"', start);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === 34) {
            const s = text.slice(start, q);
            value += s.indexOf('\r') === -1 && s.indexOf('\n') === -1 ? s : fold(s);
            value += '"';
            start = q + 2;
            continue;
          }
          const s = text.slice(start, q);
          value += s.indexOf('\r') === -1 && s.indexOf('\n') === -1 ? s : fold(s);
          closed = q;
          break;
        }
        if (closed === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnq(open + 1, '"');
          value = r.value;
          ended = r.ended;
          pos = r.pos;
        } else {
          pos = closed + 1;
          if (pos >= n) {
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = BREAK;
            } else {
              // What follows the closing quote is appended as it stands, up to
              // the next comma or line break (quote_junk, when the field ends).
              const r = readUnq(pos, value);
              if (r.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = r.value;
              ended = r.ended;
              pos = r.pos;
            }
          }
        }
        fields.push(value);
      } else {
        quoted = false;
        const r = readUnq(pos, '');
        fields.push(r.value);
        ended = r.ended;
        pos = r.pos;
      }
    } while (ended === COMMA);
    finish(fields, quoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
