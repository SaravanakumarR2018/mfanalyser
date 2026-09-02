import type { Portfolio } from "./cas-parser";

export const PORTFOLIO_DATABASE = "foliovista-browser-portfolio";
const STORE_NAME = "portfolio";
const PORTFOLIO_KEY = "current";
const STORAGE_VERSION = 1;

type StoredPortfolio = {
  version: typeof STORAGE_VERSION;
  savedAt: string;
  portfolio: Portfolio;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function readStoredPortfolio(value: unknown): Portfolio | null {
  if (!isRecord(value) || value.version !== STORAGE_VERSION || !isRecord(value.portfolio)) return null;
  const portfolio = value.portfolio;
  if (
    portfolio.source !== "cas"
    || typeof portfolio.statementDate !== "string"
    || typeof portfolio.valuationDate !== "string"
    || !Number.isFinite(portfolio.currentValue)
    || !Number.isFinite(portfolio.invested)
    || !Array.isArray(portfolio.funds)
    || !Array.isArray(portfolio.closedFunds)
    || !Array.isArray(portfolio.timeline)
  ) return null;
  return portfolio as Portfolio;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PORTFOLIO_DATABASE, STORAGE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadPortfolioFromBrowser(): Promise<Portfolio | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(PORTFOLIO_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return readStoredPortfolio(stored);
  } finally {
    database.close();
  }
}

export async function savePortfolioToBrowser(portfolio: Portfolio): Promise<void> {
  if (typeof indexedDB === "undefined" || portfolio.source !== "cas") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const stored: StoredPortfolio = { version: STORAGE_VERSION, savedAt: new Date().toISOString(), portfolio };
      transaction.objectStore(STORE_NAME).put(stored, PORTFOLIO_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function clearPortfolioFromBrowser(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PORTFOLIO_DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
