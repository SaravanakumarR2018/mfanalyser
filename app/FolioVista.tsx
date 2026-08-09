"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import PortfolioChart from "./PortfolioChart";
import NavActivityChart from "./NavActivityChart";
import FundStackChart from "./FundStackChart";
import {
  demoPortfolio,
  parseCasFile,
  type ClosedFund,
  type FolioHolding,
  type FundHolding,
  type FundTransaction,
  type HistoricalNavPoint,
  type Portfolio,
  type TimelinePoint,
} from "./cas-parser";
import { refreshWithDailyHistory, refreshWithLatestNav, type NavHistoryProgress } from "./nav-service";
import { buildHoldingTimeline } from "./timeline-service";
import {
  annualizedReturnAt,
  portfolioAbsoluteReturn,
  portfolioAnnualizedReturn,
} from "./fund-stack-service";
import {
  DEFAULT_FUND_SORT,
  nextFundSort,
  sortFunds,
  type FundSort,
  type FundSortKey,
} from "./fund-sort";

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

function SortableFundHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: FundSortKey;
  sort: FundSort;
  onSort: (key: FundSortKey) => void;
}) {
  const active = sort.key === sortKey;
  const direction = active ? sort.direction : null;
  const nextDirection = active && direction === "desc" ? "ascending" : "descending";
  const stateLabel = active
    ? direction === "asc"
      ? "Low → high"
      : "High → low"
    : "Sort";
  return (
    <span className={`sort-column${active ? " active" : ""}`} role="columnheader" aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        className={`table-sort${active ? " active" : ""}`}
        aria-label={`${label}: ${active ? `sorted ${direction === "asc" ? "ascending" : "descending"}` : "not sorted"}. Sort ${nextDirection}.`}
        title={`Sort ${label.toLowerCase()} ${nextDirection}`}
        onClick={() => onSort(sortKey)}
      >
        <span className="table-sort-copy">
          <strong>{label}</strong>
          <small>{stateLabel}</small>
        </span>
        <i className={`sort-arrows${direction ? ` ${direction}` : ""}`} aria-hidden="true"><b>↑</b><b>↓</b></i>
      </button>
    </span>
  );
}

function MetricInfo({ label, children }: { label: string; children: string }) {
  const tooltipId = useId();
  return (
    <span className="metric-info">
      <button type="button" aria-label={label} aria-describedby={tooltipId}>i</button>
      <span id={tooltipId} role="tooltip">{children}</span>
    </span>
  );
}

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
      const statementPortfolio = await parseCasFile(
        file,
        suppliedPassword,
        (nextProgress) => setProgress(Math.min(88, nextProgress)),
      );
      setProgress(92);
      const portfolio = await refreshWithLatestNav(statementPortfolio);
      setProgress(100);
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

type JourneyHolding = {
  currentValue: number;
  invested: number;
  units: number;
  nav: number;
  navDate: string;
  liveNav?: boolean;
  navHistory?: HistoricalNavPoint[];
  folioHoldings?: FolioHolding[];
  transactions: FundTransaction[];
};

type MomentumSignal = {
  label: "1Y" | "1M";
  value: number;
  strong: boolean;
  yoy: number | null;
  mom: number | null;
};

function getMomentum(holding: JourneyHolding): MomentumSignal | null {
  if (!holding.nav || !holding.navDate) return null;
  const currentDate = new Date(`${holding.navDate}T00:00:00Z`).getTime();
  const dailyPrices = holding.navHistory?.map((point) => ({
    date: new Date(`${point.date}T00:00:00Z`).getTime(),
    price: point.nav,
  })) ?? [];
  const prices = dailyPrices.length
    ? dailyPrices
    : holding.transactions
      .filter((transaction) => transaction.price > 0 && transaction.date < holding.navDate)
      .map((transaction) => ({ date: new Date(`${transaction.date}T00:00:00Z`).getTime(), price: transaction.price }));

  const observedReturn = (months: number, toleranceDays: number) => {
    const target = new Date(currentDate);
    target.setUTCMonth(target.getUTCMonth() - months);
    const nearest = prices.reduce<{ date: number; price: number } | null>((best, point) => {
      if (!best) return point;
      return Math.abs(point.date - target.getTime()) < Math.abs(best.date - target.getTime()) ? point : best;
    }, null);
    if (!nearest || Math.abs(nearest.date - target.getTime()) > toleranceDays * 86_400_000) return null;
    return ((holding.nav / nearest.price) - 1) * 100;
  };

  const yoy = observedReturn(12, 75);
  const mom = observedReturn(1, 24);
  if (yoy === null && mom === null) return null;
  const yoyStrong = yoy !== null && yoy >= 12;
  const momStrong = mom !== null && mom >= 2;
  if (momStrong && (!yoyStrong || (mom ?? 0) / 2 > (yoy ?? 0) / 12)) {
    return { label: "1M", value: mom as number, strong: true, yoy, mom };
  }
  if (yoy !== null) return { label: "1Y", value: yoy, strong: yoyStrong, yoy, mom };
  return { label: "1M", value: mom as number, strong: momStrong, yoy, mom };
}

function getDownside(points: TimelinePoint[]) {
  let episodes = 0;
  let observations = 0;
  let inDip = false;
  let worst = 0;
  for (const point of points) {
    const drawdown = point.invested > 0 ? ((point.value - point.invested) / point.invested) * 100 : 0;
    const below = point.invested > 0 && drawdown < -0.25;
    if (below) {
      observations += 1;
      worst = Math.min(worst, drawdown);
      if (!inDip) episodes += 1;
    }
    inDip = below;
  }
  return { episodes, observations, worst };
}

function MomentumBadge({ holding }: { holding: JourneyHolding }) {
  const momentum = getMomentum(holding);
  if (!momentum) return <span className="signal-empty">Not enough history</span>;
  const displayChange = (label: string, value: number) => `${label} ${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  return (
    <span className={`momentum-badge ${momentum.strong ? "strong" : momentum.value < 0 ? "weak" : "steady"}`} title={`${holding.navHistory?.length ? "Official daily AMFI" : "CAS-observed"} NAV change. 1Y: ${momentum.yoy === null ? "unavailable" : `${momentum.yoy.toFixed(1)}%`}; 1M: ${momentum.mom === null ? "unavailable" : `${momentum.mom.toFixed(1)}%`}.`}>
      {momentum.yoy !== null && <strong>{displayChange("YoY", momentum.yoy)}</strong>}
      {momentum.mom !== null && <strong>{displayChange("MoM", momentum.mom)}</strong>}
      <small>{momentum.strong ? "Strong" : momentum.value < 0 ? "Cooling" : "Steady"}</small>
    </span>
  );
}

function DownsideBadge({ holding }: { holding: JourneyHolding }) {
  const downside = getDownside(buildHoldingTimeline(holding));
  const tone = downside.episodes >= 3 ? "risk" : downside.episodes > 0 ? "watch" : "clear";
  return (
    <span className={`downside-badge ${tone}`} title={downside.episodes ? `Value moved below net invested in ${downside.episodes} distinct CAS-observed period${downside.episodes === 1 ? "" : "s"}. Worst observed gap: ${downside.worst.toFixed(1)}%.` : "No CAS-observed period below net invested."}>
      <i>{tone === "clear" ? "✓" : "↓"}</i>
      <span><strong>{downside.episodes ? `${downside.episodes} ${downside.episodes === 1 ? "dip" : "dips"}` : "Never"}</strong><small>{tone === "risk" ? "Repeated" : tone === "watch" ? "Below cost" : "Below cost"}</small></span>
    </span>
  );
}

const TRANSACTION_BATCH_SIZE = 20;

function CompleteTransactionHistory({
  title,
  transactions,
}: {
  title: string;
  transactions: FundTransaction[];
}) {
  const orderedTransactions = useMemo(
    () => [...transactions].sort((left, right) => right.date.localeCompare(left.date)),
    [transactions],
  );
  const [visibleCount, setVisibleCount] = useState(
    Math.min(TRANSACTION_BATCH_SIZE, orderedTransactions.length),
  );
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const displayedTransactions = orderedTransactions.slice(0, visibleCount);
  const hasEarlierTransactions = visibleCount < orderedTransactions.length;

  const loadNextBatch = useCallback(() => {
    setVisibleCount((current) =>
      Math.min(current + TRANSACTION_BATCH_SIZE, orderedTransactions.length),
    );
  }, [orderedTransactions.length]);

  useEffect(() => {
    const loadMoreTarget = loadMoreRef.current;
    if (!loadMoreTarget || !hasEarlierTransactions || typeof IntersectionObserver === "undefined") {
      return;
    }

    const drawer = loadMoreTarget.closest(".fund-drawer");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNextBatch();
      },
      {
        root: drawer,
        rootMargin: "0px 0px 180px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(loadMoreTarget);
    return () => observer.disconnect();
  }, [hasEarlierTransactions, loadNextBatch]);

  return (
    <>
      <div className="transaction-head">
        <h3>{title}</h3>
        {orderedTransactions.length > 0 && (
          <span>
            {visibleCount.toLocaleString("en-IN")} of{" "}
            {orderedTransactions.length.toLocaleString("en-IN")}
          </span>
        )}
      </div>
      {orderedTransactions.length ? (
        <>
          <div className="transaction-list" aria-label={`Complete ${title.toLowerCase()}`}>
            {displayedTransactions.map((transaction, index) => (
              <div key={`${transaction.date}-${transaction.label}-${index}`}>
                <span className={`transaction-icon ${transaction.amount < 0 ? "out" : ""}`}>
                  {transaction.amount < 0 ? "↓" : "↑"}
                </span>
                <p>
                  <strong>{transaction.label}</strong>
                  <small>
                    {formatDate(transaction.date)} ·{" "}
                    {transaction.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })} units
                  </small>
                </p>
                <b>{formatMoney(transaction.amount)}</b>
              </div>
            ))}
          </div>
          {hasEarlierTransactions ? (
            <div ref={loadMoreRef} className="transaction-load-more" aria-live="polite">
              <span>Scroll for earlier transactions</span>
              <button type="button" onClick={loadNextBatch}>
                Load 20 more
              </button>
            </div>
          ) : (
            <div className="transaction-history-complete">
              <span aria-hidden="true">✓</span>
              Complete history · earliest transaction{" "}
              {formatDate(orderedTransactions[orderedTransactions.length - 1].date)}
            </div>
          )}
        </>
      ) : (
        <p className="empty-transactions">Transaction rows were not available for this holding.</p>
      )}
    </>
  );
}

function HoldingDrawer({
  title,
  eyebrow,
  subtitle,
  holding,
  onClose,
  transactionTitle,
  valueLabel,
}: {
  title: string;
  eyebrow: string;
  subtitle: string;
  holding: JourneyHolding;
  onClose: () => void;
  transactionTitle: string;
  valueLabel: string;
}) {
  const titleId = useId();
  const gain = holding.currentValue - holding.invested;
  const returnValue = holding.invested ? (gain / holding.invested) * 100 : 0;
  const timeline = useMemo(() => buildHoldingTimeline(holding), [holding]);
  const momentum = getMomentum(holding);
  const downside = getDownside(timeline);
  return (
    <div className="drawer-backdrop">
      <button className="drawer-scrim" type="button" onClick={onClose} aria-label="Close holding details" />
      <aside className="fund-drawer" aria-modal="true" role="dialog" aria-labelledby={titleId}>
        <button className="drawer-close" onClick={onClose} aria-label="Close fund details">×</button>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        <p className="drawer-isin">{subtitle}</p>
        <div className="drawer-value"><span>Current value</span><strong>{formatMoney(holding.currentValue)}</strong><em className={gain >= 0 ? "positive" : "negative"}>{gain >= 0 ? "+" : ""}{formatMoney(gain)} · {returnValue.toFixed(1)}%</em></div>
        <div className="drawer-grid">
          <p><span>Net invested</span><strong>{formatMoney(holding.invested)}</strong></p>
          <p><span>Units</span><strong>{holding.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</strong></p>
          <p><span>Latest NAV</span><strong>{formatMoney(holding.nav, 4)}</strong></p>
          <p><span>NAV date</span><strong>{formatDate(holding.navDate)}</strong></p>
        </div>
        <div className="drawer-signals">
          <article>
            <span>Observed momentum</span>
            <MomentumBadge holding={holding} />
            <small>{momentum?.strong ? "Strong relative NAV movement" : holding.navHistory?.length ? "Based on official daily NAV history" : "Based on transaction-day NAV history"}</small>
          </article>
          <article className={downside.episodes >= 3 ? "signal-risk" : downside.episodes ? "signal-watch" : "signal-clear"}>
            <span>Below invested value</span>
            <strong>{downside.episodes ? `${downside.episodes} distinct ${downside.episodes === 1 ? "period" : "periods"}` : "Not observed"}</strong>
            <small>{downside.episodes ? `Worst observed gap ${downside.worst.toFixed(1)}%` : "Value stayed above net invested"}</small>
          </article>
        </div>
        <PortfolioChart
          points={timeline}
          eyebrow="Fund journey"
          title="Invested vs value"
          valueLabel={valueLabel}
          compact
          showBelowCost
          note={holding.transactions.length
            ? holding.navHistory?.length
              ? "daily points use every actual published AMFI NAV and the CAS unit balance held on that date. Diamonds retain exact CAS transaction dates; missing dates are skipped, never estimated."
              : "the invested amount is the net cash flow recorded in the CAS. Daily AMFI history is loading or unavailable; transaction dates and the exact endpoint remain visible."
            : "the CAS provides the exact current invested amount and value, but did not include usable transaction rows for an earlier history."}
        />
        <NavActivityChart
          transactions={holding.transactions}
          navHistory={holding.navHistory}
          nav={holding.nav}
          navDate={holding.navDate}
          liveNav={holding.liveNav}
        />
        <CompleteTransactionHistory
          key={`${title}-${subtitle}-${holding.transactions.length}`}
          title={transactionTitle}
          transactions={holding.transactions}
        />
      </aside>
    </div>
  );
}

function FundDrawer({ fund, onClose }: { fund: FundHolding; onClose: () => void }) {
  return (
    <HoldingDrawer
      title={fund.name}
      eyebrow={`${fund.category} · ${fund.folios} ${fund.folios === 1 ? "folio" : "folios"}`}
      subtitle={fund.isin}
      holding={fund}
      onClose={onClose}
      transactionTitle="Statement transactions"
      valueLabel="Fund value"
    />
  );
}

function FolioDrawer({ fund, folio, onClose }: { fund: FundHolding; folio: FolioHolding; onClose: () => void }) {
  return (
    <HoldingDrawer
      title={folio.label}
      eyebrow={`${fund.category} · ${fund.name}`}
      subtitle="Masked folio number · visible only in this browser tab"
      holding={folio}
      onClose={onClose}
      transactionTitle="Folio transactions"
      valueLabel="Folio value"
    />
  );
}

function ClosedFunds({ funds }: { funds: ClosedFund[] }) {
  if (!funds.length) return null;
  const totalRealized = funds.reduce((total, fund) => total + fund.realizedGain, 0);
  return (
    <section className="closed-card" aria-labelledby="closed-title">
      <div className="closed-head">
        <div><p className="eyebrow">Completed journeys</p><h2 id="closed-title">Closed funds</h2></div>
        <div><span>Realised gain</span><strong className={totalRealized >= 0 ? "positive" : "negative"}>{formatMoney(totalRealized)}</strong></div>
      </div>
      <p className="closed-explainer">These funds have a zero closing balance in the CAS. Their realised gains are included in all-time performance, but not in current portfolio value or active invested amount.</p>
      <div className="closed-table">
        <div className="closed-row closed-table-head"><span>Fund</span><span>Closed</span><span>Historic investment</span><span>Sale proceeds</span><span>Realised gain</span></div>
        {funds.map((fund) => (
          <div className="closed-row" key={fund.key}>
            <span><strong>{fund.name}</strong><small>{fund.folios} {fund.folios === 1 ? "folio" : "folios"} · {fund.category}</small></span>
            <span data-label="Closed">{fund.closedDate ? formatDate(fund.closedDate) : "—"}</span>
            <span data-label="Historic investment">{formatMoney(fund.totalInvested)}</span>
            <span data-label="Sale proceeds">{formatMoney(fund.totalProceeds)}</span>
            <span data-label="Realised gain" className={fund.realizedGain >= 0 ? "positive" : "negative"}>{fund.realizedGain >= 0 ? "+" : ""}{formatMoney(fund.realizedGain)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

type HistoryProgressState = NavHistoryProgress & { complete?: boolean };

function HistoryProgressToast({ progress }: { progress: HistoryProgressState }) {
  const detailsId = useId();
  const percentage = progress.total
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : 100;
  return (
    <aside
      className={`history-progress-toast ${progress.complete ? "complete" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={`Daily NAV history ${percentage}% loaded`}
    >
      <button className="history-progress-summary" type="button" aria-describedby={detailsId}>
        <span className="history-progress-pulse" aria-hidden="true" />
        <strong>{progress.complete ? "Daily NAVs ready" : "Loading daily NAVs"}</strong>
        <b>{percentage}%</b>
      </button>
      <div className="history-progress-track" aria-hidden="true">
        <i style={{ width: `${percentage}%` }} />
      </div>
      <div className="history-progress-details" id={detailsId}>
        <p>
          <strong>{progress.complete ? "Daily history is ready" : "Current portfolio values are ready"}</strong>
          <small>{progress.complete ? "All available NAV dates loaded" : "Published daily NAV history is loading in the background"}</small>
        </p>
        <span>{Math.min(progress.completed, progress.total)} of {progress.total} fund histories processed</span>
      </div>
    </aside>
  );
}

function Dashboard({
  portfolio,
  onReset,
  historyProgress,
}: {
  portfolio: Portfolio;
  onReset: () => void;
  historyProgress: HistoryProgressState | null;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FundSort>(() => ({ ...DEFAULT_FUND_SORT }));
  const [selectedFundKey, setSelectedFundKey] = useState<string | null>(null);
  const [selectedFolioKey, setSelectedFolioKey] = useState<{ fundKey: string; folioKey: string } | null>(null);
  const [expandedFund, setExpandedFund] = useState<string | null>(null);
  const selected = selectedFundKey
    ? portfolio.funds.find((fund) => fund.key === selectedFundKey) ?? null
    : null;
  const selectedFolioFund = selectedFolioKey
    ? portfolio.funds.find((fund) => fund.key === selectedFolioKey.fundKey) ?? null
    : null;
  const selectedFolio = selectedFolioFund && selectedFolioKey
    ? selectedFolioFund.folioHoldings.find((folio) => folio.key === selectedFolioKey.folioKey) ?? null
    : null;
  const unrealizedGain = portfolio.currentValue - portfolio.invested;
  const gain = unrealizedGain + portfolio.realizedGain;
  const absoluteReturn = portfolioAbsoluteReturn(portfolio.invested, gain);
  const absoluteReturnLabel = absoluteReturn === null ? "—" : `${absoluteReturn.toFixed(2)}%`;
  const annualizedReturn = useMemo(() => portfolioAnnualizedReturn(portfolio), [portfolio]);
  const activeFolios = portfolio.funds.reduce((total, fund) => total + fund.folios, 0);
  const fundColors = useMemo(
    () => new Map(portfolio.funds.map((fund, index) => [fund.key, palette[index % palette.length]])),
    [portfolio.funds],
  );

  const allocations = useMemo(() => {
    const grouped = new Map<string, number>();
    portfolio.funds.forEach((fund) => grouped.set(fund.category, (grouped.get(fund.category) ?? 0) + fund.currentValue));
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  }, [portfolio]);

  const conic = useMemo(() => {
    const shares = allocations.map(([, value]) => (value / portfolio.currentValue) * 100);
    return shares.map((share, index) => {
      const start = shares.slice(0, index).reduce((total, prior) => total + prior, 0);
      const segment = `${palette[index % palette.length]} ${start}% ${start + share}%`;
      return segment;
    }).join(", ");
  }, [allocations, portfolio.currentValue]);

  const fundsWithAnnualizedReturn = useMemo(
    () => portfolio.funds.map((fund) => ({
      ...fund,
      annualizedReturn: annualizedReturnAt(
        fund.transactions,
        fund.navDate || portfolio.valuationDate,
        fund.currentValue,
      ),
    })),
    [portfolio.funds, portfolio.valuationDate],
  );

  const filteredFunds = useMemo(() => {
    const lower = query.toLowerCase();
    const matches = fundsWithAnnualizedReturn
      .filter((fund) => `${fund.name} ${fund.fundHouse} ${fund.category}`.toLowerCase().includes(lower));
    return sortFunds(matches, sort);
  }, [fundsWithAnnualizedReturn, query, sort]);

  const selectSort = useCallback((key: FundSortKey) => {
    setSort((current) => nextFundSort(current, key));
  }, []);

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <Brand />
        <div className="dash-context"><span>Portfolio overview</span><i />Valued as of {formatDate(portfolio.valuationDate)}</div>
        <button className="import-button" onClick={onReset}><span>＋</span> Import another CAS</button>
      </header>
      <div className="dashboard-shell">
        <div className="reconcile-bar">
          <div><span className="check-badge">✓</span><strong>{portfolio.valuationSource === "amfi" ? "Latest NAV applied" : "Statement reconciled"}</strong><i />{portfolio.navCoverage.updated}/{portfolio.navCoverage.total} funds updated · {portfolio.navHistoryLoading ? "daily history loading" : portfolio.navHistoryCoverage ? `${portfolio.navHistoryCoverage.updated}/${portfolio.navHistoryCoverage.total} daily histories` : "daily history unavailable"} · {activeFolios} active folios</div>
          <p><span className="privacy-pulse" /> CAS processed locally · AMFI prices only {portfolio.source === "demo" && <em>Demo data</em>}</p>
        </div>

        <div className={`valuation-notice ${portfolio.valuationSource === "amfi" ? "live" : "fallback"}`}>
          <span>{portfolio.valuationSource === "amfi" ? "LIVE" : "CAS"}</span>
          <p><strong>{portfolio.valuationSource === "amfi" ? `Latest available official NAVs · ${formatDate(portfolio.valuationDate)}` : `Showing statement valuation · ${formatDate(portfolio.statementDate)}`}</strong>{portfolio.valuationSource === "amfi" ? ` Values use the unit balances in your CAS dated ${formatDate(portfolio.statementDate)}. ${portfolio.navHistoryLoading ? "Actual daily NAV history is loading in the background." : portfolio.navHistoryError ?? "Daily history uses only published AMFI observations."}` : ` ${portfolio.liveUpdateError ?? "Live NAVs were unavailable."}`}</p>
        </div>

        <section className="summary-card">
          <div className="summary-main">
            <p>CURRENT PORTFOLIO VALUE <span title="Latest available NAV multiplied by the unit balances in this CAS">i</span></p>
            <h1>{compactMoney(portfolio.currentValue)}</h1>
            <div className="gain-line"><strong className={gain >= 0 ? "positive" : "negative"}>{gain >= 0 ? "↗" : "↘"} {formatMoney(Math.abs(gain))}</strong><span>all-time gain</span><i /> <strong>{absoluteReturnLabel}</strong><span>absolute return</span></div>
            <small>{portfolio.valuationSource === "amfi" ? "Official AMFI NAV" : "CAS statement value"} · {formatDate(portfolio.valuationDate)} · CAS units as of {formatDate(portfolio.statementDate)}</small>
          </div>
          <div className="summary-allocation">
            <div className="hero-donut" style={{ background: `conic-gradient(${conic})` }}><span><small>{portfolio.funds.length}</small>funds</span></div>
            <div><p>LARGEST ALLOCATION</p><strong>{allocations[0]?.[0]}</strong><span>{((allocations[0]?.[1] ?? 0) / portfolio.currentValue * 100).toFixed(1)}% of portfolio</span></div>
          </div>
        </section>

        <section className="metric-grid" aria-label="Portfolio summary metrics">
          <article><p>Amount invested <span title="Purchases minus redemptions from active CAS holdings">i</span></p><strong>{compactMoney(portfolio.invested)}</strong><span className="metric-exact">Exact · {formatMoney(portfolio.invested, 2)}</span><small>Net transaction cash flow</small></article>
          <article><p>Wealth created</p><strong className={gain >= 0 ? "positive" : "negative"}>{compactMoney(gain)}</strong><span className="metric-exact">Exact · {formatMoney(gain, 2)}</span><small>{absoluteReturn === null ? "Absolute return unavailable" : `${absoluteReturnLabel} including realised gains`}</small></article>
          <article className="return-metric"><p>Absolute return <MetricInfo label="About absolute return">Wealth created divided by amount invested, including realised gains.</MetricInfo></p><strong className={absoluteReturn === null ? "" : absoluteReturn >= 0 ? "positive" : "negative"}>{absoluteReturnLabel}</strong><small>{absoluteReturn === null ? "Requires a positive invested amount" : "Total return including realised gains"}</small></article>
          <article className="return-metric"><p>Return p.a. <MetricInfo label="About return per annum">Money-weighted XIRR from exact dated CAS cash flows, including closed-fund proceeds, and the current portfolio value.</MetricInfo></p><strong className={annualizedReturn === null ? "" : annualizedReturn >= 0 ? "positive" : "negative"}>{annualizedReturn === null ? "—" : `${annualizedReturn.toFixed(2)}%`}</strong><small>{annualizedReturn === null ? "Not enough dated cash flows" : "Money-weighted XIRR · all funds"}</small></article>
          <article><p>Realised gains</p><strong className={portfolio.realizedGain >= 0 ? "positive" : "negative"}>{compactMoney(portfolio.realizedGain)}</strong><small>From {portfolio.closedFunds.length} closed {portfolio.closedFunds.length === 1 ? "fund" : "funds"}</small></article>
          <article><p>Active funds</p><strong>{portfolio.funds.length}</strong><small>{activeFolios} statement folios</small></article>
          <article className="accuracy-metric"><p>Accuracy check</p><strong><i>✓</i> Reconciled</strong><small>{portfolio.reconciliationDifference <= 0.01 ? "Within statement rounding" : `₹${portfolio.reconciliationDifference.toFixed(2)} rounding difference`}</small></article>
        </section>

        <PortfolioChart
          points={portfolio.timeline}
          note={portfolio.valuationSource === "amfi"
            ? portfolio.navHistoryLoading
              ? `exact daily AMFI NAV observations are loading in the background. CAS transaction dates and the latest endpoint dated ${formatDate(portfolio.valuationDate)} remain exact while loading.`
              : `daily points value the CAS units held in each scheme using actual AMFI NAVs published on that date. Transaction diamonds remain on exact CAS dates; incomplete dates are skipped rather than estimated.`
            : `the endpoint is the reconciled CAS value dated ${formatDate(portfolio.statementDate)} because live NAVs were unavailable. Net invested is calculated from statement purchases and redemptions.`}
        />

        <section className="holdings-card" aria-labelledby="holdings-title">
          <div className="holdings-head">
            <div><p className="eyebrow">The full picture</p><h2 id="holdings-title">Your funds</h2></div>
            <div className="table-tools">
              <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search funds" aria-label="Search funds" /></label>
            </div>
          </div>
          <div className="signal-guide">
            <p><i className="guide-momentum">↗</i><span><strong>YoY / MoM momentum</strong>Uses the nearest official daily AMFI NAV when available. “Strong” means at least +12% YoY or +2% MoM.</span></p>
            <p><i className="guide-dip">↓</i><span><strong>Below-cost periods</strong>Counts distinct observed periods where estimated value fell below net invested by more than 0.25%.</span></p>
          </div>
          <div className="fund-table" role="table" aria-label="Mutual fund holdings">
            <div className="fund-row table-header" role="row">
              <span role="columnheader">Fund</span>
              <SortableFundHeader label="Invested amount" sortKey="invested" sort={sort} onSort={selectSort} />
              <SortableFundHeader label="Current value" sortKey="value" sort={sort} onSort={selectSort} />
              <SortableFundHeader label="Gain / loss" sortKey="gain" sort={sort} onSort={selectSort} />
              <SortableFundHeader label="Return" sortKey="return" sort={sort} onSort={selectSort} />
              <SortableFundHeader label="Return p.a." sortKey="annualizedReturn" sort={sort} onSort={selectSort} />
              <span role="columnheader">Momentum</span><span role="columnheader">Below cost</span><span role="columnheader" />
            </div>
            {filteredFunds.map((fund) => {
              const fundGain = fund.currentValue - fund.invested;
              const fundReturn = fund.invested ? (fundGain / fund.invested) * 100 : 0;
              const expanded = expandedFund === fund.key;
              return (
                <div className={`fund-group ${expanded ? "expanded" : ""}`} key={fund.key}>
                  <div
                    className="fund-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedFundKey(fund.key)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedFundKey(fund.key); }}
                  >
                    <span className="fund-name"><i style={{ background: fundColors.get(fund.key) ?? palette[0] }}>{fund.fundHouse.slice(0, 2).toUpperCase()}</i><span><strong>{fund.name}</strong><small>{fund.category} · {fund.folios} {fund.folios === 1 ? "folio" : "folios"}</small></span></span>
                    <span data-label="Invested amount">{formatMoney(fund.invested)}</span>
                    <span data-label="Current value"><strong>{formatMoney(fund.currentValue)}</strong></span>
                    <span data-label="Gain / loss" className={fundGain >= 0 ? "positive" : "negative"}>{fundGain >= 0 ? "+" : ""}{formatMoney(fundGain)}</span>
                    <span data-label="Return"><em className={fundReturn >= 0 ? "return-pill positive" : "return-pill negative"}>{fundReturn >= 0 ? "↗" : "↘"} {fundReturn.toFixed(1)}%</em></span>
                    <span data-label="Return p.a. (XIRR)">
                      {fund.annualizedReturn === null
                        ? <em className="annualized-return-unavailable" title="Not enough dated cash flows to calculate an annualized return">—</em>
                        : <em
                            className={fund.annualizedReturn >= 0 ? "return-pill positive" : "return-pill negative"}
                            title={`Money-weighted annualized return (XIRR) using CAS cash flows and the fund value dated ${formatDate(fund.navDate || portfolio.valuationDate)}`}
                          >{fund.annualizedReturn >= 0 ? "↗" : "↘"} {fund.annualizedReturn.toFixed(1)}% p.a.</em>}
                    </span>
                    <span data-label="Momentum"><MomentumBadge holding={fund} /></span>
                    <span data-label="Below cost"><DownsideBadge holding={fund} /></span>
                    <button
                      className={`row-expand ${expanded ? "open" : ""}`}
                      aria-label={`${expanded ? "Collapse" : "Expand"} folios for ${fund.name}`}
                      aria-expanded={expanded}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedFund(expanded ? null : fund.key);
                      }}
                    >⌄</button>
                  </div>
                  {expanded && (
                    <div className="folio-panel" role="group" aria-label={`Folios for ${fund.name}`}>
                      <div className="folio-panel-head"><span>{fund.folioHoldings.length} {fund.folioHoldings.length === 1 ? "folio" : "folios"}</span><p>Select a folio to open its own invested-vs-value graph.</p></div>
                      {fund.folioHoldings.map((folio) => {
                        const folioGain = folio.currentValue - folio.invested;
                        const folioReturn = folio.invested ? (folioGain / folio.invested) * 100 : 0;
                        const folioAnnualizedReturn = annualizedReturnAt(
                          folio.transactions,
                          folio.navDate || portfolio.valuationDate,
                          folio.currentValue,
                        );
                        return (
                          <button className="folio-row" key={folio.key} onClick={() => setSelectedFolioKey({ fundKey: fund.key, folioKey: folio.key })}>
                            <span className="folio-name"><i>F</i><span><strong>{folio.label}</strong><small>{folio.currentValue > 0 ? `${folio.transactions.length} transactions` : "Closed / zero balance"}</small></span></span>
                            <span data-label="Invested amount">{formatMoney(folio.invested)}</span>
                            <span data-label="Current value"><strong>{formatMoney(folio.currentValue)}</strong></span>
                            <span data-label="Gain / loss" className={folioGain >= 0 ? "positive" : "negative"}>{folioGain >= 0 ? "+" : ""}{formatMoney(folioGain)}</span>
                            <span data-label="Return"><em className={folioReturn >= 0 ? "return-pill positive" : "return-pill negative"}>{folioReturn >= 0 ? "↗" : "↘"} {folioReturn.toFixed(1)}%</em></span>
                            <span data-label="Return p.a. (XIRR)">
                              {folioAnnualizedReturn === null
                                ? <em className="annualized-return-unavailable" title="Not enough dated cash flows to calculate an annualized return">—</em>
                                : <em
                                    className={folioAnnualizedReturn >= 0 ? "return-pill positive" : "return-pill negative"}
                                    title={`Money-weighted annualized return (XIRR) using CAS cash flows and the folio value dated ${formatDate(folio.navDate || portfolio.valuationDate)}`}
                                  >{folioAnnualizedReturn >= 0 ? "↗" : "↘"} {folioAnnualizedReturn.toFixed(1)}% p.a.</em>}
                            </span>
                            <span data-label="Momentum"><MomentumBadge holding={folio} /></span>
                            <span data-label="Below cost"><DownsideBadge holding={folio} /></span>
                            <span className="row-arrow">›</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {!filteredFunds.length && <div className="no-results">No funds match “{query}”.</div>}
          </div>
        </section>

        <ClosedFunds funds={portfolio.closedFunds} />

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

        <FundStackChart portfolio={portfolio} />

        <footer className="dashboard-footer"><Brand /><p>Your statement was processed locally and is not stored by FolioVista.</p><span>For tracking only · Not investment advice</span></footer>
      </div>
      {historyProgress && <HistoryProgressToast progress={historyProgress} />}
      {selected && <FundDrawer fund={selected} onClose={() => setSelectedFundKey(null)} />}
      {selectedFolioFund && selectedFolio && <FolioDrawer fund={selectedFolioFund} folio={selectedFolio} onClose={() => setSelectedFolioKey(null)} />}
    </main>
  );
}

export default function FolioVista() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [historyProgress, setHistoryProgress] = useState<HistoryProgressState | null>(null);
  const importSequence = useRef(0);
  const historyRequest = useRef<AbortController | null>(null);
  const progressDismissTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  useEffect(() => () => {
    historyRequest.current?.abort();
    if (progressDismissTimer.current) globalThis.clearTimeout(progressDismissTimer.current);
  }, []);
  const acceptPortfolio = (next: Portfolio) => {
    historyRequest.current?.abort();
    if (progressDismissTimer.current) globalThis.clearTimeout(progressDismissTimer.current);
    const sequence = importSequence.current + 1;
    importSequence.current = sequence;
    setPortfolio(next);
    const historyTotal = next.navHistoryCoverage?.total ?? 0;
    setHistoryProgress(next.navHistoryLoading && historyTotal > 0
      ? { completed: 0, total: historyTotal }
      : null);
    if (!next.navHistoryLoading) return;
    const controller = new AbortController();
    historyRequest.current = controller;
    void refreshWithDailyHistory(next, controller.signal, (progress) => {
      if (importSequence.current === sequence) setHistoryProgress(progress);
    }).then((enriched) => {
      if (importSequence.current !== sequence) return;
      setPortfolio(enriched);
      setHistoryProgress(historyTotal > 0
        ? { completed: historyTotal, total: historyTotal, complete: true }
        : null);
      progressDismissTimer.current = globalThis.setTimeout(() => {
        if (importSequence.current === sequence) setHistoryProgress(null);
      }, 650);
    });
  };
  const resetPortfolio = () => {
    historyRequest.current?.abort();
    historyRequest.current = null;
    if (progressDismissTimer.current) globalThis.clearTimeout(progressDismissTimer.current);
    progressDismissTimer.current = null;
    importSequence.current += 1;
    setPortfolio(null);
    setHistoryProgress(null);
  };
  return portfolio
    ? <Dashboard portfolio={portfolio} onReset={resetPortfolio} historyProgress={historyProgress} />
    : <Landing onPortfolio={acceptPortfolio} />;
}
