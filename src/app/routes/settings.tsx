import { useState } from "react";
import { useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "../lib/hooks";
import { api } from "../lib/api";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Card, PageHeader } from "../ui/misc";
import { useToast } from "../ui/toast";

export function SettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const org = me.data?.orgs.find((o) => o.id === orgId);
  const isOwner = me.data?.user.isAdmin || org?.role === "owner";
  const [name, setName] = useState(org?.name ?? "");

  const rename = async () => {
    try {
      await api(`/orgs/${orgId}`, { method: "PATCH", body: { name } });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast("Organization renamed");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageHeader title="Settings" sub="Organization settings" />
      <Card className="max-w-lg">
        <div className="flex flex-col gap-4">
          <Field label="Organization name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
            />
          </Field>
          <Field label="Organization id">
            <Input value={orgId} disabled readOnly />
          </Field>
          {isOwner ? (
            <div>
              <Button variant="primary" onClick={rename} disabled={!name.trim()}>
                Save
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted">
              Only the owner can change these settings.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
