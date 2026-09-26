import "server-only";

/**
 * Bounded request-body reading.
 *
 * `Content-Length` is not a limit. It can be absent (chunked transfer, or HTTP/2
 * without a length), malformed, or simply wrong, and an App Router route handler
 * applies no default body cap of its own. Relying on it would let a caller stream
 * an unbounded body into memory before any size check ran.
 *
 * So the body is read as a stream and counted as it arrives, and the read is
 * abandoned the moment the cap is passed. Bytes past the cap are never
 * accumulated.
 */

/** The original file cap, restated here so the two cannot drift apart. */
const MAX_AVATAR_UPLOAD_BYTES_FOR_REQUEST = 4 * 1024 * 1024;

/**
 * Smallest sensible multipart framing allowance above the file cap.
 *
 * The part headers, the boundary delimiter, and the trailing CRLF all count
 * toward the request size, so the request limit cannot be identical to the file
 * limit. 64 KiB is far more than any realistic framing overhead for a single
 * small part while keeping the total bounded and predictable.
 */
export const MAX_AVATAR_REQUEST_BYTES =
  MAX_AVATAR_UPLOAD_BYTES_FOR_REQUEST + 64 * 1024;

/** The body exceeded a size or chunk-count bound. */
export class AvatarRequestTooLargeError extends Error {
  constructor() {
    super("The upload request exceeded the maximum size.");
    this.name = "AvatarRequestTooLargeError";
  }
}

/**
 * Reject an obviously oversized body before reading it, when a length is declared.
 *
 * A fast path only. A missing, malformed, or dishonest header is handled by the
 * streaming read, which is the authoritative limit. A non-numeric value is
 * deliberately *not* treated as a trusted length.
 */
export function rejectIfDeclaredOversized(
  declaredLength: string | null,
  limit: number = MAX_AVATAR_REQUEST_BYTES,
): boolean {
  if (declaredLength === null) {
    return false;
  }

  const parsed = Number(declaredLength);

  // `NaN` fails this comparison, so a malformed length falls through to the
  // streaming read rather than being silently accepted as small.
  if (!Number.isFinite(parsed) || parsed < 0) {
    return false;
  }

  return parsed > limit;
}

/**
 * The body could not be read to completion.
 *
 * A disconnect, a proxy reset, a truncated upload, and a stalled stream are all
 * distinct from an oversized one. Reporting them as a size problem would tell a
 * legitimate user the wrong thing and would make a real size rejection
 * indistinguishable in telemetry.
 */
export class AvatarRequestReadFailedError extends Error {
  constructor() {
    super("The upload could not be read.");
    this.name = "AvatarRequestReadFailedError";
  }
}

/**
 * Ceiling on the number of chunks retained from a request body.
 *
 * The byte cap alone is not sufficient: a caller can send a very large number of
 * minimal chunks whose summed length never approaches the byte cap, and each
 * retained `Uint8Array` costs far more in object overhead than its payload. Empty
 * chunks are never retained at all, and this bounds everything else.
 *
 * The value has to accommodate a *legitimate* body at the approved 4 MiB boundary
 * arriving in small segments, because rejecting a valid maximum-size upload would
 * be a bug of its own. 4 MiB in 1 KiB segments is 4096 chunks, so this leaves
 * headroom for a maximum-size upload while still bounding the array to a few
 * thousand entries.
 */
export const MAX_AVATAR_BODY_CHUNKS = 8192;

/**
 * Wall-clock ceiling on reading a request body.
 *
 * A stream can also pend indefinitely, which no byte or chunk count would catch.
 * The deadline is enforced by racing each read against a timer rather than by
 * checking the clock between reads, so a body that stops producing mid-stream is
 * still abandoned.
 */
export const MAX_AVATAR_READ_MS = 15_000;

/**
 * Read at most `limit` bytes from a request body stream.
 *
 * Bytes are counted as they arrive and the check happens *before* the chunk is
 * retained, so the chunk that crosses the cap is never accumulated. Empty chunks
 * are dropped rather than stored, the chunk count is separately bounded, and each
 * read races a deadline, so neither a long nor a stalled stream can hold memory.
 *
 * @param limit    Ceiling on total buffered bytes.
 * @param maxMs    Wall-clock ceiling on the whole read. Overridable so tests need
 *                 not spend the production deadline in real time.
 *
 * @throws {AvatarRequestTooLargeError} when the body exceeds a size or chunk bound
 * @throws {AvatarRequestReadFailedError} when the stream fails or stalls
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number = MAX_AVATAR_REQUEST_BYTES,
  maxMs: number = MAX_AVATAR_READ_MS,
): Promise<Buffer> {
  if (body === null) {
    return Buffer.alloc(0);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + maxMs;
  let total = 0;

  /** Stop the source and report why the read ended. */
  const abandon = async (reason: Error): Promise<never> => {
    await reader.cancel().catch(() => undefined);
    throw reason;
  };

  /**
   * One read, bounded in wall-clock time.
   *
   * Racing the read rather than polling the clock between iterations is what makes
   * a stalled source abandonable: a body that simply stops producing never reaches
   * the next loop iteration, so a between-reads check would never fire.
   */
  const readWithinDeadline = async (): Promise<
    ReadableStreamReadResult<Uint8Array>
  > => {
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      throw new AvatarRequestReadFailedError();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new AvatarRequestReadFailedError()),
        remaining,
      );
    });

    // The read may still be pending when the timer wins. Cancelling the reader
    // settles it, but an explicit handler keeps a late rejection from becoming an
    // unhandled rejection in the meantime.
    const read = reader.read();
    read.catch(() => undefined);

    try {
      return await Promise.race([read, expiry]);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    for (;;) {
      const { done, value } = await readWithinDeadline();

      if (done) {
        break;
      }

      // An empty chunk carries no data, so retaining it would cost a slot in the
      // array for nothing.
      if (value === undefined || value.byteLength === 0) {
        continue;
      }

      if (chunks.length >= MAX_AVATAR_BODY_CHUNKS) {
        return await abandon(new AvatarRequestTooLargeError());
      }

      total += value.byteLength;

      // Check before accumulating, so the chunk that crosses the cap is never
      // retained.
      if (total > limit) {
        return await abandon(new AvatarRequestTooLargeError());
      }

      chunks.push(value);
    }
  } catch (error) {
    // A size bound keeps its own identity, so the caller can distinguish "too
    // large" from "did not arrive". Everything else is a failed read.
    if (error instanceof AvatarRequestTooLargeError) {
      return await abandon(error);
    }

    return await abandon(
      error instanceof AvatarRequestReadFailedError
        ? error
        : new AvatarRequestReadFailedError(),
    );
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}
