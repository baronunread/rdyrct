import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as v from "valibot";
import type { LinkDTO, LinkInput, WithQuotaUsage } from "@/shared/types";
import { api } from "../lib/api";
import { useCurrentOrg } from "../lib/current-org";
import { useCurrentUser } from "../lib/hooks";
import { registerWebMcpTools, type WebMcpTool } from "../lib/webmcp";

const findLinksInput = v.object({
  query: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100))),
});

const createLinkInput = v.object({
  destination: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000)),
  title: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
});

function inputError(): string {
  return "That tool input is not valid. Check the required fields and try again.";
}

function linkSearchParams(query: string | undefined): string {
  const params = new URLSearchParams({ limit: "10" });
  if (query) params.set("q", query);
  return params.toString();
}

function conciseLink(link: LinkDTO): string {
  const address = link.domain ? `${link.domain}/${link.slug}` : `rdyrct.com/${link.slug}`;
  return `${address} → ${link.destination}${link.title ? ` (${link.title})` : ""}`;
}

function toolResult(message: string): string {
  return message.slice(0, 1_500);
}

/** Browser-agent tools available only after the signed-in answer is current. */
export function WebMcpLinkTools() {
  const currentUser = useCurrentUser();
  const { org } = useCurrentOrg();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentUser.data || !org) return;

    const tools: WebMcpTool[] = [
      {
        name: "find_links",
        description:
          "Search links in the current organization by slug, destination, or title. Returns concise, untrusted link text.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", maxLength: 100 } },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (input, options) => {
          const parsed = v.safeParse(findLinksInput, input);
          if (!parsed.success) return inputError();
          const result = await api<{ items: LinkDTO[] }>(
            `/orgs/${org.id}/links?${linkSearchParams(parsed.output.query)}`,
            { signal: options?.signal },
          );
          if (result.items.length === 0) return "No matching links in the current organization.";
          return toolResult(result.items.map(conciseLink).join("\n"));
        },
      },
      {
        name: "create_link",
        description:
          "Create a new tracked link in the current organization. Requires a destination URL and can include a title.",
        inputSchema: {
          type: "object",
          properties: {
            destination: { type: "string", minLength: 1, maxLength: 2_000 },
            title: { type: "string", maxLength: 200 },
          },
          required: ["destination"],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: async (input, options) => {
          const parsed = v.safeParse(createLinkInput, input);
          if (!parsed.success) return inputError();
          const body: LinkInput = { ...parsed.output, forceSeparateLink: true };
          const link = await api<WithQuotaUsage<LinkDTO>>(`/orgs/${org.id}/links`, {
            method: "POST",
            body,
            signal: options?.signal,
          });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["links", org.id] }),
            queryClient.invalidateQueries({ queryKey: ["stats", org.id] }),
            queryClient.invalidateQueries({ queryKey: ["linkQuotaUsage", org.id] }),
          ]);
          await navigate({ to: "/links" });
          return toolResult(`Created ${conciseLink(link)}. The Links page now shows it.`);
        },
      },
    ];

    return registerWebMcpTools(tools);
  }, [currentUser.data, navigate, org, queryClient]);

  return null;
}
