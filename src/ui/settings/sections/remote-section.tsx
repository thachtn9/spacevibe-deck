import { useCallback, useEffect, useState } from "preact/hooks";
import type { TargetedEvent } from "preact";
import { remoteHost } from "../../../host/remote-host";
import { writeText } from "../../../host/shell-host";
import { open } from "../../../host/dialog-host";
import type { RemoteAccessStatus } from "../../../lib/deck-remote";
import { ConfigRow, ToggleRow } from "../../controls/config-row";

export function RemoteSection() {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"web" | "native" | null>(null);
  const adopt = useCallback((next: RemoteAccessStatus) => {
    setStatus(next);
    setAddress((previous) =>
      next.addresses.includes(previous) ? previous : (next.addresses[0] ?? ""),
    );
  }, []);
  useEffect(() => {
    if (!remoteHost.available) return;
    let active = true;
    void remoteHost
      .status()
      .then((next) => {
        if (active) adopt(next);
      })
      .catch(() => {
        if (active) setError("Could not read remote access settings. Reopen Settings to retry.");
      });
    return () => {
      active = false;
    };
  }, [adopt]);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setCopied(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The remote access action failed.");
    } finally {
      setBusy(false);
    }
  }, []);
  const toggle = useCallback(() => {
    if (status)
      void run(async () =>
        adopt(await remoteHost.configure(!status.enabled, status.port, status.root)),
      );
  }, [status, run, adopt]);
  const chooseFolder = useCallback(
    () =>
      void run(async () => {
        if (!status) return;
        const selected = await open({ directory: true, multiple: false });
        if (typeof selected === "string")
          adopt(await remoteHost.configure(status.enabled, status.port, selected));
      }),
    [status, run, adopt],
  );
  const changePort = useCallback(
    (event: TargetedEvent<HTMLInputElement, FocusEvent>) => {
      const port = Number(event.currentTarget.value);
      if (status && port !== status.port)
        void run(async () => adopt(await remoteHost.configure(status.enabled, port, status.root)));
    },
    [status, run, adopt],
  );
  const changeAddress = useCallback((event: TargetedEvent<HTMLSelectElement, Event>) => {
    setAddress(event.currentTarget.value);
    setCopied(null);
  }, []);
  const copyConnection = useCallback(
    () =>
      void run(async () => {
        await writeText(await remoteHost.pair(address));
        setCopied("native");
      }),
    [address, run],
  );
  const copyWebConnection = useCallback(
    () =>
      void run(async () => {
        await writeText(await remoteHost.pairWeb(address));
        setCopied("web");
      }),
    [address, run],
  );
  const resetPairing = useCallback(
    () => void run(async () => adopt(await remoteHost.rotate())),
    [run, adopt],
  );
  if (!remoteHost.available) return <p>Remote access requires Deck Electron.</p>;
  return (
    <>
      <ToggleRow
        label="Remote access"
        desc="Control your computer's sessions from Safari on iPhone"
        checked={status?.enabled ?? false}
        disabled={!status || busy}
        onToggle={toggle}
      />
      {status && (
        <>
          <ConfigRow label="Shared folder" desc={status.root}>
            <button class="cfg-btn" type="button" disabled={busy} onClick={chooseFolder}>
              Choose folder
            </button>
          </ConfigRow>
          <ConfigRow label="Port" desc="Changes apply when the field loses focus">
            <input
              class="cfg-btn"
              type="number"
              aria-label="Remote access port"
              min="1024"
              max="65535"
              key={status.port}
              defaultValue={status.port}
              disabled={busy}
              onBlur={changePort}
            />
          </ConfigRow>
          {status.enabled && (
            <>
              <ConfigRow label="Computer address" desc="Use a reachable LAN or Tailscale address">
                <span class="cfg-btn cfg-btn--overlay">
                  <span class="cfg-btn__text">{address}</span>
                  <select
                    aria-label="Remote computer address"
                    value={address}
                    disabled={busy}
                    onChange={changeAddress}
                  >
                    {status.addresses.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </span>
              </ConfigRow>
              <ConfigRow
                label="Open on iPhone"
                desc="Open the web link in Safari, then Share → Add to Home Screen"
              >
                <button
                  class="cfg-btn"
                  type="button"
                  disabled={busy || !address}
                  onClick={copyWebConnection}
                >
                  {copied === "web" ? "Web link copied" : "Copy web link"}
                </button>
              </ConfigRow>
              <ConfigRow
                label="Native iOS app"
                desc="Paste the connection into the optional Xcode-built app"
              >
                <button
                  class="cfg-btn"
                  type="button"
                  disabled={busy || !address}
                  onClick={copyConnection}
                >
                  {copied === "native" ? "Copied" : "Copy connection"}
                </button>
              </ConfigRow>
              <ConfigRow
                label="Disconnect paired devices"
                desc="Create a new key and pair your iPhone again"
              >
                <button class="cfg-btn" type="button" disabled={busy} onClick={resetPairing}>
                  Reset pairing
                </button>
              </ConfigRow>
            </>
          )}
        </>
      )}
      {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
      {!status && !error && <p role="status">Loading remote access settings…</p>}
    </>
  );
}
