// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthOptions } from "@/server/auth/options";
import {
  AUTH_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS,
} from "@/server/auth/token-expiry";
import {
  buildPasswordResetEmailContent,
  buildVerificationEmailContent,
  PASSWORD_RESET_EMAIL_SUBJECT,
  VERIFICATION_EMAIL_SUBJECT,
} from "@/server/email/content";
import { createProductionAuthEmailConfigSource } from "@/server/email/config";
import {
  AUTH_EMAIL_DELIVERY_ERROR_MESSAGE,
  AuthEmailDeliveryError,
  type AuthEmailDeliveryFailureReason,
} from "@/server/email/errors";
import { AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE } from "@/server/email/operational-log";
import { ResendProductionEmailTransport } from "@/server/email/production";
import type {
  AuthEmailProvider,
  AuthEmailProviderOutcome,
} from "@/server/email/provider";
import {
  assertProductionActionUrl,
  assertRecipientAddress,
  assertSenderAddress,
  AUTH_EMAIL_FROM_DISPLAY_NAME,
  buildFromHeader,
  escapeHtml,
} from "@/server/email/safety";

const BASE_URL = "https://app.teammate.example";
const TRUSTED_ORIGIN = "https://app.teammate.example";
const API_KEY = "re_TESTSECRET_do-not-leak-8f3a2b1c";
const FROM_ADDRESS = "no-reply@app.teammate.example";
const RECIPIENT = "person@example.com";
const VERIFICATION_TOKEN = "verifyTOKEN0123456789";
const RESET_TOKEN = "resetTOKEN9876543210";
const VERIFICATION_URL = `${BASE_URL}/verify-email?token=${VERIFICATION_TOKEN}&callbackURL=%2Fonboarding`;
const RESET_URL = `${BASE_URL}/reset-password/${RESET_TOKEN}?callbackURL=`;

const HTML_VERIFICATION_URL = VERIFICATION_URL.replaceAll("&", "&amp;");
const PROVIDER_ERROR_MARKER = "PROVIDER_RESPONSE_BODY_secret_do_not_log";
const PROVIDER_EXCEPTION_MARKER = "PROVIDER_EXCEPTION_secret_do_not_log";

type SentMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type FakeProvider = {
  sent: SentMessage[];
  createdWithApiKeys: string[];
};

type FakeProviderFactory = FakeProvider & {
  create: (apiKey: string) => AuthEmailProvider;
};

function createFakeProvider(
  outcome: AuthEmailProviderOutcome = { delivered: true },
): FakeProviderFactory {
  const sent: SentMessage[] = [];
  const createdWithApiKeys: string[] = [];

  return {
    sent,
    createdWithApiKeys,
    create(apiKey: string) {
      createdWithApiKeys.push(apiKey);
      return {
        async send(message: SentMessage) {
          sent.push(message);
          return outcome;
        },
      };
    },
  };
}

function createTransport(
  options: {
    env?: Record<string, string | undefined>;
    provider?: FakeProviderFactory;
    baseUrl?: string;
  } = {},
) {
  const provider = options.provider ?? createFakeProvider();

  const transport = new ResendProductionEmailTransport({
    loadConfig: createProductionAuthEmailConfigSource({
      env: options.env ?? {
        RESEND_API_KEY: API_KEY,
        AUTH_EMAIL_FROM_ADDRESS: FROM_ADDRESS,
      },
      baseUrl: options.baseUrl ?? BASE_URL,
    }),
    createProvider: provider.create,
  });

  return { transport, provider };
}

function createThrowingTransport(
  error: Error,
  env: Record<string, string | undefined> = {
    RESEND_API_KEY: API_KEY,
    AUTH_EMAIL_FROM_ADDRESS: FROM_ADDRESS,
  },
) {
  const sent: SentMessage[] = [];

  const transport = new ResendProductionEmailTransport({
    loadConfig: createProductionAuthEmailConfigSource({
      env,
      baseUrl: BASE_URL,
    }),
    createProvider: () => ({
      async send(message: SentMessage) {
        sent.push(message);
        throw error;
      },
    }),
  });

  return { transport, sent };
}

function captureConsole() {
  return {
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    info: vi.spyOn(console, "info").mockImplementation(() => undefined),
    debug: vi.spyOn(console, "debug").mockImplementation(() => undefined),
  };
}

function serializedError(error: unknown): string {
  const value = error as { message?: string; stack?: string } | null;
  return [value?.message, value?.stack, JSON.stringify(error)].join("\n");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("escapeHtml", () => {
  it("escapes every character that can break out of HTML text or an attribute", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });

  it("leaves ordinary URL-safe content unchanged", () => {
    expect(escapeHtml(RESET_URL)).toBe(RESET_URL);
  });
});

describe("production auth email content", () => {
  it("uses the approved subjects", () => {
    expect(VERIFICATION_EMAIL_SUBJECT).toBe("Verify your TeamMate email");
    expect(PASSWORD_RESET_EMAIL_SUBJECT).toBe("Reset your TeamMate password");
    expect(buildVerificationEmailContent(VERIFICATION_URL).subject).toBe(
      VERIFICATION_EMAIL_SUBJECT,
    );
    expect(buildPasswordResetEmailContent(RESET_URL).subject).toBe(
      PASSWORD_RESET_EMAIL_SUBJECT,
    );
  });

  it("derives expiry copy from the configured Better Auth token policy", () => {
    const verification = buildVerificationEmailContent(VERIFICATION_URL);
    const reset = buildPasswordResetEmailContent(RESET_URL);

    expect(AUTH_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS).toBe(3600);
    expect(AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS).toBe(3600);
    expect(verification.text).toContain("This link expires in 1 hour.");
    expect(verification.html).toContain("This link expires in 1 hour.");
    expect(reset.text).toContain("This link expires in 1 hour.");
    expect(reset.html).toContain("This link expires in 1 hour.");
  });

  it("identifies TeamMate, links once, and stays neutral in both bodies", () => {
    for (const content of [
      buildVerificationEmailContent(VERIFICATION_URL),
      buildPasswordResetEmailContent(RESET_URL),
    ]) {
      expect(content.text).toContain("TeamMate");
      expect(content.html).toContain("TeamMate");
      expect(occurrences(content.html, "<a href=")).toBe(1);
      expect(content.text).not.toMatch(/<[a-z]/i);
    }

    expect(buildVerificationEmailContent(VERIFICATION_URL).text).toContain(
      "If you did not create a TeamMate account, you can ignore this message.",
    );
    expect(buildPasswordResetEmailContent(RESET_URL).text).toContain(
      "If you did not request a password reset, you can ignore this message",
    );
  });

  it("escapes dynamic values instead of trusting them", () => {
    const hostile = "https://app.teammate.example/verify?token=a&x=<script>";
    const content = buildVerificationEmailContent(hostile);

    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&amp;x=&lt;script&gt;");
  });

  it("never renders a token, internal identifier, or account detail separately", () => {
    const verification = buildVerificationEmailContent(VERIFICATION_URL);
    const reset = buildPasswordResetEmailContent(RESET_URL);

    expect(occurrences(verification.html, VERIFICATION_TOKEN)).toBe(1);
    expect(occurrences(verification.text, VERIFICATION_TOKEN)).toBe(1);
    expect(occurrences(reset.html, RESET_TOKEN)).toBe(1);
    expect(occurrences(reset.text, RESET_TOKEN)).toBe(1);

    for (const [content, url] of [
      [verification, VERIFICATION_URL],
      [reset, RESET_URL],
    ] as const) {
      // The action URL is the one sanctioned place a token may appear. The HTML
      // body carries the HTML-escaped form of the same link.
      const strip = (body: string) =>
        body.split(url).join("").split(url.replaceAll("&", "&amp;")).join("");

      expect(strip(content.text)).not.toMatch(
        /token|\bstatus\b|api key|secret|\buser id\b/i,
      );
      expect(strip(content.html)).not.toMatch(
        /token|\bstatus\b|api key|secret|\buser id\b/i,
      );
    }
  });
});

describe("ResendProductionEmailTransport successful sends", () => {
  it("sends a verification email with the fixed From header and both bodies", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { transport, provider } = createTransport();

    await transport.sendVerificationEmail({
      to: RECIPIENT,
      url: VERIFICATION_URL,
    });

    expect(provider.createdWithApiKeys).toEqual([API_KEY]);
    expect(provider.sent).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    const message = provider.sent[0] as SentMessage;
    expect(message.from).toBe("TeamMate <no-reply@app.teammate.example>");
    expect(message.from).toBe(
      `${AUTH_EMAIL_FROM_DISPLAY_NAME} <${FROM_ADDRESS}>`,
    );
    expect(message.to).toBe(RECIPIENT);
    expect(message.subject).toBe("Verify your TeamMate email");
    expect(message.text).toContain(VERIFICATION_URL);
    expect(message.html).toContain(`<a href="${HTML_VERIFICATION_URL}">`);
    expect(message.html).toContain("This link expires in 1 hour.");
  });

  it("sends a password-reset email with the fixed From header and both bodies", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { transport, provider } = createTransport();

    await transport.sendPasswordResetEmail({ to: RECIPIENT, url: RESET_URL });

    expect(provider.createdWithApiKeys).toEqual([API_KEY]);
    expect(fetchSpy).not.toHaveBeenCalled();

    const message = provider.sent[0] as SentMessage;
    expect(message.from).toBe("TeamMate <no-reply@app.teammate.example>");
    expect(message.to).toBe(RECIPIENT);
    expect(message.subject).toBe("Reset your TeamMate password");
    expect(message.text).toContain(RESET_URL);
    expect(message.html).toContain(`<a href="${RESET_URL}">`);
    expect(message.html).toContain("This link expires in 1 hour.");
  });

  it("keeps the token only inside the intended link", async () => {
    const { transport, provider } = createTransport();

    await transport.sendVerificationEmail({
      to: RECIPIENT,
      url: VERIFICATION_URL,
    });
    await transport.sendPasswordResetEmail({ to: RECIPIENT, url: RESET_URL });

    const [verification, reset] = provider.sent as [SentMessage, SentMessage];

    expect(occurrences(verification.html, VERIFICATION_TOKEN)).toBe(1);
    expect(verification.html).toContain(
      `<a href="${BASE_URL}/verify-email?token=${VERIFICATION_TOKEN}`,
    );
    expect(occurrences(verification.text, VERIFICATION_TOKEN)).toBe(1);
    expect(occurrences(reset.html, RESET_TOKEN)).toBe(1);
    expect(reset.html).toContain(
      `<a href="${BASE_URL}/reset-password/${RESET_TOKEN}`,
    );
    expect(occurrences(reset.text, RESET_TOKEN)).toBe(1);

    for (const message of provider.sent) {
      expect(Object.keys(message).sort()).toEqual([
        "from",
        "html",
        "subject",
        "text",
        "to",
      ]);
    }
  });
});

describe("ResendProductionEmailTransport action URL validation", () => {
  const cases: { name: string; url: string }[] = [
    { name: "a malformed URL", url: "not-a-url" },
    { name: "a relative URL", url: "/verify-email?token=abc" },
    { name: "a non-HTTP protocol", url: "ftp://app.teammate.example/verify" },
    {
      name: "an HTTP production URL",
      url: "http://app.teammate.example/verify-email?token=abc",
    },
    {
      name: "a look-alike host",
      url: "https://app.teammate.example.evil.test/verify-email?token=abc",
    },
    {
      name: "a subdomain host",
      url: "https://evil.app.teammate.example/verify-email?token=abc",
    },
    {
      name: "an alternate port",
      url: "https://app.teammate.example:8443/verify-email?token=abc",
    },
    {
      name: "a user-supplied callback origin",
      url: "https://attacker.test/verify-email?token=abc&callbackURL=https://attacker.test",
    },
    {
      name: "a URL with a username",
      url: "https://user@app.teammate.example/verify-email?token=abc",
    },
    {
      name: "a URL with a password",
      url: "https://user:secret@app.teammate.example/verify-email?token=abc",
    },
  ];

  for (const { name, url } of cases) {
    it(`rejects ${name} before the provider is created`, async () => {
      const { transport, provider } = createTransport();

      await expect(
        transport.sendVerificationEmail({ to: RECIPIENT, url }),
      ).rejects.toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);

      expect(provider.createdWithApiKeys).toEqual([]);
      expect(provider.sent).toEqual([]);
    });
  }

  it("rejects a CR/LF-bearing action URL", async () => {
    const { transport, provider } = createTransport();

    await expect(
      transport.sendPasswordResetEmail({
        to: RECIPIENT,
        url: `${VERIFICATION_URL}\r\nBcc: attacker@example.com`,
      }),
    ).rejects.toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);

    expect(provider.sent).toEqual([]);
  });

  it("fails closed on a non-string recipient or action URL", async () => {
    const { transport, provider } = createTransport();

    for (const input of [
      { to: null, url: VERIFICATION_URL },
      { to: RECIPIENT, url: null },
      { to: undefined, url: undefined },
    ]) {
      await expect(
        transport.sendVerificationEmail(input as never),
      ).rejects.toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);
    }

    expect(provider.createdWithApiKeys).toEqual([]);
    expect(provider.sent).toEqual([]);
  });

  it("fails closed when the configured base URL is not an absolute URL", async () => {
    const { transport, provider } = createTransport({
      baseUrl: "localhost:3000",
    });

    await expect(
      transport.sendVerificationEmail({
        to: RECIPIENT,
        url: VERIFICATION_URL,
      }),
    ).rejects.toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);

    expect(provider.sent).toEqual([]);
  });

  it("accepts an HTTPS URL on the exact configured origin", () => {
    expect(
      assertProductionActionUrl(
        "https://app.teammate.example:443/verify-email?token=abc",
        TRUSTED_ORIGIN,
      ),
    ).toBe("https://app.teammate.example:443/verify-email?token=abc");
  });
});

describe("ResendProductionEmailTransport address validation", () => {
  it("rejects an invalid recipient", async () => {
    const { transport, provider } = createTransport();

    await expect(
      transport.sendVerificationEmail({
        to: "person",
        url: VERIFICATION_URL,
      }),
    ).rejects.toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);

    expect(provider.sent).toEqual([]);
  });

  it("rejects a recipient list instead of a single mailbox", async () => {
    const { transport, provider } = createTransport();

    await expect(
      transport.sendPasswordResetEmail({
        to: "one@example.com, two@example.com",
        url: RESET_URL,
      }),
    ).rejects.toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);

    expect(provider.sent).toEqual([]);
  });

  it("rejects CR/LF header injection in the recipient", async () => {
    const { transport, provider } = createTransport();

    await expect(
      transport.sendVerificationEmail({
        to: `${RECIPIENT}\r\nBcc: attacker@example.com`,
        url: VERIFICATION_URL,
      }),
    ).rejects.toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);

    await expect(
      transport.sendPasswordResetEmail({
        to: `${RECIPIENT}\nBcc: attacker@example.com`,
        url: RESET_URL,
      }),
    ).rejects.toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);

    expect(provider.sent).toEqual([]);
  });

  it("rejects an invalid or display-name AUTH_EMAIL_FROM_ADDRESS", async () => {
    for (const fromAddress of [
      "",
      "   ",
      "not-an-address",
      "no-reply@",
      "@example.com",
      "no-reply@example",
      "TeamMate <no-reply@example.com>",
      "<no-reply@example.com>",
      '"no-reply@example.com"',
      "no-reply@example.com, other@example.com",
      "no-reply@example.com\r\nBcc: attacker@example.com",
    ]) {
      const { transport, provider } = createTransport({
        env: {
          RESEND_API_KEY: API_KEY,
          AUTH_EMAIL_FROM_ADDRESS: fromAddress,
        },
      });

      await expect(
        transport.sendVerificationEmail({
          to: RECIPIENT,
          url: VERIFICATION_URL,
        }),
      ).rejects.toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);

      expect(provider.sent).toEqual([]);
    }
  });

  it("builds the only permitted From header in code", () => {
    expect(buildFromHeader(FROM_ADDRESS)).toBe(
      "TeamMate <no-reply@app.teammate.example>",
    );
    expect(assertSenderAddress(`  ${FROM_ADDRESS}  `)).toBe(FROM_ADDRESS);
    expect(assertRecipientAddress(RECIPIENT)).toBe(RECIPIENT);
  });
});

describe("ResendProductionEmailTransport lazy configuration", () => {
  it("fails closed when RESEND_API_KEY is missing", async () => {
    const { transport, provider } = createTransport({
      env: { AUTH_EMAIL_FROM_ADDRESS: FROM_ADDRESS },
    });

    await expect(
      transport.sendVerificationEmail({
        to: RECIPIENT,
        url: VERIFICATION_URL,
      }),
    ).rejects.toMatchObject({
      name: "AuthEmailDeliveryError",
      reason: "not-configured",
      message: AUTH_EMAIL_DELIVERY_ERROR_MESSAGE,
    });

    expect(provider.createdWithApiKeys).toEqual([]);
    expect(provider.sent).toEqual([]);
  });

  it("fails closed when RESEND_API_KEY is empty", async () => {
    const { transport, provider } = createTransport({
      env: { RESEND_API_KEY: "", AUTH_EMAIL_FROM_ADDRESS: FROM_ADDRESS },
    });

    await expect(
      transport.sendPasswordResetEmail({ to: RECIPIENT, url: RESET_URL }),
    ).rejects.toMatchObject({ reason: "not-configured" });

    expect(provider.sent).toEqual([]);
  });

  it("fails closed when AUTH_EMAIL_FROM_ADDRESS is missing", async () => {
    const { transport, provider } = createTransport({
      env: { RESEND_API_KEY: API_KEY },
    });

    await expect(
      transport.sendVerificationEmail({
        to: RECIPIENT,
        url: VERIFICATION_URL,
      }),
    ).rejects.toMatchObject({ reason: "not-configured" });

    expect(provider.createdWithApiKeys).toEqual([]);
    expect(provider.sent).toEqual([]);
  });

  it("reads the environment on every send rather than at construction", () => {
    const env: Record<string, string | undefined> = {
      RESEND_API_KEY: API_KEY,
      AUTH_EMAIL_FROM_ADDRESS: FROM_ADDRESS,
    };
    const loadConfig = createProductionAuthEmailConfigSource({
      env,
      baseUrl: BASE_URL,
    });

    expect(loadConfig()).toEqual({
      apiKey: API_KEY,
      fromAddress: FROM_ADDRESS,
      baseUrl: BASE_URL,
    });

    env.RESEND_API_KEY = undefined;
    env.AUTH_EMAIL_FROM_ADDRESS = undefined;

    expect(() => loadConfig()).toThrowError(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);
  });

  it("fails closed in production when BETTER_AUTH_URL is not HTTPS", async () => {
    for (const baseUrl of [
      "http://localhost:3000",
      "http://app.teammate.example",
      "not-a-url",
    ]) {
      const { transport, provider } = createTransport({
        baseUrl,
        env: {
          NODE_ENV: "production",
          RESEND_API_KEY: API_KEY,
          AUTH_EMAIL_FROM_ADDRESS: FROM_ADDRESS,
        },
      });

      await expect(
        transport.sendVerificationEmail({
          to: RECIPIENT,
          url: VERIFICATION_URL,
        }),
      ).rejects.toMatchObject({ reason: "not-configured" });

      expect(provider.createdWithApiKeys).toEqual([]);
      expect(provider.sent).toEqual([]);
    }
  });

  it("allows an HTTP base URL outside production", async () => {
    const { transport, provider } = createTransport({
      baseUrl: "http://localhost:3000",
      env: {
        NODE_ENV: "development",
        RESEND_API_KEY: API_KEY,
        AUTH_EMAIL_FROM_ADDRESS: FROM_ADDRESS,
      },
    });

    // An HTTP origin can never produce a valid production action URL, so this
    // still fails closed, but on the URL check rather than configuration.
    await expect(
      transport.sendVerificationEmail({ to: RECIPIENT, url: VERIFICATION_URL }),
    ).rejects.toMatchObject({ reason: "invalid-url" });
    expect(provider.sent).toEqual([]);
  });

  it("never includes configuration values in a configuration failure", async () => {
    const { transport } = createTransport({
      env: {
        RESEND_API_KEY: API_KEY,
        AUTH_EMAIL_FROM_ADDRESS: "TeamMate <a@b.co>",
      },
    });

    const error = await transport
      .sendVerificationEmail({ to: RECIPIENT, url: VERIFICATION_URL })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(AuthEmailDeliveryError);
    expect(serializedError(error)).not.toContain(API_KEY);
    expect(serializedError(error)).not.toContain("a@b.co");
  });
});

describe("ResendProductionEmailTransport provider failure sanitization", () => {
  it("converts a provider returned error result into one sanitized error", async () => {
    const consoleSpies = captureConsole();
    const { transport, provider } = createTransport({
      provider: createFakeProvider({ delivered: false }),
    });

    const error = await transport
      .sendVerificationEmail({ to: RECIPIENT, url: VERIFICATION_URL })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(AuthEmailDeliveryError);
    expect(error).toMatchObject({
      reason: "provider-rejected",
      message: AUTH_EMAIL_DELIVERY_ERROR_MESSAGE,
    });
    expect(provider.sent).toHaveLength(1);

    for (const spy of Object.values(consoleSpies)) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(serializedError(error)).not.toContain(API_KEY);
    expect(serializedError(error)).not.toContain(VERIFICATION_URL);
    expect(serializedError(error)).not.toContain(VERIFICATION_TOKEN);
    expect(serializedError(error)).not.toContain(RECIPIENT);
  });

  it("sanitizes a provider returned error object without logging it", async () => {
    const consoleSpies = captureConsole();
    const providerError = {
      message: `Request failed: ${PROVIDER_ERROR_MARKER}`,
      name: "validation_error",
      statusCode: 422,
    };
    const provider = createFakeProvider();
    const transport = new ResendProductionEmailTransport({
      loadConfig: createProductionAuthEmailConfigSource({
        env: { RESEND_API_KEY: API_KEY, AUTH_EMAIL_FROM_ADDRESS: FROM_ADDRESS },
        baseUrl: BASE_URL,
      }),
      createProvider: (apiKey: string) => {
        provider.createdWithApiKeys.push(apiKey);
        return {
          async send(message: SentMessage) {
            provider.sent.push(message);
            // The SDK binding collapses this to `delivered: false`; the raw
            // object is never returned upward. A fake that leaks it instead must
            // still be reduced to the fixed sanitized error.
            return { delivered: false, error: providerError } as never;
          },
        };
      },
    });

    const error = await transport
      .sendPasswordResetEmail({ to: RECIPIENT, url: RESET_URL })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(AuthEmailDeliveryError);
    expect(serializedError(error)).not.toContain(PROVIDER_ERROR_MARKER);
    expect(serializedError(error)).not.toContain("validation_error");
    expect(serializedError(error)).not.toContain("422");

    for (const spy of Object.values(consoleSpies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("converts a thrown provider exception into one sanitized error", async () => {
    const consoleSpies = captureConsole();
    const providerError = Object.assign(
      new Error(`fetch failed: ${PROVIDER_EXCEPTION_MARKER}`),
      {
        cause: {
          apiKey: API_KEY,
          requestBody: VERIFICATION_URL,
          responseBody: PROVIDER_ERROR_MARKER,
        },
      },
    );
    const { transport, sent } = createThrowingTransport(providerError);

    const error = await transport
      .sendVerificationEmail({ to: RECIPIENT, url: VERIFICATION_URL })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(AuthEmailDeliveryError);
    expect(error).toMatchObject({
      reason: "provider-unavailable",
      message: AUTH_EMAIL_DELIVERY_ERROR_MESSAGE,
    });
    expect(sent).toHaveLength(1);

    const rendered = serializedError(error);
    expect(rendered).not.toContain(PROVIDER_EXCEPTION_MARKER);
    expect(rendered).not.toContain(PROVIDER_ERROR_MARKER);
    expect(rendered).not.toContain(API_KEY);
    expect(rendered).not.toContain(VERIFICATION_URL);
    expect(rendered).not.toContain(VERIFICATION_TOKEN);
    expect(rendered).not.toContain(RECIPIENT);
    expect((error as { cause?: unknown }).cause).toBeUndefined();

    for (const spy of Object.values(consoleSpies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("Better Auth email callback delivery-failure normalization", () => {
  function verificationCallback(
    send: (input: { to: string; url: string }) => Promise<void>,
  ) {
    const authOptions = createAuthOptions({
      baseURL: "http://localhost:3000",
      email: {
        sendVerificationEmail: send,
        sendPasswordResetEmail: async () => {},
      },
    });

    return authOptions.emailVerification.sendVerificationEmail;
  }

  it("normalizes a sanitized delivery failure and emits one fixed line", async () => {
    const consoleSpies = captureConsole();
    const send = vi.fn(async () => {
      throw new AuthEmailDeliveryError("provider-rejected");
    });
    const callback = verificationCallback(send);

    await expect(
      callback?.({
        user: { email: RECIPIENT } as never,
        url: VERIFICATION_URL,
        token: VERIFICATION_TOKEN,
      } as never),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    expect(consoleSpies.error).toHaveBeenCalledTimes(1);
    expect(consoleSpies.error).toHaveBeenCalledWith(
      AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE,
    );

    // The single emitted line must be argument-free and leak nothing.
    const emitted = consoleSpies.error.mock.calls.flat();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toBe(AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE);
    for (const spy of [
      consoleSpies.warn,
      consoleSpies.log,
      consoleSpies.info,
    ]) {
      expect(spy).not.toHaveBeenCalled();
    }
    const rendered = JSON.stringify(consoleSpies.error.mock.calls);
    expect(rendered).not.toContain(API_KEY);
    expect(rendered).not.toContain(RECIPIENT);
    expect(rendered).not.toContain(VERIFICATION_URL);
    expect(rendered).not.toContain(VERIFICATION_TOKEN);
  });

  it("normalizes every sanitized delivery-failure reason", async () => {
    const reasons: AuthEmailDeliveryFailureReason[] = [
      "not-configured",
      "invalid-recipient",
      "invalid-sender",
      "invalid-url",
      "provider-unavailable",
      "provider-rejected",
    ];

    for (const reason of reasons) {
      const consoleSpies = captureConsole();
      const callback = verificationCallback(async () => {
        throw new AuthEmailDeliveryError(reason);
      });

      await expect(
        callback?.({
          user: { email: RECIPIENT } as never,
          url: VERIFICATION_URL,
          token: VERIFICATION_TOKEN,
        } as never),
      ).resolves.toBeUndefined();

      expect(consoleSpies.error).toHaveBeenCalledTimes(1);
      expect(consoleSpies.error).toHaveBeenCalledWith(
        AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE,
      );
      vi.restoreAllMocks();
    }
  });

  it("still propagates a non-sanitized unexpected error", async () => {
    const consoleSpies = captureConsole();
    const raw = new Error(PROVIDER_ERROR_MARKER);
    const callback = verificationCallback(async () => {
      throw raw;
    });

    await expect(
      callback?.({
        user: { email: RECIPIENT } as never,
        url: VERIFICATION_URL,
        token: VERIFICATION_TOKEN,
      } as never),
    ).rejects.toBe(raw);

    expect(consoleSpies.error).not.toHaveBeenCalled();
  });

  it("leaves the password-reset callback propagating so the native flow owns it", async () => {
    const authOptions = createAuthOptions({
      baseURL: "http://localhost:3000",
      email: {
        sendVerificationEmail: async () => {},
        sendPasswordResetEmail: async () => {
          throw new AuthEmailDeliveryError("provider-rejected");
        },
      },
    });

    await expect(
      authOptions.emailAndPassword.sendResetPassword?.({
        user: { email: RECIPIENT } as never,
        url: RESET_URL,
        token: RESET_TOKEN,
      } as never),
    ).rejects.toBeInstanceOf(AuthEmailDeliveryError);
  });
});

describe("Better Auth email callback delegation", () => {
  it("routes verification and reset callbacks only through AuthEmailOperations", async () => {
    const calls: { kind: string; to: string; url: string }[] = [];
    const authOptions = createAuthOptions({
      baseURL: "http://localhost:3000",
      email: {
        sendVerificationEmail: async (input) => {
          calls.push({ kind: "verification", ...input });
        },
        sendPasswordResetEmail: async (input) => {
          calls.push({ kind: "password-reset", ...input });
        },
      },
    });

    await authOptions.emailVerification.sendVerificationEmail?.({
      user: { email: RECIPIENT } as never,
      url: VERIFICATION_URL,
      token: VERIFICATION_TOKEN,
    } as never);
    await authOptions.emailAndPassword.sendResetPassword?.({
      user: { email: RECIPIENT } as never,
      url: RESET_URL,
      token: RESET_TOKEN,
    } as never);

    expect(calls).toEqual([
      { kind: "verification", to: RECIPIENT, url: VERIFICATION_URL },
      { kind: "password-reset", to: RECIPIENT, url: RESET_URL },
    ]);
  });

  it("keeps auth expiries sourced from the shared token policy", () => {
    const authOptions = createAuthOptions({
      baseURL: "http://localhost:3000",
      email: {
        sendVerificationEmail: async () => {},
        sendPasswordResetEmail: async () => {},
      },
    });

    expect(authOptions.emailVerification?.expiresIn).toBe(
      AUTH_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
    );
    expect(authOptions.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(
      AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS,
    );
  });

  it("keeps the Resend adapter out of the CLI-safe auth options module", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await readFile(
      path.resolve(process.cwd(), "src", "server", "auth", "options.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/from "resend"|Resend/);
  });
});
