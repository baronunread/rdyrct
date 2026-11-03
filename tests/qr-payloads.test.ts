import { describe, expect, test } from "bun:test";
import { vcardPayload, whatsappPayload, wifiPayload } from "../src/app/lib/qr-payloads";

describe("wifiPayload", () => {
  test("writes the format phone cameras read", () => {
    expect(
      wifiPayload({ ssid: "Home", password: "hunter22", security: "WPA", hidden: false }),
    ).toBe("WIFI:T:WPA;S:Home;P:hunter22;;");
  });

  test("escapes the characters that would end a field early", () => {
    expect(
      wifiPayload({ ssid: "Cafe;2", password: 'a:b,c"d\\', security: "WPA", hidden: true }),
    ).toBe('WIFI:T:WPA;S:Cafe\\;2;P:a\\:b\\,c\\"d\\\\;H:true;;');
  });

  test("leaves the password out of an open network, and needs a name", () => {
    expect(wifiPayload({ ssid: "Guest", password: "x", security: "nopass", hidden: false })).toBe(
      "WIFI:T:nopass;S:Guest;;",
    );
    expect(wifiPayload({ ssid: "", password: "x", security: "WPA", hidden: false })).toBe("");
  });
});

describe("vcardPayload", () => {
  const empty = {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    company: "",
    jobTitle: "",
    website: "",
  };

  test("writes a vCard 3.0 with only the fields given", () => {
    expect(
      vcardPayload({ ...empty, firstName: "Ada", lastName: "Lovelace", phone: "+44 20 7946 0000" }),
    ).toBe(
      "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace;Ada;;;\r\nFN:Ada Lovelace\r\nTEL;TYPE=CELL:+44 20 7946 0000\r\nEND:VCARD",
    );
  });

  test("escapes commas and semicolons, and needs a name or a company", () => {
    expect(vcardPayload({ ...empty, company: "Smith, Jones; Co" })).toContain(
      "ORG:Smith\\, Jones\\; Co",
    );
    expect(vcardPayload({ ...empty, email: "a@b.co" })).toBe("");
  });
});

describe("whatsappPayload", () => {
  test("keeps only the digits and encodes the message", () => {
    expect(whatsappPayload("+1 (555) 010-9999", "Hi there & more")).toBe(
      "https://wa.me/15550109999?text=Hi%20there%20%26%20more",
    );
    expect(whatsappPayload("+39 333 1234567", "  ")).toBe("https://wa.me/393331234567");
    expect(whatsappPayload("12", "")).toBe("");
  });
});
