import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { useIsMobile } from "../hooks.js";
import Card from "../components/Card.jsx";

const FEATURES = [
  ["Live card recognition", "A phone camera over the table reads every card as it is dealt."],
  ["Hi-Lo running and true count", "Counted once per card, restarted on every shuffle."],
  ["Basic strategy, one tap away", "The full chart, and a clear notice whenever the count can't be trusted."],
];

const fieldStyle = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  color: "var(--white)",
  fontSize: "1rem",
};

function Field({ label, children }) {
  return (
    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--white-dim)" }}>
      <span style={{ display: "block", marginBottom: 7 }}>{label}</span>
      {children}
    </label>
  );
}

/** The charcoal sign-in form, shared by the computer and phone layouts. */
function LoginForm({ mode, setMode, name, setName, onSubmit, onGuest }) {
  const [showPassword, setShowPassword] = useState(false);
  const signingUp = mode === "register";
  return (
        <div style={{ width: "100%", maxWidth: 420 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "2.6rem", letterSpacing: "0.03em", margin: "0 0 6px" }}>
          {signingUp ? "Create your account" : "Welcome back"}
        </h2>
        <p style={{ margin: "0 0 30px", color: "var(--white-faint)", fontSize: "0.95rem" }}>
          {signingUp ? "Save your playstyle report across sessions." : "Log in to see your analysis and sit at the table."}
        </p>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Field label="Username">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. cardCounter22"
              autoComplete="username"
              autoFocus
              style={fieldStyle}
            />
          </Field>
          <Field label="Password">
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete={signingUp ? "new-password" : "current-password"}
                style={{ ...fieldStyle, paddingRight: 64 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: 0,
                  color: "var(--white-faint)",
                  cursor: "pointer",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                }}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </Field>
          <button
            type="submit"
            className="hlo-btn hlo-btn--primary"
            style={{ marginTop: 6, padding: "15px 18px", fontSize: "1rem", borderRadius: 10, width: "100%" }}
          >
            {signingUp ? "Create account" : "Log in"}
          </button>
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "26px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize: "0.75rem", color: "var(--white-faint)", letterSpacing: "0.08em" }}>OR</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
        </div>

        <button
          type="button"
          className="hlo-btn hlo-btn--ghost"
          style={{ width: "100%", padding: "14px 18px", fontSize: "0.98rem", borderRadius: 10 }}
          onClick={onGuest}
        >
          Continue as guest
        </button>
        <p style={{ fontSize: "0.78rem", color: "var(--white-faint)", margin: "12px 0 0", lineHeight: 1.5 }}>
          Guests get real-time recommendations and the running count only. No stats are saved and no playstyle report
          is generated.
        </p>

        <p style={{ margin: "30px 0 0", fontSize: "0.9rem", color: "var(--white-dim)", textAlign: "center" }}>
          {signingUp ? "Already have an account? " : "New to HighLo? "}
          <button
            type="button"
            onClick={() => setMode(signingUp ? "login" : "register")}
            style={{ background: "none", border: 0, padding: 0, color: "var(--red-bright)", fontWeight: 600, cursor: "pointer", font: "inherit" }}
          >
            {signingUp ? "Log in" : "Create an account"}
          </button>
        </p>
      </div>
  );
}

/** Computer layout: brand panel on the left, sign-in form on the right. */
function LoginDesktop({ mode, setMode, name, setName, onSubmit, onGuest }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* ---- brand panel ---- */}
      <aside
        style={{
          flex: "1 1 56%",
          position: "relative",
          overflow: "hidden",
          padding: "56px clamp(48px, 6vw, 96px)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(ellipse at 20% 15%, rgba(255,255,255,0.07), transparent 55%), linear-gradient(155deg, var(--felt-light) 0%, var(--felt) 50%, var(--felt-dark) 100%)",
          borderRight: "1px solid rgba(168,134,63,0.4)",
        }}
      >
        {/* soft table-rail rings */}
        <div aria-hidden style={{ position: "absolute", right: -220, bottom: -260, width: 720, height: 720, borderRadius: "50%", border: "1px solid rgba(168,134,63,0.28)" }} />
        <div aria-hidden style={{ position: "absolute", right: -140, bottom: -180, width: 560, height: 560, borderRadius: "50%", border: "1px solid rgba(168,134,63,0.18)" }} />

        <div style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem", letterSpacing: "0.06em", position: "relative" }}>
          HIGH<span style={{ color: "var(--red-bright)" }}>LO</span>
        </div>

        <div style={{ position: "relative", maxWidth: 560 }}>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(3.2rem, 5.2vw, 5.4rem)",
              lineHeight: 0.98,
              letterSpacing: "0.02em",
              margin: "0 0 20px",
            }}
          >
            Know the count.
            <br />
            <span style={{ color: "var(--red-bright)" }}>Play the odds.</span>
          </h1>
          <p style={{ margin: "0 0 34px", fontSize: "1.08rem", lineHeight: 1.6, color: "var(--white-dim)", maxWidth: 470 }}>
            Live table intelligence for blackjack: every card read, every hand tracked, a recommendation for each turn.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {FEATURES.map(([title, text], i) => (
              <div key={title} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <span
                  style={{
                    flex: "0 0 auto",
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    border: "1px solid var(--brass)",
                    color: "var(--brass)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.8rem",
                  }}
                >
                  {i + 1}
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.98rem" }}>{title}</div>
                  <div style={{ fontSize: "0.86rem", color: "var(--white-faint)", lineHeight: 1.5 }}>{text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* a fanned hand, using the app's own cards */}
        <div aria-hidden style={{ position: "absolute", right: "clamp(40px, 6vw, 110px)", bottom: 64, display: "flex", pointerEvents: "none" }}>
          {[["AS", -14], ["KH", 0], ["QC", 14]].map(([code, rot], i) => (
            <div
              key={code}
              style={{
                transform: `rotate(${rot}deg)`,
                transformOrigin: "50% 120%",
                marginLeft: i ? -34 : 0,
                filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.45))",
              }}
            >
              <Card code={code} size="xl" />
            </div>
          ))}
        </div>

        <div style={{ position: "relative", fontSize: "0.72rem", color: "var(--white-faint)", maxWidth: 420, lineHeight: 1.5 }}>
          For learning and analysis only. Card counting may be restricted by casino rules or local law.
        </div>
      </aside>

      {/* ---- form ---- */}
      <main
        style={{
          flex: "1 1 44%",
          minWidth: 460,
          background: "var(--charcoal)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px clamp(32px, 5vw, 88px)",
        }}
      >
        <LoginForm mode={mode} setMode={setMode} name={name} setName={setName} onSubmit={onSubmit} onGuest={onGuest} />
      </main>
    </div>
  );
}

export default function Login() {
  const { login, continueAsGuest } = useAppState();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [name, setName] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    // NOTE: no real backend is wired up. This simulates a successful
    // login/register for any name so the rest of the flow can be built and
    // tested. The demo accounts (alex, jordan, sean) are matched by username
    // in state/mockData.js; the password is not checked.
    login(name.trim() || "Player");
    navigate("/seats");
  }

  function handleGuest() {
    continueAsGuest();
    navigate("/seats");
  }

  if (!isMobile) {
    return (
      <LoginDesktop
        mode={mode}
        setMode={setMode}
        name={name}
        setName={setName}
        onSubmit={handleSubmit}
        onGuest={handleGuest}
      />
    );
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--charcoal)" }}>
      <header
        style={{
          padding: "32px 24px 18px",
          textAlign: "center",
          borderBottom: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <div style={{ fontFamily: "var(--font-display)", fontSize: "2rem", letterSpacing: "0.06em" }}>
          HIGH<span style={{ color: "var(--red-bright)" }}>LO</span>
        </div>
      </header>
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>
        <LoginForm
          mode={mode}
          setMode={setMode}
          name={name}
          setName={setName}
          onSubmit={handleSubmit}
          onGuest={handleGuest}
        />
      </main>
    </div>
  );
}
