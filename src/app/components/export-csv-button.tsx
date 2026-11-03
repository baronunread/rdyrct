import { Download } from "@/app/ui/icons";
import { Button } from "../ui/button";
import { downloadCsv, statsFilename, statsToCsv, type ExportableStats } from "../lib/csv";
import { Tooltip } from "@/app/ui/tooltip";

/**
 * Exports the stats already on screen (#78).
 *
 * No request: the page holds every row this writes, and those rows are
 * already trimmed to the plan's analytics window, so the export cannot reach
 * further back than the view it came from.
 */
export function ExportCsvButton({
  stats,
  scope,
  days,
}: {
  stats: ExportableStats;
  scope: string;
  days: number;
}) {
  // Every section the CSV writes, not just the first two: a link with only
  // device or referrer rows still has something to export.
  const empty = ![stats.series, stats.countries, stats.devices, stats.referrers].some(
    (section) => section.length,
  );
  const button = (
    <Button
      variant="outline"
      size="sm"
      disabled={empty}
      onClick={() => downloadCsv(statsFilename(scope, days), statsToCsv(stats))}
    >
      <Download className="size-4" aria-hidden />
      Export CSV
    </Button>
  );
  // A disabled button takes no pointer events, so the tip sits on a wrapper.
  return empty ? (
    <Tooltip content="Nothing to export yet">
      <span className="inline-flex">{button}</span>
    </Tooltip>
  ) : (
    button
  );
}
