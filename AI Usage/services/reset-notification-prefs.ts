import type { StorageWriteResult } from "./settings";

/**
 * 冷却结束提醒的提醒范围。
 *
 * - nearest：每个账号只提醒最近一次重置（最安静，一个账号同一时间只有一条待送达）
 * - all：每个额度窗口各提醒一次（5 小时与每周额度都会提醒）
 * - constrained：只提醒剩余额度告急的窗口
 */
export type ResetNotificationScope = "nearest" | "all" | "constrained";

export type ResetNotificationPreferences = {
  enabled: boolean;
  scope: ResetNotificationScope;
  /** 提前提醒的分钟数，0 表示到点提醒 */
  leadMinutes: number;
};

const STORAGE_KEY = "ai_usage_reset_notification_prefs_v1";

export const RESET_NOTIFICATION_SCOPE_OPTIONS: ReadonlyArray<{
  id: ResetNotificationScope;
  title: string;
}> = [
  { id: "nearest", title: "每个账号最近一次" },
  { id: "all", title: "全部额度窗口" },
  { id: "constrained", title: "仅告急窗口" },
];

export const RESET_NOTIFICATION_LEAD_OPTIONS = [0, 5, 15] as const;

export const RESET_NOTIFICATION_LEAD_LABELS: Record<number, string> = {
  0: "到点提醒",
  5: "提前 5 分钟",
  15: "提前 15 分钟",
};

export const DEFAULT_RESET_NOTIFICATION_PREFERENCES: ResetNotificationPreferences =
  {
    enabled: false,
    scope: "nearest",
    leadMinutes: 0,
  };

function normalizeScope(value: unknown): ResetNotificationScope {
  if (value === "nearest" || value === "all" || value === "constrained")
    return value;
  return DEFAULT_RESET_NOTIFICATION_PREFERENCES.scope;
}

function normalizeLeadMinutes(value: unknown): number {
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(minutes)) {
    return DEFAULT_RESET_NOTIFICATION_PREFERENCES.leadMinutes;
  }
  return (RESET_NOTIFICATION_LEAD_OPTIONS as readonly number[]).includes(minutes)
    ? minutes
    : DEFAULT_RESET_NOTIFICATION_PREFERENCES.leadMinutes;
}

export function getResetNotificationPreferences(): ResetNotificationPreferences {
  try {
    const value =
      Storage.get<Partial<ResetNotificationPreferences>>(STORAGE_KEY);
    if (!value || typeof value !== "object") {
      return { ...DEFAULT_RESET_NOTIFICATION_PREFERENCES };
    }
    return {
      enabled: value.enabled === true,
      scope: normalizeScope(value.scope),
      leadMinutes: normalizeLeadMinutes(value.leadMinutes),
    };
  } catch {
    return { ...DEFAULT_RESET_NOTIFICATION_PREFERENCES };
  }
}

export function setResetNotificationPreferences(
  patch: Partial<ResetNotificationPreferences>,
): StorageWriteResult<ResetNotificationPreferences> {
  const current = getResetNotificationPreferences();
  const next: ResetNotificationPreferences = {
    enabled: patch.enabled === undefined ? current.enabled : patch.enabled === true,
    scope:
      patch.scope === undefined ? current.scope : normalizeScope(patch.scope),
    leadMinutes:
      patch.leadMinutes === undefined
        ? current.leadMinutes
        : normalizeLeadMinutes(patch.leadMinutes),
  };
  try {
    if (!Storage.set(STORAGE_KEY, next)) return { ok: false, value: next };
    return { ok: true, value: next };
  } catch {
    return { ok: false, value: next };
  }
}
