// SPDX-FileCopyrightText: 2026 carlohustletv
// SPDX-License-Identifier: GPL-3.0-only

import type { Session } from "@supabase/supabase-js";
import { lazy, Suspense, useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { predictFlockManagement } from "@flockiq/shared";
import { apiRequest, type AdminDatabaseHealth, type AdminOverview, type AdminUser, type AdminUserPage, type DailyReport, type DashboardData, type FarmListItem, type FarmMember, type FieldEvidence, type Flock, type ModulePermissions } from "./api";
import { supabase } from "./supabase";
import "./styles.css";

const UserLocationMap = lazy(() => import("./SuperadminLocationMap"));

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [systemRole, setSystemRole] = useState<"user" | "superadmin">("user");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setSystemRole("user");
      return;
    }
    let current = true;
    apiRequest<{ profile: { system_role?: "user" | "superadmin" } | null }>("/api/auth/me")
      .then((data) => { if (current) setSystemRole(data.profile?.system_role ?? "user"); })
      .catch(() => { if (current) setSystemRole("user"); });
    return () => { current = false; };
  }, [session]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const request =
      authMode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({
            email,
            password,
            options: { data: { account_type: "manager" } }
          });

    const { error } = await request;
    if (error) setMessage(error.message);
    else setMessage(authMode === "signup" ? "Account created. Check email confirmation if enabled." : "Signed in.");
  }

  if (!session) {
    return (
      <LandingPage
        authMode={authMode}
        authOpen={authOpen}
        email={email}
        message={message}
        password={password}
        onAuthModeChange={setAuthMode}
        onAuthOpen={setAuthOpen}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={submitAuth}
      />
    );
  }

  return <Dashboard email={session.user.email ?? "Manager"} systemRole={systemRole} />;
}

function LandingPage({
  authMode,
  authOpen,
  email,
  message,
  password,
  onAuthModeChange,
  onAuthOpen,
  onEmailChange,
  onPasswordChange,
  onSubmit
}: {
  authMode: "login" | "signup";
  authOpen: boolean;
  email: string;
  message: string;
  password: string;
  onAuthModeChange: (mode: "login" | "signup") => void;
  onAuthOpen: (open: boolean) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  function openAuth(mode: "login" | "signup") {
    onAuthModeChange(mode);
    onAuthOpen(true);
  }

  return (
    <main className="landingPage">
      <nav className="landingNav" aria-label="Main navigation">
        <a className="landingBrand" href="#top" aria-label="IQuila home">
          <img src="/mark.svg" alt="" />
          <span>IQuila</span>
        </a>
        <div className="landingNavLinks">
          <a href="#platform">Platform</a>
          <a href="#field">Field tools</a>
          <a href="#insight">Intelligence</a>
        </div>
        <div className="landingNavActions">
          <button className="landingTextButton" type="button" onClick={() => openAuth("login")}>Sign in</button>
          <button className="landingPrimaryButton compactCta" type="button" onClick={() => openAuth("signup")}>Start free</button>
        </div>
      </nav>

      <section className="landingHero" id="top">
        <div className="heroSignal" aria-hidden="true"><span /><span /><span /></div>
        <div className="landingHeroCopy">
          <div className="landingEyebrow"><i /> Poultry operations, reimagined</div>
          <h1>See the whole farm.<br /><em>Act at the right moment.</em></h1>
          <p>IQuila connects field activity, flock health, team access, and evidence into one clear operating picture.</p>
          <div className="landingHeroActions">
            <button className="landingPrimaryButton" type="button" onClick={() => openAuth("signup")}>Build your farm workspace <span aria-hidden="true">-&gt;</span></button>
            <button className="landingSecondaryButton" type="button" onClick={() => document.getElementById("platform")?.scrollIntoView({ behavior: "smooth" })}>Explore the platform</button>
          </div>
          <div className="landingTrust"><span>Offline field capture</span><span>GPS evidence</span><span>Live Supabase sync</span></div>
        </div>

        <div className="farmVision" aria-label="Illustration of IQuila farm intelligence">
          <div className="visionSky"><i className="visionSun" /><span className="scanLine" /></div>
          <div className="visionTerrain terrainBack" />
          <div className="visionTerrain terrainFront" />
          <div className="visionBarn"><span className="barnRoof" /><span className="barnDoor" /><i /><i /></div>
          <div className="visionSilo"><span /></div>
          <div className="visionGrid" />
          <div className="visionMetric metricBirds"><span>Live flock</span><strong>12,840</strong><small>birds monitored</small></div>
          <div className="visionMetric metricHealth"><span>Health index</span><strong>96.4%</strong><small><i /> Stable today</small></div>
          <div className="visionPin pinOne"><i /></div>
          <div className="visionPin pinTwo"><i /></div>
          <div className="visionCaption"><span>IQ / FARM 03</span><strong>All systems in view</strong></div>
        </div>
      </section>

      <section className="landingStrip" aria-label="Platform capabilities">
        <span>01 / OPERATIONS</span><strong>From daily records to decisive action.</strong><span>FIELD + OFFICE / ONE SYSTEM</span>
      </section>

      <section className="platformSection" id="platform">
        <div className="sectionIntro">
          <span className="sectionNumber">01</span>
          <div><p className="landingEyebrow">One operational layer</p><h2>Built around how farms actually move.</h2></div>
          <p>Capture work where it happens. Give managers a trusted view without slowing the team down.</p>
        </div>
        <div className="featureMatrix">
          <article className="featureCard featureCardLarge">
            <div className="featureTop"><span>LIVE OPERATIONS</span><b>Connected</b></div>
            <div className="miniChart" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
            <h3>A farm pulse you can read in seconds.</h3>
            <p>Bird counts, feed, mortality, eggs, and field events become a useful daily signal.</p>
          </article>
          <article className="featureCard darkFeature" id="field">
            <div className="fieldOrb" aria-hidden="true"><span>GPS</span><i /></div>
            <span className="featureCode">FIELD / VERIFIED</span>
            <h3>Evidence that carries its own context.</h3>
            <p>Stamped time and location, safe offline storage, and private manager review.</p>
          </article>
          <article className="featureCard accessFeature">
            <div className="accessNodes" aria-hidden="true"><i>D</i><i>W</i><i>V</i><span /></div>
            <span className="featureCode">ACCESS / PRECISE</span>
            <h3>Each person sees exactly what they need.</h3>
            <p>Farm-level roles and module controls keep operations focused and protected.</p>
          </article>
        </div>
      </section>

      <section className="intelligenceSection" id="insight">
        <div className="intelligenceVisual" aria-hidden="true">
          <span className="orbit orbitOne" /><span className="orbit orbitTwo" /><span className="orbit orbitThree" />
          <img src="/mark.svg" alt="" />
          <i className="dataPoint pointOne" /><i className="dataPoint pointTwo" /><i className="dataPoint pointThree" />
        </div>
        <div className="intelligenceCopy">
          <p className="landingEyebrow">Intelligence without noise</p>
          <h2>Know what changed.<br />Know what comes next.</h2>
          <p>IQuila turns routine farm data into patterns managers can use, while preserving the field-level detail behind every decision.</p>
          <div className="intelligenceStats"><div><strong>14</strong><span>day operating trends</span></div><div><strong>100%</strong><span>private evidence storage</span></div></div>
          <button className="landingPrimaryButton" type="button" onClick={() => openAuth("signup")}>Create an IQuila account</button>
        </div>
      </section>

      <footer className="landingFooter">
        <div className="landingBrand"><img src="/mark.svg" alt="" /><span>IQuila</span></div>
        <p>Farm intelligence, clearly.</p>
        <button className="landingTextButton" type="button" onClick={() => openAuth("login")}>Manager sign in -&gt;</button>
      </footer>

      {authOpen ? <div className="authOverlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onAuthOpen(false); }}>
        <section className="landingAuthPanel" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button className="authClose" type="button" aria-label="Close authentication" onClick={() => onAuthOpen(false)}>x</button>
          <img src="/logo.svg" alt="IQuila" />
          <p className="landingEyebrow">{authMode === "login" ? "Welcome back" : "Start your workspace"}</p>
          <h2 id="auth-title">{authMode === "login" ? "Sign in to IQuila" : "Create your IQuila account"}</h2>
          <p>{authMode === "login" ? "Your farms, teams, and live operations are waiting." : "Register as a manager. A verified membership is required before creating farms."}</p>
          <form onSubmit={onSubmit}>
            <label>Email address<input value={email} onChange={(event) => onEmailChange(event.target.value)} type="email" autoComplete="email" required autoFocus /></label>
            <label>Password<input value={password} onChange={(event) => onPasswordChange(event.target.value)} type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={6} required /></label>
            {message ? <p className="landingNotice">{message}</p> : null}
            <button className="landingPrimaryButton authSubmit" type="submit">{authMode === "login" ? "Enter workspace" : "Create account"}</button>
          </form>
          <button className="authSwitch" type="button" onClick={() => onAuthModeChange(authMode === "login" ? "signup" : "login")}>
            {authMode === "login" ? "New to IQuila? Create an account" : "Already have an account? Sign in"}
          </button>
          <small>Secure authentication powered by Supabase.</small>
        </section>
      </div> : null}
    </main>
  );
}

type ErpView = "dashboard" | "farms" | "flocks" | "team" | "evidence" | "reports" | "admin";

type DataNotice = { id: string; title: string; detail: string };

function viewLabel(view: ErpView, canManageFarm: boolean) {
  if (view === "evidence") return "Field Evidence";
  if (view === "reports" && !canManageFarm) return "My Reports";
  if (view === "admin") return "Superadmin Console";
  return view.slice(0, 1).toUpperCase() + view.slice(1);
}

function Dashboard({ email, systemRole }: { email: string; systemRole: "user" | "superadmin" }) {
  const [farms, setFarms] = useState<FarmListItem[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState("");
  const [flocks, setFlocks] = useState<Flock[]>([]);
  const [farmName, setFarmName] = useState("");
  const [farmLocation, setFarmLocation] = useState("");
  const [flockName, setFlockName] = useState("");
  const [initialCount, setInitialCount] = useState("500");
  const [status, setStatus] = useState("Loading farms...");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [members, setMembers] = useState<FarmMember[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"manager" | "worker" | "viewer">("worker");
  const [activeView, setActiveView] = useState<ErpView>("dashboard");
  const [evidence, setEvidence] = useState<FieldEvidence[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [databaseHealth, setDatabaseHealth] = useState<AdminDatabaseHealth | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminUserPage, setAdminUserPage] = useState(0);
  const [adminUserTotal, setAdminUserTotal] = useState(0);
  const [adminUserSearch, setAdminUserSearch] = useState("");
  const [dataNotice, setDataNotice] = useState<DataNotice | null>(null);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const activitySignatureRef = useRef("");
  const deferredAdminUserSearch = useDeferredValue(adminUserSearch);

  async function loadFarms() {
    const data = await apiRequest<{ farms: FarmListItem[] }>("/api/farms");
    setFarms(data.farms);
    const firstFarmId = data.farms[0]?.farms.id ?? "";
    setSelectedFarmId((current) => current || firstFarmId);
    setStatus(data.farms.length ? "Farm workspace ready." : "Create your first farm to begin.");
  }

  useEffect(() => {
    loadFarms().catch((error: Error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!selectedFarmId) return;
    const controller = new AbortController();
    setFlocks([]);
    setDashboard(null);
    setMembers([]);
    setEvidence([]);
    setReports([]);
    const membership = farms.find((item) => item.farms.id === selectedFarmId);
    const canManageMembers = membership?.role === "owner" || membership?.role === "manager";
    const dashboardRequest = canManageMembers
      ? apiRequest<DashboardData>(`/api/farms/${selectedFarmId}/dashboard`, { signal: controller.signal })
      : Promise.resolve(null);
    Promise.all([
      apiRequest<{ flocks: Flock[] }>(`/api/farms/${selectedFarmId}/flocks`, { signal: controller.signal }),
      dashboardRequest,
      canManageMembers
        ? apiRequest<{ members: FarmMember[] }>(`/api/farms/${selectedFarmId}/members`, { signal: controller.signal })
        : Promise.resolve({ members: [] }),
      canManageMembers
        ? apiRequest<{ daily_records: DailyReport[] }>(`/api/farms/${selectedFarmId}/daily-records`, { signal: controller.signal })
        : Promise.resolve({ daily_records: [] })
    ])
      .then(([flockData, dashboardData, memberData, reportData]) => {
        setFlocks(flockData.flocks);
        setDashboard(dashboardData);
        setMembers(memberData.members);
        setReports(reportData.daily_records);
      })
      .catch((error: Error) => { if (error.name !== "AbortError") setStatus(error.message); });
    return () => controller.abort();
  }, [selectedFarmId, farms]);

  useEffect(() => {
    const controller = new AbortController();
    if (activeView === "evidence" && selectedFarmId) {
      apiRequest<{ evidence: FieldEvidence[] }>(`/api/farms/${selectedFarmId}/evidence`, { signal: controller.signal })
        .then((data) => setEvidence(data.evidence))
        .catch((error: Error) => { if (error.name !== "AbortError") setStatus(error.message); });
    }
    if (activeView === "reports" && selectedFarmId) {
      apiRequest<{ daily_records: DailyReport[] }>(`/api/farms/${selectedFarmId}/daily-records`, { signal: controller.signal })
        .then((data) => setReports(data.daily_records))
        .catch((error: Error) => { if (error.name !== "AbortError") setStatus(error.message); });
    }
    if (activeView === "admin" && systemRole === "superadmin") {
      const loadOverview = () => apiRequest<AdminOverview>("/api/admin/overview", { signal: controller.signal })
        .then(setAdminOverview)
        .catch((error: Error) => { if (error.name !== "AbortError") setStatus(error.message); });
      loadOverview();
      apiRequest<AdminUserPage>(`/api/admin/users?page=${adminUserPage}&search=${encodeURIComponent(deferredAdminUserSearch)}`, { signal: controller.signal })
        .then((data) => { setAdminUsers(data.users); setAdminUserTotal(data.total); })
        .catch((error: Error) => { if (error.name !== "AbortError") setStatus(error.message); });
      apiRequest<AdminDatabaseHealth>("/api/admin/database-health", { signal: controller.signal })
        .then(setDatabaseHealth)
        .catch((error: Error) => { if (error.name !== "AbortError") setStatus(error.message); });
      const interval = window.setInterval(loadOverview, 60_000);
      return () => { controller.abort(); window.clearInterval(interval); };
    }
    return () => controller.abort();
  }, [activeView, selectedFarmId, systemRole, adminUserPage, deferredAdminUserSearch]);

  async function createFarm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setStatus("Creating farm...");
      await apiRequest("/api/farms", {
        method: "POST",
        body: JSON.stringify({ name: farmName, location: farmLocation || undefined })
      });
      setFarmName("");
      setFarmLocation("");
      await loadFarms();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create farm.");
    }
  }

  async function createFlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFarmId) return;
    try {
      setStatus("Creating flock...");
      await apiRequest(`/api/farms/${selectedFarmId}/flocks`, {
        method: "POST",
        body: JSON.stringify({
          name: flockName,
          poultry_type: "broiler",
          start_date: new Date().toISOString().slice(0, 10),
          initial_count: Number(initialCount)
        })
      });
      setFlockName("");
      setStatus("Flock created.");
      const [flockData, dashboardData] = await Promise.all([
        apiRequest<{ flocks: Flock[] }>(`/api/farms/${selectedFarmId}/flocks`),
        apiRequest<DashboardData>(`/api/farms/${selectedFarmId}/dashboard`)
      ]);
      setFlocks(flockData.flocks);
      setDashboard(dashboardData);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create flock.");
    }
  }

  async function assignMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFarmId) return;
    try {
      setStatus("Assigning personnel...");
      await apiRequest(`/api/farms/${selectedFarmId}/members`, {
        method: "POST",
        body: JSON.stringify({ email: memberEmail, role: memberRole })
      });
      const data = await apiRequest<{ members: FarmMember[] }>(`/api/farms/${selectedFarmId}/members`);
      setMembers(data.members);
      setMemberEmail("");
      setStatus("Personnel assigned to this farm.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not assign personnel.");
    }
  }

  async function removeMember(memberId: string) {
    if (!selectedFarmId) return;
    try {
      await apiRequest(`/api/farms/${selectedFarmId}/members/${memberId}`, { method: "DELETE" });
      setMembers((current) => current.filter((member) => member.id !== memberId));
      setStatus("Personnel removed from this farm.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not remove personnel.");
    }
  }

  async function updateMemberPermission(member: FarmMember, key: keyof ModulePermissions) {
    if (!selectedFarmId || !member.permissions) return;
    const permissions = { ...member.permissions, [key]: !member.permissions[key] };
    try {
      await apiRequest(`/api/farms/${selectedFarmId}/members/${member.id}/permissions`, {
        method: "PATCH",
        body: JSON.stringify(permissions)
      });
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, permissions } : item));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update view access.");
    }
  }

  async function toggleSuperadmin(userId: string, currentRole: "user" | "superadmin") {
    try {
      await apiRequest(`/api/admin/users/${userId}/system-role`, {
        method: "PATCH",
        body: JSON.stringify({ system_role: currentRole === "superadmin" ? "user" : "superadmin" })
      });
      setAdminUsers((current) => current.map((item) => item.id === userId ? { ...item, system_role: currentRole === "superadmin" ? "user" : "superadmin" } : item));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update system role.");
    }
  }

  async function updateMembershipStatus(userId: string, currentStatus: "active" | "pending" | "suspended") {
    const membershipStatus = currentStatus === "active" ? "suspended" : "active";
    const reason = window.prompt(`Reason to ${membershipStatus === "active" ? "approve" : "suspend"} this manager membership:`)?.trim();
    if (!reason) return;
    try {
      const data = await apiRequest<{ profile: { membership_status: "active" | "pending" | "suspended" } }>(`/api/admin/users/${userId}/membership-status`, {
        method: "PATCH",
        body: JSON.stringify({ membership_status: membershipStatus, reason })
      });
      setAdminUsers((current) => current.map((user) => user.id === userId ? { ...user, membership_status: data.profile.membership_status } : user));
      setStatus(`Manager membership ${membershipStatus}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update membership.");
    }
  }

  const selectedMembership = farms.find((item) => item.farms.id === selectedFarmId);
  const canManageFarm = selectedMembership?.role === "owner" || selectedMembership?.role === "manager";
  const visibleViews = (["dashboard", "farms", "flocks", "team", "evidence", "reports"] as ErpView[]).filter((view) => {
    if (view === "admin") return false;
    if (view === "farms") return true;
    if (view === "team") return canManageFarm;
    if (view === "evidence") return canManageFarm || Boolean(selectedMembership?.permissions.evidence);
    if (view === "reports") return true;
    if (view === "dashboard") return canManageFarm;
    return selectedMembership?.permissions[view] ?? true;
  });

  useEffect(() => {
    if (!visibleViews.includes(activeView) && activeView !== "admin") setActiveView(visibleViews[0] ?? "farms");
  }, [activeView, visibleViews]);

  useEffect(() => {
    activitySignatureRef.current = "";
    setDataNotice(null);
    if (!selectedFarmId || !canManageFarm) return;

    let cancelled = false;

    async function checkForNewFieldData(initial = false) {
      const [reportData, evidenceData] = await Promise.all([
        apiRequest<{ daily_records: DailyReport[] }>(`/api/farms/${selectedFarmId}/daily-records`),
        apiRequest<{ evidence: FieldEvidence[] }>(`/api/farms/${selectedFarmId}/evidence`)
      ]);
      if (cancelled) return;

      const reportCount = reportData.daily_records.length;
      const evidenceCount = evidenceData.evidence.length;
      const latestReport = reportData.daily_records.reduce((latest, item) => item.created_at > latest ? item.created_at : latest, "");
      const latestEvidence = evidenceData.evidence.reduce((latest, item) => item.server_received_at > latest ? item.server_received_at : latest, "");
      const nextSignature = `${reportCount}|${latestReport}|${evidenceCount}|${latestEvidence}`;
      const previousSignature = activitySignatureRef.current;
      const previousParts = previousSignature.split("|");
      activitySignatureRef.current = nextSignature;

      const changed = !initial && Boolean(previousSignature) && previousSignature !== nextSignature;
      if (activeView === "reports") setReports(reportData.daily_records);
      if (activeView === "evidence") setEvidence(evidenceData.evidence);
      if (activeView === "dashboard" && changed) {
        apiRequest<DashboardData>(`/api/farms/${selectedFarmId}/dashboard`)
          .then((data) => { if (!cancelled) setDashboard(data); })
          .catch(() => undefined);
      }

      if (!changed) return;

      const reportCountChanged = reportCount > Number(previousParts[0]);
      const evidenceCountChanged = evidenceCount > Number(previousParts[2]);
      const title = "New field data available";
      const detail = [
        reportCountChanged ? "daily report" : "",
        evidenceCountChanged ? "photo evidence" : ""
      ].filter(Boolean).join(" and ") || "field update";
      setDataNotice({ id: nextSignature, title, detail: `A new ${detail} was synced for ${selectedMembership?.farms.name ?? "this farm"}.` });
      setStatus(`New ${detail} available.`);

      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body: `IQuila received a new ${detail}.` });
      }
    }

    checkForNewFieldData(true).catch(() => undefined);
    const interval = window.setInterval(() => { checkForNewFieldData().catch(() => undefined); }, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeView, canManageFarm, selectedFarmId, selectedMembership?.farms.name]);

  async function enableBrowserNotifications() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  return (
    <main className="erpShell">
      <aside className="erpSidebar" aria-label="IQuila workspace navigation">
        <div className="brandLockup compact">
          <img src="/mark.svg" alt="IQuila logo" />
          <div><strong>IQuila</strong><small>Operations system</small></div>
        </div>
        <div className="erpNavLabel">Operations</div>
        <nav className="erpNav" aria-label="Operations">
          {visibleViews.map((view, index) => (
            <button className={activeView === view ? "erpNavItem active" : "erpNavItem"} key={view} onClick={() => setActiveView(view)}>
              <span className="erpNavCode">{String(index + 1).padStart(2, "0")}</span>
              {viewLabel(view, canManageFarm)}
            </button>
          ))}
        </nav>
        {systemRole === "superadmin" ? <><div className="erpNavLabel">System</div><button className={activeView === "admin" ? "erpNavItem active" : "erpNavItem"} onClick={() => setActiveView("admin")}><span className="erpNavCode">SA</span>Superadmin</button></> : null}
        <div className="sidebarUser"><strong>{email}</strong><small>{systemRole}</small><button onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </aside>

      <section className="erpContent">
      <header className="topbar"><div><span className="pageKicker">IQuila / Operations</span><h2>{viewLabel(activeView, canManageFarm)}</h2></div><div className="topbarContext"><span className="contextFarm">{selectedMembership?.farms.name ?? "No farm selected"}</span><span className="liveDot" /><span>Live</span></div></header>
      <div className="erpStatus" role="status" aria-live="polite"><span>System note</span>{status}</div>
      {dataNotice ? <div className="dataNotice" role="status" aria-live="polite"><div><strong>{dataNotice.title}</strong><span>{dataNotice.detail}</span></div><div className="dataNoticeActions"><button type="button" onClick={() => setActiveView(dataNotice.detail.includes("photo") ? "evidence" : "reports")}>Review</button>{notificationPermission === "default" ? <button type="button" className="ghostNotice" onClick={enableBrowserNotifications}>Enable alerts</button> : null}<button type="button" className="ghostNotice" onClick={() => setDataNotice(null)}>Dismiss</button></div></div> : null}

      {activeView === "dashboard" ? <>
      <section className="dashboardHero">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1>Good decisions start with today&apos;s numbers.</h1>
          <p>{dashboard?.farm.location ? `${dashboard.farm.name} · ${dashboard.farm.location}` : status}</p>
        </div>
        <div className="metricPanel">
          <span>Selected farm</span>
          <strong className="metricFarmName">{dashboard?.farm.name ?? "Choose a farm"}</strong>
          <small>{farms.length} farm{farms.length === 1 ? "" : "s"} · {formatNumber(dashboard?.summary.total_birds ?? 0)} birds</small>
        </div>
      </section>

      <section className="farmRail">
        <div className="farmRailLabel">Your farms</div>
        <div className="farmRailItems">
          {farms.map((item) => (
            <button
              className={item.farms.id === selectedFarmId ? "farmTab active" : "farmTab"}
              key={item.farms.id}
              onClick={() => setSelectedFarmId(item.farms.id)}
            >
              <span className="farmIcon">{item.farms.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{item.farms.name}</strong><small>{item.role}</small></span>
            </button>
          ))}
          <button className="addFarmTab" onClick={() => document.getElementById("create-farm")?.focus()}>+ New farm</button>
        </div>
      </section>

       {dashboard ? <><FarmAnalytics dashboard={dashboard} /><FlockAdvisories flocks={flocks} reports={reports} /></> : null}
      </> : null}

      {activeView !== "admin" ?
      <section className="workspaceGrid">
        {activeView === "farms" || activeView === "dashboard" ? <article className="panel setupPanel">
          <div className="panelKicker">Workspace setup</div>
          <h2>Manage farms</h2>
          <form onSubmit={createFarm} className="stack">
            <input id="create-farm" aria-label="Farm name" placeholder="Farm name" value={farmName} onChange={(event) => setFarmName(event.target.value)} required />
            <input aria-label="Farm location" placeholder="Location" value={farmLocation} onChange={(event) => setFarmLocation(event.target.value)} />
            <button>Create farm</button>
          </form>
          <p className="panelHint">Add farms once, then use the farm rail above to move between them.</p>
        </article> : null}

        {activeView === "flocks" || activeView === "dashboard" ? <article className={activeView === "flocks" ? "panel wide flockPanel standalonePanel" : "panel wide flockPanel"}>
          <div className="panelHeaderRow"><div><div className="panelKicker">Livestock</div><h2>Active flocks</h2></div><span className="countPill">{flocks.length} total</span></div>
          {canManageFarm ? <form onSubmit={createFlock} className="inlineForm">
            <input aria-label="Flock name" placeholder="Flock name" value={flockName} onChange={(event) => setFlockName(event.target.value)} required />
            <input aria-label="Initial bird count" placeholder="Birds" value={initialCount} onChange={(event) => setInitialCount(event.target.value)} type="number" min="1" required />
            <button type="submit" disabled={!selectedFarmId}>Add flock</button>
          </form> : null}
          <div className="flockTable">
            {flocks.map((flock) => (
              <div className="flockRow" key={flock.id}>
                <strong>{flock.name}</strong>
                <span>{flock.poultry_type}</span>
                <span>{flock.current_count.toLocaleString()} birds</span>
                <span>{flock.status}</span>
              </div>
            ))}
            {!flocks.length ? <p className="empty">No flocks yet for this farm.</p> : null}
          </div>
        </article> : null}

        {activeView === "team" || activeView === "dashboard" ? <article className={activeView === "team" ? "panel teamPanel standalonePanel" : "panel teamPanel"}>
          <div className="panelHeaderRow"><div><div className="panelKicker">Farm access</div><h2>Assigned team</h2></div><span className="countPill">{members.length}</span></div>
          {canManageFarm ? (
            <form className="teamForm" onSubmit={assignMember}>
              <input aria-label="Registered personnel email" type="email" placeholder="Registered personnel email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} required />
              <select aria-label="Personnel farm role" value={memberRole} onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}>
                <option value="worker">Worker</option>
                <option value="manager">Manager</option>
                <option value="viewer">Viewer</option>
              </select>
              <button type="submit">Assign</button>
            </form>
          ) : null}
          <div className="teamList">
            {members.map((member) => (
              <div className="teamMember" key={member.id}>
                <span className="avatar">{(member.full_name ?? member.email ?? "P").slice(0, 1).toUpperCase()}</span>
                <div><strong>{member.full_name ?? member.email}</strong><small>{member.email} · {member.status}</small></div>
                <span className={`roleTag ${member.role}`}>{member.role}</span>
                {canManageFarm && member.role !== "owner" ? <button type="button" className="removeMember" onClick={() => removeMember(member.id)}>Remove</button> : null}
                {canManageFarm && member.role !== "owner" && member.permissions ? <div className="permissionRow">{(Object.keys(member.permissions) as (keyof ModulePermissions)[]).map((key) => <button type="button" className={member.permissions?.[key] ? "permission active" : "permission"} key={key} onClick={() => updateMemberPermission(member, key)}>{key}</button>)}</div> : null}
              </div>
            ))}
          </div>
        </article> : null}

        {activeView === "evidence" ? <article className="panel evidencePanel"><div className="panelHeaderRow"><div><div className="panelKicker">Verified field activity</div><h2>Photo evidence</h2></div><span className="countPill">{evidence.length}</span></div><div className="evidenceGrid">{evidence.map((item) => <article className="evidenceCard" key={item.id}>{item.signed_url ? <img src={item.signed_url} alt="Field evidence" loading="lazy" decoding="async" /> : <div className="evidencePlaceholder">Image unavailable</div>}<div className="evidenceBody"><strong>{item.captured_by_name}</strong><span>{new Date(item.device_captured_at).toLocaleString()}</span><span>{item.latitude != null && item.longitude != null ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}` : "Location unavailable"}</span><p>{item.notes || "No notes"}</p></div></article>)}{!evidence.length ? <p className="empty">No field photos have been uploaded for this farm yet.</p> : null}</div></article> : null}
        {activeView === "reports" ? <article className="panel evidencePanel"><div className="panelHeaderRow"><div><div className="panelKicker">{canManageFarm ? "Farm reporting" : "Private reporting history"}</div><h2>{canManageFarm ? "Daily reports" : "Reports submitted by you"}</h2></div><span className="countPill">{reports.length}</span></div><div className="reportTable">{reports.map((report) => <div className="reportRow" key={report.id}><strong>{report.record_date}</strong><span>Mortality {report.mortality_count}</span><span>Feed {report.feed_consumed_kg ?? 0} kg</span><span>Eggs {report.eggs_collected ?? 0}</span><small>{report.notes || "No notes"}</small></div>)}{!reports.length ? <p className="empty">No reports are available yet.</p> : null}</div></article> : null}
      </section> : null}

        {activeView === "admin" && systemRole === "superadmin" ? <SuperadminConsole overview={adminOverview} databaseHealth={databaseHealth} users={adminUsers} userPage={adminUserPage} userTotal={adminUserTotal} userSearch={adminUserSearch} onUserSearch={(value) => { setAdminUserSearch(value); setAdminUserPage(0); }} onUserPage={setAdminUserPage} onToggleRole={toggleSuperadmin} onUpdateMembership={updateMembershipStatus} /> : null}
      </section>
    </main>
  );
}

function SuperadminConsole({ overview, databaseHealth, users, userPage, userTotal, userSearch, onUserSearch, onUserPage, onToggleRole, onUpdateMembership }: { overview: AdminOverview | null; databaseHealth: AdminDatabaseHealth | null; users: AdminUser[]; userPage: number; userTotal: number; userSearch: string; onUserSearch: (value: string) => void; onUserPage: (page: number) => void; onToggleRole: (userId: string, role: "user" | "superadmin") => void; onUpdateMembership: (userId: string, status: "active" | "pending" | "suspended") => void }) {
  if (!overview) return <p className="empty">Loading system overview...</p>;
  return <section className="adminConsole"><div className="adminMetrics">{Object.entries(overview.summary).map(([key, value]) => <article key={key}><span>{key.replaceAll("_", " ")}</span><strong>{formatNumber(value)}</strong></article>)}</div>{databaseHealth ? <DatabaseHealthPanel health={databaseHealth} /> : <article className="panel healthPanel"><p className="empty">Loading database health...</p></article>}<section className="adminInsights" aria-label="User analytics"><ActivityChart title="New users" description="Registrations during the last 30 days" values={overview.analytics.registrations} /><ActivityChart title="Verified field activity" description="GPS-tagged evidence received during the last 14 days" values={overview.analytics.field_activity} /><DistributionChart title="Account makeup" values={overview.analytics.account_types.map((item) => ({ label: item.account_type, count: item.count }))} /><DistributionChart title="Membership access" values={overview.analytics.membership_statuses.map((item) => ({ label: item.status, count: item.count }))} /></section><Suspense fallback={<article className="panel locationPanel"><p className="empty">Loading activity map...</p></article>}><UserLocationMap locations={overview.locations} activeUsers={overview.analytics.active_location_users} /></Suspense><ActivityFeed activity={overview.activity} /><AccountDirectory users={users} page={userPage} total={userTotal} search={userSearch} onSearch={onUserSearch} onPage={onUserPage} onToggleRole={onToggleRole} onUpdateMembership={onUpdateMembership} /><article className="panel adminTable"><div className="panelKicker">Entitlement audit</div><h2>Recent membership decisions</h2>{overview.membership_audits.map((audit) => <div className="adminUser" key={audit.id}><div><strong>{audit.action.replaceAll("_", " ")}</strong><small>{new Date(audit.created_at).toLocaleString()} · {audit.metadata.reason || "No reason recorded"}</small></div><span className="roleTag active">{audit.metadata.new_status || "recorded"}</span></div>)}{!overview.membership_audits.length ? <p className="empty">No membership decisions have been recorded.</p> : null}</article></section>;
}

function DatabaseHealthPanel({ health }: { health: AdminDatabaseHealth }) {
  const cacheHit = `${(health.cache_hit_ratio * 100).toFixed(1)}%`;
  return <article className="panel healthPanel"><div className="panelHeaderRow"><div><div className="panelKicker">Supabase / PostgreSQL</div><h2>Database health</h2></div><span className="countPill">Live stats</span></div><div className="healthMetrics"><div><span>Database size</span><strong>{formatBytes(health.database_size_bytes)}</strong></div><div><span>Connections</span><strong>{health.active_connections} active / {health.total_connections}</strong><small>{health.max_connections} maximum</small></div><div><span>Cache hit rate</span><strong>{cacheHit}</strong></div><div><span>Tracked tables</span><strong>{health.tables.length}</strong></div></div><div className="healthTable">{health.tables.map((table) => <div key={table.table}><div><strong>{table.table.replaceAll("_", " ")}</strong><span>{formatNumber(table.estimated_rows)} estimated rows · {formatBytes(table.total_size_bytes)}</span></div><span className={`roleTag ${table.status}`}>{table.status.replaceAll("_", " ")}</span><small>{table.dead_rows ? `${formatNumber(table.dead_rows)} dead rows (${(table.dead_row_ratio * 100).toFixed(1)}%)` : "No dead-row pressure"} · {formatNumber(table.index_scans)} index scans</small></div>)}</div></article>;
}

function AccountDirectory({ users, page, total, search, onSearch, onPage, onToggleRole, onUpdateMembership }: { users: AdminUser[]; page: number; total: number; search: string; onSearch: (value: string) => void; onPage: (page: number) => void; onToggleRole: (userId: string, role: "user" | "superadmin") => void; onUpdateMembership: (userId: string, status: "active" | "pending" | "suspended") => void }) {
  const pageSize = 50;
  const hasNextPage = (page + 1) * pageSize < total;
  return <article className="panel adminTable accountDirectory"><div className="panelHeaderRow"><div><div className="panelKicker">Accounts and membership</div><h2>Account directory</h2></div><span className="countPill">{formatNumber(total)} accounts</span></div><input aria-label="Search accounts" className="accountSearch" placeholder="Search name or email" value={search} onChange={(event) => onSearch(event.target.value)} />{users.map((user) => <div className="adminUser" key={user.id}><div><strong>{user.full_name || user.email}</strong><small>{user.email} · {user.account_type}</small></div><span className={`roleTag ${user.membership_status}`}>{user.membership_status}</span><span className={`roleTag ${user.system_role}`}>{user.system_role}</span>{user.account_type === "manager" ? <button onClick={() => onUpdateMembership(user.id, user.membership_status)}>{user.membership_status === "active" ? "Suspend membership" : "Approve membership"}</button> : null}<button onClick={() => onToggleRole(user.id, user.system_role)}>{user.system_role === "superadmin" ? "Remove admin" : "Make superadmin"}</button></div>)}{!users.length ? <p className="empty">No accounts match this search.</p> : null}<div className="directoryPager"><span>Page {page + 1}</span><button disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button><button disabled={!hasNextPage} onClick={() => onPage(page + 1)}>Next</button></div></article>;
}

function ActivityFeed({ activity }: { activity: AdminOverview["activity"] }) {
  const [filter, setFilter] = useState("all");
  const categories = [...new Set(activity.map((entry) => entry.entity_table))].sort();
  const visible = filter === "all" ? activity : activity.filter((entry) => entry.entity_table === filter);
  return <article className="panel activityFeed"><div className="panelHeaderRow"><div><div className="panelKicker">System monitoring</div><h2>Activity log</h2></div><select aria-label="Filter system activity" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All activity</option>{categories.map((category) => <option value={category} key={category}>{category.replaceAll("_", " ")}</option>)}</select></div><p className="panelHint">Latest 100 recorded writes across farms, teams, flocks, reports, and field evidence. Refreshes every minute while this page is open.</p><div className="activityList">{visible.map((entry) => <div className="activityItem" key={entry.id}><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time><div><strong>{entry.action.replace(".", " ")}</strong><span>{entry.actor?.full_name || entry.actor?.email || "System"} · {entry.farm_name}</span>{entry.metadata.name || entry.metadata.record_date || entry.metadata.role ? <small>{entry.metadata.name || entry.metadata.record_date || entry.metadata.role}</small> : null}</div><span className="roleTag active">{entry.entity_table.replaceAll("_", " ")}</span></div>)}{!visible.length ? <p className="empty">No recorded activity matches this filter.</p> : null}</div></article>;
}

function ActivityChart({ title, description, values }: { title: string; description: string; values: { date: string; count: number }[] }) {
  const maximum = Math.max(...values.map((item) => item.count), 1);
  return <article className="panel analyticsCard"><div className="panelKicker">User analytics</div><h2>{title}</h2><p>{description}</p><div className="barChart" role="img" aria-label={`${title}: ${values.reduce((total, item) => total + item.count, 0)} total`}><div className="barPlot">{values.map((item) => <div className="barColumn" key={item.date}><span className="barValue">{item.count || ""}</span><i style={{ height: `${Math.max(item.count ? 10 : 2, (item.count / maximum) * 100)}%` }} /><small>{item.date.slice(5).replace("-", "/")}</small></div>)}</div></div></article>;
}

function DistributionChart({ title, values }: { title: string; values: { label: string; count: number }[] }) {
  const total = values.reduce((sum, item) => sum + item.count, 0) || 1;
  return <article className="panel analyticsCard"><div className="panelKicker">User analytics</div><h2>{title}</h2><div className="distributionList">{values.map((item) => <div key={item.label}><div><span>{item.label}</span><strong>{formatNumber(item.count)}</strong></div><i><b style={{ width: `${(item.count / total) * 100}%` }} /></i></div>)}</div></article>;
}


function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)) - 1, units.length - 1);
  return `${(value / 1024 ** (index + 1)).toFixed(value >= 1024 ** (index + 2) ? 1 : 0)} ${units[index]}`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function FlockAdvisories({ flocks, reports }: { flocks: Flock[]; reports: DailyReport[] }) {
  const advisories = flocks.map((flock) => predictFlockManagement({
    id: flock.id,
    name: flock.name,
    poultryType: flock.poultry_type,
    initialCount: flock.initial_count,
    currentCount: flock.current_count,
    startDate: flock.start_date
  }, reports.map((report) => ({
    flockId: report.flock_id,
    recordDate: report.record_date,
    mortalityCount: report.mortality_count,
    cullingCount: report.culling_count,
    feedKg: report.feed_consumed_kg,
    waterLiters: report.water_consumed_liters,
    eggsCollected: report.eggs_collected,
    averageWeightGrams: report.average_weight_grams
  }))));

  return <section className="advisoryPanel">
    <div className="panelHeading"><div><p className="panelKicker">Decision support / trend model</p><h2>Flock adjustments to review</h2></div><span>Latest visible records</span></div>
    <p className="advisoryIntro">Forecasts compare each flock&apos;s recent 3-7 recorded days with its own prior baseline. They flag checks to make, not diagnoses or treatment instructions.</p>
    <div className="advisoryGrid">
      {advisories.map((advisory) => <article className={`advisoryCard ${advisory.severity}`} key={advisory.flockId}>
        <div className="advisoryTop"><div><strong>{advisory.flockName}</strong><span>{advisory.recordDays} record days · {advisory.confidence} confidence{advisory.ageWeeks === null ? "" : ` · week ${advisory.ageWeeks}`}</span></div><b>{advisory.severity}</b></div>
        {advisory.severity === "insufficient" ? <p>Record at least {5 - advisory.recordDays} more distinct day{5 - advisory.recordDays === 1 ? "" : "s"} to start a flock trend forecast.</p> : <>
          <div className="forecastLine"><span>Next 2 days</span><strong>{advisory.forecast.mortalityNext2Days} mortality/culls</strong>{advisory.forecast.feedKgNext2Days !== null ? <strong>{advisory.forecast.feedKgNext2Days} kg feed</strong> : null}{advisory.forecast.eggsNext2Days !== null ? <strong>{advisory.forecast.eggsNext2Days} eggs</strong> : null}</div>
          {advisory.alerts.map((alert) => <div className="advisoryAlert" key={alert.title}><strong>{alert.title}</strong><span>{alert.observation}</span><p>{alert.action}</p></div>)}
        </>}
      </article>)}
      {!advisories.length ? <p className="empty">Create a flock and add daily records to receive decision support.</p> : null}
    </div>
  </section>;
}

function FarmAnalytics({ dashboard }: { dashboard: DashboardData }) {
  const maxTrend = Math.max(...dashboard.trends.map((item) => Math.max(item.feed_kg, item.eggs, item.mortality)), 1);
  const maxTableRows = Math.max(...dashboard.table_health.map((item) => item.rows), 1);
  const totalMixBirds = Math.max(dashboard.poultry_mix.reduce((sum, item) => sum + item.birds, 0), 1);

  const cards = [
    { label: "Total Birds", value: formatNumber(dashboard.summary.total_birds), detail: `${dashboard.summary.active_flocks} active flocks` },
    { label: "Mortality Rate", value: `${dashboard.summary.mortality_rate}%`, detail: `${dashboard.summary.total_mortality} mortality, ${dashboard.summary.total_culls} culls` },
    { label: "Feed Used", value: `${formatNumber(dashboard.summary.total_feed_kg)} kg`, detail: `${dashboard.summary.daily_records} daily records` },
    { label: "Eggs", value: formatNumber(dashboard.summary.total_eggs), detail: "Recorded from layer/breeder flocks" },
    { label: "Members", value: formatNumber(dashboard.summary.members), detail: `${dashboard.summary.accepted_members} accepted` },
    { label: "Houses / Units", value: formatNumber(dashboard.summary.units), detail: "Farm unit records" }
  ];

  return (
    <section className="analyticsBlock">
      <div className="summaryCards">
        {cards.map((card) => (
          <article className="summaryCard" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </article>
        ))}
      </div>

      <div className="chartGrid">
        <article className="chartPanel wideChart">
          <div className="panelHeading">
            <h2>14-Day Production Trend</h2>
            <span>Feed, eggs, mortality</span>
          </div>
          {dashboard.trends.length ? (
            <div className="barChart">
              {dashboard.trends.map((item) => (
                <div className="barGroup" key={item.date} title={item.date}>
                  <div className="bars">
                    <span className="bar feedBar" style={{ height: `${Math.max(6, item.feed_kg / maxTrend * 100)}%` }} />
                    <span className="bar eggBar" style={{ height: `${Math.max(6, item.eggs / maxTrend * 100)}%` }} />
                    <span className="bar mortalityBar" style={{ height: `${Math.max(6, item.mortality / maxTrend * 100)}%` }} />
                  </div>
                  <small>{formatShortDate(item.date)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">No daily records yet. Sync Android records to populate trends.</p>
          )}
          <div className="legend">
            <span><i className="feedDot" /> Feed kg</span>
            <span><i className="eggDot" /> Eggs</span>
            <span><i className="mortalityDot" /> Mortality</span>
          </div>
        </article>

        <article className="chartPanel">
          <div className="panelHeading">
            <h2>Poultry Mix</h2>
            <span>By current birds</span>
          </div>
          <div className="mixList">
            {dashboard.poultry_mix.map((item) => (
              <div className="mixItem" key={item.type}>
                <div>
                  <strong>{item.type}</strong>
                  <span>{item.count} flocks • {formatNumber(item.birds)} birds</span>
                </div>
                <div className="progress"><span style={{ width: `${item.birds / totalMixBirds * 100}%` }} /></div>
              </div>
            ))}
            {!dashboard.poultry_mix.length ? <p className="empty">Create flocks to see poultry mix.</p> : null}
          </div>
        </article>

        <article className="chartPanel">
          <div className="panelHeading">
            <h2>Table Coverage</h2>
            <span>Rows in core tables</span>
          </div>
          <div className="tableBars">
            {dashboard.table_health.map((item) => (
              <div className="tableBar" key={item.table}>
                <span>{item.table}</span>
                <div><i style={{ width: `${item.rows / maxTableRows * 100}%` }} /></div>
                <strong>{item.rows}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="chartPanel wideChart">
          <div className="panelHeading">
            <h2>Recent Records</h2>
            <span>Latest synced daily entries</span>
          </div>
          <div className="recordList">
            {dashboard.recent_records.map((record) => (
              <div className="recordItem" key={record.id}>
                <strong>{formatShortDate(record.record_date)}</strong>
                <span>Mortality {record.mortality_count}</span>
                <span>Feed {record.feed_consumed_kg ?? 0} kg</span>
                <span>Eggs {record.eggs_collected ?? 0}</span>
              </div>
            ))}
            {!dashboard.recent_records.length ? <p className="empty">No synced daily records yet.</p> : null}
          </div>
        </article>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
