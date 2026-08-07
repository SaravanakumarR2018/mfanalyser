"use client";

import { useMemo, useRef, useState } from "react";
import PortfolioChart from "./PortfolioChart";
import {
  demoPortfolio,
  parseCasFile,
  type FundHolding,
  type Portfolio,
  type TimelinePoint,
} from "./cas-parser";

const formatMoney = (value: number, decimals = 0) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value);

const compactMoney = (value: number) => {
  if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`;
  return formatMoney(value);
};

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${date}T00:00:00Z`),
  );

const palette = ["#79DDA7", "#FF856F", "#F2C96D", "#86A8D4", "#B49BD8", "#9FB69F", "#D59C76"];

function Brand() {
  return (
    <div className="brand" aria-label="FolioVista home">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span>FolioVista</span>
    </div>
  );
}

type UploadPanelProps = {
  busy: boolean;
  progress: number;
  error: string;
  passwordMode: boolean;
  password: string;
  setPassword: (password: string) => void;
  onFile: (file: File, password?: string) => void;
  onRetry: () => void;
  onDemo: () => void;
};

function UploadPanel({ busy, progress, error, passwordMode, password, setPassword, onFile, onRetry, onDemo }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="upload-card-wrap">
      <div
        className={`upload-card ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
      >
        {passwordMode ? (
          <div className="password-panel">
            <span className="lock-illustration" aria-hidden="true"><i /></span>
            <p className="eyebrow">Protected statement</p>
            <h3>Enter the PDF password</h3>
            <p>It is used only in this browser tab and is never sent anywhere.</p>
            <label>
              <span>PDF password</span>
              <input
                autoFocus
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") onRetry(); }}
                placeholder="Enter password"
              />
            </label>
            <button className="primary-button full" onClick={onRetry} disabled={!password || busy}>
              {busy ? "Unlocking…" : "Unlock & analyse"}
            </button>
          </div>
        ) : busy ? (
          <div className="processing-panel" aria-live="polite">
            <div className="processing-orbit"><i /><i /><i /></div>
            <p className="eyebrow">Reading locally</p>
            <h3>Reconciling your portfolio</h3>
            <p>Checking every scheme, folio, unit balance and valuation.</p>
            <div className="progress-row"><span style={{ width: `${progress}%` }} /></div>
            <small>{progress}% complete</small>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
                event.target.value = "";
              }}
            />
            <span className="pdf-illustration" aria-hidden="true"><i>PDF</i></span>
            <p className="eyebrow">Start with your statement</p>
            <h3>Drop your CAS here</h3>
            <p>Detailed CAMS or KFintech consolidated account statement · PDF up to 30 MB</p>
            <button className="primary-button" onClick={() => inputRef.current?.click()}>Choose statement</button>
            <button className="text-button" onClick={onDemo}>or explore with demo data <span>→</span></button>
          </>
        )}
      </div>
      {error && !passwordMode && <div className="upload-error" role="alert"><span>!</span><p>{error}</p></div>}
      <div className="privacy-caption"><span className="tiny-lock">⌁</span> Your PDF never leaves this device. No account. No storage.</div>
    </div>
  );
}

function Landing({ onPortfolio }: { onPortfolio: (portfolio: Portfolio) => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [passwordMode, setPasswordMode] = useState(false);
  const [password, setPassword] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const processFile = async (file: File, suppliedPassword = "") => {
    setBusy(true);
    setError("");
    setProgress(3);
    try {
      const portfolio = await parseCasFile(file, suppliedPassword, setProgress);
      setPendingFile(null);
      setPassword("");
      setPasswordMode(false);
      onPortfolio(portfolio);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "PasswordRequired") {
        setPendingFile(file);
        setPasswordMode(true);
      } else {
        setPendingFile(null);
        setPasswordMode(false);
        setError(caught instanceof Error ? caught.message : "This statement could not be read. Please try a fresh detailed CAS PDF.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="landing">
      <header className="site-header">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
          <button className="header-action" onClick={() => document.querySelector<HTMLButtonElement>(".upload-card .primary-button")?.click()}>
            Analyse statement
          </button>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="hero-kicker"><span>Private by design</span><i /> All calculations happen here</div>
          <h1>Your mutual funds,<br /><em>finally in focus.</em></h1>
          <p>Turn a dense CAS PDF into a clear, interactive view of every fund, every rupee, and the journey in between.</p>
          <div className="trust-row">
            <span><i>✓</i> Statement totals reconciled</span>
            <span><i>✓</i> CAMS + KFintech</span>
            <span><i>✓</i> Nothing uploaded</span>
          </div>
        </div>
        <UploadPanel
          busy={busy}
          progress={progress}
          error={error}
          passwordMode={passwordMode}
          password={password}
          setPassword={setPassword}
          onFile={processFile}
          onRetry={() => pendingFile && processFile(pendingFile, password)}
          onDemo={() => onPortfolio(demoPortfolio)}
        />
      </section>

      <section className="preview-band" aria-label="Dashboard preview">
        <div className="preview-window">
          <div className="preview-nav"><Brand /><span /><span /><i /></div>
          <div className="preview-body">
            <div className="preview-summary">
              <small>TOTAL PORTFOLIO VALUE</small>
              <strong>₹30.70L</strong>
              <span>+₹6.84L all-time gain</span>
              <div className="preview-swoop"><i /><i /><i /><i /><i /><i /><i /></div>
            </div>
            <div className="preview-side">
              <span className="preview-donut" />
              <div><small>LARGEST ALLOCATION</small><strong>Small cap</strong><em>26.9%</em></div>
            </div>
          </div>
        </div>
        <div className="preview-float left"><span>✓</span><div><strong>Reconciled</strong><small>To the last paisa</small></div></div>
        <div className="preview-float right"><span>↗</span><div><strong>+28.7%</strong><small>Absolute return</small></div></div>
      </section>

      <section className="how-section" id="how-it-works">
        <div>
          <p className="eyebrow">From PDF to perspective</p>
          <h2>Three steps. Zero data trails.</h2>
        </div>
        <ol>
          <li><span>01</span><h3>Choose your CAS</h3><p>Use the detailed statement from CAMS or KFintech. Password-protected PDFs are supported.</p></li>
          <li><span>02</span><h3>We reconcile it</h3><p>Folio valuations are totalled and checked against the portfolio summary before anything is shown.</p></li>
          <li><span>03</span><h3>Explore the journey</h3><p>Zoom, pan, compare allocations and inspect each fund without your data leaving the tab.</p></li>
        </ol>
      </section>

      <section className="privacy-section" id="privacy">
        <div className="privacy-orb"><span>⌁</span></div>
        <div><p className="eyebrow">A private tool, not a data collector</p><h2>Your money is personal.<br />Your data stays that way.</h2></div>
        <div className="privacy-points"><p><i>01</i><span><strong>Browser-only processing</strong>Your PDF is opened in memory and discarded after analysis.</span></p><p><i>02</i><span><strong>No account or analytics profile</strong>There is nothing to sign up for and no portfolio stored on a server.</span></p></div>
      </section>
      <footer><Brand /><p>Clarity for your consolidated account statement.</p><span>Built for privacy · Not investment advice</span></footer>
    </main>
  );
}

function buildFundTimeline(fund: FundHolding): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  let units = 0;
  let netInvested = 0;
  const transactions = [...fund.transactions].sort((a, b) => a.date.localeCompare(b.date));

  for (const transaction of transactions) {
    units += transaction.units;
    netInvested += transaction.amount;
    const point = {
      date: transaction.date,
      invested: Math.max(0, netInvested),
      value: Math.max(0, units * transaction.price),
    };
    if (points.at(-1)?.date === transaction.date) points[points.length - 1] = point;
    else points.push(point);
  }

  const exactPoint: TimelinePoint = {
    date: fund.navDate,
    invested: fund.invested,
    value: fund.currentValue,
    exact: true,
  };
  if (points.at(-1)?.date === fund.navDate) points[points.length - 1] = exactPoint;
  else points.push(exactPoint);

  if (points.length === 1) {
    const start = new Date(`${fund.navDate}T00:00:00Z`);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    points.unshift({ date: start.toISOString().slice(0, 10), invested: 0, value: 0 });
  }
  return points;
}

function FundDrawer({ fund, onClose }: { fund: FundHolding; onClose: () => void }) {
  const gain = fund.currentValue - fund.invested;
  const returnValue = fund.invested ? (gain / fund.invested) * 100 : 0;
  const timeline = useMemo(() => buildFundTimeline(fund), [fund]);
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="fund-drawer" aria-modal="true" role="dialog" aria-labelledby="fund-title">
        <button className="drawer-close" onClick={onClose} aria-label="Close fund details">×</button>
        <p className="eyebrow">{fund.category} · {fund.folios} {fund.folios === 1 ? "folio" : "folios"}</p>
        <h2 id="fund-title">{fund.name}</h2>
        <p className="drawer-isin">{fund.isin}</p>
        <div className="drawer-value"><span>Current value</span><strong>{formatMoney(fund.currentValue)}</strong><em className={gain >= 0 ? "positive" : "negative"}>{gain >= 0 ? "+" : ""}{formatMoney(gain)} · {returnValue.toFixed(1)}%</em></div>
        <div className="drawer-grid">
          <p><span>Invested</span><strong>{formatMoney(fund.invested)}</strong></p>
          <p><span>Units</span><strong>{fund.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</strong></p>
          <p><span>Latest NAV</span><strong>{formatMoney(fund.nav, 4)}</strong></p>
          <p><span>NAV date</span><strong>{formatDate(fund.navDate)}</strong></p>
        </div>
        <PortfolioChart
          points={timeline}
          eyebrow="Fund journey"
          title="Invested vs value"
          valueLabel="Fund value"
          compact
          note={fund.transactions.length
            ? "the final invested amount and value are exact from this fund’s CAS rows. Earlier points use its recorded transaction units and NAVs."
            : "the CAS provides the exact current invested amount and value, but did not include usable transaction rows for an earlier history."}
        />
        <div className="transaction-head"><h3>Statement transactions</h3><span>{fund.transactions.length}</span></div>
        {fund.transactions.length ? (
          <div className="transaction-list">
            {fund.transactions.slice().reverse().slice(0, 12).map((transaction, index) => (
              <div key={`${transaction.date}-${index}`}>
                <span className={`transaction-icon ${transaction.amount < 0 ? "out" : ""}`}>{transaction.amount < 0 ? "↓" : "↑"}</span>
                <p><strong>{transaction.label}</strong><small>{formatDate(transaction.date)} · {transaction.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })} units</small></p>
                <b>{formatMoney(transaction.amount)}</b>
              </div>
            ))}
          </div>
        ) : <p className="empty-transactions">Transaction rows were not available for this holding.</p>}
      </aside>
    </div>
  );
}

function Dashboard({ portfolio, onReset }: { portfolio: Portfolio; onReset: () => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"value" | "return" | "name">("value");
  const [selected, setSelected] = useState<FundHolding | null>(null);
  const gain = portfolio.currentValue - portfolio.invested;
  const absoluteReturn = portfolio.invested ? (gain / portfolio.invested) * 100 : 0;
  const activeFolios = portfolio.funds.reduce((total, fund) => total + fund.folios, 0);

  const allocations = useMemo(() => {
    const grouped = new Map<string, number>();
    portfolio.funds.forEach((fund) => grouped.set(fund.category, (grouped.get(fund.category) ?? 0) + fund.currentValue));
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  }, [portfolio]);

  const conic = useMemo(() => {
    let start = 0;
    return allocations.map(([category, value], index) => {
      const share = (value / portfolio.currentValue) * 100;
      const segment = `${palette[index % palette.length]} ${start}% ${start + share}%`;
      start += share;
      return segment;
    }).join(", ");
  }, [allocations, portfolio.currentValue]);

  const filteredFunds = useMemo(() => {
    const lower = query.toLowerCase();
    return portfolio.funds
      .filter((fund) => `${fund.name} ${fund.fundHouse} ${fund.category}`.toLowerCase().includes(lower))
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "return") return ((b.currentValue - b.invested) / Math.max(1, b.invested)) - ((a.currentValue - a.invested) / Math.max(1, a.invested));
        return b.currentValue - a.currentValue;
      });
  }, [portfolio.funds, query, sort]);

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <Brand />
        <div className="dash-context"><span>Portfolio overview</span><i />Statement as of {formatDate(portfolio.statementDate)}</div>
        <button className="import-button" onClick={onReset}><span>＋</span> Import another CAS</button>
      </header>
      <div className="dashboard-shell">
        <div className="reconcile-bar">
          <div><span className="check-badge">✓</span><strong>Statement reconciled</strong><i />{portfolio.funds.length} active funds across {activeFolios} folios</div>
          <p><span className="privacy-pulse" /> Processed locally · Nothing uploaded {portfolio.source === "demo" && <em>Demo data</em>}</p>
        </div>

        <section className="summary-card">
          <div className="summary-main">
            <p>TOTAL PORTFOLIO VALUE <span title="Exact value from the CAS portfolio summary">i</span></p>
            <h1>{compactMoney(portfolio.currentValue)}</h1>
            <div className="gain-line"><strong className={gain >= 0 ? "positive" : "negative"}>{gain >= 0 ? "↗" : "↘"} {formatMoney(Math.abs(gain))}</strong><span>all-time gain</span><i /> <strong>{absoluteReturn.toFixed(2)}%</strong><span>absolute return</span></div>
            <small>Exact statement value · {formatDate(portfolio.statementDate)}</small>
          </div>
          <div className="summary-allocation">
            <div className="hero-donut" style={{ background: `conic-gradient(${conic})` }}><span><small>{portfolio.funds.length}</small>funds</span></div>
            <div><p>LARGEST ALLOCATION</p><strong>{allocations[0]?.[0]}</strong><span>{((allocations[0]?.[1] ?? 0) / portfolio.currentValue * 100).toFixed(1)}% of portfolio</span></div>
          </div>
        </section>

        <section className="metric-grid" aria-label="Portfolio summary metrics">
          <article><p>Amount invested <span>i</span></p><strong>{compactMoney(portfolio.invested)}</strong><small>Across active holdings</small></article>
          <article><p>Wealth created</p><strong className={gain >= 0 ? "positive" : "negative"}>{compactMoney(gain)}</strong><small>{absoluteReturn.toFixed(2)}% on invested capital</small></article>
          <article><p>Active funds</p><strong>{portfolio.funds.length}</strong><small>{activeFolios} statement folios</small></article>
          <article className="accuracy-metric"><p>Accuracy check</p><strong><i>✓</i> Reconciled</strong><small>{portfolio.reconciliationDifference <= 0.01 ? "Within statement rounding" : `₹${portfolio.reconciliationDifference.toFixed(2)} rounding difference`}</small></article>
        </section>

        <PortfolioChart points={portfolio.timeline} />

        <section className="holdings-card" aria-labelledby="holdings-title">
          <div className="holdings-head">
            <div><p className="eyebrow">The full picture</p><h2 id="holdings-title">Your funds</h2></div>
            <div className="table-tools">
              <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search funds" aria-label="Search funds" /></label>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort funds">
                <option value="value">Sort: Value</option>
                <option value="return">Sort: Return</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>
          </div>
          <div className="fund-table" role="table" aria-label="Mutual fund holdings">
            <div className="fund-row table-header" role="row"><span>Fund</span><span>Invested</span><span>Current value</span><span>Gain / loss</span><span>Return</span><span /></div>
            {filteredFunds.map((fund, index) => {
              const fundGain = fund.currentValue - fund.invested;
              const fundReturn = fund.invested ? (fundGain / fund.invested) * 100 : 0;
              return (
                <button className="fund-row" role="row" key={fund.key} onClick={() => setSelected(fund)}>
                  <span className="fund-name"><i style={{ background: palette[index % palette.length] }}>{fund.fundHouse.slice(0, 2).toUpperCase()}</i><span><strong>{fund.name}</strong><small>{fund.category} · {fund.folios} {fund.folios === 1 ? "folio" : "folios"}</small></span></span>
                  <span data-label="Invested">{formatMoney(fund.invested)}</span>
                  <span data-label="Current value"><strong>{formatMoney(fund.currentValue)}</strong></span>
                  <span data-label="Gain / loss" className={fundGain >= 0 ? "positive" : "negative"}>{fundGain >= 0 ? "+" : ""}{formatMoney(fundGain)}</span>
                  <span data-label="Return"><em className={fundReturn >= 0 ? "return-pill positive" : "return-pill negative"}>{fundReturn >= 0 ? "↗" : "↘"} {fundReturn.toFixed(1)}%</em></span>
                  <span className="row-arrow">›</span>
                </button>
              );
            })}
            {!filteredFunds.length && <div className="no-results">No funds match “{query}”.</div>}
          </div>
        </section>

        <section className="insight-grid">
          <article className="allocation-card">
            <div><p className="eyebrow">Where it sits</p><h2>Allocation</h2></div>
            <div className="allocation-content">
              <div className="allocation-donut" style={{ background: `conic-gradient(${conic})` }}><span><strong>100%</strong><small>invested</small></span></div>
              <div className="allocation-list">
                {allocations.slice(0, 6).map(([category, value], index) => <p key={category}><i style={{ background: palette[index % palette.length] }} /><span>{category}</span><strong>{(value / portfolio.currentValue * 100).toFixed(1)}%</strong></p>)}
              </div>
            </div>
          </article>
          <article className="top-funds-card">
            <p className="eyebrow">Concentration check</p><h2>Top holdings</h2>
            <div className="top-list">
              {portfolio.funds.slice(0, 4).map((fund, index) => <div key={fund.key}><span>{String(index + 1).padStart(2, "0")}</span><p><strong>{fund.name}</strong><i><b style={{ width: `${fund.currentValue / portfolio.funds[0].currentValue * 100}%` }} /></i></p><em>{(fund.currentValue / portfolio.currentValue * 100).toFixed(1)}%</em></div>)}
            </div>
          </article>
        </section>

        <footer className="dashboard-footer"><Brand /><p>Your statement was processed locally and is not stored by FolioVista.</p><span>For tracking only · Not investment advice</span></footer>
      </div>
      {selected && <FundDrawer fund={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

export default function FolioVista() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  return portfolio ? <Dashboard portfolio={portfolio} onReset={() => setPortfolio(null)} /> : <Landing onPortfolio={setPortfolio} />;
}
