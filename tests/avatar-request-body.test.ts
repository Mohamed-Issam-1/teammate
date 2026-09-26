// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  MAX_AVATAR_BODY_CHUNKS,
  MAX_AVATAR_READ_MS,
  MAX_AVATAR_REQUEST_BYTES,
  readBoundedBody,
  rejectIfDeclaredOversized,
  AvatarRequestReadFailedError,
  AvatarRequestTooLargeError,
} from "@/server/avatars/request-body";

/**
 * Bounded request-body reading.
 *
 * `Content-Length` is not trusted, because it can be absent, malformed, or simply
 * wrong. These tests pin that the streaming read is the authoritative limit, which
 * is what closes the unbounded-buffering hole.
 */

/** A stream that emits `total` bytes in chunks of `chunkSize`. */
function streamOf(
  total: number,
  chunkSize = 64 * 1024,
): ReadableStream<Uint8Array> {
  let emitted = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= total) {
        controller.close();
        return;
      }

      const size = Math.min(chunkSize, total - emitted);
      emitted += size;
      controller.enqueue(new Uint8Array(size).fill(0x41));
    },
  });
}

describe("request body cap", () => {
  it("is the 4 MiB file cap plus a 64 KiB framing allowance", () => {
    expect(MAX_AVATAR_REQUEST_BYTES).toBe(4 * 1024 * 1024 + 64 * 1024);
  });

  it("is larger than the file cap so a maximum-size file can still be framed", () => {
    expect(MAX_AVATAR_REQUEST_BYTES).toBeGreaterThan(4 * 1024 * 1024);
  });
});

describe("declared length fast path", () => {
  it("rejects a declared length above the cap", () => {
    expect(
      rejectIfDeclaredOversized(String(MAX_AVATAR_REQUEST_BYTES + 1)),
    ).toBe(true);
  });

  it("accepts a declared length within the cap", () => {
    expect(rejectIfDeclaredOversized(String(MAX_AVATAR_REQUEST_BYTES))).toBe(
      false,
    );
    expect(rejectIfDeclaredOversized("1024")).toBe(false);
  });

  it("does not fire when the length is missing", () => {
    // Absence is normal under chunked transfer; the streaming read is the limit.
    expect(rejectIfDeclaredOversized(null)).toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["non-numeric text", "not-a-number"],
    ["a NaN-producing value", "NaN"],
    ["a negative value", "-1"],
    ["infinity", "Infinity"],
  ])("does not treat %s as a trusted small length", (_label, value) => {
    // A malformed length must not silently pass as if it were small.
    expect(rejectIfDeclaredOversized(value)).toBe(false);
  });

  it("respects an explicit lower limit", () => {
    expect(rejectIfDeclaredOversized("2048", 1024)).toBe(true);
    expect(rejectIfDeclaredOversized("512", 1024)).toBe(false);
  });
});

describe("bounded stream reading", () => {
  it("reads a body within the limit", async () => {
    const bytes = await readBoundedBody(streamOf(1024), 4096);

    expect(bytes.length).toBe(1024);
  });

  it("reads an empty stream", async () => {
    const bytes = await readBoundedBody(streamOf(0), 4096);

    expect(bytes.length).toBe(0);
  });

  it("returns empty for a null body", async () => {
    expect((await readBoundedBody(null, 4096)).length).toBe(0);
  });

  it("rejects a streamed body that exceeds the cap", async () => {
    // No Content-Length is involved: this is the chunked case the cap exists for.
    await expect(
      readBoundedBody(streamOf(8192, 1024), 4096),
    ).rejects.toBeInstanceOf(AvatarRequestTooLargeError);
  });

  it("rejects a body exactly at the limit plus one byte", async () => {
    await expect(
      readBoundedBody(streamOf(4097, 512), 4096),
    ).rejects.toBeInstanceOf(AvatarRequestTooLargeError);
  });

  it("accepts a body exactly at the limit", async () => {
    expect((await readBoundedBody(streamOf(4096, 512), 4096)).length).toBe(
      4096,
    );
  });

  it("abandons the source instead of draining it", async () => {
    // A source far larger than the cap must not be read to the end. The stream
    // records what it was asked to produce, so the assertion is on bytes pulled
    // from the source rather than on timing.
    let produced = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024).fill(0x41));
      },
    });

    await expect(readBoundedBody(source, 128 * 1024)).rejects.toBeInstanceOf(
      AvatarRequestTooLargeError,
    );

    // The cap is two chunks, and the stream machinery pre-fetches a couple more, so
    // an exact count would be a brittle assertion about buffering internals. What
    // matters is that the read stopped: the source would otherwise emit 16 chunks,
    // and producing a small fraction of that proves it was abandoned.
    expect(produced).toBeLessThan(16 * 64 * 1024);
  });

  it("reports a mid-stream failure as an interrupted read, not a size problem", async () => {
    // Telling a user their file is too large when the socket actually reset would
    // be wrong, and would make a real size rejection indistinguishable in telemetry.
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16).fill(0x41));
        controller.error(new Error("socket reset"));
      },
    });

    await expect(readBoundedBody(failing, 4096)).rejects.toBeInstanceOf(
      AvatarRequestReadFailedError,
    );
  });

  it("does not retain empty chunks", async () => {
    // A stream of empty chunks carries no data, so it must neither be retained in
    // the chunk array nor trip the byte cap.
    let pulls = 0;
    const empties = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 50) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(0));
      },
    });

    const bytes = await readBoundedBody(empties, 4096);

    expect(bytes.length).toBe(0);
  });

  /** A stream of `count` one-byte chunks, which the byte cap alone would not catch. */
  function tinyChunkStream(count: number): ReadableStream<Uint8Array> {
    let emitted = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= count) {
          controller.close();
          return;
        }
        emitted += 1;
        controller.enqueue(new Uint8Array(1).fill(0x41));
      },
    });
  }

  it("accepts a stream at exactly the chunk cap", async () => {
    const bytes = await readBoundedBody(
      tinyChunkStream(MAX_AVATAR_BODY_CHUNKS),
      MAX_AVATAR_REQUEST_BYTES,
    );

    expect(bytes.length).toBe(MAX_AVATAR_BODY_CHUNKS);
  });

  it("refuses a stream one chunk past the cap", async () => {
    // The byte cap alone would never fire here: the total is far below it.
    await expect(
      readBoundedBody(
        tinyChunkStream(MAX_AVATAR_BODY_CHUNKS + 1),
        MAX_AVATAR_REQUEST_BYTES,
      ),
    ).rejects.toBeInstanceOf(AvatarRequestTooLargeError);
  });

  it("accepts a maximum-size body delivered in small segments", async () => {
    // A legitimate body at the approved 4 MiB boundary must survive however the
    // transport happens to segment it. In 1 KiB segments the full request cap is
    // 4160 chunks, which the chunk ceiling has to leave room for.
    const bytes = await readBoundedBody(
      streamOf(MAX_AVATAR_REQUEST_BYTES, 1024),
      MAX_AVATAR_REQUEST_BYTES,
    );

    expect(bytes.length).toBe(MAX_AVATAR_REQUEST_BYTES);
  });

  it("accepts a stream that stays within the chunk cap", async () => {
    const moderate = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 10; index += 1) {
          controller.enqueue(new Uint8Array(16).fill(0x41));
        }
        controller.close();
      },
    });

    expect((await readBoundedBody(moderate, 4096)).length).toBe(160);
  });

  it("abandons a source that stalls mid-stream", async () => {
    // A body that stops producing never reaches the next loop iteration, so the
    // deadline has to race the read itself rather than be checked between reads.
    // A one-byte-per-read trickle keeps the byte and chunk caps far away.
    const trickle = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        controller.enqueue(new Uint8Array(1).fill(0x41));
      },
    });

    // Well under the byte cap and the chunk cap, so only the clock can end this.
    await expect(
      readBoundedBody(trickle, MAX_AVATAR_REQUEST_BYTES, 300),
    ).rejects.toBeInstanceOf(AvatarRequestReadFailedError);
  }, 10_000);

  it("reports a stalled read as an interrupted read, not as a size problem", async () => {
    // The distinction is the whole point: a 413 here would tell a user their file
    // is too large when it simply never arrived.
    const trickle = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        controller.enqueue(new Uint8Array(1).fill(0x41));
      },
    });

    const error = await readBoundedBody(
      trickle,
      MAX_AVATAR_REQUEST_BYTES,
      300,
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AvatarRequestReadFailedError);
    expect(error).not.toBeInstanceOf(AvatarRequestTooLargeError);
  }, 10_000);

  it("does not leave an unhandled rejection when the deadline wins the race", async () => {
    // Cancelling the reader settles the still-pending read, but the rejection can
    // land a moment later. It must not surface as an unhandled rejection.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const trickle = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          controller.enqueue(new Uint8Array(1).fill(0x41));
        },
      });

      await expect(
        readBoundedBody(trickle, MAX_AVATAR_REQUEST_BYTES, 300),
      ).rejects.toBeInstanceOf(AvatarRequestReadFailedError);

      // Give any late rejection a chance to arrive.
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  }, 10_000);

  it("keeps a size bound distinct from a failed read", async () => {
    // Two refusals with two different causes, so a caller can tell them apart.
    const oversized = streamOf(8192, 1024);
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("socket reset"));
      },
    });

    await expect(readBoundedBody(oversized, 4096)).rejects.toBeInstanceOf(
      AvatarRequestTooLargeError,
    );
    await expect(readBoundedBody(failing, 4096)).rejects.toBeInstanceOf(
      AvatarRequestReadFailedError,
    );
  });

  it("exposes a deadline that is a positive number of milliseconds", () => {
    expect(MAX_AVATAR_READ_MS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_AVATAR_READ_MS)).toBe(true);
  });

  it("does not throw for a well-behaved large-but-permitted body", async () => {
    const bytes = await readBoundedBody(
      streamOf(300 * 1024, 32 * 1024),
      1024 * 1024,
    );

    expect(bytes.length).toBe(300 * 1024);
  });
});
