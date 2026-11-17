import * as v from "valibot";
import { INVITABLE_ROLES } from "@/shared/types";

// The server decides what counts as a web address and accepts scheme-less input,
// so this only checks that something was typed.
export const orgNameSchema = v.object({
  name: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, "Enter an organization name"),
    v.maxLength(100),
  ),
});

export const accountNameSchema = v.object({
  name: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, "Enter your name"),
    v.maxLength(100, "Name must be 100 characters or fewer"),
  ),
});

const tryUrl = (val: string) => v.is(v.pipe(v.string(), v.url()), val);

const destinationField = v.pipe(
  v.string(),
  v.check((val) => tryUrl(val) || tryUrl(`https://${val}`), "Enter a valid URL"),
);

export const destinationSchema = v.object({
  destination: destinationField,
});

export const hostnameSchema = v.object({
  hostname: v.pipe(
    v.string(),
    v.minLength(1, "Enter a hostname"),
    v.regex(
      /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      "Enter a valid hostname (e.g. links.example.com)",
    ),
  ),
});

export const inviteEmailSchema = v.object({
  email: v.pipe(v.string(), v.email("Enter a valid email address")),
  role: v.picklist(INVITABLE_ROLES),
});

const authEmail = v.pipe(v.string(), v.nonEmpty("Required"), v.email("Not a valid email"));

export const loginSchema = v.object({
  email: authEmail,
  password: v.pipe(v.string(), v.nonEmpty("Required")),
});

export const signupSchema = v.object({
  email: authEmail,
  password: v.pipe(v.string(), v.nonEmpty("Required"), v.minLength(8, "At least 8 characters")),
});

export const forgotSchema = v.object({
  email: authEmail,
});

export const otpSchema = v.object({
  otp: v.pipe(v.string(), v.length(6, "Enter a 6-digit code")),
});

const qrField = v.optional(v.string(), "");

export const linkInputSchema = v.object({
  destination: destinationField,
  domainId: v.optional(v.nullable(v.string()), null),
  slug: v.optional(v.string(), ""),
  title: v.optional(v.string(), ""),
  utmSource: v.optional(v.string(), ""),
  utmMedium: v.optional(v.string(), ""),
  utmCampaign: v.optional(v.string(), ""),
  utmTerm: v.optional(v.string(), ""),
  utmContent: v.optional(v.string(), ""),
  qrStyle: qrField,
  qrColor: qrField,
  qrCorner: qrField,
  qrEyeColor: qrField,
  qrBg: qrField,
  qrLogo: qrField,
  qrLogoSize: v.optional(v.nullable(v.number()), null),
});
