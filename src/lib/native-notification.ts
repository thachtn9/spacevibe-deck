import notificationSoundUrl from "../assets/noti.mp3";

/** Retained for the notifier's existing call contract; alerts play sound only. */
export interface AgentNotificationPayload {
  title: string;
  body?: string;
}

export interface NotificationAudio {
  currentTime: number;
  play(): Promise<void>;
}

export const AGENT_SOUND_COOLDOWN_MS = 2_000;

/** Reuse one player and collapse bursts so simultaneous agent alerts cannot stack. */
export function createAgentNotificationAdapter(
  createAudio: () => NotificationAudio = () => new Audio(notificationSoundUrl),
  now: () => number = Date.now,
): {
  send(payload: AgentNotificationPayload): Promise<void>;
} {
  let audio: NotificationAudio | undefined;
  let playPending = false;
  let lastPlayedAt = -Infinity;
  return {
    async send(_payload): Promise<void> {
      const startedAt = now();
      if (playPending || startedAt - lastPlayedAt < AGENT_SOUND_COOLDOWN_MS) return;
      playPending = true;
      try {
        audio ??= createAudio();
        audio.currentTime = 0;
        await audio.play();
        lastPlayedAt = startedAt;
      } catch {
        // Audio failure must not interrupt terminal output or open a popup.
      } finally {
        playPending = false;
      }
    },
  };
}

const adapter = createAgentNotificationAdapter();

export function sendAgentNotification(payload: AgentNotificationPayload): Promise<void> {
  return adapter.send(payload);
}
