import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as v from "valibot";
import { ORG_PLANS, PLAN_LIMITS, PLAN_PRICES, type OrgPlan } from "@/shared/types";
import { resolveLook } from "../lib/qr-look";
import { registerWebMcpTools, type WebMcpTool } from "../lib/webmcp";

/**
 * Read-only WebMCP tools for the logged-out marketing pages. They hand a
 * browser agent the same plan numbers and product summary the pages show,
 * so it answers "what does rdyrct cost" from a value it was given rather
 * than by scraping the layout. First-party static copy, no API, no auth.
 *
 * The one exception is `create_qr_code`: it renders a real code so an agent
 * on any page can make one from a link. The renderer is a dynamic import so
 * qr-code-styling never lands in the marketing bundle, only in the chunk the
 * tool call pulls.
 */

const qrInput = v.object({
  value: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000)),
  format: v.optional(v.picklist(["png", "svg"])),
});

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function planLine(plan: OrgPlan): string {
  const limits = PLAN_LIMITS[plan];
  const name = plan[0].toUpperCase() + plan.slice(1);
  const price = plan === "free" ? "$0" : `${PLAN_PRICES[plan]}/mo`;
  const qr = limits.qrCustom ? "branded QR codes (logo and colors)" : "plain QR codes only";
  return (
    `${name} (${price}): ${plural(limits.links, "link")}, ${plural(limits.members, "team member")}, ` +
    `${plural(limits.domains, "custom domain")}, ${limits.analyticsDays}-day click analytics, ` +
    `${plural(limits.orgs, "organization")}, ${qr}.`
  );
}

const PRICING = [
  ...ORG_PLANS.map(planLine),
  "Only the organization owner needs a paid plan; one subscription covers every organization they own.",
  "rdyrct is open source and self-hosts on your own Cloudflare account with everything Pro has, minus email support.",
].join("\n");

const OVERVIEW = [
  "rdyrct is a link shortener and QR code generator for teams, running entirely on Cloudflare.",
  "The free plan is a working shortener: short links, click tracking (country, referrer, device, and time, never an IP address), and a QR code generator. No credit card.",
  "Paid plans add a custom domain with your own slugs, branded QR codes, more links and team members, and a longer analytics history.",
  "Links on the shared domain always get a random slug; chosen slugs need a custom domain.",
].join(" ");

function marketingResult(message: string): string {
  return message.slice(0, 2_000);
}

/** Mounted on the landing page and every standalone marketing page, including
 * the QR generator and the legal pages. */
export function WebMcpMarketingTools() {
  const navigate = useNavigate();

  useEffect(() => {
    const tools: WebMcpTool[] = [
      {
        name: "get_rdyrct_pricing",
        description:
          "Get rdyrct's plans, prices, and per-plan limits (links, team members, custom domains, analytics history).",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => marketingResult(PRICING),
      },
      {
        name: "get_rdyrct_overview",
        description:
          "Get a short summary of what rdyrct is, what the free plan includes, and what paid plans add.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => marketingResult(OVERVIEW),
      },
      {
        name: "create_qr_code",
        description:
          "Generate a free QR code for any link or text. Returns it as an image data URL (PNG or SVG) and opens the full generator at rdyrct.com/qr-code-generator with that value, where generate_qr_code and download_qr_code can change the colors, dot style, or logo and save a file. No account needed, and nothing is sent anywhere.",
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string", minLength: 1, maxLength: 2_000 },
            format: { type: "string", enum: ["png", "svg"] },
          },
          required: ["value"],
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (input) => {
          const parsed = v.safeParse(qrInput, input);
          if (!parsed.success) return "Provide a non-empty link or text of up to 2000 characters.";
          const { qrDataUrl } = await import("./qr");
          const look = resolveLook({});
          const value = parsed.output.value;
          // qrDataUrl renders a PNG through a canvas instance now, but keep a
          // SVG fallback so a flaky raster still returns something usable.
          const render = (format: "png" | "svg") =>
            qrDataUrl(value, look, format).catch(() => null);
          const dataUrl = (await render(parsed.output.format ?? "png")) ?? (await render("svg"));
          await navigate({ to: "/qr-code-generator", search: { value } });
          return (
            dataUrl ??
            "Opened the QR generator with that value. Use download_qr_code there to save the file."
          );
        },
      },
    ];

    return registerWebMcpTools(tools);
  }, [navigate]);

  return null;
}
