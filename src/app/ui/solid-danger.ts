/**
 * The confirm button of a destructive dialog: solid danger, because by the
 * time somebody reads that dialog the outline version has already done its
 * job of not being clicked by accident. The kit's `danger` button stays the
 * quiet outline for the row and page actions that open such dialogs. Pass it
 * as `className` on a `variant="danger"` Button.
 *
 * Contrast: the light theme's danger under surface text measures about 4:1,
 * short of AA for 14px text. TODO(lead): a darker `--danger-strong` for this
 * fill would fix light without touching dark.
 */
export const SOLID_DANGER =
  "bg-danger font-semibold text-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.18)] [@media(hover:hover)]:hover:bg-danger [@media(hover:hover)]:hover:brightness-110 active:brightness-95";
