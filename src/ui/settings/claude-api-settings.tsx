import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { claudeApiHost } from "../../host/claude-api-host";
import {
  CLAUDE_API_DEFAULT_MODEL,
  CLAUDE_API_DEFAULT_URL,
  CLAUDE_API_MODELS,
  type ClaudeApiSettings,
} from "../../lib/claude-api";
import { ConfigGroup, ConfigRow } from "../controls/config-row";

export function ClaudeApiSettingsForm() {
  const baseUrl = useSignal(CLAUDE_API_DEFAULT_URL);
  const model = useSignal(CLAUDE_API_DEFAULT_MODEL);
  const apiKey = useSignal("");
  const hasKey = useSignal(false);
  const busy = useSignal<"loading" | "saving" | "testing" | null>("loading");
  const failedLoad = useSignal(false);
  const result = useSignal<{ ok: boolean; message: string } | null>(null);

  const adopt = (saved: ClaudeApiSettings): void => {
    baseUrl.value = saved.baseUrl;
    model.value = saved.model;
    hasKey.value = saved.hasApiKey;
  };

  useEffect(() => {
    let active = true;
    void claudeApiHost
      .load()
      .then(
        (saved) => {
          if (active) adopt(saved);
        },
        () => {
          if (!active) return;
          failedLoad.value = true;
          result.value = {
            ok: false,
            message: "Could not load Claude API settings. Reopen Settings to retry.",
          };
        },
      )
      .finally(() => {
        if (active) busy.value = null;
      });
    return () => {
      active = false;
    };
    // Signal containers stay stable; changing a draft must not reload saved values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (action: "saving" | "testing"): Promise<void> => {
    if (busy.value || failedLoad.value) return;
    busy.value = action;
    result.value = null;
    const draft = { baseUrl: baseUrl.value, model: model.value, apiKey: apiKey.value };
    try {
      if (action === "testing") {
        result.value = await claudeApiHost.test(draft);
      } else {
        adopt(await claudeApiHost.save(draft));
        apiKey.value = "";
        result.value = {
          ok: true,
          message: "Saved. Open a new Claude session to use these settings.",
        };
      }
    } catch (error) {
      // Main returns only credential-free validation and connection errors.
      result.value = {
        ok: false,
        message:
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "")
            : "Could not complete the request. Try again.",
      };
    } finally {
      busy.value = null;
    }
  };

  const blocked = busy.value !== null || failedLoad.value;
  const clearResult = (): void => {
    result.value = null;
  };

  return (
    <section class="lp-agent-group lp-claude-api" aria-label="Claude API connection">
      <ConfigGroup label="API connection" />
      <p class="lp-install-help">
        Use MWAPI or another Anthropic-compatible gateway. Saved settings apply to new Claude Code
        sessions on this computer.
      </p>
      <ConfigRow label="Base URL" desc="An optional /v1 suffix is removed automatically.">
        <input
          class="text-input"
          type="url"
          aria-label="Claude API base URL"
          value={baseUrl.value}
          disabled={blocked}
          spellcheck={false}
          onInput={(e) => {
            baseUrl.value = e.currentTarget.value;
            clearResult();
          }}
        />
      </ConfigRow>
      <ConfigRow
        label="API key"
        desc={
          hasKey.value
            ? "A key is saved. Leave blank to keep it."
            : "Stored locally in Claude settings; never in your project."
        }
      >
        <input
          class="text-input"
          type="password"
          aria-label="Claude API key"
          autoComplete="new-password"
          spellcheck={false}
          value={apiKey.value}
          placeholder={hasKey.value ? "Saved key" : "Paste your API key"}
          disabled={blocked}
          onInput={(e) => {
            apiKey.value = e.currentTarget.value;
            clearResult();
          }}
        />
      </ConfigRow>
      <ConfigRow label="API model" desc="Use the exact model ID supplied by your gateway.">
        <input
          class="text-input"
          type="text"
          aria-label="Claude API model"
          list="claude-api-models"
          value={model.value}
          disabled={blocked}
          spellcheck={false}
          onInput={(e) => {
            model.value = e.currentTarget.value;
            clearResult();
          }}
        />
        <datalist id="claude-api-models">
          {CLAUDE_API_MODELS.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </ConfigRow>
      <ConfigRow
        label="Test connection"
        desc="Sends a short request using this model and key. Does not save changes."
      >
        <button
          type="button"
          class="cfg-btn"
          disabled={blocked || (!apiKey.value.trim() && !hasKey.value)}
          onClick={() => void run("testing")}
        >
          {busy.value === "testing" ? "Testing…" : "Test connection"}
        </button>
      </ConfigRow>
      <ConfigRow label="Save connection" desc="Running sessions keep their current configuration.">
        <button
          type="button"
          class="cfg-btn"
          disabled={blocked || (!apiKey.value.trim() && !hasKey.value)}
          onClick={() => void run("saving")}
        >
          {busy.value === "saving" ? "Saving…" : "Save"}
        </button>
      </ConfigRow>
      <p
        class={`lp-install-help ${result.value && !result.value.ok ? "cfg-custom--error" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {busy.value === "loading" ? "Loading API settings…" : result.value?.message}
      </p>
    </section>
  );
}
