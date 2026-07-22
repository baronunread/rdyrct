import { z } from "zod";

export const orgNameSchema = z.object({
  name: z.string().min(1, "Enter an organization name").max(100),
});

export const destinationSchema = z.object({
  destination: z.string().url("Enter a valid URL"),
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
