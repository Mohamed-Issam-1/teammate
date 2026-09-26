// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  isValidTimeZone,
  profileEditSchema,
  PROFILE_VISIBILITY_VALUES,
} from "@/features/profile/validation";

/**
 * Validation is the only control on the approved editable fields, so these tests
 * pin the exact server-side contract rather than mirroring the schema.
 */

function valid(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Robin Fields",
    headline: "Backend engineer",
    bio: "A short bio.",
    availabilityHoursPerWeek: "10",
    timezone: "Europe/London",
    profileVisibility: "PRIVATE",
    ...overrides,
  };
}

describe("displayName", () => {
  it("trims surrounding whitespace", () => {
    const result = profileEditSchema.safeParse(
      valid({ displayName: "  Robin Fields  " }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.displayName).toBe("Robin Fields");
  });

  it("accepts the approved 2 and 80 character boundaries", () => {
    for (const value of ["ab", "a".repeat(80)]) {
      expect(
        profileEditSchema.safeParse(valid({ displayName: value })).success,
      ).toBe(true);
    }
  });

  it("rejects a name that is too short or too long", () => {
    expect(
      profileEditSchema.safeParse(valid({ displayName: "a" })).success,
    ).toBe(false);
    expect(
      profileEditSchema.safeParse(valid({ displayName: "a".repeat(81) }))
        .success,
    ).toBe(false);
  });

  it("rejects control characters", () => {
    for (const controlCode of [0, 7, 27, 127]) {
      const hostile = `Robin${String.fromCharCode(controlCode)}Fields`;

      expect(
        profileEditSchema.safeParse(valid({ displayName: hostile })).success,
        `code ${controlCode}`,
      ).toBe(false);
    }
  });
});

describe("headline", () => {
  it("normalizes an empty or whitespace-only value to null", () => {
    for (const value of ["", "   "]) {
      const result = profileEditSchema.safeParse(valid({ headline: value }));

      expect(result.success).toBe(true);
      expect(result.data?.headline).toBeNull();
    }
  });

  it("accepts the 120 character boundary and rejects beyond it", () => {
    expect(
      profileEditSchema.safeParse(valid({ headline: "a".repeat(120) })).success,
    ).toBe(true);
    expect(
      profileEditSchema.safeParse(valid({ headline: "a".repeat(121) })).success,
    ).toBe(false);
  });
});

describe("bio", () => {
  it("normalizes an empty value to null", () => {
    const result = profileEditSchema.safeParse(valid({ bio: "   " }));

    expect(result.success).toBe(true);
    expect(result.data?.bio).toBeNull();
  });

  it("accepts the 2000 character boundary and rejects beyond it", () => {
    expect(
      profileEditSchema.safeParse(valid({ bio: "a".repeat(2000) })).success,
    ).toBe(true);
    expect(
      profileEditSchema.safeParse(valid({ bio: "a".repeat(2001) })).success,
    ).toBe(false);
  });

  it("permits normal Unicode and line breaks but rejects other control characters", () => {
    const permitted = profileEditSchema.safeParse(
      valid({ bio: "Line one\nLine two\ttabbed — ünïcodé ✅" }),
    );

    expect(permitted.success).toBe(true);
    expect(permitted.data?.bio).toContain("\n");
    expect(permitted.data?.bio).toContain("\t");

    for (const controlCode of [0, 7, 8, 11, 12, 27, 127]) {
      const hostile = `before${String.fromCharCode(controlCode)}after`;

      expect(
        profileEditSchema.safeParse(valid({ bio: hostile })).success,
        `code ${controlCode}`,
      ).toBe(false);
    }
  });
});

describe("availabilityHoursPerWeek", () => {
  it("normalizes an empty value to null", () => {
    for (const value of ["", "   "]) {
      const result = profileEditSchema.safeParse(
        valid({ availabilityHoursPerWeek: value }),
      );

      expect(result.success).toBe(true);
      expect(result.data?.availabilityHoursPerWeek).toBeNull();
    }
  });

  it("accepts the inclusive 0 and 168 boundaries", () => {
    for (const value of [0, 168, "0", "168"]) {
      expect(
        profileEditSchema.safeParse(valid({ availabilityHoursPerWeek: value }))
          .success,
      ).toBe(true);
    }
  });

  it("rejects negative and above-range values", () => {
    for (const value of [-1, 169, "-1", "169", 1000]) {
      expect(
        profileEditSchema.safeParse(valid({ availabilityHoursPerWeek: value }))
          .success,
      ).toBe(false);
    }
  });

  it("rejects fractional and non-numeric input", () => {
    for (const value of [1.5, "1.5", "abc", "10h", Number.NaN]) {
      expect(
        profileEditSchema.safeParse(valid({ availabilityHoursPerWeek: value }))
          .success,
      ).toBe(false);
    }
  });
});

describe("timezone", () => {
  it("normalizes an empty value to null", () => {
    const result = profileEditSchema.safeParse(valid({ timezone: "  " }));

    expect(result.success).toBe(true);
    expect(result.data?.timezone).toBeNull();
  });

  it("accepts real IANA zone identifiers", () => {
    for (const zone of [
      "UTC",
      "Asia/Gaza",
      "Europe/London",
      "America/New_York",
    ]) {
      const result = profileEditSchema.safeParse(valid({ timezone: zone }));

      expect(result.success, zone).toBe(true);
      expect(result.data?.timezone).toBe(zone);
    }
  });

  it("rejects an invalid zone identifier", () => {
    for (const zone of [
      "Not/AZone",
      "Europe/Nowhere",
      "../etc/passwd",
      "GMT+25:00",
    ]) {
      expect(
        profileEditSchema.safeParse(valid({ timezone: zone })).success,
        zone,
      ).toBe(false);
    }
  });

  it("validates zones with the runtime database, not an allowlist", () => {
    expect(isValidTimeZone("Pacific/Auckland")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Nowhere/Special")).toBe(false);
  });
});

describe("profileVisibility", () => {
  it("accepts only the approved values", () => {
    for (const value of PROFILE_VISIBILITY_VALUES) {
      expect(
        profileEditSchema.safeParse(valid({ profileVisibility: value }))
          .success,
      ).toBe(true);
    }
  });

  it("rejects any other string", () => {
    for (const value of ["public", "ADMIN", "", "MEMBERS", "PUBLIC "]) {
      expect(
        profileEditSchema.safeParse(valid({ profileVisibility: value }))
          .success,
      ).toBe(false);
    }
  });
});

describe("schema idempotency", () => {
  it("accepts its own normalized output, so a cleared field can be saved", () => {
    // The form resolver emits null for a cleared optional field, and the server
    // action re-validates that output with this same schema. Without this
    // property the second parse fails and no cleared field can ever be saved.
    const first = profileEditSchema.parse({
      ...valid(),
      headline: "  ",
      bio: "",
      availabilityHoursPerWeek: "",
      timezone: "  ",
    });

    expect(first).toMatchObject({
      headline: null,
      bio: null,
      availabilityHoursPerWeek: null,
      timezone: null,
    });

    const second = profileEditSchema.safeParse(first);

    expect(second.success).toBe(true);
    expect(second.data).toEqual(first);
  });

  it("treats an explicit null as a cleared optional field", () => {
    const result = profileEditSchema.safeParse({
      ...valid(),
      headline: null,
      bio: null,
      availabilityHoursPerWeek: null,
      timezone: null,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      headline: null,
      bio: null,
      availabilityHoursPerWeek: null,
      timezone: null,
    });
  });

  it("still rejects a non-string, non-null optional value", () => {
    for (const value of [123, true, {}, []]) {
      expect(
        profileEditSchema.safeParse(valid({ headline: value })).success,
      ).toBe(false);
    }
  });
});

describe("mass-assignment rejection", () => {
  it("rejects a payload that tries to set a protected field", () => {
    for (const [field, value] of [
      ["userId", "someone-else"],
      ["avatarUrl", "https://attacker.example/x.png"],
      ["onboardingCompletedAt", "2020-01-01T00:00:00.000Z"],
      ["createdAt", "2020-01-01T00:00:00.000Z"],
      ["updatedAt", "2020-01-01T00:00:00.000Z"],
      ["globalRole", "ADMIN"],
      ["accountStatus", "ACTIVE"],
      ["emailVerified", true],
      ["name", "Injected Name"],
      ["image", "https://attacker.example/x.png"],
    ] as const) {
      const result = profileEditSchema.safeParse(valid({ [field]: value }));

      expect(result.success, field).toBe(false);
    }
  });

  it("does not silently drop an unknown key", () => {
    const result = profileEditSchema.safeParse(valid({ somethingElse: "x" }));

    expect(result.success).toBe(false);
  });
});
