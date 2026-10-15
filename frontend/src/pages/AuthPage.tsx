import { useState, type FormEvent } from "react";
import { AuthError, useAuth } from "../auth";
import { STORE_KIND } from "../data";
import type { Theme } from "../App";
import { ChatIcon, Logo, MoonIcon, SparkIcon, SunIcon, UserIcon } from "../components/icons";

const FEATURES = [
  { Icon: UserIcon, title: "One profile, everything in one place", text: "Grades, tests, activities, and your college list." },
  { Icon: ChatIcon, title: "An advisor that knows you", text: "Ask anything; answers are tailored to your profile and cite official sources." },
  { Icon: SparkIcon, title: "AI insights on your list", text: "See reach, target, and likely schools plus a prioritized action plan." },
];

export function AuthPage({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === "signup" && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      if (mode === "signup") {
        const result = await signUp(name, email, password);
        if ("confirmEmail" in result) {
          setNotice("Check your inbox to confirm your email, then sign in.");
          setMode("signin");
          setSubmitting(false);
          return;
        }
      } else {
        await signIn(email, password);
      }
      window.location.hash = mode === "signup" ? "/profile" : "/overview";
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === "signup" ? "signin" : "signup"));
    setError(null);
  };

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="auth-brand">
          <Logo size={32} />
          <span>Track2College</span>
        </div>
        <div className="auth-pitch">
          <h1>Your path to college, planned around you.</h1>
          <p>Build your student profile once. Track2College uses it to answer your questions and analyze your college list.</p>
          <ul className="auth-features">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title}>
                <span className="auth-feature-icon">
                  <Icon width={18} height={18} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-foot">Built for first-gen and college-bound high school students.</p>
      </section>

      <section className="auth-panel">
        <button className="icon-btn auth-theme" onClick={onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>

        <form className="auth-form" onSubmit={submit} noValidate={false}>
          <div className="auth-mobile-brand">
            <Logo size={40} />
          </div>
          <h2>{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-sub">
            {mode === "signup" ? "It takes a minute, and you can fill in your profile at your own pace." : "Sign in to pick up where you left off."}
          </p>

          {mode === "signup" && (
            <label className="field">
              <span className="field-label">Full name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder="Maya Rodriguez" />
            </label>
          )}
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="you@example.com" />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={mode === "signup" ? 8 : undefined}
              required
              placeholder={mode === "signup" ? "At least 8 characters" : ""}
            />
          </label>

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

          <button className="btn-primary btn-block" disabled={submitting}>
            {submitting ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>

          <p className="auth-switch">
            {mode === "signup" ? "Already have an account?" : "New to Track2College?"}{" "}
            <button type="button" onClick={switchMode}>
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
          {STORE_KIND === "local" && <p className="auth-note">Accounts are currently stored privately on this device only.</p>}
        </form>
      </section>
    </div>
  );
}
