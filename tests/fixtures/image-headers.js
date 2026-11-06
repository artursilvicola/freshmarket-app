// [feat/marketing-photos] Minimalne, poprawne nagłówki obrazów do testów (sniff czyta tylko nagłówek).
/** Minimalne, poprawne nagłówki obrazów (bez prawdziwych danych pikseli — sniff czyta tylko nagłówek). */
export function jpegHeader(width, height, pad = 2000) {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03];
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  return Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from(app0), Buffer.from(sof), Buffer.alloc(pad, 0x11), Buffer.from([0xff, 0xd9])]);
}
export function pngHeader(width, height, pad = 2000) {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  return b;
}
export function webpVp8Header(width, height, pad = 2000) {
  const b = Buffer.alloc(30 + pad);
  b.write("RIFF", 0); b.writeUInt32LE(22 + pad, 4); b.write("WEBP", 8); b.write("VP8 ", 12); b.writeUInt32LE(10 + pad, 16);
  b[20] = 0x9d; b[21] = 0x01; b[22] = 0x2a; // start code VP8
  b.writeUInt16LE(width, 26); b.writeUInt16LE(height, 28);
  return b;
}

