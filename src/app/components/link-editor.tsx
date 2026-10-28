import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useForm, type SubmitErrorHandler } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Link as RouterLink } from "@tanstack/react-router";
import { ArrowLeft, Lock, Plus, QrCode } from "@/app/ui/icons";
import { shortUrl } from "../lib/api";
import { useLinkHost } from "../lib/hooks";
import type { DomainDTO, LinkInput } from "@/shared/types";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { QRPreview } from "./qr";
import { LinkQrEditor, withoutQrOverrides } from "./link-qr-editor";
import { linkInputSchema } from "../lib/schemas";
import { resolveQrLook, type OrgQr } from "../lib/org-qr";
import { resolveDefaultDomainId } from "../lib/default-domain";
import { useShake } from "../lib/use-shake";

const defaultForm: LinkInput = {
  destination: "",
  domainId: null,
  slug: "",
  title: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
  qrStyle: "",
  qrColor: "",
  qrCorner: "",
  qrEyeColor: "",
  qrBg: "",
  qrLogo: "",
  qrLogoSize: null,
};

type UtmKey = "utmSource" | "utmMedium" | "utmCampaign" | "utmTerm" | "utmContent";

/** The link's own QR look, as opposed to the organization's defaults. The
 * server refuses these outright on a plan without qrCustom. */
const QR_OVERRIDE_FIELDS = [
  "qrStyle",
  "qrColor",
  "qrCorner",
  "qrEyeColor",
  "qrBg",
  "qrLogo",
  "qrLogoSize",
] as const;

/** Whether this link already carries a QR look of its own, so the editor can
 * say it is kept and locked rather than showing an upsell for a feature the
 * link is visibly using (#162). */
function hasQrOverrides(data: LinkInput): boolean {
  return QR_OVERRIDE_FIELDS.some((field) =>
    field === "qrLogoSize" ? data.qrLogoSize != null : !!data[field],
  );
}

/** The three tags people set on almost every link, shown at once; term and
 * content sit behind one line until somebody wants them. */
const UTM_MAIN: { key: UtmKey; label: string; placeholder: string }[] = [
  { key: "utmSource", label: "Source", placeholder: "newsletter" },
  { key: "utmMedium", label: "Medium", placeholder: "email" },
  { key: "utmCampaign", label: "Campaign", placeholder: "spring-sale" },
];
const UTM_MORE: { key: UtmKey; label: string; placeholder: string }[] = [
  { key: "utmTerm", label: "Term", placeholder: "running-shoes" },
  { key: "utmContent", label: "Content", placeholder: "ad-variant-a" },
];

const UTM_PARAMS: { param: string; key: UtmKey }[] = [
  { param: "utm_source", key: "utmSource" },
  { param: "utm_medium", key: "utmMedium" },
  { param: "utm_campaign", key: "utmCampaign" },
  { param: "utm_term", key: "utmTerm" },
  { param: "utm_content", key: "utmContent" },
];

// SAFETY: Object.fromEntries types its result as an open record whatever it
// is given. UTM_PARAMS lists every UtmKey exactly once, so the object built
// from it has one entry per key.
const UTM_PARAM_BY_KEY = Object.fromEntries(
  UTM_PARAMS.map(({ param, key }) => [key, param] as const),
) as Record<UtmKey, string>;

/** UTM params already in the pasted/typed URL, mirroring the server's
 * resolveUtm: params present in the destination win over whatever is in
 * the form fields. A param that's present but empty still wins (so
 * backspacing its value out clears the field instead of leaving a stale
 * one behind); a param that's absent leaves the field alone. */
function utmFromDestination(destination: string) {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return {};
  }
  const out: Partial<Record<UtmKey, string>> = {};
  for (const { param, key } of UTM_PARAMS) {
    if (url.searchParams.has(param)) out[key] = url.searchParams.get(param)!.trim();
  }
  return out;
}

/** Drop a UTM param from the destination's query string, if present. Used
 * when a UTM field is edited by hand, so the field's value (not a stale
 * copy baked into the destination) is what wins on submit. */
function withoutUtmParam(destination: string, param: string): string {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return destination;
  }
  if (!url.searchParams.has(param)) return destination;
  url.searchParams.delete(param);
  return url.toString();
}

/** Same normalization the server applies on save (see stripUtmParams in
 * src/worker/util.ts): drop every utm_* param, leave the rest alone. */
function stripUtmFromDestination(destination: string): string {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return destination;
  }
  for (const { param } of UTM_PARAMS) url.searchParams.delete(param);
  return url.toString();
}

/** Splice pasted text into an input's current selection, the way the
 * browser's own paste would, so a partial selection is respected instead of
 * always replacing the whole field. */
function mergePastedText(input: HTMLInputElement, pasted: string): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  return input.value.slice(0, start) + pasted + input.value.slice(end);
}

/** Where the link will send people, split so the tags it adds can be told
 * from the address that was typed. Mirrors the save: the destination with
 * its own utm_* params dropped, then the fields' values added. */
function openedUrl(form: LinkInput): { base: string; tags: string } | null {
  const raw = form.destination.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { base: raw, tags: "" };
  }
  for (const { param } of UTM_PARAMS) url.searchParams.delete(param);
  const hash = url.hash;
  url.hash = "";
  const tags = new URLSearchParams();
  for (const { param, key } of UTM_PARAMS) {
    const value = form[key]?.trim();
    if (value) tags.set(param, value);
  }
  const base = url.toString().replace(/^https?:\/\//, "");
  const query = tags.toString();
  return { base, tags: (query ? (url.search ? "&" : "?") + query : "") + hash };
}

type SetForm = (f: LinkInput) => void;

function UtmInput({
  field,
  form,
  setForm,
}: {
  field: { key: UtmKey; label: string; placeholder: string };
  form: LinkInput;
  setForm: SetForm;
}) {
  const { key, label, placeholder } = field;
  return (
    <Field label={label}>
      <Input
        value={form[key] ?? ""}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: e.target.value,
            destination: withoutUtmParam(form.destination, UTM_PARAM_BY_KEY[key]),
          })
        }
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="px-2.5 font-mono text-xs"
      />
    </Field>
  );
}

/** UTM tags inline, because people change them more than anything else on
 * a link. Term and content open on request, and stay open once either has a
 * value, so nothing set is ever out of sight. */
function UtmFields({
  form,
  setForm,
  showMore,
  onShowMore,
}: {
  form: LinkInput;
  setForm: SetForm;
  showMore: boolean;
  onShowMore: () => void;
}) {
  const open = showMore || !!form.utmTerm || !!form.utmContent;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 flex w-full items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">UTM tags</span>
        <span className="text-xs text-muted">Added to the destination</span>
      </legend>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        {UTM_MAIN.map((f) => (
          <UtmInput key={f.key} field={f} form={form} setForm={setForm} />
        ))}
      </div>
      {open ? (
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          {UTM_MORE.map((f) => (
            <UtmInput key={f.key} field={f} form={form} setForm={setForm} />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={onShowMore}
          aria-expanded={false}
          className="-ml-1 flex h-8 w-fit cursor-pointer items-center gap-1 rounded-md px-1 text-xs text-muted transition-colors [@media(hover:hover)]:hover:text-text"
        >
          <Plus size={13} aria-hidden /> Term and content
        </button>
      )}
    </fieldset>
  );
}

/**
 * What sits under the QR on a plan without `qrCustom`.
 *
 * Two different sentences, because they are two different situations. A link
 * with no styling is being offered a feature. A link that already has some,
 * on an org that downgraded, is keeping it: saying "add your logo on a paid
 * plan" to somebody whose logo is right there in the preview reads as a bug.
 */
function QrCustomizationUpsell({ locked }: { locked: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="flex items-start gap-1.5 text-xs text-pretty text-muted">
        <Lock size={13} className="mt-px shrink-0" aria-hidden />
        <span>
          {locked
            ? "This QR keeps the look it already has, and still downloads that way. Changing it needs a paid plan."
            : "Add your logo, colors, and dot shapes to this QR on a paid plan."}
        </span>
      </p>
      <RouterLink to="/billing" className={buttonClass({ variant: "outline", size: "sm" })}>
        See plans
      </RouterLink>
    </div>
  );
}

/** The short link as a domain and a slug joined by a slash. Chosen slugs
 * only exist on custom domains, so on the shared one the slug is locked. */
function ShortLinkField({
  form,
  setForm,
  editing,
  activeDomains,
  domainsAllowed,
}: {
  form: LinkInput;
  setForm: SetForm;
  editing: boolean;
  activeDomains: DomainDTO[];
  domainsAllowed: boolean;
}) {
  const linkHost = useLinkHost();
  const slugLocked = !form.domainId;
  const hasDomains = activeDomains.length > 0;
  const hints: ReactNode[] = [];
  if (slugLocked) {
    hints.push(
      hasDomains ? (
        "Use a custom domain for custom slugs."
      ) : domainsAllowed ? (
        <>
          <RouterLink to="/domains" className="text-accent hover:underline">
            Connect a domain
          </RouterLink>{" "}
          for custom slugs.
        </>
      ) : (
        <>
          <RouterLink to="/billing" className="text-accent hover:underline">
            Upgrade
          </RouterLink>{" "}
          for custom slugs.
        </>
      ),
    );
  } else if (!editing) {
    hints.push("Leave the slug empty for a random one.");
  }
  if (editing && hasDomains) {
    hints.push("A link's domain can't change: create a new link on the other domain instead.");
  }

  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-xs text-muted">Short link</span>
      <div className="flex min-w-0 items-stretch">
        {hasDomains ? (
          <MenuSelect
            label="Domain"
            value={form.domainId ?? ""}
            onChange={(v) => setForm({ ...form, domainId: v || null, slug: "" })}
            disabled={editing}
            className="w-auto max-w-[60%] min-w-0 rounded-r-none font-mono text-[13px]"
            options={[
              { value: "", label: linkHost },
              ...activeDomains.map((d) => ({ value: d.id, label: d.hostname })),
            ]}
          />
        ) : (
          <span className="flex h-9 max-w-[60%] min-w-0 items-center truncate rounded-l-lg bg-surface-2 px-3 font-mono text-[13px] text-muted">
            {linkHost}
          </span>
        )}
        <span
          aria-hidden
          className="grid w-5 shrink-0 place-items-center bg-surface-2 text-sm text-muted"
        >
          /
        </span>
        <Input
          aria-label="Slug"
          value={form.slug ?? ""}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          placeholder={slugLocked ? "random" : "launch-2026"}
          disabled={slugLocked}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-l-none font-mono text-[13px]"
        />
      </div>
      {hints.map((hint, i) => (
        <span key={i} className="mt-1.5 block text-xs text-muted">
          {hint}
        </span>
      ))}
    </div>
  );
}

function LinkFormFields({
  form,
  setForm,
  editing,
  activeDomains,
  domainsAllowed,
  destinationRef,
  destinationError,
  showMoreUtm,
  onShowMoreUtm,
}: {
  form: LinkInput;
  setForm: SetForm;
  editing: boolean;
  activeDomains: DomainDTO[];
  domainsAllowed: boolean;
  destinationRef: RefObject<HTMLInputElement | null>;
  destinationError?: string;
  showMoreUtm: boolean;
  onShowMoreUtm: () => void;
}) {
  const toast = useToast();

  const onDestinationChange = (e: ChangeEvent<HTMLInputElement>) => {
    const destination = e.target.value;
    setForm({ ...form, destination, ...utmFromDestination(destination) });
  };

  // Pasting a link with utm_* params already on it shows the cleaned link
  // right away, not the raw paste: extract into the UTM fields below and
  // strip them from what lands in this field. Typing a URL out by hand
  // still shows exactly what's typed (see onDestinationChange) until it's
  // stripped on save.
  const onDestinationPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const merged = mergePastedText(e.currentTarget, pasted);
    const utm = utmFromDestination(merged);
    if (Object.keys(utm).length === 0) return;
    e.preventDefault();
    setForm({ ...form, destination: stripUtmFromDestination(merged), ...utm });
    toast("UTM parameters found");
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Field label="Destination" error={destinationError}>
        <Input
          ref={destinationRef}
          value={form.destination}
          onChange={onDestinationChange}
          onPaste={onDestinationPaste}
          // A URL keyboard on a text field: the form's own check marks the
          // field, where type="url" would have the browser refuse first in
          // a bubble of its own.
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://example.com/launch"
          autoFocus={!editing}
          className="h-10 font-mono text-[13px]"
        />
      </Field>

      <ShortLinkField
        form={form}
        setForm={setForm}
        editing={editing}
        activeDomains={activeDomains}
        domainsAllowed={domainsAllowed}
      />

      <Field label="Title">
        <Input
          value={form.title ?? ""}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Spring launch"
        />
      </Field>

      <UtmFields form={form} setForm={setForm} showMore={showMoreUtm} onShowMore={onShowMoreUtm} />
    </div>
  );
}

function LinkQrPreview({
  form,
  orgQr,
  previewUrl,
  size,
}: {
  form: LinkInput;
  orgQr: OrgQr;
  previewUrl: string;
  size: number;
}) {
  const look = resolveQrLook(form, orgQr);
  return (
    <QRPreview
      url={previewUrl}
      logo={look.logo}
      dotStyle={look.dotStyle}
      color={look.color}
      corner={look.corner}
      eyeColor={look.eyeColor}
      bg={look.bg}
      logoSize={look.logoSize}
      size={size}
    />
  );
}

/** The side column: the code, the short link, and where it opens. */
function LinkSummary({
  form,
  host,
  opened,
}: {
  form: LinkInput;
  host: string;
  opened: ReturnType<typeof openedUrl>;
}) {
  const slug = form.slug?.trim();
  return (
    <dl className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs text-muted">Short link</dt>
        <dd className="font-mono text-[13px] font-bold [overflow-wrap:anywhere]">
          {host}/{slug || <span className="font-sans font-normal text-muted">(random)</span>}
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs text-muted">Opens</dt>
        <dd className="font-mono text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
          {opened ? (
            <>
              {opened.base}
              <span className="text-text">{opened.tags}</span>
            </>
          ) : (
            "Nothing yet"
          )}
        </dd>
      </div>
    </dl>
  );
}

export function LinkEditor({
  open,
  onOpenChange,
  editingLink,
  busy,
  onSave,
  activeDomains,
  defaultDomainId,
  domainsAllowed,
  qrCustomEnabled,
  orgQr,
  shakeKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingLink: LinkInput | null;
  busy: boolean;
  onSave: (data: LinkInput) => void;
  activeDomains: DomainDTO[];
  /** The org's default domain for new links (#69), or null for the shared
   * one. Ignored when editing: that link already has an address. */
  defaultDomainId: string | null;
  /** Whether the org's plan allows a custom domain at all (regardless of
   * whether one is connected yet): governs the shared-domain slug hint. */
  domainsAllowed: boolean;
  qrCustomEnabled: boolean;
  orgQr: OrgQr;
  shakeKey: number;
}) {
  const editing = editingLink != null;
  // Sends what it loaded. Clearing the QR fields on a plan without qrCustom
  // was how a title edit silently destroyed a link's logo and colours (#162);
  // the server now only refuses a save that *changes* them.
  const save = (data: LinkInput) => onSave(data);
  const shake = useShake();
  const destinationRef = useRef<HTMLInputElement>(null);
  const customizeRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  // The QR editor replaces the form in the same dialog, with a way back.
  const [view, setView] = useState<"form" | "qr">("form");
  const [showMoreUtm, setShowMoreUtm] = useState(false);

  const {
    handleSubmit,
    watch,
    reset,
    setValue,
    getFieldState,
    formState: { errors, isSubmitted },
  } = useForm<LinkInput>({
    resolver: valibotResolver(linkInputSchema),
    defaultValues: defaultForm,
  });

  // A new link starts on the org's default domain, which also unlocks the
  // slug field: chosen slugs only exist on custom domains, so the customer
  // who set a default is exactly the one who wants to name their links.
  const newDomainId = resolveDefaultDomainId(defaultDomainId, activeDomains);

  // Deliberately not a dependency: the default is read when the dialog opens
  // and not again, so a background refetch of the org's domains cannot re-run
  // this and wipe whatever the person had already typed.
  useEffect(() => {
    if (open) {
      reset(editingLink ?? { ...defaultForm, domainId: newDomainId });
      setView("form");
      setShowMoreUtm(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingLink, reset]);

  // The org's domains can arrive after the dialog opened (New link pressed
  // straight after a reload). Until somebody picks a domain, follow the
  // default as it resolves; once they pick, leave their choice alone.
  useEffect(() => {
    if (!open || editingLink || getFieldState("domainId").isDirty) return;
    setValue("domainId", newDomainId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDomainId]);

  // Focus follows the view switch: into the QR editor's back button, and
  // home to the button that opened it on the way back.
  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    (view === "qr" ? backRef : customizeRef).current?.focus();
  }, [view]);
  const showView = (next: "form" | "qr") => {
    switched.current = true;
    setView(next);
  };

  // shakeKey bumps on every save failure (client validation or server
  // error): the button shakes either way, without the parent needing to
  // know shake is button-level, not whole-dialog.
  const lastShakeKey = useRef(shakeKey);
  useEffect(() => {
    if (shakeKey !== lastShakeKey.current) {
      lastShakeKey.current = shakeKey;
      shake.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shakeKey]);

  const form = watch();
  // Every call site passes the full next LinkInput (spreading the current
  // `form` and overriding one or a few keys), which made reset(next) look
  // like the obvious fit — but reset() re-registers and revalidates every
  // field in the form, not just the one that changed. On a destination
  // field it's cheap enough per keystroke to be invisible; it's still the
  // wrong tool, so a fast typist hitting it 5+ times a second (typing
  // "https://" is exactly that, back-to-back identical characters) can
  // outrun it and land a keystroke against a stale re-render. setValue
  // updates just the fields that actually changed. After a failed submit it
  // also re-checks them, so a fixed field drops its mark as it is fixed.
  const setForm = (next: LinkInput) => {
    // SAFETY: `next` is typed LinkInput, a fully-defined object type, so
    // Object.keys(next) can only return its own declared keys.
    (Object.keys(next) as (keyof LinkInput)[]).forEach((key) => {
      if (next[key] !== form[key])
        setValue(key, next[key], { shouldDirty: true, shouldValidate: isSubmitted });
    });
  };

  // A form error marks its field (rdyrct-design): the reason in the label
  // row, focus on the field, and the button shakes. No toast.
  const onInvalid: SubmitErrorHandler<LinkInput> = (errors) => {
    shake.start();
    // destination is the only field this schema can reject, so it's always
    // the culprit.
    if (errors.destination) {
      setView("form");
      // After the view has rendered, so the field exists to take focus.
      requestAnimationFrame(() => {
        destinationRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        destinationRef.current?.focus();
      });
    }
  };
  const destinationError = errors.destination
    ? form.destination.trim()
      ? (errors.destination.message ?? "Enter a valid URL")
      : "Required"
    : undefined;

  const selectedDomain = activeDomains.find((d) => d.id === form.domainId)?.hostname ?? null;
  const linkHost = useLinkHost();

  const previewUrl = useMemo(
    () => shortUrl(form.slug?.trim() || "preview", selectedDomain, linkHost),
    [form.slug, selectedDomain, linkHost],
  );
  const opened = openedUrl(form);

  const actions = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button
        variant="primary"
        type="submit"
        disabled={busy}
        className={cn("whitespace-nowrap", shake.className)}
        onAnimationEnd={shake.end}
      >
        <BusyContent busy={busy}>{editing ? "Save changes" : "Create link"}</BusyContent>
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? "Edit link" : "New link"} wide>
      <form
        onSubmit={handleSubmit(save, onInvalid)}
        noValidate
        className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_15rem]"
      >
        {view === "form" ? (
          <>
            <LinkFormFields
              form={form}
              setForm={setForm}
              editing={editing}
              activeDomains={activeDomains}
              domainsAllowed={domainsAllowed}
              destinationRef={destinationRef}
              destinationError={destinationError}
              showMoreUtm={showMoreUtm}
              onShowMoreUtm={() => setShowMoreUtm(true)}
            />
            <aside className="flex min-w-0 flex-col gap-5 rounded-xl bg-bg p-4">
              <div className="flex flex-col items-center gap-3">
                <p className="self-start text-xs text-muted">QR code</p>
                <LinkQrPreview form={form} orgQr={orgQr} previewUrl={previewUrl} size={152} />
                {qrCustomEnabled ? (
                  <Button ref={customizeRef} size="sm" onClick={() => showView("qr")}>
                    <QrCode size={14} aria-hidden /> Customize QR
                  </Button>
                ) : (
                  <QrCustomizationUpsell locked={hasQrOverrides(form)} />
                )}
              </div>
              <LinkSummary form={form} host={selectedDomain ?? linkHost} opened={opened} />
              <div className="mt-auto pt-1 max-sm:hidden">{actions}</div>
            </aside>
            {/* On a phone the column above sits under every field, so the
                buttons ride the sheet's bottom edge instead of a scroll away. */}
            <div className="sticky -bottom-5 z-10 -mx-5 -mt-3 bg-surface px-5 pt-3 pb-5 shadow-[0_-1px_0_var(--border)] sm:hidden">
              {actions}
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center gap-1">
                <button
                  ref={backRef}
                  type="button"
                  onClick={() => showView("form")}
                  aria-label="Back to the link"
                  className="-ml-2 grid size-9 cursor-pointer place-items-center rounded-md text-muted transition-colors [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text"
                >
                  <ArrowLeft size={16} />
                </button>
                <h3 className="text-sm font-semibold">QR code</h3>
              </div>
              <LinkQrEditor form={form} setForm={setForm} orgQr={orgQr} />
            </div>
            {/* On a phone the preview leads, so a change shows where it is
                made rather than a long scroll below. */}
            <aside className="order-first flex min-w-0 flex-col items-center gap-4 rounded-xl bg-bg p-4 sm:sticky sm:top-0 sm:order-none sm:self-start">
              <LinkQrPreview form={form} orgQr={orgQr} previewUrl={previewUrl} size={168} />
              <div className="flex w-full items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setForm(withoutQrOverrides(form))}
                  disabled={!hasQrOverrides(form)}
                >
                  Reset
                </Button>
                <Button variant="primary" onClick={() => showView("form")}>
                  Done
                </Button>
              </div>
            </aside>
          </>
        )}
      </form>
    </Dialog>
  );
}
