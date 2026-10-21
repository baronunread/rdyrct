/**
 * The look of the 404's way home (NotFoundView). Its own module so the view's
 * file exports only the component and keeps Fast Refresh.
 */
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";

export const HOME_LINK = cn(buttonClass({ variant: "primary" }), "h-10 rounded-full px-5");
