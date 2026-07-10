import type { PhotoContentType } from '@mat-inspect/shared-schemas';

// Content-based image detection. The Media Service handles binary uploads, a different attack
// surface from the JSON APIs (ARCHITECTURE.md 5), so it must not trust the client-declared
// Content-Type or filename: a request can label a script or a zip as image/jpeg. These functions
// inspect the file's leading bytes (its "magic number") to decide what it actually is. The
// detected type, not the declared one, is what gets stored on the blob and returned to the client.

// Returns true when buf's bytes at offset match sig exactly.
const matchesAt = (buf: Buffer, sig: readonly number[], offset = 0): boolean =>
  buf.length >= offset + sig.length && sig.every((byte, i) => buf[offset + i] === byte);

// JPEG streams start with the Start Of Image marker FF D8 FF.
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

// PNG files start with the 8-byte signature 89 50 4E 47 0D 0A 1A 0A ("\x89PNG\r\n\x1a\n").
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

// WebP is a RIFF container: bytes 0-3 are "RIFF", bytes 4-7 are the file size, bytes 8-11 are
// "WEBP". Checking both the RIFF prefix and the WEBP tag rules out other RIFF formats (WAV, AVI).
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP"

// Returns the actual image content type of buf, or null when buf is not a supported image. Null
// is the reject signal for the upload route (415). Only JPEG, PNG, and WebP are supported per the
// DEV-32 decision; HEIC and others are out of scope.
export const sniffImageType = (buf: Buffer): PhotoContentType | null => {
  if (matchesAt(buf, JPEG_SIGNATURE)) return 'image/jpeg';
  if (matchesAt(buf, PNG_SIGNATURE)) return 'image/png';
  if (matchesAt(buf, RIFF_SIGNATURE) && matchesAt(buf, WEBP_TAG, 8)) return 'image/webp';
  return null;
};
