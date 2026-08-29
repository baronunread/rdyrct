import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as v from "valibot";
import type { JsonValue, LinkDTO, LinkInput, WithQuotaUsage } from "@/shared/types";
import { api } from "../lib/api";
import { useCurrentOrg } from "../lib/current-org";
import { useCurrentUser } from "../lib/hooks";
import { registerWebMcpTools, type WebMcpTool } from "../lib/webmcp";

const findLinksInput = v.object({
  query: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100))),
});

const slugField = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200));

const createLinkInput = v.object({
  destination: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000)),
  title: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
});

const getLinkInput = v.object({ slug: slugField });

const updateLinkInput = v.object({
  slug: slugField,
  destination: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000))),
  title: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
});

const deleteLinkInput = v.object({ slug: slugField });

type SlugSchema<T extends { slug: string }> = v.BaseSchema<unknown, T, v.BaseIssue<unknown>>;

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
    const orgId = org.id;

    const refreshLinks = () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["links", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["stats", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["linkQuotaUsage", orgId] }),
      ]);

    // Agents hold a slug, not the internal id the API keys on, so every
    // per-link tool resolves one through the same search the list page uses.
    const linkBySlug = async (slug: string, signal?: AbortSignal): Promise<LinkDTO | null> => {
      const result = await api<{ items: LinkDTO[] }>(
        `/orgs/${orgId}/links?${linkSearchParams(slug)}`,
        { signal },
      );
      return result.items.find((link) => link.slug === slug) ?? null;
    };

    // Parse a slug-keyed input, resolve the link, and hand both to the tool
    // body. Keeps get/update/delete free of the same three guard clauses.
    const withLink = async <T extends { slug: string }>(
      schema: SlugSchema<T>,
      input: JsonValue,
      signal: AbortSignal | undefined,
      run: (link: LinkDTO, parsed: T) => Promise<string>,
    ): Promise<string> => {
      const parsed = v.safeParse(schema, input);
      if (!parsed.success) return inputError();
      const link = await linkBySlug(parsed.output.slug, signal);
      if (!link) return "No link with that slug in the current organization.";
      return run(link, parsed.output);
    };

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
            `/orgs/${orgId}/links?${linkSearchParams(parsed.output.query)}`,
            { signal: options?.signal },
          );
          if (result.items.length === 0) return "No matching links in the current organization.";
          return toolResult(result.items.map(conciseLink).join("\n"));
        },
      },
      {
        name: "get_link",
        description:
          "Look up one link in the current organization by its exact slug. Returns its destination, title, click count, and address count as untrusted text.",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string", minLength: 1, maxLength: 200 } },
          required: ["slug"],
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) =>
          withLink(getLinkInput, input, options?.signal, async (link) =>
            toolResult(
              `${conciseLink(link)}. ${link.clicks} clicks, ${link.addressCount} addresses.`,
            ),
          ),
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
          const link = await api<WithQuotaUsage<LinkDTO>>(`/orgs/${orgId}/links`, {
            method: "POST",
            body,
            signal: options?.signal,
          });
          await refreshLinks();
          await navigate({ to: "/links" });
          return toolResult(`Created ${conciseLink(link)}. The Links page now shows it.`);
        },
      },
      {
        name: "update_link",
        description:
          "Change the destination and/or title of a link in the current organization, found by its exact slug. The slug itself does not change.",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", minLength: 1, maxLength: 200 },
            destination: { type: "string", minLength: 1, maxLength: 2_000 },
            title: { type: "string", maxLength: 200 },
          },
          required: ["slug"],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) =>
          withLink(
            updateLinkInput,
            input,
            options?.signal,
            async (link, { destination, title }) => {
              if (destination === undefined && title === undefined)
                return "Give a new destination or title to change.";
              // undefined keys drop out of the JSON body, so this is a true
              // partial patch: an untouched field keeps its stored value.
              const body: Partial<LinkInput> = { destination, title };
              const updated = await api<WithQuotaUsage<LinkDTO>>(
                `/orgs/${orgId}/links/${link.id}`,
                {
                  method: "PATCH",
                  body,
                  signal: options?.signal,
                },
              );
              await refreshLinks();
              await navigate({ to: "/links" });
              return toolResult(`Updated ${conciseLink(updated)}.`);
            },
          ),
      },
      {
        name: "delete_link",
        description:
          "Delete a link in the current organization, found by its exact slug. This stops the short link from redirecting, including any printed QR codes. It cannot be undone.",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string", minLength: 1, maxLength: 200 } },
          required: ["slug"],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) =>
          withLink(deleteLinkInput, input, options?.signal, async (link) => {
            await api(`/orgs/${orgId}/links/${link.id}`, {
              method: "DELETE",
              signal: options?.signal,
            });
            await refreshLinks();
            await navigate({ to: "/links" });
            return toolResult(`Deleted rdyrct.com/${link.slug}. It no longer redirects.`);
          }),
      },
    ];

    return registerWebMcpTools(tools);
  }, [currentUser.data, navigate, org, queryClient]);

  return null;
}
