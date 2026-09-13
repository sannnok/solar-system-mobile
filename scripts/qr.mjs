/**
 * A minimal QR encoder, just enough to put a URL on a phone screen.
 *
 * Byte mode, error correction level M, versions 1-6 (up to 106 bytes) — which
 * covers any LAN or tunnel URL you would point a phone at. Kept here in
 * `scripts/` because it is development tooling; nothing in the app uses it.
 *
 * Reference: ISO/IEC 18004. The structure follows the usual pipeline —
 * bitstream, Reed-Solomon, interleave, place, mask, format bits.
 */

// --- GF(256) arithmetic, primitive polynomial 0x11d ------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function mul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon remainder: the EC codewords appended to a block. */
function errorCorrection(data, count) {
  const gen = generatorPoly(count);
  const buffer = new Uint8Array(data.length + count);
  buffer.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = buffer[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) buffer[i + j] ^= mul(gen[j], factor);
  }
  return buffer.subarray(data.length);
}

// --- version tables (error correction level M) -----------------------------

// [total data codewords, EC codewords per block, number of blocks]
const VERSIONS = {
  1: [16, 10, 1],
  2: [28, 16, 1],
  3: [44, 26, 1],
  4: [64, 18, 2],
  5: [86, 24, 2],
  6: [108, 16, 4],
};

const ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
// Bits of padding after the interleaved codewords, per version.
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7 };
const EC_LEVEL_M = 0b00;

const MAX_BYTES = VERSIONS[6][0] - 2; // two codewords go to the header

function chooseVersion(byteLength) {
  // 4-bit mode indicator + 8-bit character count + the data itself.
  const needed = Math.ceil((4 + 8 + byteLength * 8) / 8);
  for (const version of [1, 2, 3, 4, 5, 6]) {
    if (VERSIONS[version][0] >= needed) return version;
  }
  throw new Error(`${byteLength} bytes is too long for this encoder (max ${MAX_BYTES})`);
}

// --- encoding ---------------------------------------------------------------

function toCodewords(bytes, version) {
  const [dataCodewords] = VERSIONS[version];
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // character count, 8 bits for versions 1-9
  for (const byte of bytes) push(byte, 8);

  // Terminator, then pad to a byte boundary, then the standard filler bytes.
  push(0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  for (let i = 0; codewords.length < dataCodewords; i++) {
    codewords.push(i % 2 === 0 ? 0xec : 0x11);
  }
  return codewords;
}

/** Splits into blocks, adds EC, and interleaves as the spec requires. */
function interleave(codewords, version) {
  const [dataCodewords, ecPerBlock, blockCount] = VERSIONS[version];
  const shortLength = Math.floor(dataCodewords / blockCount);
  const longBlocks = dataCodewords % blockCount;

  const blocks = [];
  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const length = shortLength + (i >= blockCount - longBlocks ? 1 : 0);
    const data = Uint8Array.from(codewords.slice(offset, offset + length));
    offset += length;
    blocks.push({ data, ec: errorCorrection(data, ecPerBlock) });
  }

  const result = [];
  const maxData = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of blocks) result.push(block.ec[i]);
  }
  return result;
}

// --- matrix -----------------------------------------------------------------

function createMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (row, col, dark) => {
    modules[row][col] = dark;
    reserved[row][col] = true;
  };

  // Finder patterns with their separators.
  for (const [baseRow, baseCol] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = baseRow + r;
        const col = baseCol + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        const edge = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(row, col, edge !== 2 && edge <= 3);
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alignment patterns, skipping the ones that would sit on a finder.
  const centres = ALIGNMENT[version];
  for (const row of centres) {
    for (const col of centres) {
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) {
        continue;
      }
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          set(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }

  // Reserve the format information areas and the always-dark module.
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) set(8, i, false);
    if (!reserved[i][8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) set(8, size - 1 - i, false);
    if (!reserved[size - 1 - i][8]) set(size - 1 - i, 8, false);
  }
  set(size - 8, 8, true);

  return { size, modules, reserved };
}

/** Walks the zigzag from the bottom-right, skipping the vertical timing column. */
function placeData(matrix, codewords, version) {
  const { size, modules, reserved } = matrix;
  const bits = [];
  for (const codeword of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((codeword >>> i) & 1);
  }
  for (let i = 0; i < REMAINDER_BITS[version]; i++) bits.push(0);

  let index = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        modules[row][col] = index < bits.length ? bits[index++] === 1 : false;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(matrix, mask) {
  const { size, modules, reserved } = matrix;
  const fn = MASKS[mask];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!reserved[row][col] && fn(row, col)) modules[row][col] = !modules[row][col];
    }
  }
}

/** The four penalty rules from the spec; lower is easier for a scanner. */
function penalty(matrix) {
  const { size, modules } = matrix;
  let score = 0;

  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(modules[i]);
    lines.push(modules.map((row) => row[i]));
  }

  for (const line of lines) {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);

    // Rule 3: a finder-like 1011101 sequence with four light modules beside it.
    for (let i = 0; i + 6 < size; i++) {
      const core =
        line[i] && !line[i + 1] && line[i + 2] && line[i + 3] && line[i + 4] && !line[i + 5] && line[i + 6];
      if (!core) continue;
      const before = i >= 4 && !line[i - 1] && !line[i - 2] && !line[i - 3] && !line[i - 4];
      const after =
        i + 10 < size && !line[i + 7] && !line[i + 8] && !line[i + 9] && !line[i + 10];
      if (before || after) score += 40;
    }
  }

  // Rule 2: every 2x2 block of one colour.
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const value = modules[row][col];
      if (value === modules[row][col + 1] && value === modules[row + 1][col] && value === modules[row + 1][col + 1]) {
        score += 3;
      }
    }
  }

  // Rule 4: deviation from an even balance of dark and light.
  let dark = 0;
  for (const row of modules) for (const value of row) if (value) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

function drawFormatBits(matrix, mask) {
  const { size, modules } = matrix;
  const data = (EC_LEVEL_M << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ (((remainder >> 9) & 1) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (i) => ((bits >> i) & 1) === 1;

  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);

  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);
  modules[size - 8][8] = true;
}

/** Encodes `text` and returns a square boolean matrix; true means a dark module. */
export function encodeQr(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = chooseVersion(bytes.length);
  const codewords = interleave(toCodewords(bytes, version), version);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = createMatrix(version);
    placeData(matrix, codewords, version);
    applyMask(matrix, mask);
    drawFormatBits(matrix, mask);
    const score = penalty(matrix);
    if (!best || score < best.score) best = { score, modules: matrix.modules };
  }
  return best.modules;
}

/**
 * Renders to ANSI half-block characters: one column per module and one line per
 * two rows, which comes out roughly square given typical terminal cells.
 *
 * Colours are always set explicitly. A scanner expects dark modules on a light
 * background, so leaving either to the terminal's own theme would invert the
 * code on half the machines it runs on.
 */
export function qrToAnsi(text, { quietZone = 4, truecolor } = {}) {
  const modules = encodeQr(text);
  const size = modules.length;
  const total = size + quietZone * 2;
  const isDark = (row, col) => {
    const r = row - quietZone;
    const c = col - quietZone;
    return r >= 0 && r < size && c >= 0 && c < size && modules[r][c];
  };

  const full = truecolor ?? /^(truecolor|24bit)$/i.test(process.env.COLORTERM ?? '');
  const fg = (dark) => (full ? `\x1b[38;2;${dark ? '0;0;0' : '255;255;255'}m` : dark ? '\x1b[30m' : '\x1b[97m');
  const bg = (dark) => (full ? `\x1b[48;2;${dark ? '0;0;0' : '255;255;255'}m` : dark ? '\x1b[40m' : '\x1b[107m');

  const lines = [];
  for (let row = 0; row < total; row += 2) {
    let line = '';
    for (let col = 0; col < total; col++) {
      const top = isDark(row, col);
      const bottom = row + 1 < total && isDark(row + 1, col);
      line += fg(top) + bg(bottom) + '▀';
    }
    lines.push(line + '\x1b[0m');
  }
  return lines.join('\n');
}
