import { z } from "zod";

export const orgNameSchema = z.object({
  name: z.string().min(1, "Enter an organization name").max(100),
});

export const destinationSchema = z.object({
  destination: z.url("Enter a valid URL"),
});

export const hostnameSchema = z.object({
  hostname: z
    .string()
    .min(1, "Enter a hostname")
    .regex(
      /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      "Enter a valid hostname (e.g. links.example.com)",
    ),
});

export const inviteEmailSchema = z.object({
  email: z.email("Enter a valid email address"),
  role: z.enum(["member", "admin"]),
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const signupSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const forgotSchema = z.object({
  email: z.email("Enter a valid email address"),
});

export const otpSchema = z.object({
  otp: z.string().length(6, "Enter a 6-digit code"),
});

const qrField = z.string().optional().default("");

export const linkInputSchema = z.object({
  destination: z.string().min(1, "Enter a destination URL"),
  domainId: z.string().nullable().optional().default(null),
  slug: z.string().optional().default(""),
  title: z.string().optional().default(""),
  utmSource: z.string().optional().default(""),
  utmMedium: z.string().optional().default(""),
  utmCampaign: z.string().optional().default(""),
  utmTerm: z.string().optional().default(""),
  utmContent: z.string().optional().default(""),
  qrStyle: qrField,
  qrColor: qrField,
  qrCorner: qrField,
  qrEyeColor: qrField,
  qrBg: qrField,
  qrLogo: qrField,
  qrLogoSize: z.number().nullable().optional().default(null),
});
