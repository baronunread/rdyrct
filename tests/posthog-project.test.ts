import { expect, test } from "bun:test";
import { posthogTokenForHost } from "../src/app/lib/posthog-project";

test("local dev and previews use only the development project", () => {
  for (const host of ["localhost", "rdyrct.localhost", "127.0.0.1", "[::1]"]) {
    expect(posthogTokenForHost(host, "production", "development")).toBe("development");
    expect(posthogTokenForHost(host, "production", undefined)).toBeUndefined();
  }
  expect(posthogTokenForHost("rdyrct.com", "production", "development")).toBe("production");
  expect(posthogTokenForHost("short.example.com", "production", "development")).toBe("production");
  expect(posthogTokenForHost("dev.example.com", "production", "development", true)).toBe(
    "development",
  );
  expect(posthogTokenForHost("dev.example.com", "production", undefined, true)).toBeUndefined();
});
