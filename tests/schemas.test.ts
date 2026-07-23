import { describe, expect, test } from "bun:test";
import {
  destinationSchema,
  hostnameSchema,
  inviteEmailSchema,
  linkInputSchema,
  loginSchema,
  orgNameSchema,
  otpSchema,
  signupSchema,
} from "../src/app/lib/schemas";

describe("form schemas", () => {
  test("accepts full and scheme-less destinations", () => {
    expect(destinationSchema.safeParse({ destination: "https://example.com/path" }).success).toBe(
      true,
    );
    expect(destinationSchema.safeParse({ destination: "example.com/path" }).success).toBe(true);
    expect(destinationSchema.safeParse({ destination: "not a URL" }).success).toBe(false);
  });

  test("rejects invalid hostnames and accepts a custom subdomain", () => {
    expect(hostnameSchema.safeParse({ hostname: "links.example.com" }).success).toBe(true);
    expect(hostnameSchema.safeParse({ hostname: "https://links.example.com" }).success).toBe(false);
    expect(hostnameSchema.safeParse({ hostname: "localhost" }).success).toBe(false);
  });

  test("enforces the user-facing auth and invite constraints", () => {
    expect(loginSchema.safeParse({ email: "person@example.com", password: "x" }).success).toBe(
      true,
    );
    expect(signupSchema.safeParse({ email: "person@example.com", password: "short" }).success).toBe(
      false,
    );
    expect(otpSchema.safeParse({ otp: "123456" }).success).toBe(true);
    expect(otpSchema.safeParse({ otp: "12345" }).success).toBe(false);
    expect(
      inviteEmailSchema.safeParse({ email: "person@example.com", role: "admin" }).success,
    ).toBe(true);
    expect(
      inviteEmailSchema.safeParse({ email: "person@example.com", role: "owner" }).success,
    ).toBe(false);
  });

  test("keeps form defaults and organization-name limits predictable", () => {
    const link = linkInputSchema.parse({ destination: "example.com" });
    expect(link.domainId).toBeNull();
    expect(link.slug).toBe("");
    expect(link.qrLogoSize).toBeNull();
    expect(orgNameSchema.safeParse({ name: "" }).success).toBe(false);
    expect(orgNameSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });
});
