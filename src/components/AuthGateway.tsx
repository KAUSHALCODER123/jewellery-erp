import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAuthSession, type AuthSession } from "../auth/AuthSessionContext.js";
import { SESSION_EXPIRED_STORAGE_KEY } from "../context/AuthContext.js";

type AuthGatewayProps = {
  apiBaseUrl?: string;
  dashboardPath?: string;
  onAuthenticated?: (session: AuthSession) => void;
};

type BootState = "checking" | "setup" | "login";
type SetupStep = 1 | 2;
type SubmitState = "idle" | "submitting";

type OrganizationForm = {
  shopName: string;
  billingAddress: string;
  gstin: string;
  contactNumber: string;
};

type AdminForm = {
  username: string;
  password: string;
  confirmPassword: string;
};

type LoginForm = {
  username: string;
  password: string;
};

const initialOrganization: OrganizationForm = {
  shopName: "",
  billingAddress: "",
  gstin: "",
  contactNumber: ""
};

const initialAdmin: AdminForm = {
  username: "",
  password: "",
  confirmPassword: ""
};

const initialLogin: LoginForm = {
  username: "",
  password: ""
};

const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export default function AuthGateway({
  apiBaseUrl = "",
  dashboardPath = "#/dashboard",
  onAuthenticated
}: AuthGatewayProps) {
  const { session, setSession } = useAuthSession();
  const [bootState, setBootState] = useState<BootState>("checking");
  const [setupStep, setSetupStep] = useState<SetupStep>(1);
  const [organization, setOrganization] = useState<OrganizationForm>(initialOrganization);
  const [admin, setAdmin] = useState<AdminForm>(initialAdmin);
  const [login, setLogin] = useState<LoginForm>(initialLogin);
  const [setupErrors, setSetupErrors] = useState<string[]>([]);
  const [loginErrors, setLoginErrors] = useState<string[]>([]);
  const [setupSubmitState, setSetupSubmitState] = useState<SubmitState>("idle");
  const [loginSubmitState, setLoginSubmitState] = useState<SubmitState>("idle");
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  // Surface why the user landed back here when the global 401 interceptor cleared
  // a dead/expired session. Read-and-clear so it shows exactly once.
  useEffect(() => {
    let expired = false;
    try {
      expired = sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY) === "1";
      if (expired) {
        sessionStorage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
      }
    } catch {
      expired = false;
    }
    if (expired) {
      setSessionNotice("Your session expired. Please sign in again.");
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function checkSetupStatus() {
      setBootState("checking");
      setLoginErrors([]);

      for (let attempt = 1; attempt <= 120; attempt += 1) {
        try {
          const response = await fetch(`${apiBaseUrl}/api/auth/status`);
          const result = (await response.json()) as { initialized?: boolean };

          if (!response.ok) {
            throw new Error("Could not check local setup status.");
          }

          if (!isMounted) {
            return;
          }

          const nextBootState = result.initialized ? "login" : "setup";
          setBootState(nextBootState);

          if (nextBootState === "login") {
            setSetupErrors([]);
            setSetupSubmitState("idle");
          } else {
            setLogin(initialLogin);
            setLoginErrors([]);
            setLoginSubmitState("idle");
          }
          return;
        } catch (error) {
          if (!isMounted) {
            return;
          }

          if (attempt === 120) {
            setLoginErrors([getErrorMessage(error, "Could not connect to the local backend.")]);
            setBootState("login");
            setSetupErrors([]);
            setSetupSubmitState("idle");
            return;
          }

          await delay(500);
        }
      }
    }

    void checkSetupStatus();

    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl]);

  const completeAuthentication = (nextSession: AuthSession) => {
    setSession(nextSession);
    onAuthenticated?.(nextSession);
    window.location.hash = dashboardPath;
  };

  const onOrganizationNext = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validateOrganization(organization);
    setSetupErrors(nextErrors);

    if (nextErrors.length === 0) {
      setSetupStep(2);
    }
  };

  const onSetupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = [...validateOrganization(organization), ...validateAdmin(admin)];
    setSetupErrors(nextErrors);

    if (nextErrors.length > 0) {
      return;
    }

    setSetupSubmitState("submitting");

    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_name: organization.shopName.trim(),
          address: organization.billingAddress.trim(),
          gstin: organization.gstin.trim().toUpperCase(),
          contact_number: organization.contactNumber.trim(),
          admin_username: admin.username.trim().toLowerCase(),
          admin_password: admin.password
        })
      });

      const result = (await response.json().catch(() => null)) as AuthSession & { errors?: string[] } | null;

      if (!response.ok || !result?.token || !result.user) {
        throw new Error(result?.errors?.join(" ") || "First-time setup failed.");
      }

      completeAuthentication(result);
    } catch (error) {
      setSetupErrors([getErrorMessage(error, "First-time setup failed.")]);
    } finally {
      setSetupSubmitState("idle");
    }
  };

  const onLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validateLogin(login);
    setLoginErrors(nextErrors);

    if (nextErrors.length > 0) {
      return;
    }

    setLoginSubmitState("submitting");

    try {
      const response = await fetchWithRetry(`${apiBaseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: login.username.trim().toLowerCase(),
          password: login.password
        })
      });

      const result = (await response.json().catch(() => null)) as AuthSession & { errors?: string[] } | null;

      if (!response.ok || !result?.token || !result.user) {
        throw new Error(result?.errors?.join(" ") || "Incorrect username or password.");
      }

      completeAuthentication(result);
    } catch (error) {
      setLoginErrors([getErrorMessage(error, "Incorrect username or password.")]);
    } finally {
      setLoginSubmitState("idle");
    }
  };

  const activeErrors = bootState === "setup" ? setupErrors : loginErrors;

  if (session) {
    return (
      <GatewayShell>
        <div className="mx-auto grid w-full max-w-md gap-3 border border-slate-800 bg-slate-950 p-5 text-center">
          <p className="text-sm font-semibold text-white">Signed in as {session.user.username}</p>
          <p className="text-xs text-slate-400">Opening dashboard...</p>
        </div>
      </GatewayShell>
    );
  }

  if (bootState === "checking") {
    return (
      <GatewayShell>
        <div className="mx-auto grid w-full max-w-md gap-3 border border-slate-800 bg-slate-950 p-5">
          <p className="text-sm font-semibold text-white">Checking local setup</p>
          <div className="h-2 overflow-hidden bg-slate-800">
            <div className="h-full w-1/2 animate-pulse bg-emerald-400" />
          </div>
        </div>
      </GatewayShell>
    );
  }

  return (
    <GatewayShell>
      <div className="grid w-full max-w-5xl grid-cols-1 border border-slate-800 bg-slate-950 lg:grid-cols-[320px_1fr]">
        <aside className="border-b border-slate-800 bg-slate-900 p-5 lg:border-b-0 lg:border-r">
          <div className="grid gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Offline Mode Active</p>
              <h1 className="mt-2 text-2xl font-semibold text-white">Jewelry ERP</h1>
              <p className="mt-2 text-sm text-slate-400">
                Local desktop access for inventory, billing, and shop operations.
              </p>
            </div>

            <div className="grid gap-2 text-xs text-slate-400">
              <StatusLine label="Database" value="Local SQLite" />
              <StatusLine label="Network" value="Not required" />
              <StatusLine label="Mode" value={bootState === "setup" ? "First-time setup" : "Login"} />
            </div>
          </div>
        </aside>

        <main className="p-5">
          {sessionNotice && bootState === "login" && (
            <div className="mb-4 border border-amber-700 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
              {sessionNotice}
            </div>
          )}

          {activeErrors.length > 0 && (
            <div className="mb-4 border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">
              {activeErrors.join(" ")}
            </div>
          )}

          {bootState === "setup" ? (
            setupStep === 1 ? (
              <OrganizationStep
                organization={organization}
                setOrganization={setOrganization}
                onSubmit={onOrganizationNext}
              />
            ) : (
              <AdminStep
                admin={admin}
                setAdmin={setAdmin}
                onBack={() => {
                  setSetupErrors([]);
                  setSetupStep(1);
                }}
                onSubmit={onSetupSubmit}
                submitting={setupSubmitState === "submitting"}
              />
            )
          ) : (
            <LoginScreen
              login={login}
              setLogin={setLogin}
              onSubmit={onLoginSubmit}
              submitting={loginSubmitState === "submitting"}
            />
          )}
        </main>
      </div>
    </GatewayShell>
  );
}

function GatewayShell({ children }: { children: ReactNode }) {
  return (
    <section className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
      {children}
    </section>
  );
}

function OrganizationStep({
  organization,
  setOrganization,
  onSubmit
}: {
  organization: OrganizationForm;
  setOrganization: (organization: OrganizationForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormHeading title="First-Time Setup" subtitle="Step 1 of 2: Organization details" />
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Shop Name">
          <input
            value={organization.shopName}
            onChange={(event) => setOrganization({ ...organization, shopName: event.target.value })}
            className={controlClassName}
            autoFocus
          />
        </Field>
        <Field label="Contact Number">
          <input
            value={organization.contactNumber}
            onChange={(event) => setOrganization({ ...organization, contactNumber: event.target.value })}
            className={controlClassName}
            inputMode="tel"
          />
        </Field>
        <Field label="GSTIN Optional">
          <input
            value={organization.gstin}
            onChange={(event) => setOrganization({ ...organization, gstin: event.target.value.toUpperCase() })}
            className={controlClassName}
            maxLength={15}
            placeholder="22AAAAA0000A1Z5"
          />
        </Field>
        <Field label="Billing Address">
          <textarea
            value={organization.billingAddress}
            onChange={(event) => setOrganization({ ...organization, billingAddress: event.target.value })}
            className={`${controlClassName} min-h-20 resize-none py-2 md:col-span-1`}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <button type="submit" className={primaryButtonClassName}>
          Continue
        </button>
      </div>
    </form>
  );
}

function AdminStep({
  admin,
  setAdmin,
  onBack,
  onSubmit,
  submitting
}: {
  admin: AdminForm;
  setAdmin: (admin: AdminForm) => void;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormHeading title="Create Super Admin" subtitle="Step 2 of 2: Owner access" />
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Admin Username">
          <input
            value={admin.username}
            onChange={(event) => setAdmin({ ...admin, username: event.target.value })}
            className={controlClassName}
            autoFocus
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={admin.password}
            onChange={(event) => setAdmin({ ...admin, password: event.target.value })}
            className={controlClassName}
          />
        </Field>
        <Field label="Confirm Password">
          <input
            type="password"
            value={admin.confirmPassword}
            onChange={(event) => setAdmin({ ...admin, confirmPassword: event.target.value })}
            className={controlClassName}
          />
        </Field>
      </div>
      <div className="flex justify-between gap-2">
        <button type="button" onClick={onBack} className={secondaryButtonClassName}>
          Back
        </button>
        <button type="submit" disabled={submitting} className={primaryButtonClassName}>
          {submitting ? "Creating" : "Finish Setup"}
        </button>
      </div>
    </form>
  );
}

function LoginScreen({
  login,
  setLogin,
  onSubmit,
  submitting
}: {
  login: LoginForm;
  setLogin: (login: LoginForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="mx-auto grid max-w-xl gap-4">
      <FormHeading title="Sign In" subtitle="Enter your local desktop credentials" />
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Username">
          <input
            value={login.username}
            onChange={(event) => setLogin({ ...login, username: event.target.value })}
            className={controlClassName}
            autoFocus
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={login.password}
            onChange={(event) => setLogin({ ...login, password: event.target.value })}
            className={controlClassName}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={submitting} className={primaryButtonClassName}>
          {submitting ? "Signing In" : "Sign In"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
      <span>{label}</span>
      {children}
    </label>
  );
}

function FormHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 py-2">
      <span>{label}</span>
      <span className="font-medium text-slate-200">{value}</span>
    </div>
  );
}

function validateOrganization(organization: OrganizationForm) {
  const errors: string[] = [];
  const gstin = organization.gstin.trim().toUpperCase();

  if (!organization.shopName.trim()) errors.push("Shop name is required.");
  if (!organization.billingAddress.trim()) errors.push("Billing address is required.");
  if (!organization.contactNumber.trim()) errors.push("Contact number is required.");
  if (gstin && !gstinPattern.test(gstin)) errors.push("GSTIN must be a valid 15-character GSTIN.");

  return errors;
}

function validateAdmin(admin: AdminForm) {
  const errors: string[] = [];

  if (!admin.username.trim()) errors.push("Admin username is required.");
  if (admin.password.length < 8) errors.push("Password must be at least 8 characters.");
  if (admin.password !== admin.confirmPassword) errors.push("Passwords do not match.");

  return errors;
}

function validateLogin(login: LoginForm) {
  const errors: string[] = [];

  if (!login.username.trim()) errors.push("Username is required.");
  if (!login.password) errors.push("Password is required.");

  return errors;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Could not connect to the local backend.");
}

const controlClassName =
  "h-10 w-full border border-slate-700 bg-slate-900 px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400";
const primaryButtonClassName =
  "h-10 bg-emerald-500 px-5 text-sm font-semibold uppercase text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400";
const secondaryButtonClassName =
  "h-10 border border-slate-700 px-5 text-sm font-semibold uppercase text-slate-200 hover:border-slate-500 hover:bg-slate-900";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
    return "Could not connect to the local backend.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

