import * as v from "valibot";

export const orgNameSchema = v.object({
  name: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, "Enter an organization name"),
    v.maxLength(100),
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
  role: v.picklist(["member", "admin"]),
});

export const loginSchema = v.object({
  email: v.pipe(v.string(), v.email("Enter a valid email address")),
  password: v.pipe(v.string(), v.minLength(1, "Enter your password")),
});

export const signupSchema = v.object({
  email: v.pipe(v.string(), v.email("Enter a valid email address")),
  password: v.pipe(v.string(), v.minLength(8, "Password must be at least 8 characters")),
});

export const forgotSchema = v.object({
  email: v.pipe(v.string(), v.email("Enter a valid email address")),
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
