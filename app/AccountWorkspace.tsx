"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Portfolio } from "./cas-parser";
import { refreshWithLatestNav } from "./nav-service";

type SavedStatement = { id: string; filename: string; bytes: number; createdAt: number };
type PendingSave = { id: string; owner: string; file: File; portfolio: Portfolio };
export type WorkspaceProps = {
  initialPortfolio: Portfolio | null;
  savedMode: boolean;
  onStatement?: (file: File, portfolio: Portfolio) => Promise<void>;
};
async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/vault/${path}`, {
    ...init, credentials: "same-origin", cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(120_000),
    headers: { "X-FolioVista-Request": "1", ...init.headers },
  });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "The request failed. Please retry.");
  return data as T;
}

export default function AccountWorkspace({ render }: { render: (props: WorkspaceProps) => ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [savedMode, setSavedMode] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [statements, setStatements] = useState<SavedStatement[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [initialPortfolio, setInitialPortfolio] = useState<Portfolio | null>(null);
  const [revision, setRevision] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const operation = useRef(0);
  const message = (caught: unknown) => caught instanceof Error ? caught.message : "Please retry.";

  async function openStatement(id: string, sequence: number) {
    const snapshot = await api<{ version: number; portfolio: Portfolio }>(`statements/${id}`);
    if (snapshot.version !== 1 || snapshot.portfolio?.source !== "cas") throw new Error("This saved analysis needs a newer app version. Download and re-import its PDF.");
    const portfolio = await refreshWithLatestNav(snapshot.portfolio);
    if (sequence !== operation.current) return;
    await api(`statements/${id}/activate`, { method: "POST" });
    if (sequence !== operation.current) return;
    setInitialPortfolio(portfolio);
    setActiveId(id);
    setRevision(value => value + 1);
    setNotice("Saved statement restored. Latest available prices refreshed.");
    setLibraryOpen(false);
  }
  async function loadLibrary(restore: boolean, sequence: number) {
    const data = await api<{ statements: SavedStatement[]; activeStatementId: string | null }>("statements");
    if (sequence !== operation.current) return;
    setStatements(data.statements);
    setActiveId(data.activeStatementId);
    const id = data.activeStatementId ?? data.statements[0]?.id;
    if (restore && id) await openStatement(id, sequence);
    else if (restore) setNotice("Signed in. Choose a CAS to save your first statement.");
  }
  useEffect(() => {
    const sequence = operation.current;
    let cancelled = false;
    void api<{ user: { username: string } | null }>("session").then(async data => {
      if (cancelled || sequence !== operation.current || !data.user) return;
      setUser(data.user.username);
      setSavedMode(true);
      setBusy(true);
      try { await loadLibrary(true, sequence); }
      catch (caught) { if (!cancelled && sequence === operation.current) setError(message(caught)); }
      finally { if (!cancelled && sequence === operation.current) setBusy(false); }
    }).catch(caught => { if (!cancelled && sequence === operation.current) setError(message(caught)); })
      .finally(() => { if (!cancelled && sequence === operation.current) setBusy(false); });
    return () => { cancelled = true; };
    // This is a single session bootstrap; user actions invalidate it by sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    const sequence = ++operation.current;
    setBusy(true); setError("");
    try {
      const data = await api<{ user: { username: string } }>(register ? "register" : "login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      setPassword(""); setPending(null); setUser(data.user.username); setSavedMode(true); setAuthOpen(false);
      setInitialPortfolio(null); setRevision(value => value + 1);
      setNotice(register ? "Account created. Your uploads will be saved privately." : "Signed in. Loading your saved statements…");
      await loadLibrary(true, sequence);
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  async function saveStatement(item: PendingSave) {
    if (!savedMode || !user || item.owner !== user) return;
    setPending(item); setBusy(true); setError(""); setNotice("Uploading statement to your account…");
    try {
      const body = new FormData();
      body.set("id", item.id); body.set("file", item.file);
      body.set("portfolio", JSON.stringify({ version: 1, portfolio: item.portfolio }));
      const data = await api<{ statement: SavedStatement }>("statements", { method: "POST", body, headers: { "X-FolioVista-Account": user } });
      setPending(null); setActiveId(data.statement.id);
      setStatements(previous => [data.statement, ...previous.filter(row => row.id !== data.statement.id)]);
      setNotice("Statement uploaded and saved. It will be here when you sign in again.");
    } catch (caught) {
      setNotice(""); setError(`Not saved: ${message(caught)} Your analysis is still available in this tab.`);
    } finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); setError("");
    try {
      await api("logout", { method: "POST" });
      ++operation.current;
      setUser(null); setSavedMode(false); setStatements([]); setPending(null); setActiveId(null);
      setRegister(false);
      setInitialPortfolio(null); setRevision(value => value + 1); setLibraryOpen(false);
      setNotice("Signed out. Your saved statements remain in your account.");
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  function guest() {
    ++operation.current; setSavedMode(false); setAuthOpen(false); setLibraryOpen(false);
    setPending(null); setInitialPortfolio(null); setActiveId(null); setRevision(value => value + 1);
    setError(""); setNotice("Guest analysis: PDFs and portfolios stay in this tab.");
  }
  async function showLibrary() {
    setBusy(true); setError("");
    try { await loadLibrary(false, operation.current); setLibraryOpen(true); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  async function removeStatement(id: string) {
    setBusy(true); setError("");
    try {
      await api(`statements/${id}`, { method: "DELETE" });
      setDeleteId(null);
      if (activeId === id) { setInitialPortfolio(null); setRevision(value => value + 1); }
      await loadLibrary(false, operation.current);
      setNotice("Statement and saved analysis deleted.");
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  return <>
    <section className="account-bar" aria-label="Analysis mode">
      <div><strong>{savedMode ? `Saved analysis · ${user}` : "Guest analysis"}</strong><span>{savedMode ? "PDFs and analysis are stored privately in your account." : "No login needed. Your PDF never leaves this device."}</span></div>
      <div className="account-actions">
        <button disabled={busy} aria-pressed={!savedMode} onClick={guest}>Analyse without login</button>
        <button disabled={busy} aria-pressed={savedMode} onClick={() => {
          ++operation.current;
          if (user) { setSavedMode(true); setInitialPortfolio(null); setRevision(value => value + 1); void showLibrary(); }
          else setAuthOpen(value => !value);
        }}>{user ? "Saved statements" : "Analyse with login"}</button>
        {user && <button disabled={busy} onClick={() => void signOut()}>Sign out</button>}
      </div>
    </section>
    {authOpen && <section className="account-panel" aria-label="Account sign in">
      <h2>{register ? "Create your account" : "Welcome back"}</h2>
      <p>Save your CAS PDFs and analysis privately. Your PDF password is never stored. Keep your account password safe; email recovery is not available.</p>
      <form onSubmit={signIn}>
        <label>Username<input required minLength={3} maxLength={40} pattern="[A-Za-z0-9_.\-]+" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label>Account password<input required type="password" minLength={12} maxLength={128} autoComplete={register ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <small>Username: 3–40 letters, numbers, dots, underscores or hyphens. Password: at least 12 characters.</small>
        <button className="primary-button" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
        <button type="button" disabled={busy} onClick={() => { setRegister(value => !value); setError(""); }}>{register ? "Already have an account? Sign in" : "New here? Create an account"}</button>
      </form>
    </section>}
    {libraryOpen && savedMode && <section className="account-panel" aria-label="Saved statements">
      <h2>Your saved statements</h2><p>Open a previous analysis or import another CAS below. New uploads are added to this library; they do not erase previous files.</p>
      {!statements.length && <p>No statements saved yet. Choose a statement below to start.</p>}
      <ul className="statement-list">{statements.map(row => <li key={row.id}>
        <div><strong>{row.filename}</strong><small>{new Date(row.createdAt).toLocaleString()} · {(row.bytes / 1024).toFixed(0)} KB</small></div>
        <button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await openStatement(row.id, operation.current); } catch (caught) { setError(message(caught)); } finally { setBusy(false); } }}>Open analysis</button>
        <a href={`/api/vault/statements/${row.id}/pdf`} download>Download PDF</a>
        <button disabled={busy} onClick={() => setDeleteId(row.id)}>Delete</button>
        {deleteId === row.id && <div className="delete-confirm"><span>Delete this PDF and its saved analysis permanently?</span><button disabled={busy} onClick={() => void removeStatement(row.id)}>Confirm delete</button><button disabled={busy} onClick={() => setDeleteId(null)}>Cancel</button></div>}
      </li>)}</ul>
      <button onClick={() => setLibraryOpen(false)}>Close library</button>
    </section>}
    {(notice || error) && <div className={`account-notice ${error ? "has-error" : ""}`} role={error ? "alert" : "status"}>
      <span>{error || notice}</span>
      {pending && !busy && <button onClick={() => void saveStatement(pending)}>Retry save</button>}
      {error && user && !pending && !busy && <button onClick={() => void showLibrary()}>Retry loading</button>}
      {!busy && <button aria-label="Dismiss account notification" onClick={() => { setNotice(""); setError(""); }}>×</button>}
    </div>}
    <div key={revision} inert={busy || authOpen} aria-busy={busy}>
      {render({ initialPortfolio, savedMode, onStatement: savedMode && user ? async (file, portfolio) => {
        await saveStatement({ id: crypto.randomUUID(), owner: user, file, portfolio });
      } : undefined })}
    </div>
  </>;
}
