import { useState, type FormEvent } from "react";
import { AuthError, useAuth } from "../auth";
import type { Theme } from "../App";
import { EyeIcon, LockIcon, Logo, MailIcon, MoonIcon, SunIcon, UserIcon } from "../components/icons";

export function AuthPage({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<"signup" | "signin" | "reset">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === "signup" && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "reset") {
        await resetPassword(email);
        setNotice("If an account exists for that email, a reset link is on the way.");
        setMode("signin");
        setSubmitting(false);
        return;
      }
      if (mode === "signup") {
        const result = await signUp(name, email, password);
        if ("confirmEmail" in result) {
          setNotice("Check your inbox to confirm your email, then log in.");
          setMode("signin");
          setSubmitting(false);
          return;
        }
      } else {
        await signIn(email, password);
      }
      window.location.hash = mode === "signup" ? "/profile" : "/materials";
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const title = mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Welcome back";
  const subtitle =
    mode === "signup"
      ? "Build a student profile once. Advisor answers, readiness checklist, and your college list stay in sync."
      : mode === "reset"
        ? "Enter your email and we’ll send a link to choose a new password."
        : "Your path to your dream UC school.";

  const cta = submitting
    ? "One moment…"
    : mode === "signup"
      ? "Create account"
      : mode === "reset"
        ? "Send reset link"
        : "Log in";

  return (
    <div className="auth">
      <div className="auth-sky" aria-hidden="true">
        <span className="auth-cloud auth-cloud-a" />
        <span className="auth-cloud auth-cloud-b" />
      </div>

      <a className="auth-brand" href="#/">
        <Logo size={28} />
        <span>Track2College</span>
      </a>

      <button className="icon-btn auth-theme" onClick={onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>

      <div className="auth-card">
        <h1>{title}</h1>
        <p className="auth-sub">{subtitle}</p>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label className="auth-field">
              <span className="auth-field-icon">
                <UserIcon width={16} height={16} />
              </span>
              <span className="visually-hidden">Full name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder="Full name" />
            </label>
          )}

          <label className="auth-field">
            <span className="auth-field-icon">
              <MailIcon width={16} height={16} />
            </span>
            <span className="visually-hidden">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="Email" />
          </label>

          {mode !== "reset" && (
            <label className="auth-field">
              <span className="auth-field-icon">
                <LockIcon width={16} height={16} />
              </span>
              <span className="visually-hidden">Password</span>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={mode === "signup" ? 8 : undefined}
                required
                placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
              />
              <button
                type="button"
                className="auth-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <EyeIcon width={16} height={16} crossed={showPassword} />
              </button>
            </label>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="form-notice" role="status">
              {notice}
            </p>
          )}

          <button className="auth-cta" disabled={submitting}>
            {cta}
          </button>

          {mode === "signin" && (
            <div className="auth-forgot-row">
              <button
                type="button"
                className="auth-forgot"
                onClick={() => {
                  setMode("reset");
                  setError(null);
                  setNotice(null);
                }}
              >
                Forgot password?
              </button>
            </div>
          )}
        </form>

        <div className="auth-divider" role="presentation">
          <span>or</span>
        </div>

        <p className="auth-switch">
          {mode === "reset" ? (
            <>
              Remembered it?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setNotice(null);
                }}
              >
                Log in
              </button>
            </>
          ) : mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setNotice(null);
                }}
              >
                Log in
              </button>
            </>
          ) : (
            <>
              New to Track2College?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                  setNotice(null);
                }}
              >
                Create an account
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
