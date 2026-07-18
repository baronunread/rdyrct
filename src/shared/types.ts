export type OrgRole = "owner" | "admin" | "member";

export interface MeUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export interface MeOrg {
  id: string;
  name: string;
  role: OrgRole;
}

export interface Me {
  user: MeUser;
  orgs: MeOrg[];
}

export interface MemberDTO {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  createdAt: number;
}

export interface InviteDTO {
  token: string;
  role: OrgRole;
  createdAt: number;
  expiresAt: number;
}

export interface LinkDTO {
  id: string;
  slug: string;
  destination: string;
  title: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
  qrLogo: string;
  createdAt: number;
  clicks: number;
}

export interface LinkInput {
  slug?: string;
  destination: string;
  title?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  qrLogo?: string;
}

export interface SeriesPoint {
  day: string;
  clicks: number;
}

export interface TopEntry {
  key: string;
  clicks: number;
}

export interface OrgStats {
  totalClicks: number;
  totalLinks: number;
  clicks7d: number;
  series: SeriesPoint[];
  topLinks: { id: string; slug: string; title: string; clicks: number }[];
  countries: TopEntry[];
  referrers: TopEntry[];
  devices: TopEntry[];
}

export interface AdminOverview {
  users: number;
  orgs: number;
  links: number;
  clicks: number;
  clicks7d: number;
  series: SeriesPoint[];
}

export interface AdminOrgRow {
  id: string;
  name: string;
  createdAt: number;
  members: number;
  links: number;
  clicks: number;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt: number;
  orgCount: number;
}

export interface InvitePreview {
  orgName: string;
  role: OrgRole;
}
