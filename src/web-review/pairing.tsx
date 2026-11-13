/* oxlint-disable react-hooks/exhaustive-deps -- Window-local signals own the pairing timer and request lifecycle. */
import { render } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { ArrowClockwise, Copy, Check, Plugs, Browser, ShieldCheck } from "@phosphor-icons/react";
import { invoke } from "../host/bridge";
import { applyThemeVars } from "../lib/theme-vars";
import type { ReviewSnapshot } from "../lib/web-review";
import "../styles/01-tokens.css";
import "./web-review.css";

function Pairing() {
  const code = useSignal(""),
    error = useSignal(""),
    busy = useSignal(false),
    copied = useSignal(false);
  const expires = useSignal(0),
    now = useSignal(Date.now());

  async function generate() {
    busy.value = true;
    error.value = "";
    copied.value = false;
    try {
      const reply = await invoke<{ code: string; expires: number }>("web_review_pairing");
      code.value = reply.code;
      expires.value = reply.expires;
    } catch (e) {
      error.value = String(e);
    } finally {
      busy.value = false;
    }
  }

  function copyCode() {
    if (!code.value || now.value >= expires.value) return;
    void navigator.clipboard.writeText(code.value).then(() => {
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 2000);
    });
  }

  useEffect(() => {
    void invoke<ReviewSnapshot>("web_review_state")
      .then((s) => applyThemeVars(document.documentElement.style, s.theme))
      .catch((e) => {
        error.value = String(e);
      });
    void generate();
    const timer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingSeconds = Math.max(0, Math.floor((expires.value - now.value) / 1000));
  const isExpired = remainingSeconds <= 0;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${minutes}:${String(seconds).padStart(2, "0")}`;
  const progressPercent = Math.min(100, Math.max(0, (remainingSeconds / 120) * 100));

  const digits =
    code.value && !isExpired && code.value.length === 6
      ? code.value.split("")
      : ["•", "•", "•", "•", "•", "•"];

  return (
    <main class="wr-app wr-pairing-container">
      <div class="wr-pairing-modal">
        {/* Header */}
        <div class="wr-pairing-header">
          <div class="wr-brand-badge">
            <Browser size={24} weight="duotone" />
          </div>
          <h1>Connect Chrome to Deck</h1>
          <p class="wr-pairing-subtitle">
            Pair the Deck Review extension to review web applications and queue feedback directly
            into your agent conversations.
          </p>
        </div>

        {/* OTP Code Card */}
        <div class="wr-otp-card">
          <div class="wr-otp-topbar">
            <span class="wr-otp-label">6-Digit Pairing Code</span>
            <span class={`wr-otp-timer ${isExpired ? "expired" : ""}`}>
              {isExpired ? "Code expired" : `Expires in ${timeFormatted}`}
            </span>
          </div>

          <div class="wr-digits-row">
            {digits.map((digit, i) => (
              <div key={i} class={`wr-digit-cell ${isExpired ? "expired" : ""}`}>
                {digit}
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div class="wr-timer-bar">
            <div
              class={`wr-timer-fill ${isExpired ? "expired" : ""}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div class="wr-otp-actions">
            <button
              type="button"
              class="wr-copy-btn"
              disabled={isExpired || !code.value}
              onClick={copyCode}
            >
              {copied.value ? (
                <>
                  <Check size={16} weight="bold" />
                  <span>Copied to Clipboard</span>
                </>
              ) : (
                <>
                  <Copy size={16} />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Action Controls */}
        <div class="wr-action-row">
          <button
            type="button"
            class="wr-primary-btn"
            disabled={busy.value}
            onClick={() => void generate()}
          >
            <ArrowClockwise size={16} className={busy.value ? "wr-spin" : ""} />
            <span>Generate new code</span>
          </button>
          <button
            type="button"
            class="wr-secondary-btn"
            onClick={() =>
              void invoke("web_review_revoke")
                .then(() => {
                  code.value = "";
                  expires.value = 0;
                  error.value = "Extension disconnected.";
                })
                .catch((e) => {
                  error.value = String(e);
                })
            }
          >
            <Plugs size={16} />
            <span>Disconnect extension</span>
          </button>
        </div>

        {error.value && (
          <div class="wr-notice-box" role="status">
            <span>{error.value}</span>
          </div>
        )}

        {/* Setup Steps */}
        <div class="wr-steps-section">
          <h2>Getting Started</h2>
          <div class="wr-steps-list">
            <div class="wr-step-item">
              <span class="wr-step-number">1</span>
              <div class="wr-step-content">
                <strong>Load Extension</strong>
                <p>
                  Open <code>chrome://extensions</code>, enable Developer mode, click{" "}
                  <strong>Load unpacked</strong> and select <code>extensions/deck-review</code>.
                </p>
              </div>
            </div>

            <div class="wr-step-item">
              <span class="wr-step-number">2</span>
              <div class="wr-step-content">
                <strong>Enter Code</strong>
                <p>
                  Pin Deck Review in Chrome, click its icon on your app page, and enter the 6-digit
                  code above.
                </p>
              </div>
            </div>

            <div class="wr-step-item">
              <span class="wr-step-number">3</span>
              <div class="wr-step-content">
                <strong>Review & Annotate</strong>
                <p>
                  Click elements or regions to leave notes, choose your source and conversation,
                  then queue changes.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="wr-footer-tip">
          <ShieldCheck size={16} />
          <span>
            Pairing uses a local authenticated loopback bridge on 127.0.0.1:43129. Credentials
            remain private.
          </span>
        </div>
      </div>
    </main>
  );
}

render(<Pairing />, document.getElementById("root")!);
