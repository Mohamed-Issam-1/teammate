// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-ordering regression for the two confirmed HIGH findings.
 *
 * H1: image bytes were decoded before the session was resolved, so any caller who
 * could satisfy the same-origin check could make the server decode an image. The
 * capability check must now happen before the body is read, before the form is
 * parsed, and before sharp runs.
 *
 * H2: the body was buffered with only a `Content-Length` pre-check. The streaming
 * read is now the authoritative limit.
 *
 * These tests assert the *order* by making each downstream stage observable and
 * proving the earlier ones are never reached for a refused caller.
 */

const capabilityMock = vi.hoisted(() => ({
  requireCurrentOwnAvatarCapability: vi.fn(),
  saveCurrentOwnAvatar: vi.fn(),
  removeCurrentOwnAvatar: vi.fn(),
}));

const imageMock = vi.hoisted(() => ({ processAvatarUpload: vi.fn() }));

const boundaryMock = vi.hoisted(() => ({ getAvatarStorage: vi.fn() }));

vi.mock("@/server/avatars/current-avatar", () => capabilityMock);
vi.mock("@/server/avatars/image", async () => {
  // Keep the real constants and error classes; only spy on the decode.
  const actual = await vi.importActual<typeof import("@/server/avatars/image")>(
    "@/server/avatars/image",
  );
  return { ...actual, processAvatarUpload: imageMock.processAvatarUpload };
});
vi.mock("@/server/avatars/current-avatar-storage", () => boundaryMock);

import { POST } from "@/app/api/profile/avatar/route";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";
import { AvatarNotOnboardedError } from "@/server/avatars/own-avatar";
import {
  AvatarRequestReadFailedError,
  AvatarRequestTooLargeError,
} from "@/server/avatars/request-body";
import { AvatarStorageOperationError } from "@/server/avatars/storage";

const ORIGIN = "http://localhost:3100";
const ENDPOINT = "http://localhost:3100/api/profile/avatar";

/**
 * A request whose body records whether the route tried to read it.
 *
 * `getReader` is what gets measured, because that is exactly what the bounded
 * reader calls. The stream is attached after construction rather than passed in,
 * because building a `Request` around a stream pulls from it eagerly, which would
 * make the measurement meaningless.
 */
function requestWithTrackedBody(
  bytes: Buffer,
  options: { contentType?: string; contentLength?: string } = {},
) {
  let reads = 0;
  let emitted = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= bytes.length) {
        controller.close();
        return;
      }
      const slice = bytes.subarray(
        emitted,
        Math.min(emitted + 8192, bytes.length),
      );
      emitted += slice.length;
      controller.enqueue(new Uint8Array(slice));
    },
  });

  const tracking = {
    getReader: () => {
      reads += 1;
      return stream.getReader();
    },
    cancel: (reason: unknown) => stream.cancel(reason),
    get locked() {
      return stream.locked;
    },
  };

  const headers: Record<string, string> = { origin: ORIGIN };
  if (options.contentType !== undefined) {
    headers["content-type"] = options.contentType;
  }
  if (options.contentLength !== undefined) {
    headers["content-length"] = options.contentLength;
  }

  const request = new Request(ENDPOINT, { method: "POST", headers });

  Object.defineProperty(request, "body", {
    value: tracking,
    configurable: true,
  });

  return {
    request,
    get reads() {
      return reads;
    },
  };
}

/** A request whose body is real `FormData`, so the boundary always matches. */
function formDataRequest(form: FormData): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { origin: ORIGIN },
    body: form,
  });
}

function tinyPngForm(extra?: Record<string, string>): FormData {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
      type: "image/png",
    }),
  );
  for (const [key, value] of Object.entries(extra ?? {})) {
    form.append(key, value);
  }
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  capabilityMock.requireCurrentOwnAvatarCapability.mockResolvedValue(undefined);
  capabilityMock.saveCurrentOwnAvatar.mockResolvedValue({
    avatarUrl: "/avatars/3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  });
  imageMock.processAvatarUpload.mockResolvedValue({
    webp: Buffer.from([1, 2, 3]),
    width: 32,
    height: 32,
  });
  boundaryMock.getAvatarStorage.mockReturnValue({
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  });
  process.env.BETTER_AUTH_URL = ORIGIN;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("H1: authorization precedes body and image work", () => {
  it.each([
    ["unauthenticated", new AuthenticationRequiredError()],
    ["unverified", new EmailVerificationRequiredError()],
    ["not onboarded", new AvatarNotOnboardedError()],
  ])("rejects an %s caller before reading the body", async (_label, error) => {
    const body = requestWithTrackedBody(Buffer.from("--x\r\n\r\n--x--\r\n"), {
      contentType: "multipart/form-data; boundary=x",
    });
    capabilityMock.requireCurrentOwnAvatarCapability.mockRejectedValue(error);

    const response = await POST(body.request);

    expect(response.status).toBeGreaterThanOrEqual(400);
    // The body was never read, the form was never parsed, and the image was never
    // decoded.
    expect(body.reads).toBe(0);
    expect(imageMock.processAvatarUpload).not.toHaveBeenCalled();
    expect(boundaryMock.getAvatarStorage).not.toHaveBeenCalled();
    expect(capabilityMock.saveCurrentOwnAvatar).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin caller before the capability check", async () => {
    const response = await POST(
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "multipart/form-data; boundary=x",
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(
      capabilityMock.requireCurrentOwnAvatarCapability,
    ).not.toHaveBeenCalled();
    expect(imageMock.processAvatarUpload).not.toHaveBeenCalled();
  });

  it("never exposes a raw error message for a refused caller", async () => {
    capabilityMock.requireCurrentOwnAvatarCapability.mockRejectedValue(
      new AuthenticationRequiredError(),
    );

    const response = await POST(
      requestWithTrackedBody(Buffer.from("x"), {
        contentType: "multipart/form-data; boundary=x",
      }).request,
    );
    const text = await response.text();

    expect(text).not.toContain("Authentication required");
    expect(JSON.parse(text)).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("H2: the body read is bounded", () => {
  it("rejects an oversized streamed body before any image processing", async () => {
    // No Content-Length is involved: this is the chunked case the cap exists for.
    const body = requestWithTrackedBody(Buffer.alloc(5 * 1024 * 1024, 0x41), {
      contentType: "multipart/form-data; boundary=x",
    });

    const response = await POST(body.request);

    expect(response.status).toBe(413);
    expect(imageMock.processAvatarUpload).not.toHaveBeenCalled();
    expect(capabilityMock.saveCurrentOwnAvatar).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized length before reading the body", async () => {
    const body = requestWithTrackedBody(Buffer.from("x"), {
      contentType: "multipart/form-data; boundary=x",
      contentLength: String(64 * 1024 * 1024),
    });

    const response = await POST(body.request);

    expect(response.status).toBe(413);
    expect(body.reads).toBe(0);
    expect(imageMock.processAvatarUpload).not.toHaveBeenCalled();
  });

  it("does not trust a malformed declared length", async () => {
    const body = requestWithTrackedBody(Buffer.from("--x\r\n\r\n--x--\r\n"), {
      contentType: "multipart/form-data; boundary=x",
      contentLength: "not-a-number",
    });

    // The malformed header is ignored rather than treated as small, so the
    // streaming read still applies and the body is actually read.
    const response = await POST(body.request);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(body.reads).toBeGreaterThan(0);
  });

  it("rejects a request within the cap whose file exceeds 4 MiB", async () => {
    const file = Buffer.alloc(4 * 1024 * 1024 + 1024, 0x41);
    const form = new FormData();
    form.append("file", new File([file], "big.png", { type: "image/png" }));

    const response = await POST(formDataRequest(form));

    // Either the request cap or the file cap refuses it; both precede decoding.
    expect(response.status).toBe(413);
    expect(imageMock.processAvatarUpload).not.toHaveBeenCalled();
    expect(capabilityMock.saveCurrentOwnAvatar).not.toHaveBeenCalled();
  });

  it("reports an oversized body as a size problem, not a decode failure", async () => {
    const response = await POST(
      requestWithTrackedBody(Buffer.alloc(4 * 1024 * 1024 + 128 * 1024, 0x41), {
        contentType: "multipart/form-data; boundary=x",
      }).request,
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "FILE_TOO_LARGE" },
    });
  });
});

describe("authorized happy path still works", () => {
  it("processes and saves after the capability check passes", async () => {
    const response = await POST(formDataRequest(tinyPngForm()));

    expect(response.status).toBe(200);
    expect(
      capabilityMock.requireCurrentOwnAvatarCapability,
    ).toHaveBeenCalledTimes(1);
    expect(imageMock.processAvatarUpload).toHaveBeenCalledTimes(1);
    expect(capabilityMock.saveCurrentOwnAvatar).toHaveBeenCalledTimes(1);
  });

  it("refuses extra fields after the capability check", async () => {
    const response = await POST(
      formDataRequest(tinyPngForm({ userId: "someone-else" })),
    );

    expect(response.status).toBe(400);
    expect(imageMock.processAvatarUpload).not.toHaveBeenCalled();
    expect(capabilityMock.saveCurrentOwnAvatar).not.toHaveBeenCalled();
  });

  it("refuses a non-multipart content type", async () => {
    const response = await POST(
      new Request(ENDPOINT, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(415);
    expect(capabilityMock.saveCurrentOwnAvatar).not.toHaveBeenCalled();
  });

  it("refuses a multipart body with no boundary", async () => {
    const response = await POST(
      requestWithTrackedBody(Buffer.from("x"), {
        contentType: "multipart/form-data",
      }).request,
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(capabilityMock.saveCurrentOwnAvatar).not.toHaveBeenCalled();
  });
});

describe("error mapping never leaks provider or library detail", () => {
  it("maps a storage failure to a 503 without provider detail", async () => {
    capabilityMock.saveCurrentOwnAvatar.mockRejectedValue(
      new AvatarStorageOperationError(),
    );

    const response = await POST(formDataRequest(tinyPngForm()));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain("AvatarStorageOperationError");
    expect(text).not.toContain("bucket");
  });

  it("maps an unexpected failure to one generic 500", async () => {
    capabilityMock.saveCurrentOwnAvatar.mockRejectedValue(
      new Error("prisma: connection postgresql://user:secret@host/db failed"),
    );

    const response = await POST(formDataRequest(tinyPngForm()));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("prisma");
    expect(text).not.toContain("postgresql://");
    expect(text).not.toContain("secret");
  });

  it("maps an interrupted read to 400, not to a size rejection", async () => {
    // A 413 here would tell a legitimate user their file is too large when it
    // simply never arrived, and would make a real size rejection unidentifiable
    // in telemetry.
    capabilityMock.requireCurrentOwnAvatarCapability.mockRejectedValue(
      new AvatarRequestReadFailedError(),
    );

    const response = await POST(
      requestWithTrackedBody(Buffer.from("x"), {
        contentType: "multipart/form-data; boundary=x",
      }).request,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "UPLOAD_INTERRUPTED" },
    });
  });

  it("accepts a multipart boundary that legitimately contains a semicolon", async () => {
    // The content type is forwarded verbatim rather than reconstructed. Rebuilding
    // it would strip the quotes, so the parser would see boundary "a" while the
    // body is delimited by "a;b", and a valid upload would be refused.
    const boundary = "a;b";
    const payload = Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="a.png"\r\n' +
        "Content-Type: image/png\r\n\r\n" +
        "PNGBYTES" +
        `\r\n--${boundary}--\r\n`,
      "utf8",
    );

    const response = await POST(
      requestWithTrackedBody(payload, {
        contentType: `multipart/form-data; boundary="${boundary}"`,
      }).request,
    );

    expect(response.status).toBe(200);
    expect(imageMock.processAvatarUpload).toHaveBeenCalledTimes(1);
  });

  it("maps the bounded-read error to a user-facing size message", async () => {
    capabilityMock.requireCurrentOwnAvatarCapability.mockRejectedValue(
      new AvatarRequestTooLargeError(),
    );

    const response = await POST(
      requestWithTrackedBody(Buffer.from("x"), {
        contentType: "multipart/form-data; boundary=x",
      }).request,
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "FILE_TOO_LARGE" },
    });
  });
});
