export type TimelinePoint = {
  date: string;
  invested: number;
  value: number;
  exact?: boolean;
};

export type FundTransaction = {
  date: string;
  amount: number;
  price: number;
  units: number;
  balance: number;
  label: string;
};

export type FolioHolding = {
  key: string;
  label: string;
  currentValue: number;
  invested: number;
  units: number;
  nav: number;
  navDate: string;
  transactions: FundTransaction[];
};

export type FundHolding = {
  key: string;
  name: string;
  isin: string;
  fundHouse: string;
  category: string;
  currentValue: number;
  invested: number;
  units: number;
  nav: number;
  navDate: string;
  folios: number;
  transactions: FundTransaction[];
  folioHoldings: FolioHolding[];
};

export type Portfolio = {
  source: "cas" | "demo";
  statementDate: string;
  currentValue: number;
  invested: number;
  funds: FundHolding[];
  timeline: TimelinePoint[];
  reconciliationDifference: number;
};

type PdfTextItem = {
  str: string;
  width: number;
  transform: number[];
  hasEOL?: boolean;
};

type PendingHolding = {
  sectionId: number;
  name: string;
  isin: string;
  folioLabel: string;
  nav: number;
  navDate: string;
  currentValue: number;
};

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const cleanNumber = (value: string) => {
  const negative = value.trim().startsWith("(") || value.trim().startsWith("-");
  const parsed = Number(value.replace(/[(),]/g, "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -Math.abs(parsed) : parsed;
};

const moneyToPaise = (value: string) => Math.round(cleanNumber(value) * 100);

const fromPaise = (value: number) => value / 100;

const maskFolio = (value: string) => {
  const cleaned = value.replace(/[^A-Z0-9/-]/gi, "");
  const suffix = cleaned.slice(-4);
  return suffix ? `Folio ••••${suffix}` : "Folio";
};

const parseCasDate = (value: string) => {
  const match = value.match(/(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (!match || MONTHS[match[2]] === undefined) return "";
  return new Date(Date.UTC(Number(match[3]), MONTHS[match[2]], Number(match[1])))
    .toISOString()
    .slice(0, 10);
};

const friendlySchemeName = (raw: string) => {
  let name = raw
    .replace(/^[A-Z0-9]+\s*-\s*/, "")
    .replace(/\s*\(formerly known as[\s\S]*$/i, "")
    .replace(/\s*\(erstwhile[\s\S]*$/i, "")
    .replace(/\s*\((?:Non[ -]?Demat|Demat)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  name = name.replace(/^[-–]\s*/, "");
  return name || "Mutual fund holding";
};

const inferFundHouse = (name: string) => {
  const houses = [
    "Aditya Birla Sun Life",
    "Bandhan",
    "Bank of India",
    "BOI AXA",
    "Canara Robeco",
    "Edelweiss",
    "Franklin Templeton",
    "HDFC",
    "HSBC",
    "ICICI Prudential",
    "Invesco",
    "Kotak",
    "Mirae Asset",
    "Motilal Oswal",
    "Nippon India",
    "Quant",
    "SBI",
    "Tata",
  ];
  const lower = name.toLowerCase();
  return houses.find((house) => lower.includes(house.toLowerCase())) ?? name.split(" ").slice(0, 2).join(" ");
};

const inferCategory = (name: string) => {
  const value = name.toLowerCase();
  if (value.includes("small cap") || value.includes("smallcap")) return "Small cap";
  if (value.includes("mid cap") || value.includes("midcap")) return "Mid cap";
  if (value.includes("large and mid") || value.includes("large & mid")) return "Large & mid cap";
  if (value.includes("large cap")) return "Large cap";
  if (value.includes("flexi")) return "Flexi cap";
  if (value.includes("focused")) return "Focused";
  if (value.includes("value")) return "Value";
  if (value.includes("silver")) return "Silver";
  if (value.includes("gold")) return "Gold";
  if (value.includes("bharat") || value.includes("index") || value.includes("etf")) return "Index / ETF";
  if (value.includes("debt") || value.includes("bond") || value.includes("liquid")) return "Debt";
  return "Diversified equity";
};

const joinItemsIntoLines = (items: PdfTextItem[]) => {
  const rows: Array<{ y: number; items: PdfTextItem[] }> = [];
  const sorted = [...items]
    .filter((item) => item.str.trim())
    .sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);

  for (const item of sorted) {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.transform[5]) <= 2.1);
    if (!row) {
      row = { y: item.transform[5], items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const rowItems = row.items.sort((a, b) => a.transform[4] - b.transform[4]);
      let line = "";
      let previousEnd = 0;
      for (const item of rowItems) {
        const x = item.transform[4];
        const gap = x - previousEnd;
        if (line && gap > 1.6 && !line.endsWith(" ")) line += " ";
        line += item.str;
        previousEnd = x + item.width;
      }
      return line.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
};

const extractIsin = (value: string) => {
  const after = value.split(/ISIN\s*:/i)[1] ?? "";
  const compact = after.replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/INF[A-Z0-9]{9}/);
  return match?.[0] ?? "";
};

const getStatementSummary = (text: string) => {
  const summaryText = text.match(/PORTFOLIO SUMMARY[\s\S]{0,4000}/i)?.[0] ?? text.slice(0, 12000);
  const matches = [...summaryText.matchAll(/\bTotal\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/gi)];
  const summary = matches[0];
  if (!summary) return null;
  return { investedPaise: moneyToPaise(summary[1]), valuePaise: moneyToPaise(summary[2]) };
};

const transactionLabel = (line: string) => {
  const lower = line.toLowerCase();
  if (lower.includes("switch")) return lower.includes("out") ? "Switch out" : "Switch in";
  if (lower.includes("redemption")) return "Redemption";
  if (lower.includes("sip")) return "SIP purchase";
  if (lower.includes("purchase")) return "Purchase";
  if (lower.includes("dividend")) return "Dividend";
  return "Transaction";
};

export async function parseCasFile(
  file: File,
  password = "",
  onProgress?: (progress: number) => void,
): Promise<Portfolio> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Please choose a PDF Consolidated Account Statement.");
  }
  if (file.size > 30 * 1024 * 1024) {
    throw new Error("This PDF is larger than 30 MB. Please export a smaller CAS statement.");
  }

  const pdfjs = (typeof window === "undefined"
    ? await import("pdfjs-dist/legacy/build/pdf.mjs")
    : await import("pdfjs-dist")) as typeof import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = typeof window === "undefined"
    ? new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()
    : `${window.location.origin}/pdf.worker.min.mjs`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes, password: password || undefined });
  let pdf: Awaited<typeof loadingTask.promise> | undefined;
  try {
    pdf = await loadingTask.promise;
    const pages: string[][] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(joinItemsIntoLines(content.items as PdfTextItem[]));
      page.cleanup();
      onProgress?.(Math.round((pageNumber / pdf.numPages) * 88));
    }

    const allLines = pages.flat();
    const allText = allLines.join("\n");
    if (!/Consolidated Account Statement/i.test(allText) || !/PORTFOLIO SUMMARY/i.test(allText)) {
      throw new Error("This does not look like a CAMS/KFintech Consolidated Account Statement.");
    }

    const summary = getStatementSummary(pages.slice(0, 3).flat().join("\n"));
    if (!summary) throw new Error("The portfolio summary total could not be read from this statement.");

    const rawHoldings: Array<PendingHolding & { units: number; investedPaise: number }> = [];
    const transactions: Array<FundTransaction & { isin: string; sectionId: number }> = [];
    let sectionId = 0;
    let current = { sectionId: 0, name: "", isin: "", folioLabel: "" };
    let pending: PendingHolding | null = null;
    const nameByIsin = new Map<string, string>();

    for (let index = 0; index < allLines.length; index += 1) {
      const line = allLines[index];
      if (/ISIN\s*:/i.test(line)) {
        sectionId += 1;
        const lookAhead = [line, allLines[index + 1] ?? "", allLines[index + 2] ?? ""].join(" ");
        const isin = extractIsin(lookAhead);
        const titlePart = line.split(/\s*-\s*ISIN\s*:/i)[0] ?? "";
        const candidate = friendlySchemeName(titlePart);
        const priorName = isin ? nameByIsin.get(isin) : undefined;
        const name = candidate.length > 12 && !candidate.startsWith("Demat") ? candidate : priorName ?? candidate;
        if (isin && name) nameByIsin.set(isin, name);
        current = { sectionId, name, isin, folioLabel: "" };
        pending = null;
      }

      const folioMatch = line.match(/Folio No\s*:\s*([A-Z0-9/-]+)/i);
      if (folioMatch && current.sectionId) {
        current = { ...current, folioLabel: maskFolio(folioMatch[1]) };
      }

      const navMatch = line.match(/NAV on\s+(\d{2}-[A-Za-z]{3}-\d{4}):\s*INR\s*([\d,]+\.\d+)/i);
      const marketMatch = line.match(/Market Value on\s+\d{2}-[A-Za-z]{3}-\d{4}:\s*INR\s*([\d,]+\.\d{2})/i);
      if (navMatch && marketMatch && current.name) {
        pending = {
          ...current,
          navDate: parseCasDate(navMatch[1]),
          nav: cleanNumber(navMatch[2]),
          currentValue: fromPaise(moneyToPaise(marketMatch[1])),
        };
      }

      const closingMatch = line.match(/Closing Unit Balance:\s*([\d,]+\.\d+)/i);
      const costMatch = line.match(/Total Cost Value:\s*([\d,]+\.\d{2})/i);
      if (closingMatch && costMatch && pending) {
        rawHoldings.push({
          ...pending,
          units: cleanNumber(closingMatch[1]),
          investedPaise: moneyToPaise(costMatch[1]),
        });
        pending = null;
      }

      const dateMatch = line.match(/^(\d{2}-[A-Za-z]{3}-\d{4})\s+(.+)$/);
      if (dateMatch && current.isin && !line.includes("***")) {
        const numeric = [...dateMatch[2].matchAll(/\(?-?[\d,]+\.\d+\)?/g)];
        if (numeric.length >= 4) {
          const amount = cleanNumber(numeric[0][0]);
          const units = cleanNumber(numeric[1][0]);
          const price = cleanNumber(numeric[numeric.length - 2][0]);
          const balance = cleanNumber(numeric[numeric.length - 1][0]);
          if (price > 0 && Number.isFinite(balance)) {
            transactions.push({
              date: parseCasDate(dateMatch[1]),
              amount,
              price,
              units,
              balance,
              label: transactionLabel(line),
              isin: current.isin,
              sectionId: current.sectionId,
            });
          }
        }
      }
    }

    if (!rawHoldings.length) {
      throw new Error("No mutual fund valuation rows could be read from this statement.");
    }

    const holdingsValuePaise = rawHoldings.reduce(
      (total, holding) => total + Math.round(holding.currentValue * 100),
      0,
    );
    const holdingsCostPaise = rawHoldings.reduce((total, holding) => total + holding.investedPaise, 0);
    const valueDifference = Math.abs(summary.valuePaise - holdingsValuePaise);
    const costDifference = Math.abs(summary.investedPaise - holdingsCostPaise);
    if (valueDifference > 100 || costDifference > 100) {
      throw new Error(
        `The statement did not reconcile (value differs by ₹${fromPaise(valueDifference).toFixed(2)}). Please download a fresh detailed CAS and try again.`,
      );
    }

    const grouped = new Map<string, FundHolding>();
    const fundKeyBySection = new Map<number, string>();
    const folioBySection = new Map<number, FolioHolding>();
    for (const holding of rawHoldings) {
      const key = holding.isin || holding.name.toLowerCase();
      const existing = grouped.get(key);
      const ordinal = (existing?.folioHoldings.length ?? 0) + 1;
      const folio: FolioHolding = {
        key: `${key}-${holding.sectionId}`,
        label: holding.folioLabel || `Folio ${ordinal}`,
        currentValue: holding.currentValue,
        invested: fromPaise(holding.investedPaise),
        units: holding.units,
        nav: holding.nav,
        navDate: holding.navDate,
        transactions: [],
      };
      fundKeyBySection.set(holding.sectionId, key);
      folioBySection.set(holding.sectionId, folio);
      if (existing) {
        existing.currentValue = fromPaise(
          Math.round(existing.currentValue * 100) + Math.round(holding.currentValue * 100),
        );
        existing.invested = fromPaise(
          Math.round(existing.invested * 100) + holding.investedPaise,
        );
        existing.units += holding.units;
        existing.folios += 1;
        existing.folioHoldings.push(folio);
      } else {
        grouped.set(key, {
          key,
          name: holding.name,
          isin: holding.isin,
          fundHouse: inferFundHouse(holding.name),
          category: inferCategory(holding.name),
          currentValue: holding.currentValue,
          invested: fromPaise(holding.investedPaise),
          units: holding.units,
          nav: holding.nav,
          navDate: holding.navDate,
          folios: 1,
          transactions: [],
          folioHoldings: [folio],
        });
      }
    }

    for (const transaction of transactions) {
      const normalized: FundTransaction = {
        date: transaction.date,
        amount: transaction.amount,
        price: transaction.price,
        units: transaction.units,
        balance: transaction.balance,
        label: transaction.label,
      };
      const key = fundKeyBySection.get(transaction.sectionId) ?? transaction.isin;
      grouped.get(key)?.transactions.push(normalized);
      folioBySection.get(transaction.sectionId)?.transactions.push(normalized);
    }

    const timeline: TimelinePoint[] = [];
    const balances = new Map<number, { balance: number; price: number }>();
    let netInvested = 0;
    for (const transaction of transactions
      .filter((item) => item.date)
      .sort((a, b) => a.date.localeCompare(b.date))) {
      netInvested += transaction.amount;
      balances.set(transaction.sectionId, { balance: transaction.balance, price: transaction.price });
      const estimatedValue = [...balances.values()].reduce(
        (total, lot) => total + lot.balance * lot.price,
        0,
      );
      const previous = timeline.at(-1);
      if (previous?.date === transaction.date) {
        previous.invested = netInvested;
        previous.value = estimatedValue;
      } else {
        timeline.push({ date: transaction.date, invested: netInvested, value: estimatedValue });
      }
    }

    const statementDate = rawHoldings.find((holding) => holding.navDate)?.navDate ?? new Date().toISOString().slice(0, 10);
    const exactCurrentPoint = {
      date: statementDate,
      invested: fromPaise(summary.investedPaise),
      value: fromPaise(summary.valuePaise),
      exact: true,
    };
    if (!timeline.length || timeline.at(-1)?.date !== statementDate) timeline.push(exactCurrentPoint);
    else timeline[timeline.length - 1] = exactCurrentPoint;

    onProgress?.(100);
    return {
      source: "cas",
      statementDate,
      currentValue: fromPaise(summary.valuePaise),
      invested: fromPaise(summary.investedPaise),
      funds: [...grouped.values()]
        .filter((fund) => fund.currentValue > 0 || fund.invested > 0)
        .sort((a, b) => b.currentValue - a.currentValue),
      timeline,
      reconciliationDifference: fromPaise(valueDifference),
    };
  } catch (error) {
    if (error instanceof Error && /password/i.test(error.message)) {
      const passwordError = new Error("This PDF needs its password.");
      passwordError.name = "PasswordRequired";
      throw passwordError;
    }
    throw error;
  } finally {
    await pdf?.destroy();
    if (bytes.byteLength) bytes.fill(0);
  }
}

const demoFunds: FundHolding[] = [
  ["Aurora Small Cap Direct Growth", "INF000A00001", "Aurora", "Small cap", 824600, 540000, 68.7167],
  ["Northstar Flexi Cap Direct Growth", "INF000A00002", "Northstar", "Flexi cap", 652800, 480000, 121.421],
  ["Meadow Large & Mid Cap Direct", "INF000A00003", "Meadow", "Large & mid cap", 544900, 420000, 94.862],
  ["Beacon Value Fund Direct Growth", "INF000A00004", "Beacon", "Value", 438200, 350000, 174.439],
  ["Foundry Gold ETF Fund of Fund", "INF000A00005", "Foundry", "Gold", 322400, 300000, 42.984],
  ["Cedar Mid Cap Direct Growth", "INF000A00006", "Cedar", "Mid cap", 287100, 240000, 109.391],
].map(([name, isin, fundHouse, category, currentValue, invested, nav], index) => {
  const folioCount = index === 0 ? 2 : 1;
  const folioHoldings: FolioHolding[] = Array.from({ length: folioCount }, (_, folioIndex) => {
    const share = folioCount === 1 ? 1 : folioIndex === 0 ? 0.62 : 0.38;
    return {
      key: `${isin}-${folioIndex + 1}`,
      label: `Folio ••••${String(4821 + index * 37 + folioIndex * 11).slice(-4)}`,
      currentValue: (currentValue as number) * share,
      invested: (invested as number) * share,
      units: ((currentValue as number) / (nav as number)) * share,
      nav: nav as number,
      navDate: "2026-07-31",
      transactions: [],
    };
  });
  return {
    key: isin as string,
    name: name as string,
    isin: isin as string,
    fundHouse: fundHouse as string,
    category: category as string,
    currentValue: currentValue as number,
    invested: invested as number,
    nav: nav as number,
    units: (currentValue as number) / (nav as number),
    navDate: "2026-07-31",
    folios: folioCount,
    transactions: [],
    folioHoldings,
  };
});

const makeDemoTimeline = () => {
  const points: TimelinePoint[] = [];
  let invested = 210000;
  for (let index = 0; index < 58; index += 1) {
    const date = new Date(Date.UTC(2021, 10 + index, 1)).toISOString().slice(0, 10);
    invested += index % 6 === 0 ? 85000 : 42000;
    const marketLift = Math.max(0, index - 5) * 9400 + Math.sin(index / 2.8) * 54000;
    const drawdown = index > 26 && index < 33 ? (33 - index) * 21000 : 0;
    points.push({ date, invested, value: Math.max(invested * 0.92, invested + marketLift - drawdown) });
  }
  const finalInvested = demoFunds.reduce((total, fund) => total + fund.invested, 0);
  const finalValue = demoFunds.reduce((total, fund) => total + fund.currentValue, 0);
  points[points.length - 1] = {
    date: "2026-07-31",
    invested: finalInvested,
    value: finalValue,
    exact: true,
  };
  return points;
};

export const demoPortfolio: Portfolio = {
  source: "demo",
  statementDate: "2026-07-31",
  currentValue: demoFunds.reduce((total, fund) => total + fund.currentValue, 0),
  invested: demoFunds.reduce((total, fund) => total + fund.invested, 0),
  funds: demoFunds,
  timeline: makeDemoTimeline(),
  reconciliationDifference: 0,
};
