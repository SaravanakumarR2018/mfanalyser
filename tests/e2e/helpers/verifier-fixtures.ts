const escapePdfText = (value: string) => value
  .replaceAll("\\", "\\\\")
  .replaceAll("(", "\\(")
  .replaceAll(")", "\\)");

const buildPdf = (lines: string[]) => {
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pages = addObject("");
  const font = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const commands = [
    "BT", "/F1 10 Tf", "14 TL", "54 760 Td",
    ...lines.flatMap((line, index) => [
      `(${escapePdfText(line)}) Tj`,
      ...(index === lines.length - 1 ? [] : ["T*"]),
    ]),
    "ET",
  ].join("\n");
  const content = addObject(`<< /Length ${Buffer.byteLength(commands, "latin1")} >>\nstream\n${commands}\nendstream`);
  const page = addObject(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
};

export const PARTIAL_FIRST_ISIN = "INF000A00123";
export const PARTIAL_SECOND_ISIN = "INF000A00456";

export const makeTwoFundCasPdf = () => buildPdf([
  "Consolidated Account Statement",
  "PORTFOLIO SUMMARY",
  "Total 17,000.00 20,000.00",
  `Testhouse Flexi Cap Direct Growth - ISIN : ${PARTIAL_FIRST_ISIN} Registrar : CAMS`,
  "Folio No : 12345678/90",
  "NAV on 31-Jul-2026: INR 12.0000 Market Value on 31-Jul-2026: INR 12,000.00",
  "Closing Unit Balance: 1,000.000 Total Cost Value: 10,000.00",
  "01-Jan-2025 Purchase 10,000.00 1,000.000 10.0000 1,000.000",
  `Secondhouse Mid Cap Direct Growth - ISIN : ${PARTIAL_SECOND_ISIN} Registrar : CAMS`,
  "Folio No : 87654321/09",
  "NAV on 31-Jul-2026: INR 20.0000 Market Value on 31-Jul-2026: INR 8,000.00",
  "Closing Unit Balance: 400.000 Total Cost Value: 7,000.00",
  "01-Feb-2025 Purchase 7,000.00 400.000 17.5000 400.000",
]);
