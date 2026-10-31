import { useEffect } from "react";
import { useCurrentOrg } from "./current-org";
import { useDomains, useInvites, useLinkQuotaUsage, useMembers } from "./hooks";
import {
  finishSetup,
  startSetup,
  useOrgSetup,
  type OrgSetup,
  type PlanIntent,
  type SetupStep,
} from "./setup";
import type { DomainDTO, OrgPlan, UserOrg } from "@/shared/types";

export type StepState = "done" | "later" | "todo";

export interface SetupStepView {
  step: SetupStep;
  state: StepState;
}

export interface SetupView {
  orgId: string;
  plan: OrgPlan;
  intent: PlanIntent | undefined;
  steps: SetupStepView[];
  /** The first step still to do: the one the list opens. */
  open: SetupStep | null;
  done: number;
  total: number;
  /** The domain the owner added, if any, for the domain row's summary. */
  domain: DomainDTO | undefined;
}

/** Only the owner sets an org up: the plan is theirs, and domains and
 * invites are admin work a member could not finish anyway. */
function setsUp(org: UserOrg | null): org is UserOrg {
  return !!org && org.role === "owner" && !org.locked;
}

interface SetupCounts {
  links: number;
  domains: DomainDTO[];
  members: number;
  invites: number;
}

/** What an org this new must look like: one member and nothing else. */
const NEW_ORG: SetupCounts = { links: 0, domains: [], members: 1, invites: 0 };

/** The counts that decide each step, once all four have arrived. Each is its
 * own small request, and only asked for while a list is open. */
function useSetupCounts(orgId: string, live: boolean): SetupCounts | null {
  const links = useLinkQuotaUsage(live ? orgId : "");
  const domains = useDomains(orgId, live);
  const members = useMembers(live ? orgId : "");
  const invites = useInvites(orgId, live);
  if (!live || !links.data || !domains.data || !members.data || !invites.data) return null;
  return {
    links: links.data.count,
    domains: domains.data,
    members: members.data.length,
    invites: invites.data.length,
  };
}

/**
 * The setup list for the current org, or null when there is none to show:
 * never started in this browser, finished, not the owner, or still waiting
 * on the counts that decide each step.
 *
 * `newOrg` is the dashboard saying the org has no links yet. Then the list is
 * drawn at once from what an org that new must look like, so the page that a
 * sign-in card turns into is already the list and not a skeleton that
 * becomes one.
 */
export function useSetup({ newOrg = false }: { newOrg?: boolean } = {}): SetupView | null {
  const { org } = useCurrentOrg();
  const owner = setsUp(org) ? org : null;
  const orgId = owner?.id ?? "";
  const setup = useOrgSetup(orgId);
  const counts = useSetupCounts(orgId, isOpen(owner, setup) && !!setup);
  const view = viewOf(owner, setup, counts ?? (newOrg ? NEW_ORG : null));

  // Everything ticked or put off: the list has said its piece. Recorded so a
  // later state (the last link deleted) does not bring it back.
  const over = !!view && view.open === null;
  useEffect(() => {
    if (over) finishSetup(orgId);
  }, [over, orgId]);

  return over ? null : view;
}

function isOpen(owner: UserOrg | null, setup: OrgSetup | undefined): owner is UserOrg {
  return !!owner && !setup?.finished;
}

/** The list, when this owner's org has one open and its counts are known. */
function viewOf(owner: UserOrg | null, setup: OrgSetup | undefined, counts: SetupCounts | null) {
  if (!isOpen(owner, setup) || !counts) return null;
  return build(owner, setup?.plan, setup?.later ?? [], counts);
}

function build(
  org: UserOrg,
  intent: PlanIntent | undefined,
  later: SetupStep[],
  counts: SetupCounts,
): SetupView {
  const done = {
    plan: org.plan !== "free",
    link: counts.links > 0,
    domain: counts.domains.length > 0,
    team: counts.members > 1 || counts.invites > 0,
  } satisfies Record<SetupStep, boolean>;
  // The plan row only for somebody who came in through a pricing link.
  const order: SetupStep[] = intent
    ? ["plan", "link", "domain", "team"]
    : ["link", "domain", "team"];
  const steps = order.map((step) => ({
    step,
    state: done[step] ? "done" : later.includes(step) ? "later" : "todo",
  })) satisfies SetupStepView[];
  return {
    orgId: org.id,
    plan: org.plan,
    intent,
    steps,
    open: steps.find((s) => s.state === "todo")?.step ?? null,
    done: steps.filter((s) => s.state === "done").length,
    total: steps.length,
    domain: counts.domains[0],
  };
}

/**
 * Whether arriving through /welcome should open the list: only for an
 * owner whose org has no links and whose list never finished, the same rule
 * the dashboard starts it by. `known` stays false until the count is in.
 */
/** Whether /welcome may open the list, once that is known. */
interface WelcomeList {
  known: boolean;
  listed: boolean;
}

export function useWelcomeList(): WelcomeList {
  const { org } = useCurrentOrg();
  const orgId = setsUp(org) ? org.id : "";
  const setup = useOrgSetup(orgId);
  const links = useLinkQuotaUsage(orgId);
  return welcomeList(orgId, links.data?.count, setup);
}

function welcomeList(orgId: string, links: number | undefined, setup: OrgSetup | undefined) {
  if (!orgId) return { known: true, listed: false } satisfies WelcomeList;
  if (links === undefined) return { known: false, listed: false } satisfies WelcomeList;
  return { known: true, listed: links === 0 && !setup?.finished } satisfies WelcomeList;
}

/** Starts the list the first time an owner's dashboard has no links: the
 * moment the old first-run screen used to appear. An account that already
 * has links never gets one. */
export function useStartSetup(org: UserOrg | null, totalLinks: number | undefined) {
  const orgId = setsUp(org) ? org.id : null;
  useEffect(() => {
    if (orgId && totalLinks === 0) startSetup(orgId);
  }, [orgId, totalLinks]);
}
