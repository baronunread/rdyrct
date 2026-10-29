/**
 * The QR editor's rows, shared by the link editor's QR view and the
 * organization's QR defaults (rdyrct-design, "Creating is a dialog": "QR
 * defaults on Organization use the same editor rows").
 *
 * Each row is a setting: its name and current value on the left, the control
 * on the right. Shapes are small drawings of the shape, colours are chips
 * around the native picker, the logo is a size and an on/off switch. Callers
 * hand in what the code renders with (already resolved over any defaults)
 * and get back a patch in the link/org field names.
 */
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { IconCheck, IconAlertTriangle, IconX } from "@tabler/icons-react";
import { QR_CORNER_STYLES, QR_DOT_STYLES } from "@/shared/types";
import { errorMessage } from "@/app/lib/error-message";
import { cn } from "../ui/cn";
import { ColorChip, ColorChips } from "../ui/color-chips";
import { Segmented } from "../ui/segmented";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { useCurrentOrg } from "../lib/current-org";
import { readPreparedQrLogo, uploadPreparedQrLogo } from "../lib/qr-logo-file";
import { qrContrast, toHex6 } from "../lib/qr-contrast";
import { hasTransparency } from "../lib/qr-look";

export type DotStyle = (typeof QR_DOT_STYLES)[number];
export type CornerStyle = (typeof QR_CORNER_STYLES)[number];

const DOT_NAMES = {
  rounded: "Rounded",
  square: "Square",
  dots: "Dots",
  classy: "Classy",
  "classy-rounded": "Classy round",
  "extra-rounded": "Extra round",
} satisfies Record<DotStyle, string>;

const CORNER_NAMES = {
  "extra-rounded": "Extra round",
  rounded: "Rounded",
  dot: "Dot",
  square: "Square",
  classy: "Classy",
} satisfies Record<CornerStyle, string>;

/** The four logo sizes, as the share of the code the logo covers. */
const LOGO_SIZES = [
  { id: "0.25", label: "S" },
  { id: "0.35", label: "M" },
  { id: "0.5", label: "L" },
  { id: "0.65", label: "XL" },
] as const;
type LogoSizeId = (typeof LOGO_SIZES)[number]["id"];

/** The nearest of the four sizes, for a value saved before there were four. */
function logoSizeId(size: number): LogoSizeId {
  let best: LogoSizeId = "0.35";
  for (const s of LOGO_SIZES) {
    if (Math.abs(Number(s.id) - size) < Math.abs(Number(best) - size)) best = s.id;
  }
  return best;
}

/** A rect path with its own radius per corner: top left, top right, bottom
 * right, bottom left. */
function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  [a, b, c, d]: [number, number, number, number],
) {
  return `M${x + a},${y} H${x + w - b} Q${x + w},${y} ${x + w},${y + b} V${y + h - c} Q${x + w},${y + h} ${x + w - c},${y + h} H${x + d} Q${x},${y + h} ${x},${y + h - d} V${y + a} Q${x},${y} ${x + a},${y} Z`;
}

function dotPath(style: DotStyle, x: number, y: number, z: number) {
  const all = (r: number): [number, number, number, number] => [r, r, r, r];
  switch (style) {
    case "square":
      return roundedRect(x, y, z, z, all(0));
    case "rounded":
      return roundedRect(x, y, z, z, all(z * 0.3));
    case "extra-rounded":
      return roundedRect(x, y, z, z, all(z * 0.5));
    case "classy":
      return roundedRect(x, y, z, z, [z * 0.5, 0, z * 0.5, 0]);
    case "classy-rounded":
      return roundedRect(x, y, z, z, [z * 0.5, z * 0.15, z * 0.5, z * 0.15]);
    case "dots":
      return `M${x + z / 2},${y + z * 0.08} a${z * 0.42},${z * 0.42} 0 1,0 0.01,0 Z`;
  }
}

/** Five modules in an X, drawn in the style: enough to tell them apart. */
function DotGlyph({ style }: { style: DotStyle }) {
  const cells = [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ];
  return (
    <svg width="20" height="20" viewBox="0 0 30 30" fill="currentColor" aria-hidden>
      <path d={cells.map(([c, r]) => dotPath(style, 1 + c * 10, 1 + r * 10, 8)).join(" ")} />
    </svg>
  );
}

/** A finder pattern (the "eye") in the style. */
function CornerGlyph({ style }: { style: CornerStyle }) {
  const radii = {
    square: [0, 0],
    rounded: [5, 2],
    "extra-rounded": [9, 3],
    dot: [14, 4.5],
    classy: [0, 0],
  } satisfies Record<CornerStyle, [number, number]>;
  const [o, i] = radii[style];
  const outer =
    style === "classy"
      ? roundedRect(2, 2, 26, 26, [9, 0, 9, 0])
      : roundedRect(2, 2, 26, 26, [o, o, o, o]);
  const inner =
    style === "classy"
      ? roundedRect(10, 10, 10, 10, [4, 0, 4, 0])
      : roundedRect(10, 10, 10, 10, [i, i, i, i]);
  return (
    <svg width="20" height="20" viewBox="0 0 30 30" aria-hidden>
      <path d={outer} fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path d={inner} fill="currentColor" />
    </svg>
  );
}

/** Mutually exclusive icon tiles, each named for a screen reader and on
 * hover. Radii nest: a 10px track, 3px of padding, 7px tiles. */
function IconPicker<V extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: V; name: string; face: ReactNode }[];
  value: string;
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-fit max-w-full flex-wrap gap-1 rounded-[10px] bg-bg p-[3px]"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-label={o.name}
            title={o.name}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "grid size-[34px] cursor-pointer place-items-center rounded-[7px] transition-[color,background-color,box-shadow,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent active:scale-[0.96] disabled:cursor-default disabled:active:scale-100",
              on
                ? "bg-surface text-text shadow-[0_0_0_1.5px_var(--accent)]"
                : "text-muted enabled:[@media(hover:hover)]:hover:text-text",
            )}
          >
            {o.face}
          </button>
        );
      })}
    </div>
  );
}

/** One row: the name and what it is set to on the left, the control on the
 * right. On a narrow screen the control wraps under the name. */
function QrRow({
  title,
  sub,
  children,
  className,
  ...drop
}: {
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  className?: string;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={cn(
        "flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3",
        className,
      )}
      {...drop}
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold">{title}</span>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}

/** What the code is drawn with, every value concrete (defaults applied). */
export interface QrLookValue {
  dot: DotStyle;
  corner: CornerStyle;
  dotColor: string;
  cornerColor: string;
  /** A hex, possibly with alpha, or the legacy "transparent". */
  bg: string;
  /** The logo's URL, or "" for none. */
  logo: string;
  logoSize: number;
}

/** A change, in the field names a link and an org both store. */
export type QrPatch = Partial<{
  qrStyle: string;
  qrCorner: string;
  qrColor: string;
  qrEyeColor: string;
  qrBg: string;
  qrLogo: string;
  qrLogoSize: number;
}>;

/** The logo switch. Base UI's switch, with the kit's look, plus a disabled
 * state the kit's own Switch does not offer. */
function LogoSwitch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label="Logo"
      className="relative inline-flex h-[22px] w-9 shrink-0 cursor-pointer items-center rounded-full bg-surface-2 smooth-shadow-ring-xs transition-[background-color] duration-150 after:absolute after:-inset-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/30 data-[checked]:bg-accent data-[checked]:shadow-none data-[disabled]:cursor-default data-[disabled]:opacity-50"
    >
      <BaseSwitch.Thumb className="pointer-events-none block size-4 translate-x-[3px] rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-150 ease-out data-[checked]:translate-x-[17px] data-[checked]:bg-bg" />
    </BaseSwitch.Root>
  );
}

/** The logo row: its size, whether there is one, and which file it is. A
 * drop on the row replaces it. */
function LogoRow({
  logo,
  logoSize,
  name,
  lockedOn,
  disabled,
  localOnly,
  onChange,
}: {
  logo: string;
  logoSize: number;
  /** Read the picked image in the browser and never upload it. */
  localOnly?: boolean;
  /** What to call the logo in the row: a file name, or whose it is. */
  name: string;
  /** Why the logo can't be switched off here, when it can't. */
  lockedOn?: string;
  disabled?: boolean;
  onChange: (patch: QrPatch, fileName?: string) => void;
}) {
  const { org } = useCurrentOrg();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const take = async (file: File | undefined) => {
    if (!file || !org || busy || disabled) return;
    setBusy(true);
    try {
      const logo = localOnly
        ? await readPreparedQrLogo(file)
        : await uploadPreparedQrLogo(org.id, file);
      onChange({ qrLogo: logo }, file.name);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const pick = () => input.current?.click();

  const sub = busy ? (
    <span className="inline-flex items-center gap-1.5">
      <Spinner /> Preparing the image
    </span>
  ) : logo ? (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="max-w-48 truncate" title={name}>
        {name}
      </span>
      {!disabled && (
        <>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={pick}
            className="cursor-pointer text-muted underline decoration-from-font underline-offset-2 [@media(hover:hover)]:hover:text-text"
          >
            Replace
          </button>
        </>
      )}
    </span>
  ) : (
    <span className="flex items-baseline gap-1">
      None
      {!disabled && (
        <>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={pick}
            className="cursor-pointer text-muted underline decoration-from-font underline-offset-2 [@media(hover:hover)]:hover:text-text"
          >
            Upload
          </button>
        </>
      )}
    </span>
  );

  return (
    <QrRow
      title="Logo"
      sub={sub}
      className={cn(dragging && "rounded-lg shadow-[0_0_0_1.5px_var(--accent)]")}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label="Upload a logo image"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files?.[0]);
          // Reset, so picking the same file again fires again.
          e.target.value = "";
        }}
      />
      <span className={cn("transition-opacity", !logo && "opacity-50")}>
        <fieldset disabled={disabled} className="contents">
          <Segmented
            label="Logo size"
            items={LOGO_SIZES}
            value={logoSizeId(logoSize)}
            onChange={(id) => onChange({ qrLogoSize: Number(id) })}
          />
        </fieldset>
      </span>
      <span title={lockedOn} className="inline-flex">
        <LogoSwitch
          checked={!!logo}
          disabled={disabled || busy || (!!logo && !!lockedOn)}
          onCheckedChange={(on) => (on ? pick() : onChange({ qrLogo: "" }))}
        />
      </span>
    </QrRow>
  );
}

/**
 * Every QR setting, as rows.
 *
 * `inherited` marks the values that come from the organization rather than
 * the link itself, so the row can say so.
 */
export function QrEditorRows({
  look,
  onChange,
  inherited = {},
  logoName,
  logoLockedOn,
  disabled,
  localLogo,
}: {
  look: QrLookValue;
  onChange: (patch: QrPatch, fileName?: string) => void;
  inherited?: Partial<Record<"dot" | "corner", boolean>>;
  /** The logo's file name, when this session knows it. */
  logoName?: string;
  logoLockedOn?: string;
  disabled?: boolean;
  /** A picked logo stays in the browser: the preview only, no upload. */
  localLogo?: boolean;
}) {
  const seeThrough = hasTransparency(look.bg);
  const named = (name: string, fromOrg?: boolean) => (fromOrg ? `${name} (default)` : name);
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">QR customization</legend>
      <div className="flex flex-col [&>*+*]:shadow-[inset_0_1px_0_color-mix(in_oklab,var(--text)_8%,transparent)]">
        <QrRow title="Dots" sub={named(DOT_NAMES[look.dot], inherited.dot)}>
          <IconPicker
            label="Dots"
            value={look.dot}
            disabled={disabled}
            onChange={(v) => onChange({ qrStyle: v })}
            options={QR_DOT_STYLES.map((s) => ({
              value: s,
              name: DOT_NAMES[s],
              face: <DotGlyph style={s} />,
            }))}
          />
        </QrRow>
        <QrRow title="Corners" sub={named(CORNER_NAMES[look.corner], inherited.corner)}>
          <IconPicker
            label="Corners"
            value={look.corner}
            disabled={disabled}
            onChange={(v) => onChange({ qrCorner: v })}
            options={QR_CORNER_STYLES.map((s) => ({
              value: s,
              name: CORNER_NAMES[s],
              face: <CornerGlyph style={s} />,
            }))}
          />
        </QrRow>
        <QrRow
          title="Colours"
          sub={
            <TransparentToggle
              on={seeThrough}
              disabled={disabled}
              // Fully transparent is 8-digit hex with a zero alpha byte, the
              // value the API already stores for it.
              onChange={(on) => onChange({ qrBg: on ? `${toHex6(look.bg)}00` : toHex6(look.bg) })}
            />
          }
        >
          <ColorChips label="Colours">
            <ColorChip
              label="Dots"
              value={look.dotColor}
              disabled={disabled}
              onChange={(v) => onChange({ qrColor: v })}
            />
            <ColorChip
              label="Corners"
              value={look.cornerColor}
              disabled={disabled}
              onChange={(v) => onChange({ qrEyeColor: v })}
            />
            <ColorChip
              label="Background"
              value={look.bg}
              transparent={seeThrough}
              disabled={disabled}
              onChange={(v) => onChange({ qrBg: v })}
            />
          </ColorChips>
        </QrRow>
        <LogoRow
          logo={look.logo}
          logoSize={look.logoSize}
          name={logoName ?? "Your logo"}
          lockedOn={logoLockedOn}
          disabled={disabled}
          localOnly={localLogo}
          onChange={onChange}
        />
      </div>
    </fieldset>
  );
}

/** A see-through background: a small checkbox under "Colours", where the
 * row has room on every screen (beside the chips it pushed them onto two
 * lines on a phone). */
function TransparentToggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 has-[:disabled]:cursor-default">
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 cursor-pointer accent-accent disabled:cursor-default"
      />
      Transparent background
    </label>
  );
}

/** "Strong contrast, scans well", or what is wrong with the colours. */
export function QrContrastNote({
  look,
  short,
}: {
  look: Pick<QrLookValue, "dotColor" | "cornerColor" | "bg">;
  /** Two words, for the narrower preview on Organization. */
  short?: boolean;
}) {
  const { level } = qrContrast({
    dots: look.dotColor,
    corners: look.cornerColor,
    background: look.bg,
  });
  const notes = {
    strong: { icon: "ok", long: "Strong contrast, scans well", brief: "Strong contrast" },
    fair: { icon: "warn", long: "Fair contrast: test a print first", brief: "Fair contrast" },
    low: { icon: "bad", long: "Low contrast, may not scan", brief: "Low contrast" },
    inverted: {
      icon: "warn",
      long: "Light on dark: some scanners miss it",
      brief: "Light on dark",
    },
    transparent: {
      icon: "warn",
      long: "Scans on a light surface only",
      brief: "Needs a light surface",
    },
  } as const;
  const note = notes[level];
  return (
    <p
      role="status"
      className="flex items-center justify-center gap-1.5 text-center text-xs text-muted"
    >
      {note.icon === "ok" ? (
        <IconCheck size={13} className="shrink-0 text-mint" aria-hidden />
      ) : note.icon === "warn" ? (
        <IconAlertTriangle size={13} className="shrink-0 text-butter" aria-hidden />
      ) : (
        <IconX size={13} className="shrink-0 text-danger" aria-hidden />
      )}
      {short ? note.brief : note.long}
    </p>
  );
}
