/**
 * MD5 (RFC 1321) — needed because ENEX/ENML reference image resources by the
 * MD5 hash of their decoded bytes. Pure and dependency free. Output: lowercase hex.
 */

const S: number[] = [];
{
  const rounds: Array<[number, number, number, number]> = [
    [7, 12, 17, 22],
    [5, 9, 14, 20],
    [4, 11, 16, 23],
    [6, 10, 15, 21],
  ];
  for (const [a, b, c, d] of rounds) {
    for (let i = 0; i < 4; i++) S.push(a, b, c, d);
  }
}

const K: number[] = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

function rotl32(x: number, c: number): number {
  // x is treated as unsigned 32-bit; bitwise shifts keep the bit pattern.
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

export function md5Hex(data: Uint8Array): string {
  // ---- padding -------------------------------------------------------------
  const byteLen = data.length;
  const bitLenLow = (byteLen << 3) >>> 0; // (byteLen * 8) mod 2^32
  const bitLenHigh = Math.floor(byteLen / 0x20000000); // byteLen*8 / 2^32

  // Append 0x80, then zeros until (length + 1 + pad) % 64 == 56, then the
  // 64-bit little-endian bit length → total length is a multiple of 64.
  const padZeros = (56 - ((byteLen + 1) % 64) + 64) % 64;
  const total = byteLen + 1 + padZeros + 8;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[byteLen] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bitLenLow, true);
  dv.setUint32(total - 4, bitLenHigh, true);

  // ---- process -------------------------------------------------------------
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let off = 0; off < total; off += 64) {
    const X = new Array<number>(16);
    for (let j = 0; j < 16; j++) X[j] = dv.getUint32(off + j * 4, true);

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const oldD = d;
      const sum = (a + f + K[i] + X[g]) >>> 0;
      const newB = (b + rotl32(sum, S[i])) >>> 0;
      d = c;
      c = b;
      b = newB;
      a = oldD;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  // ---- little-endian hex output -------------------------------------------
  let out = "";
  for (const w of [a0, b0, c0, d0]) {
    for (let byte = 0; byte < 4; byte++) {
      out += ((w >>> (byte * 8)) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return out;
}
