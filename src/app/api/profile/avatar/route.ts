import { NextResponse } from "next/server";

import {
  assertSameOriginMutation,
  CrossOriginRequestError,
  isMultipartFormData,
} from "@/server/avatars/origin";
import {
  AvatarAnimatedError,
  AvatarEmptyError,
  AvatarTooLargeError,
  AvatarUndecodableError,
  AvatarUnsupportedFormatError,
  MAX_AVATAR_UPLOAD_BYTES,
  processAvatarUpload,
} from "@/server/avatars/image";
import {
  AvatarRequestReadFailedError,
  AvatarRequestTooLargeError,
  readBoundedBody,
  rejectIfDeclaredOversized,
} from "@/server/avatars/request-body";
import {
  removeCurrentOwnAvatar,
  requireCurrentOwnAvatarCapability,
  saveCurrentOwnAvatar,
} from "@/server/avatars/current-avatar";
import { AvatarNotOnboardedError } from "@/server/avatars/own-avatar";
import {
  AvatarStorageOperationError,
  AvatarStorageUnavailableError,
} from "@/server/avatars/storage";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";

/**
 * Own-avatar upload endpoint.
 *
 * A dedicated route handler rather than a Server Action, because Server Actions
 * carry a body-size limit well below the 4 MiB this endpoint accepts. Changing
 * that limit globally would relax it for every action in the application to serve
 * one endpoint, so the upload gets its own transport instead.
 *
 * The surface is intentionally minimal. It accepts `multipart/form-data` with a
 * single file field and nothing else, so there is no place for a client to submit
 * a user id, a URL, a storage key, or a bucket name. Identity comes from the
 * session alone.
 *
 * The order of operations is the security-relevant part:
 *
 * 1. verify same-origin, so a cross-site caller is refused immediately;
 * 2. require the avatar capability, so **no body is read and no image is decoded
 *    for a caller who is not allowed to change an avatar**;
 * 3. reject an obviously oversized declared length, as a cheap fast path only;
 * 4. read the body through a bounded stream, which is the authoritative limit and
 *    works even when `Content-Length` is missing, malformed, or a lie;
 * 5. parse the multipart form from those bounded bytes;
 * 6. require exactly one file field, then enforce the file cap;
 * 7. decode and normalize the image;
 * 8. write.
 *
 * The write boundary authorizes again, so step 2 is a fast rejection and never the
 * only check.
 */

export const dynamic = "force-dynamic";

/** The only accepted form field name. */
const FILE_FIELD = "file";

function jsonError(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * A bounded, specific message for problems the user can act on.
 *
 * Anything unexpected collapses into one generic line, so no Prisma, S3, or sharp
 * error text can ever reach the client.
 */
function describeUploadError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof CrossOriginRequestError) {
    return {
      status: 403,
      code: "FORBIDDEN_ORIGIN",
      message: "Request refused.",
    };
  }

  if (error instanceof AuthenticationRequiredError) {
    return {
      status: 401,
      code: "UNAUTHENTICATED",
      message: "Sign in to manage your avatar.",
    };
  }

  if (error instanceof EmailVerificationRequiredError) {
    return {
      status: 403,
      code: "FORBIDDEN",
      message: "Verify your email before managing your avatar.",
    };
  }

  if (error instanceof AvatarNotOnboardedError) {
    return {
      status: 403,
      code: "FORBIDDEN",
      message: "Finish account setup before managing your avatar.",
    };
  }

  if (error instanceof AvatarRequestTooLargeError) {
    return {
      status: 413,
      code: "FILE_TOO_LARGE",
      message: "Choose an image no larger than 4 MB.",
    };
  }

  if (error instanceof AvatarRequestReadFailedError) {
    // The stream was interrupted rather than oversized. Telling the user their
    // file is too large would be wrong, and would make the two indistinguishable in
    // telemetry, which is the signal a real size rejection depends on.
    return {
      status: 400,
      code: "UPLOAD_INTERRUPTED",
      message: "That upload did not finish. Please try again.",
    };
  }

  if (error instanceof AvatarEmptyError) {
    return {
      status: 400,
      code: "EMPTY_FILE",
      message: "Choose a file to upload.",
    };
  }

  if (error instanceof AvatarTooLargeError) {
    return {
      status: 413,
      code: "FILE_TOO_LARGE",
      message: "Choose an image no larger than 4 MB.",
    };
  }

  if (error instanceof AvatarUnsupportedFormatError) {
    return {
      status: 415,
      code: "UNSUPPORTED_FORMAT",
      message: "Choose a JPEG, PNG, or WebP image.",
    };
  }

  if (error instanceof AvatarAnimatedError) {
    return {
      status: 415,
      code: "ANIMATED_UNSUPPORTED",
      message: "Choose a still image rather than an animated one.",
    };
  }

  if (error instanceof AvatarUndecodableError) {
    return {
      status: 415,
      code: "UNDECODABLE_IMAGE",
      message: "That file could not be read as an image.",
    };
  }

  if (
    error instanceof AvatarStorageUnavailableError ||
    error instanceof AvatarStorageOperationError
  ) {
    return {
      status: 503,
      code: "STORAGE_UNAVAILABLE",
      message:
        "Avatar storage is unavailable right now. Please try again later.",
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message:
      "We couldn't save your avatar right now. Please try again in a moment.",
  };
}

/** Parse a multipart body from bytes already bounded by the streaming read. */
async function parseBoundedMultipart(
  bytes: Buffer,
  contentType: string,
): Promise<FormData> {
  // The content type is forwarded verbatim rather than reconstructed. Rebuilding it
  // would strip the quotes from a boundary that legitimately contains a ";", which
  // would make the reconstructed header disagree with the body and refuse a valid
  // upload. The type is already known to be multipart and already bounded.
  try {
    return await new Response(new Uint8Array(bytes), {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new AvatarUndecodableError();
  }
}
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 1. Same-origin first: refuse a cross-site caller before anything else.
    assertSameOriginMutation(request);

    // 2. Authorize BEFORE reading a body or decoding an image. A same-origin
    //    request from a signed-out visitor stops here, so the upload endpoint is
    //    not an unauthenticated decode primitive.
    await requireCurrentOwnAvatarCapability();

    const contentType = request.headers.get("content-type");

    if (!isMultipartFormData(contentType)) {
      return jsonError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Avatars must be uploaded as a form.",
      );
    }

    // 3. Cheap fast path only; a missing or malformed length falls through.
    if (rejectIfDeclaredOversized(request.headers.get("content-length"))) {
      return jsonError(
        413,
        "FILE_TOO_LARGE",
        "Choose an image no larger than 4 MB.",
      );
    }

    // 4. The authoritative limit: count bytes as they stream and abandon the read
    //    the moment the cap is passed, whether or not a length was declared.
    const bounded = await readBoundedBody(request.body);

    if (bounded.length === 0) {
      return jsonError(400, "EMPTY_FILE", "Choose a file to upload.");
    }

    // Non-null: `isMultipartFormData` already refused a null content type above.
    const form = await parseBoundedMultipart(bounded, contentType ?? "");

    // 5. Exactly one file field, and nothing else. Extra fields are refused rather
    //    than ignored, so a client cannot smuggle in an identity or a URL.
    const entries = [...form.keys()];
    if (entries.length !== 1 || entries[0] !== FILE_FIELD) {
      return jsonError(
        400,
        "UNEXPECTED_FIELDS",
        "Upload exactly one image file.",
      );
    }

    const value = form.get(FILE_FIELD);
    if (!(value instanceof File)) {
      return jsonError(400, "MISSING_FILE", "Choose a file to upload.");
    }

    // 6. The file cap, enforced independently of the request cap.
    if (value.size === 0) {
      return jsonError(400, "EMPTY_FILE", "Choose a file to upload.");
    }

    if (value.size > MAX_AVATAR_UPLOAD_BYTES) {
      return jsonError(
        413,
        "FILE_TOO_LARGE",
        "Choose an image no larger than 4 MB.",
      );
    }

    // 7. Decode and normalize. The declared type and filename are never consulted.
    const processed = await processAvatarUpload(
      Buffer.from(await value.arrayBuffer()),
    );

    // 8. Write. The boundary authorizes again before it touches the database.
    const result = await saveCurrentOwnAvatar(processed.webp);

    return NextResponse.json(
      { avatarUrl: result.avatarUrl },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const described = describeUploadError(error);
    return jsonError(described.status, described.code, described.message);
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    // Deletion mutates no file bytes, so there is no body to bound, but it is
    // still authorized before any storage or database work and still requires
    // same-origin.
    assertSameOriginMutation(request);
    await requireCurrentOwnAvatarCapability();

    await removeCurrentOwnAvatar();

    return NextResponse.json(
      { avatarUrl: null },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const described = describeUploadError(error);
    return jsonError(described.status, described.code, described.message);
  }
}
