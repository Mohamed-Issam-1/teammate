import "server-only";

import sharp, { type Metadata } from "sharp";

/**
 * Avatar upload validation and normalization.
 *
 * The stored avatar is always the WebP produced here, never the bytes the client
 * sent. That is what makes the rest of the system safe: by the time anything
 * touches storage or a browser, the payload has already been decoded by a real
 * image library, re-encoded, stripped of metadata, and bounded in size.
 *
 * The filename and the browser-supplied `Content-Type` are never treated as
 * evidence of anything. Only the format the decoder actually reports counts.
 */

/** Hard cap on the ORIGINAL upload, checked before any decoding work. */
export const MAX_AVATAR_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Longest edge of the stored avatar. */
export const AVATAR_MAX_DIMENSION = 512;

/** WebP quality for the stored avatar. */
export const AVATAR_WEBP_QUALITY = 82;

/** Formats the decoder is allowed to report. */
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

/**
 * Upper bound on decoded pixels.
 *
 * A small file can declare enormous dimensions, and libvips would try to
 * allocate for them. This caps that well above any plausible avatar while still
 * refusing a decompression bomb before it becomes a memory problem.
 */
const MAX_INPUT_PIXELS = 40_000_000;

export type ProcessedAvatar = {
  webp: Buffer;
  width: number;
  height: number;
};

export class AvatarEmptyError extends Error {
  constructor() {
    super("The uploaded file was empty.");
    this.name = "AvatarEmptyError";
  }
}

export class AvatarTooLargeError extends Error {
  constructor() {
    super("The uploaded file exceeded the maximum size.");
    this.name = "AvatarTooLargeError";
  }
}

export class AvatarUnsupportedFormatError extends Error {
  constructor() {
    super("The uploaded file is not a supported image.");
    this.name = "AvatarUnsupportedFormatError";
  }
}

export class AvatarUndecodableError extends Error {
  constructor() {
    super("The uploaded file could not be decoded as an image.");
    this.name = "AvatarUndecodableError";
  }
}

export class AvatarAnimatedError extends Error {
  constructor() {
    super("Animated or multi-page images are not supported.");
    this.name = "AvatarAnimatedError";
  }
}

/**
 * Validate and normalize an uploaded avatar.
 *
 * Order matters: the size and emptiness checks run on the raw buffer before any
 * decode, so an oversized or empty upload costs nothing. Only then is the buffer
 * handed to libvips, and the format is taken from what the decoder reports rather
 * than from any header the client supplied.
 *
 * The output is WebP, orientation-normalized, bounded to
 * {@link AVATAR_MAX_DIMENSION} on the longest edge, never enlarged beyond its
 * original size, and re-encoded from scratch so EXIF, GPS, and any other metadata
 * in the source is dropped rather than copied.
 */
export async function processAvatarUpload(
  bytes: Buffer,
): Promise<ProcessedAvatar> {
  if (bytes.length === 0) {
    throw new AvatarEmptyError();
  }

  if (bytes.length > MAX_AVATAR_UPLOAD_BYTES) {
    throw new AvatarTooLargeError();
  }

  let metadata: Metadata;

  try {
    metadata = await sharp(bytes, {
      // Refuse truncated or corrupt input rather than decoding what it can.
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      // Never honour a larger declared page count than we are willing to decode.
      unlimited: false,
    }).metadata();
  } catch {
    throw new AvatarUndecodableError();
  }

  if (
    typeof metadata.format !== "string" ||
    !ALLOWED_FORMATS.has(metadata.format)
  ) {
    // This is what rejects SVG: libvips will happily rasterize it, and an SVG can
    // carry script, so it is refused on the decoded format rather than trusted.
    throw new AvatarUnsupportedFormatError();
  }

  // Animated WebP and multi-page inputs report more than one page. Refusing them
  // keeps the stored file a single static frame and bounds decode cost.
  if (typeof metadata.pages === "number" && metadata.pages > 1) {
    throw new AvatarAnimatedError();
  }

  if (
    typeof metadata.width !== "number" ||
    typeof metadata.height !== "number" ||
    metadata.width < 1 ||
    metadata.height < 1
  ) {
    throw new AvatarUndecodableError();
  }

  try {
    const { data, info } = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      // Apply EXIF orientation, then discard it: re-encoding below writes a fresh
      // container that carries none of the original metadata.
      .rotate()
      .resize(AVATAR_MAX_DIMENSION, AVATAR_MAX_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: AVATAR_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return { webp: data, width: info.width, height: info.height };
  } catch {
    throw new AvatarUndecodableError();
  }
}
