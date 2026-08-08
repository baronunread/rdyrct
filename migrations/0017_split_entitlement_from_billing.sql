-- #81: user.plan carried two different facts at once, what a user may do and
-- what a user pays, and nothing told them apart. A comp written by an admin
-- was byte-identical to a plan written by a Polar webhook, so a
-- subscription.revoked could strip access an admin granted by hand, and every
-- revenue figure counted comps as money.
--
-- The two facts are now stored separately and `plan` becomes derived: it is
-- coalesce(comp_plan, entitling subscription_plan, 'free'), written only by
-- the resolver in src/worker/entitlement.ts. Nothing writes `plan` directly.

-- What Polar says. Only the webhook writes these.
alter table user add column subscription_plan text;
alter table user add column subscription_status text;
-- No price is stored (#82). Polar knows what it charged, net of discounts,
-- tax and refunds, so revenue is read in its dashboard rather than recomputed
-- here from a copy that would have to be kept true.

-- What an admin granted by hand. Only the comp routes write these, and a
-- webhook can never clear them.
alter table user add column comp_plan text;
alter table user add column comp_granted_by text references user (id) on delete set null;
alter table user add column comp_granted_at integer;
alter table user add column comp_reason text;

-- Backfill so that no one's access changes. A paid row with a Polar
-- subscription behind it is a subscription; a paid row without one can only
-- have come from the admin `Set plan` action this migration replaces.
update user
set subscription_plan = plan,
    subscription_status = 'active'
where plan <> 'free'
  and polar_subscription_id is not null;

update user
set comp_plan = plan,
    comp_granted_at = updated_at,
    comp_reason = 'Backfilled: granted through the admin plan control that predates comps (#81)'
where plan <> 'free'
  and polar_subscription_id is null;

-- Every row now derives back to the plan it already had:
-- coalesce(comp_plan, subscription_plan, 'free') = plan, for all three cases
-- (paid with a subscription, paid without one, free).

create index if not exists idx_user_comp_plan on user (comp_plan)
where comp_plan is not null;
create index if not exists idx_user_subscription_plan on user (subscription_plan)
where subscription_plan is not null;
