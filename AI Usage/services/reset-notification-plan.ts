import { PROVIDER_META, type ProviderId, type UsageWindowView } from "../models";
import type { ResetNotificationScope } from "./reset-notification-prefs";

/** 距重置不足该秒数时不再排期，避免排期后立刻送达或直接错过。 */
export const RESET_NOTIFICATION_MIN_DELAY_SECONDS = 30;

/** iOS 单个 App 最多保留 64 条待处理通知，这里留出余量。 */
export const RESET_NOTIFICATION_MAX_SCHEDULED = 48;

/** 「额度告急」判定与用量配色统一：剩余不高于 15% 视为告急。 */
export const RESET_NOTIFICATION_CONSTRAINED_REMAINING_PERCENT = 15;

export type ResetNotificationAccount = {
  provider: ProviderId;
  accountId: string;
  /** 账号显示名（邮箱或名称） */
  title: string;
  windows: readonly UsageWindowView[];
};

export type ResetNotificationPlanItem = {
  key: string;
  provider: ProviderId;
  accountId: string;
  windowId: string;
  windowLabel: string;
  /** 通知送达的绝对时间（ISO） */
  fireAt: string;
  /** 相对排期时刻的延迟秒数 */
  delaySeconds: number;
  title: string;
  body: string;
};

type Candidate = {
  window: UsageWindowView;
  fireMs: number;
};

function providerTitle(provider: ProviderId): string {
  return PROVIDER_META[provider]?.title || provider;
}

function isConstrained(window: UsageWindowView): boolean {
  if (window.remainingPercent != null) {
    return (
      window.remainingPercent <=
      RESET_NOTIFICATION_CONSTRAINED_REMAINING_PERCENT
    );
  }
  if (window.usedPercent != null) {
    return (
      window.usedPercent >=
      100 - RESET_NOTIFICATION_CONSTRAINED_REMAINING_PERCENT
    );
  }
  return false;
}

function describe(
  provider: ProviderId,
  accountTitle: string,
  windowLabel: string,
  leadMinutes: number,
): { title: string; body: string } {
  const name = providerTitle(provider);
  if (leadMinutes > 0) {
    return {
      title: `${name} 冷却即将结束`,
      body: `${accountTitle}｜${windowLabel} 约 ${leadMinutes} 分钟后重置。`,
    };
  }
  return {
    title: `${name} 冷却结束`,
    body: `${accountTitle}｜${windowLabel} 已重置，可以继续使用。`,
  };
}

/**
 * 纯函数：根据各账号最新的额度窗口算出需要排期的本地通知。
 *
 * 只依赖入参，不读取 Storage、不访问网络，便于单独回归。
 */
export function planResetNotifications(input: {
  accounts: readonly ResetNotificationAccount[];
  scope: ResetNotificationScope;
  leadMinutes: number;
  nowMs: number;
  maxCount?: number;
}): ResetNotificationPlanItem[] {
  const leadMinutes =
    Number.isFinite(input.leadMinutes) && input.leadMinutes > 0
      ? Math.floor(input.leadMinutes)
      : 0;
  const leadMs = leadMinutes * 60_000;
  const minDelayMs = RESET_NOTIFICATION_MIN_DELAY_SECONDS * 1000;
  const maxCount = Math.max(
    0,
    input.maxCount ?? RESET_NOTIFICATION_MAX_SCHEDULED,
  );
  const items: ResetNotificationPlanItem[] = [];

  for (const account of input.accounts) {
    const candidates: Candidate[] = [];
    for (const window of account.windows || []) {
      if (!window || typeof window.id !== "string" || !window.resetAt) continue;
      const resetMs = new Date(window.resetAt).getTime();
      if (!Number.isFinite(resetMs)) continue;
      if (input.scope === "constrained" && !isConstrained(window)) continue;
      const fireMs = resetMs - leadMs;
      if (fireMs - input.nowMs < minDelayMs) continue;
      candidates.push({ window, fireMs });
    }

    candidates.sort((left, right) => left.fireMs - right.fireMs);
    const picked =
      input.scope === "nearest" ? candidates.slice(0, 1) : candidates;

    for (const candidate of picked) {
      const windowLabel = candidate.window.label || candidate.window.id;
      const text = describe(
        account.provider,
        account.title,
        windowLabel,
        leadMinutes,
      );
      items.push({
        key: `${account.provider}:${account.accountId}:${candidate.window.id}`,
        provider: account.provider,
        accountId: account.accountId,
        windowId: candidate.window.id,
        windowLabel,
        fireAt: new Date(candidate.fireMs).toISOString(),
        delaySeconds: Math.max(
          1,
          Math.round((candidate.fireMs - input.nowMs) / 1000),
        ),
        title: text.title,
        body: text.body,
      });
    }
  }

  // delaySeconds 与触发时刻在同一 nowMs 下同序，直接按它排序即可。
  return items
    .sort((left, right) => left.delaySeconds - right.delaySeconds)
    .slice(0, maxCount);
}
