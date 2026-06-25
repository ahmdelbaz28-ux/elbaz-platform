 
/**
 * Lightweight SVG QR Code Generator
 * Encodes a URL into an SVG QR code pattern using a minimal bit matrix approach.
 * No external dependencies required.
 */

// Error correction levels (we use Medium by default)
type ECL = "L" | "M" | "Q" | "H";

// Minimal QR code version table (version -> size, capacity)
const VERSION_DATA: Record<number, { size: number; capacity: number }> = {
  1: { size: 21, capacity: 17 },
  2: { size: 25, capacity: 32 },
  3: { size: 29, capacity: 53 },
  4: { size: 33, capacity: 78 },
  5: { size: 37, capacity: 106 },
};

// Alignment pattern positions per version
const ALIGNMENT_POSITIONS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
};

// Error correction codewords per block (version, ecl)
const EC_TABLE: Record<string, number[]> = {
  "1-M": [10, 16],
  "2-M": [16, 28],
  "3-M": [26, 44],
  "4-M": [18, 16],
  "5-M": [24, 16],
};

/**
 * Convert a string to a byte array (UTF-8)
 */
function textToBytes(text: string): number[] {
  const encoder = new TextEncoder();
  return Array.from(encoder.encode(text));
}

/**
 * GF(256) arithmetic for Reed-Solomon
 * Using primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
 */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11D : 0);
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Generate Reed-Solomon error correction codewords
 */
function rsEncode(data: number[], ecCount: number): number[] {
  // Generate generator polynomial
  let gen = [1];
  for (let i = 0; i < ecCount; i++) {
    const newGen = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      newGen[j] ^= gen[j];
      newGen[j + 1] ^= gfMul(gen[j], GF_EXP[i]);
    }
    gen = newGen;
  }

  // Polynomial division
  const result = new Array(ecCount).fill(0);
  for (let i = 0; i < data.length; i++) {
    const coef = data[i] ^ result[0];
    result.shift();
    result.push(0);
    for (let j = 0; j < gen.length; j++) {
      result[j] ^= gfMul(gen[j], coef);
    }
  }
  return result;
}

/**
 * Calculate BCH error correction for the format information
 */
function bchEncode(data: number): number {
  let d = data << 10;
  const gen = 0x537; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
  for (let i = 14; i >= 10; i--) {
    if (d & (1 << i)) {
      d ^= gen << (i - 10);
    }
  }
  return ((data << 10) | d) ^ 0x5412; // XOR with mask pattern 000
}

/**
 * Simple QR code matrix builder
 */
function buildMatrix(
  size: number,
  dataBits: number[],
  version: number,
  ecl: ECL
): boolean[][] {
  // Initialize matrix
  const matrix: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  // Place finder patterns (7x7 squares at three corners)
  function placeFinderPattern(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const mr = row + r;
        const mc = col + c;
        if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
        const isBlack =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        matrix[mr][mc] = isBlack;
        reserved[mr][mc] = true;
      }
    }
  }

  placeFinderPattern(0, 0);
  placeFinderPattern(0, size - 7);
  placeFinderPattern(size - 7, 0);

  // Place alignment patterns
  const alignPos = ALIGNMENT_POSITIONS[version] || [];
  for (const row of alignPos) {
    for (const col of alignPos) {
      // Skip if overlaps with finder patterns
      if (
        (row < 9 && col < 9) ||
        (row < 9 && col > size - 9) ||
        (row > size - 9 && col < 9)
      )
        continue;

      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
          matrix[row + r][col + c] = isBlack;
          reserved[row + r][col + c] = true;
        }
      }
    }
  }

  // Place timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) {
      matrix[6][i] = i % 2 === 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      matrix[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }
  }

  // Reserve format information areas
  for (let i = 0; i < 8; i++) {
    reserved[8][i] = true;
    reserved[8][size - 1 - i] = true;
    reserved[i][8] = true;
    reserved[size - 1 - i][8] = true;
  }
  reserved[8][8] = true;
  // Dark module
  matrix[size - 8][8] = true;
  reserved[size - 8][8] = true;

   // Place data bits in zigzag pattern
   let bitIndex = 0;

   for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5; // Skip vertical timing pattern column
    for (let row = 0; row < size; row++) {
      for (let c = 0; c < 2; c++) {
        const mc = col - c;
        if (mc < 0 || reserved[row][mc]) continue;
        if (bitIndex < dataBits.length) {
          matrix[row][mc] = dataBits[bitIndex] === 1;
        }
        // Remaining bits are 0 (false) by default
        bitIndex++;
      }
    }
  }

  // Place format information
  const eclBits = ecl === "M" ? 0 : ecl === "L" ? 1 : ecl === "H" ? 3 : 2;
  const formatInfo = bchEncode(eclBits);
  const formatBits = Array.from({ length: 15 }, (_, i) => !!(formatInfo & (1 << (14 - i))));

  // Around top-left finder
  for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i];
  matrix[8][7] = formatBits[6];
  matrix[8][8] = formatBits[7];
  matrix[7][8] = formatBits[8];
  for (let i = 0; i < 6; i++) matrix[5 - i][8] = formatBits[9 + i];

  // Around top-right and bottom-left finders
  for (let i = 0; i < 7; i++) matrix[size - 1 - i][8] = formatBits[i];
  for (let i = 0; i < 8; i++) matrix[8][size - 8 + i] = formatBits[7 + i];

   // Apply mask pattern 0 (no masking for simplicity)
   return matrix;
 }

/**
 * Convert data bytes and EC bytes into a bit array
 */
function bytesToBits(data: number[], ecBytes: number[]): number[] {
  const bits: number[] = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }
  for (const byte of ecBytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }
  return bits;
}

/**
 * Pad data to required length
 */
function padData(data: number[], totalCodewords: number): number[] {
  const padded = [...data];
  // Add terminator
  padded.push(0xEC);
  // Pad with 0x11 and 0xEC alternating
  let padByte = 0x11;
  while (padded.length < totalCodewords) {
    padded.push(padByte);
    padByte = padByte === 0x11 ? 0xEC : 0x11;
  }
  return padded.slice(0, totalCodewords);
}

/**
 * Encode data into QR code data bits (byte mode)
 */
function encodeData(text: string): number[] {
  const bytes = textToBytes(text);

  // Byte mode indicator (0100) + character count (8 bits for version 1-9) + data
  const modeBits = [0, 1, 0, 0];
  const countBits = Array.from({ length: 8 }, (_, i) => (bytes.length >> (7 - i)) & 1);
  const dataBits = [...modeBits, ...countBits];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      dataBits.push((byte >> i) & 1);
    }
  }

  return dataBits;
}

/**
 * Generate an SVG QR code for a given URL
 * @param url - The URL to encode
 * @param size - The SVG size in pixels (default: 90)
 * @returns SVG string
 */
export function generateQRCodeSVG(url: string, size: number = 90): string {
  // Determine version needed
  const bytes = textToBytes(url);
  let version = 1;
  for (const [v, info] of Object.entries(VERSION_DATA)) {
    if (bytes.length <= info.capacity) {
      version = Number(v);
      break;
    }
  }

  const ecl: ECL = "M";
  const { size: matrixSize } = VERSION_DATA[version];
  const ecKey = `${version}-${ecl}`;
  const ecInfo = EC_TABLE[ecKey] || [10, 16];
  const ecCodewordsPerBlock = ecInfo[0];
  const totalCodewords = ecInfo[1];
  const dataCodewords = totalCodewords - ecCodewordsPerBlock;

   // Encode data
   const dataBits = encodeData(url);
  const dataBytes: number[] = [];
  for (let i = 0; i + 7 < dataBits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | dataBits[i + j];
    }
    dataBytes.push(byte);
  }

  // Pad data
  const paddedData = padData(dataBytes, dataCodewords);

  // Generate error correction
  const ecBytes = rsEncode(paddedData, ecCodewordsPerBlock);

  // Combine and convert to bits
  const allBits = bytesToBits(paddedData, ecBytes);

  // Build matrix
  const matrix = buildMatrix(matrixSize, allBits, version, ecl);

   // Generate SVG
   const cellSize = size / matrixSize;
   const quietZone = 2;
   const totalSize = size + quietZone * 2 * cellSize;

   let rects = "";
  for (let row = 0; row < matrixSize; row++) {
    for (let col = 0; col < matrixSize; col++) {
      if (matrix[row][col]) {
        const x = (col + quietZone) * cellSize;
        const y = (row + quietZone) * cellSize;
        rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellSize + 0.5).toFixed(2)}" height="${(cellSize + 0.5).toFixed(2)}" fill="#0f172a"/>`;
      }
    }
  }

  return `<svg viewBox="0 0 ${totalSize.toFixed(2)} ${totalSize.toFixed(2)}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;">${rects}</svg>`;
}
