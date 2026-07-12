import { describe, expect, it } from 'vitest';
import { sniffImageType } from './image-type.js';

// Minimal valid magic-byte prefixes for each supported format, padded with trailing bytes so the
// buffers resemble a real (short) file. The sniffer only reads the leading signature.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]), // little-endian file size, value irrelevant to the sniff
  Buffer.from('WEBP'),
  Buffer.from('VP8 '),
]);

describe('sniffImageType', () => {
  it('detects JPEG from its FF D8 FF signature', () => {
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
  });

  it('detects PNG from its 8-byte signature', () => {
    expect(sniffImageType(png)).toBe('image/png');
  });

  it('detects WebP from the RIFF....WEBP container tags', () => {
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('returns null for plain text (a non-image with a spoofable Content-Type)', () => {
    expect(sniffImageType(Buffer.from('not an image, just text'))).toBeNull();
  });

  it('returns null for a PDF (magic %PDF-)', () => {
    expect(sniffImageType(Buffer.from('%PDF-1.7\n...'))).toBeNull();
  });

  it('returns null for a RIFF container that is not WebP (e.g. WAV)', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE'),
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a buffer shorter than a full signature', () => {
    // Starts like PNG but is truncated before the 8-byte signature completes.
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
  });
});
