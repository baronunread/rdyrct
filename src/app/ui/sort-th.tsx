import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Th } from "./misc";
import { cn } from "./cn";
import type { Sort } from "@/shared/types";

export function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  sort: Sort;
  onSort: (s: Sort) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <Th className={className}>
      <button
        type="button"
        onClick={() => onSort({ key: sortKey, dir: active && sort.dir === 1 ? -1 : 1 })}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 tracking-wider uppercase",
          active ? "text-text" : "hover:text-text",
        )}
      >
        {label}
        {active ? (
          sort.dir === 1 ? (
            <ArrowUp size={11} />
          ) : (
            <ArrowDown size={11} />
          )
        ) : (
          <ArrowUpDown size={11} className="opacity-40" />
        )}
      </button>
    </Th>
  );
}
