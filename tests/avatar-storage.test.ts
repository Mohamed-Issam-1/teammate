// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AVATAR_S3_REQUIRED_ENV_KEYS,
  createS3AvatarStorage,
  readAvatarS3Config,
} from "@/server/avatars/s3";
import {
  createFilesystemAvatarStorage,
  isFilesystemAvatarKey,
} from "@/server/avatars/filesystem-storage";
import {
  getAvatarStorage,
  isEndToEndTestProcess,
  resetAvatarStorageForTests,
} from "@/server/avatars/current-avatar-storage";
import {
  AvatarStorageOperationError,
  AvatarStorageUnavailableError,
} from "@/server/avatars/storage";
import {
  generateAvatarToken,
  avatarObjectKeyForToken,
} from "@/server/avatars/token";

/**
 * Storage adapters and configuration.
 *
 * Two properties are load-bearing. Configuration must be absent-safe, so a build
 * or a test never needs credentials. And the filesystem adapter must be genuinely
 * unreachable outside a guarded end-to-end run, so a temporary directory can never
 * become a production fallback.
 */

const completeEnv: Record<string, string | undefined> = {
  S3_ENDPOINT: "https://s3.example.test",
  S3_REGION: "eu-west-1",
  S3_BUCKET: "teammate-avatars",
  S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
  S3_SECRET_ACCESS_KEY: "secret-value",
};

describe("S3 configuration reading", () => {
  it("reads a complete configuration", () => {
    const config = readAvatarS3Config(completeEnv);

    expect(config).not.toBeNull();
    expect(config?.bucket).toBe("teammate-avatars");
    expect(config?.region).toBe("eu-west-1");
    expect(config?.forcePathStyle).toBe(true);
  });

  it.each(AVATAR_S3_REQUIRED_ENV_KEYS)(
    "returns null when %s is missing",
    (key) => {
      const env = { ...completeEnv };
      delete env[key];

      expect(readAvatarS3Config(env)).toBeNull();
    },
  );

  it("treats an empty string as missing", () => {
    expect(readAvatarS3Config({ ...completeEnv, S3_BUCKET: "" })).toBeNull();
  });

  it("rejects a non-http endpoint", () => {
    expect(
      readAvatarS3Config({ ...completeEnv, S3_ENDPOINT: "not-a-url" }),
    ).toBeNull();
    expect(
      readAvatarS3Config({
        ...completeEnv,
        S3_ENDPOINT: "ftp://files.example",
      }),
    ).toBeNull();
    expect(
      readAvatarS3Config({ ...completeEnv, S3_ENDPOINT: "file:///etc/passwd" }),
    ).toBeNull();
  });

  it("honours an explicit path-style opt-out", () => {
    expect(
      readAvatarS3Config({ ...completeEnv, S3_FORCE_PATH_STYLE: "false" })
        ?.forcePathStyle,
    ).toBe(false);
    expect(
      readAvatarS3Config({ ...completeEnv, S3_FORCE_PATH_STYLE: "true" })
        ?.forcePathStyle,
    ).toBe(true);
  });

  it("never exposes a secret through the parsed configuration shape", () => {
    // The configuration is an internal value, but a test pins that the reader does
    // not invent extra fields such as a pre-signed base URL.
    const config = readAvatarS3Config(completeEnv);

    expect(Object.keys(config ?? {}).sort()).toEqual([
      "accessKeyId",
      "bucket",
      "endpoint",
      "forcePathStyle",
      "region",
      "secretAccessKey",
    ]);
    expect(JSON.stringify(config)).not.toContain("PUBLIC_BASE_URL");
  });
});

describe("production endpoint transport", () => {
  it("refuses a plaintext endpoint in production", () => {
    // A plaintext endpoint would transmit the signed Authorization header, and
    // with it the bucket credentials, in cleartext.
    expect(
      readAvatarS3Config(
        { ...completeEnv, S3_ENDPOINT: "http://s3.example.test" },
        "production",
      ),
    ).toBeNull();
  });

  it("accepts an https endpoint in production", () => {
    expect(
      readAvatarS3Config(
        { ...completeEnv, S3_ENDPOINT: "https://s3.example.test" },
        "production",
      ),
    ).not.toBeNull();
  });

  it("allows http in explicitly non-production environments only", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(
        readAvatarS3Config(
          { ...completeEnv, S3_ENDPOINT: "http://localhost:9000" },
          nodeEnv,
        ),
        nodeEnv,
      ).not.toBeNull();
    }
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["misspelled", "Production"],
    ["abbreviated", "prod"],
  ])("denies a plaintext endpoint when NODE_ENV is %s", (_label, nodeEnv) => {
    // NODE_ENV is optional in the project environment contract, so the check is
    // an allow-list: anything not known to be a local environment denies.
    expect(
      readAvatarS3Config(
        { ...completeEnv, S3_ENDPOINT: "http://s3.example.test" },
        nodeEnv,
      ),
    ).toBeNull();
  });

  it("refuses a non-http scheme in production", () => {
    expect(
      readAvatarS3Config(
        { ...completeEnv, S3_ENDPOINT: "ftp://s3.example.test" },
        "production",
      ),
    ).toBeNull();
  });

  it("reads NODE_ENV from the supplied record when no node env is passed", () => {
    expect(
      readAvatarS3Config({
        ...completeEnv,
        S3_ENDPOINT: "http://s3.example.test",
        NODE_ENV: "production",
      }),
    ).toBeNull();

    expect(
      readAvatarS3Config({
        ...completeEnv,
        S3_ENDPOINT: "http://localhost:9000",
        NODE_ENV: "development",
      }),
    ).not.toBeNull();
  });
});

describe("filesystem adapter self-refusal", () => {
  it("refuses to construct in production even with a valid directory", () => {
    expect(() =>
      createFilesystemAvatarStorage(process.cwd(), {
        E2E_TEST_CONTEXT: "teammate-e2e",
        NODE_ENV: "production",
      }),
    ).toThrow(AvatarStorageUnavailableError);
  });

  it("refuses to construct without the end-to-end marker", () => {
    expect(() =>
      createFilesystemAvatarStorage(process.cwd(), {
        NODE_ENV: "development",
      }),
    ).toThrow(AvatarStorageUnavailableError);
  });

  it("refuses to construct with an empty directory", () => {
    expect(() =>
      createFilesystemAvatarStorage("", {
        E2E_TEST_CONTEXT: "teammate-e2e",
        NODE_ENV: "development",
      }),
    ).toThrow(AvatarStorageUnavailableError);
  });

  it("constructs under the guarded marker outside production", () => {
    expect(() =>
      createFilesystemAvatarStorage(process.cwd(), {
        E2E_TEST_CONTEXT: "teammate-e2e",
        NODE_ENV: "development",
      }),
    ).not.toThrow();
  });
});
describe("S3 adapter without configuration", () => {
  it("fails closed", () => {
    expect(() => createS3AvatarStorage(null)).toThrow(
      AvatarStorageUnavailableError,
    );
  });

  it("does not construct a client at build or import time", () => {
    // Importing the module and reading a null configuration must not touch the
    // network or require credentials.
    expect(() => createS3AvatarStorage(readAvatarS3Config({}))).toThrow(
      AvatarStorageUnavailableError,
    );
  });
});

describe("end-to-end process detection", () => {
  it("is true only with the marker and a non-production node env", () => {
    expect(
      isEndToEndTestProcess({
        E2E_TEST_CONTEXT: "teammate-e2e",
        NODE_ENV: "development",
      }),
    ).toBe(true);
  });

  it("is false without the marker", () => {
    expect(isEndToEndTestProcess({ NODE_ENV: "development" })).toBe(false);
  });

  it("is false in production even with the marker", () => {
    // A stray environment variable must never switch on a temporary-filesystem
    // avatar store in a real deployment.
    expect(
      isEndToEndTestProcess({
        E2E_TEST_CONTEXT: "teammate-e2e",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });
});

describe("avatar storage selection", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetAvatarStorageForTests();
  });

  afterEach(() => {
    process.env = { ...envBackup };
    resetAvatarStorageForTests();
  });

  it("refuses to build anything without configuration outside a test run", () => {
    delete process.env.E2E_TEST_CONTEXT;
    delete process.env.E2E_AVATAR_STORAGE_DIR;
    delete process.env.S3_BUCKET;

    expect(() => getAvatarStorage()).toThrow(AvatarStorageUnavailableError);
  });

  it("refuses the filesystem adapter in production even when fully configured", () => {
    process.env.E2E_TEST_CONTEXT = "teammate-e2e";
    process.env.E2E_AVATAR_STORAGE_DIR = path.join(
      tmpdir(),
      "should-not-be-used",
    );
    Object.assign(process.env, { NODE_ENV: "production" });

    // Falls through to the S3 branch, which has no configuration here.
    expect(() => getAvatarStorage()).toThrow(AvatarStorageUnavailableError);
  });

  it("refuses the filesystem adapter without a directory", () => {
    process.env.E2E_TEST_CONTEXT = "teammate-e2e";
    Object.assign(process.env, { NODE_ENV: "development" });
    delete process.env.E2E_AVATAR_STORAGE_DIR;

    expect(() => getAvatarStorage()).toThrow(AvatarStorageUnavailableError);
  });
});

describe("filesystem avatar storage", () => {
  let directory: string;
  let storage: ReturnType<typeof createFilesystemAvatarStorage>;

  // The adapter refuses to construct without the guarded end-to-end marker, so
  // the suite presents itself as an end-to-end run outside production.
  const guardedEnv = {
    E2E_TEST_CONTEXT: "teammate-e2e",
    NODE_ENV: "test",
  };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "teammate-avatar-test-"));
    storage = createFilesystemAvatarStorage(directory, guardedEnv);
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("stores and reads an object", async () => {
    const key = avatarObjectKeyForToken(generateAvatarToken());
    const bytes = Buffer.from([1, 2, 3, 4, 5]);

    await storage.put(key, bytes, "image/webp");

    expect(await storage.get(key)).toEqual(bytes);
  });

  it("returns null for a missing object", async () => {
    const key = avatarObjectKeyForToken(generateAvatarToken());

    expect(await storage.get(key)).toBeNull();
  });

  it("deletes an object and tolerates deleting a missing one", async () => {
    const key = avatarObjectKeyForToken(generateAvatarToken());

    await storage.put(key, Buffer.from([9]), "image/webp");
    await storage.delete(key);

    expect(await storage.get(key)).toBeNull();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it("overwrites an existing object", async () => {
    const key = avatarObjectKeyForToken(generateAvatarToken());

    await storage.put(key, Buffer.from([1, 1]), "image/webp");
    await storage.put(key, Buffer.from([2, 2, 2]), "image/webp");

    expect(await storage.get(key)).toEqual(Buffer.from([2, 2, 2]));
  });

  it.each([
    ["a traversal key", "../../escape.webp"],
    ["an absolute path", "/etc/passwd"],
    ["a nested path", "avatars/nested/file.webp"],
    ["a bare filename", "file.webp"],
    [
      "a key outside the namespace",
      "other/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp",
    ],
    [
      "a key with a wrong suffix",
      "avatars/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png",
    ],
    ["an empty key", ""],
  ])("refuses %s", async (_label, key) => {
    await expect(
      storage.put(key, Buffer.from([1]), "image/webp"),
    ).rejects.toBeInstanceOf(AvatarStorageOperationError);
    await expect(storage.get(key)).rejects.toBeInstanceOf(
      AvatarStorageOperationError,
    );
    await expect(storage.delete(key)).rejects.toBeInstanceOf(
      AvatarStorageOperationError,
    );
  });

  it("does not write outside its base directory for a traversal key", async () => {
    const escapeTarget = path.join(directory, "..", "escaped.webp");

    await expect(
      storage.put(`avatars/../escaped.webp`, Buffer.from([1]), "image/webp"),
    ).rejects.toBeInstanceOf(AvatarStorageOperationError);

    const { existsSync } = await import("node:fs");
    expect(existsSync(escapeTarget)).toBe(false);
  });

  it("recognizes only well-formed avatar keys", () => {
    expect(
      isFilesystemAvatarKey(
        avatarObjectKeyForToken("3f2504e0-4f89-41d3-9a0c-0305e82c3301"),
      ),
    ).toBe(true);
    expect(isFilesystemAvatarKey("avatars/../x.webp")).toBe(false);
    expect(isFilesystemAvatarKey("nope")).toBe(false);
  });
});
