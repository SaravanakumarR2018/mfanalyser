import { createHash } from "node:crypto";

import { TEST_ISIN } from "./cas-fixture";

const PASSWORD_PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const padPassword = (password: string) => Buffer.concat([
  Buffer.from(password, "latin1").subarray(0, 32),
  PASSWORD_PADDING,
]).subarray(0, 32);

const md5 = (value: Uint8Array) => createHash("md5").update(value).digest();

const rc4 = (key: Uint8Array, input: Uint8Array) => {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let cursor = 0;
  for (let index = 0; index < 256; index += 1) {
    cursor = (cursor + state[index] + key[index % key.length]) & 0xff;
    [state[index], state[cursor]] = [state[cursor], state[index]];
  }
  const output = Buffer.alloc(input.length);
  let left = 0;
  let right = 0;
  for (let index = 0; index < input.length; index += 1) {
    left = (left + 1) & 0xff;
    right = (right + state[left]) & 0xff;
    [state[left], state[right]] = [state[right], state[left]];
    output[index] = input[index] ^ state[(state[left] + state[right]) & 0xff];
  }
  return output;
};

const objectKey = (fileKey: Uint8Array, objectNumber: number) => {
  const suffix = Buffer.from([
    objectNumber & 0xff,
    (objectNumber >> 8) & 0xff,
    (objectNumber >> 16) & 0xff,
    0,
    0,
  ]);
  return md5(Buffer.concat([fileKey, suffix])).subarray(0, 10);
};

const escapePdfText = (value: string) => value
  .replaceAll("\\", "\\\\")
  .replaceAll("(", "\\(")
  .replaceAll(")", "\\)");

/** Deterministic PDF 1.4 Standard Security Handler (revision 2 / 40-bit RC4). */
export function makeEncryptedCasPdf(password = "folio123") {
  const lines = [
    "Consolidated Account Statement",
    "PORTFOLIO SUMMARY",
    "Total 10,000.00 12,000.00",
    `Testhouse Flexi Cap Direct Growth - ISIN : ${TEST_ISIN} Registrar : CAMS`,
    "Folio No : 12345678/90",
    "NAV on 31-Jul-2026: INR 12.0000 Market Value on 31-Jul-2026: INR 12,000.00",
    "Closing Unit Balance: 1,000.000 Total Cost Value: 10,000.00",
    "01-Jan-2025 Purchase 4,000.00 400.000 10.0000 400.000",
    "01-Jul-2025 SIP Purchase 3,000.00 272.727 11.0000 672.727",
    "01-Jan-2026 Purchase 3,000.00 327.273 9.1667 1,000.000",
  ];
  const commands = [
    "BT", "/F1 11 Tf", "14 TL", "54 760 Td",
    ...lines.flatMap((line, index) => [
      `(${escapePdfText(line)}) Tj`,
      ...(index === lines.length - 1 ? [] : ["T*"]),
    ]),
    "ET",
  ].join("\n");

  const user = padPassword(password);
  const ownerKey = md5(user).subarray(0, 5);
  const owner = rc4(ownerKey, user);
  const permissions = Buffer.from([0xfc, 0xff, 0xff, 0xff]);
  const fileId = md5(Buffer.from("FolioVista deterministic encrypted CAS fixture", "utf8"));
  const fileKey = md5(Buffer.concat([user, owner, permissions, fileId])).subarray(0, 5);
  const userEntry = rc4(fileKey, PASSWORD_PADDING);
  const encryptedStream = rc4(objectKey(fileKey, 4), Buffer.from(commands, "latin1"));

  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [5 0 R] /Count 1 >>", "latin1"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"),
    Buffer.concat([
      Buffer.from(`<< /Length ${encryptedStream.length} >>\nstream\n`, "latin1"),
      encryptedStream,
      Buffer.from("\nendstream", "latin1"),
    ]),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>", "latin1"),
    Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${userEntry.toString("hex")}> /P -4 >>`, "latin1"),
  ];

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [0];
  let length = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    parts.push(object);
    length += object.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${fileId.toString("hex")}><${fileId.toString("hex")}>] >>\n`,
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}
