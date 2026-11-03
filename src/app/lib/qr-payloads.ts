/**
 * What the QR type pages (/wifi-qr-code, /vcard-qr-code, /whatsapp-qr-code)
 * put inside the code. Each returns "" until the fields hold enough for a
 * phone to act on, so the card shows its empty state rather than a code that
 * scans to nothing.
 */

export type WifiSecurity = "WPA" | "WEP" | "nopass";

/** The ZXing Wi-Fi format, which iOS and Android cameras both read:
 *  `WIFI:T:WPA;S:name;P:password;;`. `\ ; , : "` are escaped with a
 *  backslash, so a network called `Cafe;2` does not end the field early. */
export function wifiPayload(wifi: {
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}): string {
  if (!wifi.ssid) return "";
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

/** A vCard 3.0, the version every phone's contacts app imports. Empty fields
 *  are left out; `\ , ;` and line breaks are escaped as RFC 2426 asks. */
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

/** A wa.me link: the number in international form with only its digits, and
 *  an optional message WhatsApp types into the chat. */
export function whatsappPayload(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "";
  const text = message.trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
