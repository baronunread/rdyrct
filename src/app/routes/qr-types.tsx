/**
 * QR codes for one job each: /wifi-qr-code, /vcard-qr-code and
 * /whatsapp-qr-code.
 *
 * People search for the job ("wifi qr code generator", 2,900 US searches a
 * month; "qr code business card", 9,900; "whatsapp qr code", 1,600), not for
 * a generator that happens to take a string. Each page asks for the fields
 * that job needs, builds the text a phone expects (lib/qr-payloads.ts), and
 * hands it to the same card the main generator uses. Nothing is sent
 * anywhere, as on that page.
 *
 * A PDF page is deliberately missing: rdyrct does not host files, so it
 * could only ask for a link to a PDF hosted elsewhere, which the main
 * generator already does.
 */
import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { MarketingPage } from "../components/marketing-page";
import { MarketingLink } from "../components/marketing-link";
import { Field, Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Switch } from "../ui/switch";
import { QrCard, QrFaq } from "./qr-generator";
import type { QrValues } from "../lib/qr-look";
import {
  vcardPayload,
  whatsappPayload,
  wifiPayload,
  type Contact,
  type WifiSecurity,
} from "../lib/qr-payloads";

const EMPTY_QR: QrValues = {
  qrStyle: "",
  qrColor: "",
  qrLogo: "",
  qrCorner: "",
  qrBg: "",
  qrEyeColor: "",
  qrLogoSize: "",
};

const QR_TYPES = [
  { to: "/qr-code-generator", label: "Link or text" },
  { to: "/wifi-qr-code", label: "WiFi" },
  { to: "/vcard-qr-code", label: "vCard" },
  { to: "/whatsapp-qr-code", label: "WhatsApp" },
] as const;

function QrTypePage({
  path,
  title,
  intro,
  encoded,
  name,
  values,
  setValues,
  fields,
  explainer,
  faqs,
}: {
  path: (typeof QR_TYPES)[number]["to"];
  title: string;
  intro: string;
  encoded: string;
  name: string;
  values: QrValues;
  setValues: Dispatch<SetStateAction<QrValues>>;
  fields: ReactNode;
  explainer: ReactNode;
  faqs: { q: string; a: string }[];
}) {
  return (
    <MarketingPage path={path} title={title} intro={intro}>
      <div className="flex flex-col items-center gap-12 py-12">
        <QrCard encoded={encoded} values={values} setValues={setValues} name={name}>
          {fields}
        </QrCard>

        <section className="flex w-full max-w-3xl flex-col gap-3 text-sm">{explainer}</section>

        <QrFaq faqs={faqs} />

        <nav aria-label="Other QR codes" className="flex w-full max-w-3xl flex-col gap-3 text-sm">
          <h2 className="font-bold">Other QR codes</h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {QR_TYPES.filter((type) => type.to !== path).map((type) => (
              <li key={type.to}>
                <MarketingLink to={type.to} className="text-accent hover:underline">
                  {type.label} QR code
                </MarketingLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </MarketingPage>
  );
}

const WIFI_SECURITY: { value: WifiSecurity; label: string }[] = [
  { value: "WPA", label: "WPA, WPA2 or WPA3" },
  { value: "WEP", label: "WEP" },
  { value: "nopass", label: "None (open network)" },
];

// main.tsx names these exports as strings, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function WifiQrPage() {
  const [values, setValues] = useState<QrValues>(EMPTY_QR);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<WifiSecurity>("WPA");
  const [hidden, setHidden] = useState(false);
  return (
    <QrTypePage
      path="/wifi-qr-code"
      title="WiFi QR code generator"
      intro="Make a QR code that joins your WiFi network when a guest points a phone camera at it. No typing the password, no account, and the password never leaves your browser."
      encoded={wifiPayload({ ssid: ssid.trim(), password, security, hidden })}
      name="wifi-qr"
      values={values}
      setValues={setValues}
      fields={
        <>
          <Field label="Network name">
            <Input
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder="Cafe guests"
              autoComplete="off"
            />
          </Field>
          <Field label="Password">
            <Input
              value={security === "nopass" ? "" : password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={security === "nopass"}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Security">
            <MenuSelect
              label="Security"
              value={security}
              onChange={(next) =>
                setSecurity(WIFI_SECURITY.find((s) => s.value === next)?.value ?? "WPA")
              }
              options={WIFI_SECURITY}
            />
          </Field>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Hidden network</span>
            <Switch checked={hidden} onCheckedChange={setHidden} label="Hidden network" />
          </div>
        </>
      }
      explainer={
        <>
          <h2 className="text-xl font-bold text-balance">How a WiFi QR code works</h2>
          <p className="text-muted">
            The code holds the network name, the password and the kind of security in one line of
            text. The camera on an iPhone or an Android phone reads it and offers to join. Nothing
            goes through rdyrct or anyone else: the phone talks to your router directly.
          </p>
          <p className="text-muted">
            Change the password and the code stops working, so make a new one. Print it where guests
            wait, such as a table card, a menu or a fridge door.
          </p>
        </>
      }
      faqs={[
        {
          q: "Is it safe to put my WiFi password in a QR code?",
          a: "Anyone who scans the code can join, the same as anyone you tell the password to. Use it for a guest network, not the one your work computers are on. The code is made in your browser, so rdyrct never sees the password.",
        },
        {
          q: "Which security option do I pick?",
          a: "WPA, WPA2 or WPA3 for almost every router made in the last fifteen years. Pick None only for an open network with no password.",
        },
        {
          q: "Does a WiFi QR code expire?",
          a: "No. It works until you change the network name or the password.",
        },
        {
          q: "Do I need an app to scan it?",
          a: "No. The camera app on iPhones (iOS 11 and later) and most Android phones reads WiFi codes and offers to join.",
        },
      ]}
    />
  );
}

const EMPTY_CONTACT: Contact = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  company: "",
  jobTitle: "",
  website: "",
};

const CONTACT_FIELDS: [key: keyof Contact, label: string, type: string, autoComplete: string][] = [
  ["phone", "Phone", "tel", "tel"],
  ["email", "Email", "email", "email"],
  ["company", "Company", "text", "organization"],
  ["jobTitle", "Job title", "text", "organization-title"],
  ["website", "Website", "url", "url"],
];

// fallow-ignore-next-line unused-export
export function VcardQrPage() {
  const [values, setValues] = useState<QrValues>(EMPTY_QR);
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT);
  const set = (key: keyof Contact) => (e: { target: { value: string } }) =>
    setContact((current) => ({ ...current, [key]: e.target.value }));
  return (
    <QrTypePage
      path="/vcard-qr-code"
      title="vCard QR code generator for business cards"
      intro="Put your contact details in a QR code for a business card, a badge or an email signature. One scan saves you to someone's contacts. Free, no account, and nothing you type leaves your browser."
      encoded={vcardPayload(contact)}
      name="vcard-qr"
      values={values}
      setValues={setValues}
      fields={
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input
                value={contact.firstName}
                onChange={set("firstName")}
                autoComplete="given-name"
              />
            </Field>
            <Field label="Last name">
              <Input
                value={contact.lastName}
                onChange={set("lastName")}
                autoComplete="family-name"
              />
            </Field>
          </div>
          {CONTACT_FIELDS.map(([key, label, type, autoComplete]) => (
            <Field key={key} label={label}>
              <Input
                type={type}
                value={contact[key]}
                onChange={set(key)}
                autoComplete={autoComplete}
              />
            </Field>
          ))}
        </>
      }
      explainer={
        <>
          <h2 className="text-xl font-bold text-balance">What a vCard QR code holds</h2>
          <p className="text-muted">
            A vCard is the contact format every phone's address book reads. The code holds your
            details as text, in vCard 3.0, so a phone camera offers to save them as a new contact
            with no app and no website in between.
          </p>
          <p className="text-muted">
            The more you fill in, the denser the code gets. On a business card, keep to a name, a
            phone number and an email, print the code at least 2 cm across, and scan a proof before
            ordering the batch.
          </p>
        </>
      }
      faqs={[
        {
          q: "Can I change the details after printing?",
          a: "No. The details are in the code itself, so a new phone number means a new code. To keep one printed code, put a link to a page with your details in a QR code made for a short link you can repoint.",
        },
        {
          q: "Does it work on iPhone and Android?",
          a: "Yes. Both cameras read vCard codes and offer to add the contact.",
        },
        {
          q: "Is the vCard QR code free?",
          a: "Yes, with no account, no watermark and no expiry. The code is made in your browser.",
        },
      ]}
    />
  );
}

// fallow-ignore-next-line unused-export
export function WhatsappQrPage() {
  const [values, setValues] = useState<QrValues>(EMPTY_QR);
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  return (
    <QrTypePage
      path="/whatsapp-qr-code"
      title="WhatsApp QR code generator"
      intro="Make a QR code that opens a WhatsApp chat with your number, with a message already typed if you want one. Free, no account, and made in your browser."
      encoded={whatsappPayload(phone, message)}
      name="whatsapp-qr"
      values={values}
      setValues={setValues}
      fields={
        <>
          <Field label="Phone number, with country code">
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 010 9999"
              autoComplete="tel"
            />
          </Field>
          <Field label="Message (optional)">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hi, I saw your poster"
              autoComplete="off"
            />
          </Field>
        </>
      }
      explainer={
        <>
          <h2 className="text-xl font-bold text-balance">How a WhatsApp QR code works</h2>
          <p className="text-muted">
            The code holds a wa.me link, WhatsApp's own address for starting a chat. Scanning it
            opens WhatsApp on a chat with your number, with your message typed and ready to send.
            The person scanning does not need to save your number first.
          </p>
          <p className="text-muted">
            Write the number with its country code and no leading zero: +44 7700 900123, not 07700
            900123.
          </p>
        </>
      }
      faqs={[
        {
          q: "Does the person scanning need my number saved?",
          a: "No. The wa.me link opens a chat with any WhatsApp number.",
        },
        {
          q: "Can I count how many people scan it?",
          a: "Not with a code that holds the wa.me link itself. Make a short link to the wa.me address in rdyrct and a QR code for that: every scan is counted, and you can change the number later without reprinting.",
        },
        {
          q: "Does it work with WhatsApp Business?",
          a: "Yes. wa.me links open WhatsApp Business numbers the same way.",
        },
      ]}
    />
  );
}
