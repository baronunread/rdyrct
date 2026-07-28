import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import {
  destinationSchema,
  forgotSchema,
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
    expect(
      v.safeParse(destinationSchema, { destination: "https://example.com/path" }).success,
    ).toBe(true);
    expect(v.safeParse(destinationSchema, { destination: "example.com/path" }).success).toBe(true);
    expect(v.safeParse(destinationSchema, { destination: "not a URL" }).success).toBe(false);
  });

  test("rejects invalid hostnames and accepts a custom subdomain", () => {
    expect(v.safeParse(hostnameSchema, { hostname: "links.example.com" }).success).toBe(true);
    expect(v.safeParse(hostnameSchema, { hostname: "https://links.example.com" }).success).toBe(
      false,
    );
    expect(v.safeParse(hostnameSchema, { hostname: "localhost" }).success).toBe(false);
  });

  test("enforces the user-facing auth and invite constraints", () => {
    expect(v.safeParse(loginSchema, { email: "person@example.com", password: "x" }).success).toBe(
      true,
    );
    expect(
      v.safeParse(signupSchema, { email: "person@example.com", password: "short" }).success,
    ).toBe(false);
    expect(v.safeParse(otpSchema, { otp: "123456" }).success).toBe(true);
    expect(v.safeParse(otpSchema, { otp: "12345" }).success).toBe(false);
    expect(v.safeParse(forgotSchema, { email: "person@example.com" }).success).toBe(true);
    expect(v.safeParse(forgotSchema, { email: "not-an-email" }).success).toBe(false);
    expect(
      v.safeParse(inviteEmailSchema, { email: "person@example.com", role: "admin" }).success,
    ).toBe(true);
    expect(
      v.safeParse(inviteEmailSchema, { email: "person@example.com", role: "owner" }).success,
    ).toBe(false);
  });

  test("keeps form defaults and organization-name limits predictable", () => {
    const link = v.parse(linkInputSchema, { destination: "example.com" });
    expect(link.domainId).toBeNull();
    expect(link.slug).toBe("");
    expect(link.qrLogoSize).toBeNull();
    expect(v.safeParse(orgNameSchema, { name: "" }).success).toBe(false);
    expect(v.safeParse(orgNameSchema, { name: "   " }).success).toBe(false);
    expect(v.safeParse(orgNameSchema, { name: "x".repeat(101) }).success).toBe(false);
  });
});
