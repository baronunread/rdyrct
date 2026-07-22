import type { ReactNode } from "react";
import { useCurrentOrg } from "../lib/current-org";
import { NoOrgState } from "./no-org";

export function RequireOrg({ children }: { children: ReactNode }) {
  const { org } = useCurrentOrg();
  if (!org) return <NoOrgState />;
  return <>{children}</>;
}
