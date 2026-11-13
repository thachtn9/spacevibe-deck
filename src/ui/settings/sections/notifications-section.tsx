import { settings, updateSettings } from "../../../settings/settings-store";
import { desktopAgentsHost } from "../../../host/desktop-agents-host";
import { ToggleRow } from "../../controls/config-row";

function toggleAgentNotifications(): void {
  updateSettings({ agentNotifications: !settings.value.agentNotifications });
}

function toggleDesktopAgents(): void {
  updateSettings({ showDesktopAgents: !settings.value.showDesktopAgents });
}

export function NotificationsSection() {
  return (
    <>
      <ToggleRow
        label="Agent notifications"
        desc="Play a sound when a background agent finishes or needs you"
        checked={settings.value.agentNotifications}
        onToggle={toggleAgentNotifications}
      />
      {desktopAgentsHost.available && (
        <ToggleRow
          label="Desktop agent activity"
          desc="Show agent activity above the desktop taskbar"
          checked={settings.value.showDesktopAgents}
          onToggle={toggleDesktopAgents}
        />
      )}
    </>
  );
}
