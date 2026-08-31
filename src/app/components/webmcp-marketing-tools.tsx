import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as v from "valibot";
import { ORG_PLANS, PLAN_LIMITS, PLAN_PRICES, type OrgPlan } from "@/shared/types";
import { registerWebMcpTools, type WebMcpTool } from "../lib/webmcp";

/**
 * Read-only WebMCP tools for the logged-out marketing pages. They hand a
 * browser agent the same plan numbers and product summary the pages show,
 * so it answers "what does rdyrct cost" from a value it was given rather
 * than by scraping the layout. First-party static copy, no API, no auth.
 *
 * `create_qr_code` is the one that navigates: it opens the QR generator with
 * the value, so the code renders on a page the person can see. A data URL in
 * the tool result is invisible to a chat-style caller.
 */

const qrInput = v.object({
  value: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000)),
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
          "Show a free QR code for any link or text. Opens the QR generator at rdyrct.com/qr-code-generator; after it loads, call generate_qr_code with the same value to render the code on the page, and again to change its color, dot style, or logo. No account needed, nothing is sent anywhere.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string", minLength: 1, maxLength: 2_000 } },
          required: ["value"],
        },
        annotations: { readOnlyHint: true },
        execute: async (input) => {
          const parsed = v.safeParse(qrInput, input);
          if (!parsed.success) return "Provide a non-empty link or text of up to 2000 characters.";
          // A data URL in the tool result is invisible to the caller, so this
          // just opens the generator. The navigate must not reject, or the
          // failure shows instead. generate_qr_code fills the form from there.
          await navigate({ to: "/qr-code-generator" }).catch(() => {});
          return `The QR generator is open at rdyrct.com/qr-code-generator. Call generate_qr_code with value "${parsed.output.value}" to render the code on the page.`;
        },
      },
    ];

    return registerWebMcpTools(tools);
  }, [navigate]);

  return null;
}
