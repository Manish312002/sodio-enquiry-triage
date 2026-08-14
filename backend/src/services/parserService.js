/**
 * Sample-enquiry file parser.
 *
 * — file at `backend/src/services/parserService.js`.
 * (Renamed to `parserService.js` to match the architecture doc; lives at
 *  `backend/src/services/parserService.js` exactly as specified.)
 *
 * scope:
 *   - Parse the operator-supplied sample-enquiries file format.
 *   - Identify individual enquiry boundaries by separator (line of dashes).
 *   - Extract From / Email / Received / Message fields per block.
 *   - Return one structured input record per enquiry.
 *   - Preserve originalText EXACTLY (no trimming, no normalization).
 *   - Identify source as 'file' (set by the import endpoint, not the parser).
 *
 * Non-destructive handling of PDF-extraction artifacts (see
 * for the full inspection report):
 *   - Form-feed (`\x0c`) characters that appear BETWEEN header lines (a
 *     side-effect of `pdftotext -layout` page breaks) are consumed by the
 *     header-line regex. They NEVER appear inside originalText in the real
 *     fixture, but if one ever did, it would be preserved verbatim.
 *   - The trailing empty block (file ends with `\n\x0c`) is detected and
 *     skipped with a parserWarning.
 *   - Blocks missing one or more headers are still parsed; missing headers
 *     yield `null` and a warning. The block does NOT crash the import.
 *
 * deliberately does NOT:
 *   - persist records (the import controller does that via enquiryService);
 *   - call the LLM;
 *   - compute priority;
 *   - create batch jobs.
 *
 * The parser is a PURE FUNCTION — given a string of file content, it returns
 * an array of parsed records plus metadata. No I/O, no side effects. This
 * makes it trivially testable.
 */

/**
 * Separator pattern: a line of 3+ dashes, optionally followed by horizontal
 * whitespace, then a line break. We match the whole line including the
 * trailing newline so re.split() consumes it.
 *
 * The real fixture uses exactly 80 dashes, but we accept 3+ to be tolerant
 * of future fixtures that may use shorter separators.
 */
const SEPARATOR_REGEX = /^-{3,}[ \t]*\r?\n/gm;

/**
 * Header-line regex. Allows optional leading horizontal whitespace AND
 * form-feed characters (`\x0c`) — these appear in the real fixture as
 * artifacts of `pdftotext -layout` page breaks (see inspection report §7a).
 *
 * Captures:
 *   $1 = header name (From | Email | Received | Message)
 *   $2 = rest of line (the value, or empty for Message:)
 *
 * The `gm` flags make this match on every line start. We use `[ \t\x0c]`
 * (NOT `\s`) so we don't match across line breaks.
 */
const HEADER_REGEX = /^[ \t\x0c]*(From|Email|Received|Message):[ \t]?(.*)$/gm;

/**
 * Received-timestamp format in the fixture: `YYYY-MM-DD HH:MM`.
 * The fixture has no timezone, so we parse as local time (the operator's
 * server timezone). This is documented in the inspection report §3.
 */
const RECEIVED_REGEX = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Reasonable upper bound on file size: 5 MiB. */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Reasonable upper bound on number of enquiry blocks per file. */
export const MAX_BLOCKS_PER_FILE = 500;

/**
 * Parse a single block (text between two separators) into a structured
 * enquiry input record.
 *
 * Block format:
 *   From: <name>
 *   Email: <email>
 *   Received: YYYY-MM-DD HH:MM
 *   Message:
 *   <body, possibly multi-line, including trailing blank line(s)>
 *
 * @param {string} block Raw block text (already split from the file).
 * @param {number} blockIndex 1-based index in the file (for debugging).
 * @returns {{record: object, warnings: string[]}}
 */
function parseBlock(block, blockIndex) {
  const warnings = [];

  // Find all header-line matches in this block.
  // We use a manual scan so we can identify the position where the Message:
  // header ends — everything after that is originalText, verbatim.
  const matches = [];
  let m;
  // Reset regex state (it's a global regex).
  HEADER_REGEX.lastIndex = 0;
  while ((m = HEADER_REGEX.exec(block)) !== null) {
    matches.push({
      name: m[1],
      value: m[2],
      headerStart: m.index,
      headerEnd: m.index + m[0].length,
      // The line ends at the next \n (or end of block). Include the \n in headerEnd
      // so originalText starts AFTER the header line.
      lineEnd: block.indexOf('\n', m.index + m[0].length),
    });
    if (matches.length > 20) break; // paranoia
  }

  if (matches.length === 0) {
    return {
      record: null,
      warnings: [`block ${blockIndex}: no headers found; skipping`],
    };
  }

  // Locate the Message: header (the body follows it).
  const messageMatch = matches.find((x) => x.name === 'Message');
  if (!messageMatch) {
    return {
      record: null,
      warnings: [`block ${blockIndex}: no Message: header found; skipping`],
    };
  }

  // originalText = everything AFTER the Message: header line's terminating newline.
  // If Message: is the last line (no body), originalText is empty.
  let originalText = '';
  const bodyStart = messageMatch.lineEnd === -1 ? block.length : messageMatch.lineEnd + 1;
  originalText = block.slice(bodyStart);

  // originalText is preserved EXACTLY. The only thing we strip is a single
  // trailing newline IF the block was split such that the separator's
  // preceding \n got captured. We detect this by checking whether originalText
  // ends with '\n' AND there is no content after that newline (i.e. it's the
  // artifact of how the split happened, not part of the message).
  //
  // Actually — "original enquiry text is immutable" — we
  // should NOT strip anything. The bytes between Message:\n and the next
  // separator are exactly what the file contains, and that's what we store.
  //
  // EXCEPT: the split regex `^-{3,}[ \t]*\r?\n` (multiline) consumes the
  // separator line AND its trailing newline. So the block content ends
  // right before the separator — which means originalText ends with whatever
  // came immediately before the separator (often a blank line).
  //
  // To make round-trip verification meaningful, we keep ALL of those bytes.
  // Tests verify that originalText matches the bytes in the file exactly
  // between Message:\n and the separator.

  // Validate non-empty: blank/short messages do not crash
  // the import, but we record them as a warning).
  if (originalText.trim().length === 0) {
    return {
      record: null,
      warnings: [`block ${blockIndex}: Message body is empty or whitespace-only; skipping`],
    };
  }

  // Extract the other headers.
  const fromMatch = matches.find((x) => x.name === 'From');
  const emailMatch = matches.find((x) => x.name === 'Email');
  const receivedMatch = matches.find((x) => x.name === 'Received');

  const senderName = fromMatch ? fromMatch.value.trim() : null;
  let senderEmail = emailMatch ? emailMatch.value.trim() : null;

  if (!fromMatch) warnings.push(`block ${blockIndex}: missing From: header`);
  if (!emailMatch) warnings.push(`block ${blockIndex}: missing Email: header`);

  // Basic email shape check (does not block — just records a warning).
  if (senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    warnings.push(`block ${blockIndex}: sender email "${senderEmail}" does not look like an email`);
  }

  // Parse Received: into a Date. Format: YYYY-MM-DD HH:MM (no timezone).
  let receivedAt = null;
  if (receivedMatch) {
    const rm = RECEIVED_REGEX.exec(receivedMatch.value.trim());
    if (rm) {
      const [_, yyyy, MM, dd, hh, mm, ss] = rm;
      // Construct Date in LOCAL time (the fixture has no timezone info).
      receivedAt = new Date(
        Number(yyyy),
        Number(MM) - 1,
        Number(dd),
        Number(hh),
        Number(mm),
        ss ? Number(ss) : 0,
      );
      if (Number.isNaN(receivedAt.getTime())) {
        receivedAt = null;
        warnings.push(`block ${blockIndex}: could not parse Received date "${receivedMatch.value}"`);
      }
    } else {
      warnings.push(`block ${blockIndex}: Received date "${receivedMatch.value}" is not in YYYY-MM-DD HH:MM format`);
    }
  } else {
    warnings.push(`block ${blockIndex}: missing Received: header`);
  }

  // If we couldn't parse receivedAt, fall back to import time (now).
  // This is recorded as a warning so the operator knows the timestamp is
  // not the original one.
  if (!receivedAt) {
    receivedAt = new Date();
    warnings.push(`block ${blockIndex}: receivedAt falling back to import time`);
  }

  return {
    record: {
      source: 'file', // explicit; import endpoint confirms
      originalText,
      sender: {
        name: senderName,
        email: senderEmail,
      },
      receivedAt,
    },
    warnings,
  };
}

/**
 * Parse a sample-enquiries file into structured input records.
 *
 * @param {string} fileContent Raw file content (already decoded as UTF-8).
 * @param {object} [opts]
 * @param {string} [opts.fileName]  For logging/metadata only.
 * @returns {{
 *   records: Array<object>,
 *   skipped: Array<{blockIndex: number, reason: string}>,
 *   warnings: string[],
 *   meta: { fileName: string, totalBlocks: number, parsedCount: number, skippedCount: number, preamble: string }
 * }}
 */
export function parseEnquiryFile(fileContent, opts = {}) {
  const fileName = opts.fileName || 'unknown';
  const warnings = [];
  const skipped = [];

  if (typeof fileContent !== 'string') {
    throw new TypeError('parseEnquiryFile: fileContent must be a string');
  }

  if (fileContent.length === 0) {
    return {
      records: [],
      skipped: [],
      warnings: ['file is empty'],
      meta: {
        fileName,
        totalBlocks: 0,
        parsedCount: 0,
        skippedCount: 0,
        preamble: '',
      },
    };
  }

  // Split on separator lines. The regex consumes the separator + its trailing
  // newline, so each resulting part is the content BETWEEN separators.
  const parts = fileContent.split(SEPARATOR_REGEX);

  // parts[0] is the file preamble (text before the first separator).
  // parts[1..N] are enquiry blocks.
  // The last part may be empty or just whitespace/form-feed if the file
  // ends with a separator + trailing newline.
  const preamble = parts[0] || '';
  const blocks = parts.slice(1);

  if (blocks.length > MAX_BLOCKS_PER_FILE) {
    warnings.push(`file has ${blocks.length} blocks; exceeding MAX_BLOCKS_PER_FILE (${MAX_BLOCKS_PER_FILE}); truncating`);
  }

  const records = [];
  let blockIndex = 0;
  for (const block of blocks) {
    blockIndex += 1;
    if (blockIndex > MAX_BLOCKS_PER_FILE) break;

    // Detect "empty" blocks (only whitespace, including form-feed).
    if (block.trim().length === 0) {
      skipped.push({
        blockIndex,
        reason: 'empty block (whitespace/form-feed only)',
      });
      continue;
    }

    const { record, warnings: blockWarnings } = parseBlock(block, blockIndex);
    if (blockWarnings.length > 0) {
      warnings.push(...blockWarnings);
    }

    if (record) {
      records.push({ ...record, blockIndex });
    } else {
      // parseBlock returned null record — the warnings already explain why.
      // We still add to `skipped` for the summary.
      const lastWarning = blockWarnings[blockWarnings.length - 1] || 'unknown reason';
      skipped.push({ blockIndex, reason: lastWarning });
    }
  }

  return {
    records,
    skipped,
    warnings,
    meta: {
      fileName,
      totalBlocks: blocks.length,
      parsedCount: records.length,
      skippedCount: skipped.length,
      preamble,
    },
  };
}

export default { parseEnquiryFile, MAX_FILE_SIZE_BYTES, MAX_BLOCKS_PER_FILE };
