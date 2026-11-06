/**
 * Who a newsletter goes to, as one line the composer can read at a glance
 * ("Offers · Free accounts with no link yet"), with the list and filters
 * behind it in a small popover. The words for each filter live here too, so
 * the summary, the count sentence, the confirm dialog and the history all
 * say the same thing.
 */
import { useId } from "react";
import { Popover } from "@base-ui/react/popover";
import { buttonClass } from "../../ui/button-class";
import { Field, Select } from "../../ui/field";
import { Skeleton } from "../../ui/skeleton";
import { fullNumber } from "./admin-kit";
import { oneOf } from "@/shared/lookup";
import {
  ACTIVE_WITHIN_DAYS,
  AUDIENCE_PLANS,
  AUDIENCE_STAGES,
  MARKETING_LIST_LABELS,
  MARKETING_LISTS,
  type AudienceFilter,
  type AudiencePlan,
  type AudienceStage,
  type MarketingList,
  type NewsletterAudienceCount,
} from "@/shared/types";

const STAGE_LABELS = {
  any: "Everyone",
  new: "New",
  active: "Active",
  slipping: "Slipping away",
} satisfies Record<AudienceStage, string>;

/** The stage picker's options, each with what it means. */
const STAGE_OPTIONS = {
  any: "Everyone",
  new: "New: no link yet",
  active: `Active: back in the last ${ACTIVE_WITHIN_DAYS} days`,
  slipping: `Slipping away: not back for ${ACTIVE_WITHIN_DAYS} days`,
} satisfies Record<AudienceStage, string>;

const PLAN_LABELS = { any: "Any plan", free: "Free", paid: "Paid" } satisfies Record<
  AudiencePlan,
  string
>;

/** What each filter keeps, as the end of "people on Offers who …". */
const STAGE_WORDS = {
  any: null,
  new: "have not made a link yet",
  active: `made a link and came back in the last ${ACTIVE_WITHIN_DAYS} days`,
  slipping: `made a link but have not been back for ${ACTIVE_WITHIN_DAYS} days`,
} satisfies Record<AudienceStage, string | null>;
const PLAN_WORDS = {
  any: null,
  free: "are on Free",
  paid: "are on a paid plan",
} satisfies Record<AudiencePlan, string | null>;

/** The summary's words for each filter. */
const PLAN_NOUN = {
  any: "accounts",
  free: "Free accounts",
  paid: "paid accounts",
} satisfies Record<AudiencePlan, string>;
const STAGE_SUFFIX = {
  any: "",
  new: " with no link yet",
  active: ` back in the last ${ACTIVE_WITHIN_DAYS} days`,
  slipping: ` not back for ${ACTIVE_WITHIN_DAYS} days`,
} satisfies Record<AudienceStage, string>;

/** "Offers · everyone", "Offers · Free accounts with no link yet". */
function audienceSummary(list: MarketingList, filter: AudienceFilter): string {
  const everyone = filter.stage === "any" && filter.plan === "any";
  const who = everyone ? "everyone" : `${PLAN_NOUN[filter.plan]}${STAGE_SUFFIX[filter.stage]}`;
  return `${MARKETING_LIST_LABELS[list]} · ${who}`;
}

/** "people on Offers who are on Free and have not made a link yet", after
 * a count of `n`. */
export function audienceTail(n: number, list: MarketingList, filter: AudienceFilter): string {
  const clauses = [PLAN_WORDS[filter.plan], STAGE_WORDS[filter.stage]].filter(Boolean);
  const who = clauses.length > 0 ? ` who ${clauses.join(" and ")}` : "";
  return `${n === 1 ? "person" : "people"} on ${MARKETING_LIST_LABELS[list]}${who}`;
}

/** The filters a past send used, for its history line; nothing for none. */
export function filterLabels(filter: AudienceFilter): string[] {
  return [
    filter.stage === "any" ? null : STAGE_LABELS[filter.stage],
    filter.plan === "any" ? null : PLAN_LABELS[filter.plan],
  ].filter((label) => label !== null);
}

/** The audience as a field: its summary, Edit, and how many people that is. */
export function AudienceField({
  list,
  filter,
  counted,
  stale,
  disabled,
  onList,
  onFilter,
}: {
  list: MarketingList;
  filter: AudienceFilter;
  /** The last count and what it counted; worded from its own list and filter. */
  counted: NewsletterAudienceCount | undefined;
  /** A newer count is on its way: the one shown is for the previous choice. */
  stale: boolean;
  disabled: boolean;
  onList: (list: MarketingList) => void;
  onFilter: (filter: AudienceFilter) => void;
}) {
  const labelId = useId();
  const summaryId = useId();
  return (
    <div className="flex min-w-0 flex-col">
      <span id={labelId} className="mb-1.5 text-xs text-muted">
        Audience
      </span>
      <Popover.Root>
        <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-surface py-1 pr-1 pl-3 smooth-shadow-ring-xs">
          <span id={summaryId} className="min-w-0 truncate text-sm font-medium">
            {audienceSummary(list, filter)}
          </span>
          <Popover.Trigger
            disabled={disabled}
            aria-describedby={summaryId}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            Edit audience
          </Popover.Trigger>
        </div>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} align="end" collisionPadding={8} className="z-50">
            <Popover.Popup className="flex w-[min(320px,calc(100vw-1.5rem))] origin-[var(--transform-origin)] flex-col gap-3 rounded-xl bg-surface p-4 smooth-shadow-ring-xl transition-[opacity,scale,filter] duration-150 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:blur-[4px] data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none">
              <Popover.Title className="sr-only">Audience</Popover.Title>
              <Field label="List">
                <Select
                  value={list}
                  onChange={(e) => onList(oneOf(MARKETING_LISTS, e.target.value, list))}
                >
                  {MARKETING_LISTS.map((id) => (
                    <option key={id} value={id}>
                      {MARKETING_LIST_LABELS[id]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Stage">
                <Select
                  value={filter.stage}
                  onChange={(e) =>
                    onFilter({
                      ...filter,
                      stage: oneOf(AUDIENCE_STAGES, e.target.value, filter.stage),
                    })
                  }
                >
                  {AUDIENCE_STAGES.map((id) => (
                    <option key={id} value={id}>
                      {STAGE_OPTIONS[id]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Plan">
                <Select
                  value={filter.plan}
                  onChange={(e) =>
                    onFilter({
                      ...filter,
                      plan: oneOf(AUDIENCE_PLANS, e.target.value, filter.plan),
                    })
                  }
                >
                  {AUDIENCE_PLANS.map((id) => (
                    <option key={id} value={id}>
                      {PLAN_LABELS[id]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Popover.Description className="text-xs text-pretty text-muted">
                Only people who opted in to the list, verified their address and are not banned.
              </Popover.Description>
              <Popover.Close className={buttonClass({ variant: "outline", className: "w-full" })}>
                Done
              </Popover.Close>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {/* One line kept whatever the filters say, so nothing below jumps. */}
      <div aria-live="polite" className="mt-1.5 flex min-h-5 items-center text-xs text-muted">
        {counted === undefined ? (
          <Skeleton className="h-3.5 w-56 max-w-full" />
        ) : (
          <p
            data-testid="newsletter-audience"
            aria-busy={stale}
            className={stale ? "opacity-50 transition-opacity" : "transition-opacity"}
          >
            <span className="font-semibold text-text tabular-nums">
              {fullNumber(counted.count)}
            </span>{" "}
            {audienceTail(counted.count, counted.list, counted.filter)}.
          </p>
        )}
      </div>
    </div>
  );
}
