import { Link } from "@tanstack/react-router";
import { Search } from "@/app/ui/icons";
import { buttonClass } from "../ui/button-class";
import { Shortcut } from "../ui/kbd";
import { MOD_KEY } from "../lib/shortcut";
import { openCommandMenu } from "../lib/shortcut";

/**
 * A page the app does not have, inside the app: the sidebar stays, so the
 * way back is where it always is. Says the one thing somebody fears on a
 * missing page, that their links and data are fine, then offers the two
 * ways on.
 */
export function AppNotFound() {
  return (
    <div className="mx-auto mt-16 flex max-w-[440px] flex-col items-center gap-3 text-center md:mt-[120px]">
      <span className="font-mono text-[0.8125rem] text-muted">404</span>
      <h1 className="text-[22px] font-semibold text-balance">This page does not exist</h1>
      <p className="text-pretty text-muted">
        The address may be mistyped, or the page moved. Your links and data are fine.
      </p>
      <div className="mt-1.5 flex flex-wrap justify-center gap-2">
        <Link to="/dashboard" className={buttonClass({ variant: "primary" })}>
          Go to the dashboard
        </Link>
        <button
          type="button"
          onClick={openCommandMenu}
          className={buttonClass({ variant: "ghost" })}
        >
          <Search size={15} aria-hidden />
          Search
          <Shortcut keys={[MOD_KEY, "K"]} className="gap-0.5 max-md:hidden" />
        </button>
      </div>
    </div>
  );
}
