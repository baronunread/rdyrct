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

function conciseLink(link: LinkDTO): string {
  const address = link.domain ? `${link.domain}/${link.slug}` : `rdyrct.com/${link.slug}`;
  return `${address} → ${link.destination}${link.title ? ` (${link.title})` : ""}`;
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
        execute: async (input, { signal }) => {
          const parsed = v.safeParse(findLinksInput, input);
          if (!parsed.success) return inputError();
          const params = new URLSearchParams({ limit: "10" });
          if (parsed.output.query) params.set("q", parsed.output.query);
          const result = await api<{ items: LinkDTO[] }>(`/orgs/${org.id}/links?${params}`, {
            signal,
          });
          if (result.items.length === 0) return "No matching links in the current organization.";
          return result.items.map(conciseLink).join("\n").slice(0, 1_500);
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
        execute: async (input, { signal }) => {
          const parsed = v.safeParse(createLinkInput, input);
          if (!parsed.success) return inputError();
          const body: LinkInput = { ...parsed.output, forceSeparateLink: true };
          const link = await api<WithQuotaUsage<LinkDTO>>(`/orgs/${org.id}/links`, {
            method: "POST",
            body,
            signal,
          });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["links", org.id] }),
            queryClient.invalidateQueries({ queryKey: ["stats", org.id] }),
            queryClient.invalidateQueries({ queryKey: ["linkQuotaUsage", org.id] }),
          ]);
          await navigate({ to: "/links" });
          return `Created ${conciseLink(link)}. The Links page now shows it.`;
        },
      },
    ];

    return registerWebMcpTools(tools);
  }, [currentUser.data, navigate, org, queryClient]);

  return null;
}
