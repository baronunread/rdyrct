import { describe, expect, it } from "bun:test";
import { ApiError } from "../src/app/lib/api";
import { linkFieldError } from "../src/app/lib/link-field-errors";

describe("linkFieldError", () => {
  it("puts a coded refusal on its field, with the server's words as the detail", () => {
    const error = new ApiError(400, "That slug is reserved", "reserved_slug");
    expect(linkFieldError(error)).toEqual({
      field: "slug",
      reason: "Reserved",
      detail: "That slug is reserved",
    });
    expect(linkFieldError(new ApiError(422, "x", "blocked_destination"))?.field).toBe(
      "destination",
    );
  });

  it("leaves an error with no code, or a code no field owns, to a toast", () => {
    // The message alone no longer decides: only the code does.
    expect(linkFieldError(new ApiError(400, "That slug is reserved"))).toBeNull();
    expect(linkFieldError(new ApiError(402, "Upgrade", "qr_locked"))).toBeNull();
    expect(linkFieldError(new ApiError(400, "x", "toString"))).toBeNull();
    expect(linkFieldError(new Error("network"))).toBeNull();
  });
});
