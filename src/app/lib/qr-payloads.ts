// Each returns "" until the fields hold enough for a phone to act on, so the card shows
// its empty state rather than a code that scans to nothing.

export type WifiSecurity = "WPA" | "WEP" | "nopass";

// The ZXing Wi-Fi format, which iOS and Android cameras both read.
// `\ ; , : "` are escaped, so a network called `Cafe;2` does not end the field early.
export function wifiPayload(wifi: {
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}): string {
  if (!wifi.ssid.trim()) return "";
  // A secured network with no password scans to a code no phone can join.
  if (wifi.security !== "nopass" && !wifi.password) return "";
  const escape = (value: string) => value.replace(/([\\;,:"])/g, "\\$1");
  const password = wifi.security === "nopass" ? "" : `P:${escape(wifi.password)};`;
  const hidden = wifi.hidden ? "H:true;" : "";
  return `WIFI:T:${wifi.security};S:${escape(wifi.ssid)};${password}${hidden};`;
}

export interface Contact {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  company: string;
  jobTitle: string;
  website: string;
}

export function vcardPayload(contact: Contact): string {
  const escape = (value: string) =>
    value
      .trim()
      .replace(/([\\,;])/g, "\\$1")
      .replace(/\r?\n/g, "\\n");
  const c: Contact = {
    firstName: escape(contact.firstName),
    lastName: escape(contact.lastName),
    phone: escape(contact.phone),
    email: escape(contact.email),
    company: escape(contact.company),
    jobTitle: escape(contact.jobTitle),
    website: escape(contact.website),
  };
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  if (!name && !c.company) return "";
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${c.lastName};${c.firstName};;;`,
    `FN:${name || c.company}`,
    c.company && `ORG:${c.company}`,
    c.jobTitle && `TITLE:${c.jobTitle}`,
    c.phone && `TEL;TYPE=CELL:${c.phone}`,
    c.email && `EMAIL:${c.email}`,
    c.website && `URL:${c.website}`,
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\r\n");
}

// Only an internationally written number counts: "07700 900123" would link
// to the wrong country, and "ext 42" would join the extension onto the number.
export function whatsappPayload(phone: string, message: string): string {
  if (!/^\+[\d\s().-]+$/.test(phone.trim())) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "";
  const text = message.trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
