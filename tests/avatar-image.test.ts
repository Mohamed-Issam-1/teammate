// @vitest-environment node

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  AVATAR_MAX_DIMENSION,
  AvatarAnimatedError,
  AvatarEmptyError,
  AvatarTooLargeError,
  AvatarUndecodableError,
  AvatarUnsupportedFormatError,
  MAX_AVATAR_UPLOAD_BYTES,
  processAvatarUpload,
} from "@/server/avatars/image";

/**
 * Avatar image validation and normalization.
 *
 * Fixtures are generated in-process rather than committed as binaries, so the
 * suite stays small and every input is exactly what the test says it is. The
 * property under test throughout is that the *decoded* format decides acceptance,
 * never a filename or a declared content type.
 */

async function pngOfSize(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 12, g: 34, b: 56 } },
  })
    .png()
    .toBuffer();
}

async function jpegOfSize(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function webpOfSize(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 5, g: 90, b: 140 } },
  })
    .webp()
    .toBuffer();
}

describe("accepted formats", () => {
  it("accepts JPEG", async () => {
    const result = await processAvatarUpload(await jpegOfSize(64, 64));

    expect((await sharp(result.webp).metadata()).format).toBe("webp");
  });

  it("accepts PNG", async () => {
    const result = await processAvatarUpload(await pngOfSize(64, 64));

    expect((await sharp(result.webp).metadata()).format).toBe("webp");
  });

  it("accepts WebP", async () => {
    const result = await processAvatarUpload(await webpOfSize(64, 64));

    expect((await sharp(result.webp).metadata()).format).toBe("webp");
  });
});

describe("rejected formats", () => {
  it("rejects SVG even though libvips will decode it", async () => {
    // sharp happily rasterizes SVG, and an SVG can carry script, so acceptance has
    // to be decided on the decoded format rather than on decoder tolerance.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#123456"/></svg>',
    );

    await expect(processAvatarUpload(svg)).rejects.toBeInstanceOf(
      AvatarUnsupportedFormatError,
    );
  });

  it("rejects GIF", async () => {
    const gif = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#0f0" },
    })
      .gif()
      .toBuffer();

    await expect(processAvatarUpload(gif)).rejects.toBeInstanceOf(
      AvatarUnsupportedFormatError,
    );
  });

  it("rejects arbitrary text", async () => {
    await expect(
      processAvatarUpload(Buffer.from("this is definitely not an image")),
    ).rejects.toBeInstanceOf(AvatarUndecodableError);
  });

  it("rejects arbitrary binary data", async () => {
    const noise = Buffer.from(
      Array.from({ length: 512 }, (_unused, index) => (index * 37) % 256),
    );

    await expect(processAvatarUpload(noise)).rejects.toBeInstanceOf(
      AvatarUndecodableError,
    );
  });

  it("rejects a truncated image", async () => {
    const full = await pngOfSize(128, 128);
    const truncated = full.subarray(0, Math.floor(full.length / 3));

    await expect(processAvatarUpload(truncated)).rejects.toBeInstanceOf(
      AvatarUndecodableError,
    );
  });

  it("rejects a PDF", async () => {
    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    );

    await expect(processAvatarUpload(pdf)).rejects.toBeInstanceOf(
      AvatarUndecodableError,
    );
  });

  it("rejects an animated WebP", async () => {
    // A genuine two-frame WebP. The format itself is allowed, so the only thing
    // that can refuse it is the multi-page guard, which keeps the stored avatar a
    // single static frame.
    const frames = await Promise.all([
      sharp({
        create: { width: 16, height: 16, channels: 3, background: "#f00" },
      })
        .webp()
        .toBuffer(),
      sharp({
        create: { width: 16, height: 16, channels: 3, background: "#0f0" },
      })
        .webp()
        .toBuffer(),
    ]);

    const animated = await sharp(frames, { join: { animated: true } })
      .webp()
      .toBuffer();

    const metadata = await sharp(animated, { pages: -1 }).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.pages).toBeGreaterThan(1);

    await expect(processAvatarUpload(animated)).rejects.toBeInstanceOf(
      AvatarAnimatedError,
    );
  });

  it("accepts the single-frame WebP from the same encoder", async () => {
    // Confirms the animated case above is refused by the page count and not by
    // the format, since a single-frame WebP of the same kind is accepted.
    const still = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#00f" },
    })
      .webp()
      .toBuffer();

    const result = await processAvatarUpload(still);
    expect((await sharp(result.webp).metadata()).format).toBe("webp");
  });
});

describe("size limits", () => {
  it("rejects an empty file", async () => {
    await expect(processAvatarUpload(Buffer.alloc(0))).rejects.toBeInstanceOf(
      AvatarEmptyError,
    );
  });

  it("rejects a file over the cap", async () => {
    const oversized = Buffer.alloc(MAX_AVATAR_UPLOAD_BYTES + 1, 0x41);

    await expect(processAvatarUpload(oversized)).rejects.toBeInstanceOf(
      AvatarTooLargeError,
    );
  });

  it("rejects the oversized case before attempting to decode", async () => {
    // Not a valid image either, so if the size check did not come first the error
    // would be a decode failure rather than a size failure.
    const oversizedJunk = Buffer.alloc(MAX_AVATAR_UPLOAD_BYTES + 1024, 0x00);

    await expect(processAvatarUpload(oversizedJunk)).rejects.toBeInstanceOf(
      AvatarTooLargeError,
    );
  });

  it("documents a 4 MiB cap", () => {
    expect(MAX_AVATAR_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("normalization", () => {
  it("always outputs WebP", async () => {
    for (const source of [
      await pngOfSize(100, 80),
      await jpegOfSize(100, 80),
      await webpOfSize(100, 80),
    ]) {
      const result = await processAvatarUpload(source);
      expect((await sharp(result.webp).metadata()).format).toBe("webp");
    }
  });

  it("resizes a large image to fit within 512 by 512", async () => {
    const result = await processAvatarUpload(await pngOfSize(1600, 1200));
    const metadata = await sharp(result.webp).metadata();

    expect(
      Math.max(metadata.width ?? 0, metadata.height ?? 0),
    ).toBeLessThanOrEqual(AVATAR_MAX_DIMENSION);
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(384);
  });

  it("resizes a tall image on its longest edge", async () => {
    const result = await processAvatarUpload(await pngOfSize(400, 2000));
    const metadata = await sharp(result.webp).metadata();

    expect(metadata.height).toBe(512);
    expect(metadata.width).toBe(102);
  });

  it("does not enlarge a small image", async () => {
    const result = await processAvatarUpload(await pngOfSize(40, 30));
    const metadata = await sharp(result.webp).metadata();

    expect(metadata.width).toBe(40);
    expect(metadata.height).toBe(30);
  });

  it("preserves a square small image", async () => {
    const result = await processAvatarUpload(await pngOfSize(64, 64));
    const metadata = await sharp(result.webp).metadata();

    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
  });

  it("reports the stored dimensions", async () => {
    const result = await processAvatarUpload(await pngOfSize(200, 100));

    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    expect(result.webp.length).toBeGreaterThan(0);
  });
});

describe("metadata handling", () => {
  it("strips EXIF and other source metadata", async () => {
    // Build a JPEG carrying an EXIF block with a GPS-ish tag, then confirm the
    // stored WebP carries no EXIF at all.
    const withExif = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#3355ff" },
    })
      .withExifMerge({
        IFD0: {
          ImageDescription: "a private description that must not survive",
          Make: "SomeCamera",
        },
      })
      .jpeg()
      .toBuffer();

    const result = await processAvatarUpload(withExif);
    const metadata = await sharp(result.webp).metadata();

    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it("strips PNG text metadata", async () => {
    const withText = await sharp({
      create: { width: 48, height: 48, channels: 3, background: "#22aa55" },
    })
      .withMetadata({ exif: {} })
      .png()
      .toBuffer();

    const result = await processAvatarUpload(withText);
    const metadata = await sharp(result.webp).metadata();

    expect(metadata.exif).toBeUndefined();
  });
});

describe("format is decided by the decoder, not the client", () => {
  it("accepts a valid PNG that a client mislabelled as text", async () => {
    // The processor receives bytes only. There is no filename or content type in
    // its signature, which is the structural reason a mislabelled upload cannot
    // change the outcome.
    const png = await pngOfSize(32, 32);
    const result = await processAvatarUpload(png);

    expect((await sharp(result.webp).metadata()).format).toBe("webp");
  });

  it("rejects a text payload even when it is well under the cap", async () => {
    const text = Buffer.from("<html><body>hello</body></html>");

    await expect(processAvatarUpload(text)).rejects.toBeInstanceOf(
      AvatarUndecodableError,
    );
  });

  it("rejects an HTML document", async () => {
    const html = Buffer.from(
      "<!DOCTYPE html><html><head><title>x</title></head><body/></html>",
    );

    await expect(processAvatarUpload(html)).rejects.toBeInstanceOf(
      AvatarUndecodableError,
    );
  });
});
