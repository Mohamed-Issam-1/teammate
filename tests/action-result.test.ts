import { describe, expect, it } from "vitest";

import { fail, isFail, isOk, ok } from "@/lib/action-result";

describe("ActionResult", () => {
  it("wraps success values with ok()", () => {
    expect(ok({ id: "1" })).toEqual({ ok: true, data: { id: "1" } });
  });

  it("supports data-less success", () => {
    expect(ok(undefined)).toEqual({ ok: true, data: undefined });
  });

  it("builds failures without fieldErrors when none are given", () => {
    const result = fail("NOT_FOUND", "Project not found");

    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Project not found",
    });
    expect("fieldErrors" in result).toBe(false);
  });

  it("includes fieldErrors only when provided", () => {
    const result = fail("VALIDATION_ERROR", "Invalid input", {
      title: ["Required"],
    });

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Invalid input",
      fieldErrors: { title: ["Required"] },
    });
  });

  it("narrows the discriminated union with isOk/isFail", () => {
    const success = ok("done");
    const failure = fail("CONFLICT", "Already pending");

    expect(isOk(success)).toBe(true);
    expect(isFail(success)).toBe(false);
    expect(isOk(failure)).toBe(false);
    expect(isFail(failure)).toBe(true);

    if (isOk(success)) {
      expect(success.data).toBe("done");
    }
    if (isFail(failure)) {
      expect(failure.code).toBe("CONFLICT");
    }
  });
});
