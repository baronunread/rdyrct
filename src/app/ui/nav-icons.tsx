import {
  IconBuilding,
  IconChartBar,
  IconCreditCard,
  IconKey,
  IconLayoutGrid,
  IconLink,
  IconSettings,
  IconStack2,
  IconUsers,
  IconWorld,
  type Icon,
} from "@tabler/icons-react";

/**
 * The sidebar's icons: Tabler (MIT), the closest matches to the redesign
 * mock's, drawn at the mock's lighter 1.75 stroke. The mock's own paths are
 * not used: their licence is unknown, and icons here must be MIT.
 */
const light =
  (Tabler: Icon) =>
  ({ size = 16, className }: { size?: number; className?: string }) => (
    <Tabler aria-hidden size={size} stroke={1.75} className={className} />
  );

export const GridIcon = light(IconLayoutGrid);
export const ChartIcon = light(IconChartBar);
export const LinkIcon = light(IconLink);
export const GlobeIcon = light(IconWorld);
export const UsersIcon = light(IconUsers);
export const BuildingIcon = light(IconBuilding);
export const KeyIcon = light(IconKey);
export const CardIcon = light(IconCreditCard);
export const GearIcon = light(IconSettings);
export const LayersIcon = light(IconStack2);
