import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  AvatarStorageOperationError,
  AvatarStorageUnavailableError,
  type AvatarStorage,
} from "./storage";

/**
 * S3-compatible avatar storage.
 *
 * The client is created lazily, on first use, so importing this module never
 * requires credentials. That is what lets the build, typecheck, and unit tests
 * run with no storage configuration at all while production still fails closed the
 * moment an avatar operation is actually attempted.
 */

export type AvatarS3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/**
 * Read the storage configuration from an environment record.
 *
 * Returns `null` when any required value is missing rather than throwing, so the
 * caller decides whether absence is fatal. Values are never included in an error
 * message: an endpoint can carry credentials or query data, and a bucket name is
 * operational detail that should not reach a log or a response.
 *
 * Uses the project's established `S3_*` prefix. `S3_PUBLIC_BASE_URL` is
 * deliberately ignored: avatars are never served from a public bucket URL, only
 * through the authorized same-origin route.
 */
export function readAvatarS3Config(
  raw: Record<string, string | undefined>,
  nodeEnv: string | undefined = raw.NODE_ENV,
): AvatarS3Config | null {
  const value = (key: string): string | null => {
    const candidate = raw[key];
    return typeof candidate === "string" && candidate.length > 0
      ? candidate
      : null;
  };

  const endpoint = value("S3_ENDPOINT");
  const region = value("S3_REGION");
  const bucket = value("S3_BUCKET");
  const accessKeyId = value("S3_ACCESS_KEY_ID");
  const secretAccessKey = value("S3_SECRET_ACCESS_KEY");

  if (
    endpoint === null ||
    region === null ||
    bucket === null ||
    accessKeyId === null ||
    secretAccessKey === null
  ) {
    return null;
  }

  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return null;
  }

  const isHttps = endpointUrl.protocol === "https:";
  const isHttp = endpointUrl.protocol === "http:";

  if (!isHttps && !isHttp) {
    return null;
  }

  // A plaintext endpoint would transmit the signed Authorization header, and with
  // it the bucket credentials, in cleartext. This is an allow-list rather than a
  // production check, so the default is to deny: `NODE_ENV` is declared optional by
  // the project environment contract, and a missing or misspelled value must not
  // silently permit plaintext. Plain HTTP is available only where it is explicitly
  // known to be safe, for local MinIO-style development. Checked at configuration
  // read rather than module load, so a build or typecheck with no configuration
  // still succeeds.
  const explicitlyNonProduction =
    nodeEnv === "development" || nodeEnv === "test";

  if (!isHttps && !explicitlyNonProduction) {
    return null;
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    // Path-style addressing is what most self-hosted S3-compatible providers
    // need; virtual-host style breaks when the bucket is not a DNS label.
    forcePathStyle: value("S3_FORCE_PATH_STYLE") !== "false",
  };
}

/** Names of the variables the adapter requires, for error-free reporting. */
export const AVATAR_S3_REQUIRED_ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

/**
 * Build the S3-backed avatar storage.
 *
 * @throws {AvatarStorageUnavailableError} when configuration is absent or invalid.
 */
export function createS3AvatarStorage(
  config: AvatarS3Config | null,
): AvatarStorage {
  if (config === null) {
    throw new AvatarStorageUnavailableError();
  }

  let client: S3Client | null = null;

  const getClient = (): S3Client => {
    if (client === null) {
      client = new S3Client({
        region: config.region,
        // Credentials are supplied explicitly rather than picked up from the
        // ambient environment, so the adapter cannot silently fall back to an
        // unrelated credential source such as an instance role.
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        ...(config.endpoint.length > 0 ? { endpoint: config.endpoint } : {}),
        forcePathStyle: config.forcePathStyle,
      });
    }

    return client;
  };

  return {
    async put(key, bytes, contentType) {
      try {
        await getClient().send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
            // Avatars are private objects: nothing may be served directly from
            // the bucket, only through the authorized application route.
            CacheControl: "private, no-store",
          }),
        );
      } catch {
        throw new AvatarStorageOperationError();
      }
    },

    async get(key) {
      try {
        const result = await getClient().send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        );

        if (result.Body === undefined) {
          return null;
        }

        return Buffer.from(await result.Body.transformToByteArray());
      } catch (error) {
        // A missing object is a normal outcome, not a failure, and must stay
        // indistinguishable from any other unreadable avatar to the caller.
        if (isNotFound(error)) {
          return null;
        }

        throw new AvatarStorageOperationError();
      }
    },

    async delete(key) {
      try {
        await getClient().send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
        );
      } catch {
        // S3 delete is already idempotent, and a cleanup failure must never fail
        // the user's request: the database is the source of truth.
        throw new AvatarStorageOperationError();
      }
    },
  };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };

  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}
