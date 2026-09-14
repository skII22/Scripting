import { Notification, Script } from "scripting";
// 同时取模块命名空间：TimeIntervalNotificationTrigger 的暴露方式随 Scripting 版本
// 而变（见 resolveTimeIntervalTrigger 的注释），需要留一条回退路径。
import * as scriptingModule from "scripting";
import { isDemoMode } from "./demo";
import { writeLog } from "./logger";
import { listAuthorizedWidgetCards } from "./widget-cards";
import {
  planResetNotifications,
  type ResetNotificationAccount,
  type ResetNotificationPlanItem,
} from "./reset-notification-plan";
import { getResetNotificationPreferences } from "./reset-notification-prefs";

/** 所有冷却结束提醒共用一个分组，便于系统折叠展示。 */
const THREAD_IDENTIFIER = "ai-usage-reset";

/** 测试通知的送达延迟。 */
const TEST_DELAY_SECONDS = 5;

export type ResetNotificationSyncResult = {
  /** 本轮成功排期的通知数量 */
  scheduled: number;
  /** 是否因为未开启提醒而跳过（此时会清空既有排期） */
  disabled: boolean;
  /** 排期失败时的错误摘要 */
  error: string | null;
};

let inFlight: Promise<ResetNotificationSyncResult> | null = null;

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/** 从 Notification.schedule 的签名推导 trigger 字段类型，避免引用本地拿不到的类名。 */
type NotificationTrigger = NonNullable<
  Parameters<typeof Notification.schedule>[0]["trigger"]
>;

type TimeIntervalTriggerConstructor = new (options: {
  timeInterval: number;
  repeats: boolean;
}) => unknown;

/**
 * 取 TimeIntervalNotificationTrigger 的构造器。
 *
 * 这个类**不是 `scripting` 模块的导出成员，而是 bridge 暴露的全局类**。
 * 依据是官方图表文档 chart_scroll_target_behavior 里的一句话（中英对照）：
 *   「`matching` 接收 `DateComponents` 实例（bridge 暴露的全局类
 *    `new DateComponents({...})`，与 Notification trigger 等其他 API 共用）」
 *   "the global `new DateComponents({...})` exposed by the bridge
 *    — same class used for notifications/triggers"
 * 旁证：notification 文档全篇写 `new TimeIntervalNotificationTrigger({...})`
 * 都不带 import，而同文档里的 Notification / VStack 却明确 import 了。
 *
 * 曾经把它当模块成员导入，运行时拿到 undefined，报
 * `undefined is not a constructor`。所以这里按「全局 → 模块命名空间」依次探测：
 * 全局是文档确认的正路，模块命名空间只是防御性回退（万一某个版本改了暴露方式），
 * 两条都落空时给出明确错误，而不是抛一个看不懂的 TypeError。
 */
function resolveTimeIntervalTrigger(): {
  create: TimeIntervalTriggerConstructor | null;
  origin: string;
} {
  // 读属性本身也放在 try 里：全局作用域万一取不到（如被沙箱裁剪），
  // 这里只应降级成「找不到触发器」，而不是把整个排期流程炸掉。
  const scopes: readonly (readonly [string, () => unknown])[] = [
    [
      "全局",
      () =>
        (globalThis as unknown as Record<string, unknown>)
          .TimeIntervalNotificationTrigger,
    ],
    [
      "scripting 模块",
      () =>
        (scriptingModule as unknown as Record<string, unknown>)
          .TimeIntervalNotificationTrigger,
    ],
  ];
  for (const [origin, read] of scopes) {
    let value: unknown;
    try {
      value = read();
    } catch {
      continue;
    }
    if (typeof value === "function") {
      return { create: value as TimeIntervalTriggerConstructor, origin };
    }
  }
  return { create: null, origin: "" };
}

type DelayTriggerResult =
  | { ok: true; trigger: NotificationTrigger; origin: string }
  | { ok: false; error: string };

/** 构造「延迟 N 秒触发」的触发器；delaySeconds 必须大于 0。 */
function createDelayTrigger(delaySeconds: number): DelayTriggerResult {
  const resolved = resolveTimeIntervalTrigger();
  if (!resolved.create) {
    return {
      ok: false,
      error:
        "当前 Scripting 版本没有提供 TimeIntervalNotificationTrigger，无法安排定时通知（立即送达的通知不受影响）。",
    };
  }
  try {
    const trigger = new resolved.create({
      timeInterval: delaySeconds,
      repeats: false,
    });
    return {
      ok: true,
      trigger: trigger as NotificationTrigger,
      origin: resolved.origin,
    };
  } catch (error) {
    return { ok: false, error: `构造延迟触发器失败：${errorText(error)}` };
  }
}

/**
 * 清空本脚本已排期的通知。
 *
 * 目前 AI Usage 只有冷却结束提醒这一种本地通知，因此整批清理是安全且
 * 幂等的；如果以后新增其他类型的通知，需要改为按 userInfo.kind 精确清理
 * （排期时已写入 kind: "reset" 便于后续收窄范围）。
 */
export function cancelResetNotifications(): void {
  try {
    Notification.removeAllPendingsOfCurrentScript();
  } catch {
    /* 通知接口不可用时静默忽略，不能影响刷新与页面渲染 */
  }
}

function collectAccounts(): ResetNotificationAccount[] {
  // 只用本地缓存构建，不触发任何网络请求。
  return listAuthorizedWidgetCards().map((card) => ({
    provider: card.provider,
    accountId: card.accountId,
    title: card.title,
    windows: card.windows,
  }));
}

async function runSync(
  source: "app" | "intent",
): Promise<ResetNotificationSyncResult> {
  const preferences = getResetNotificationPreferences();
  if (!preferences.enabled || isDemoMode()) {
    cancelResetNotifications();
    return { scheduled: 0, disabled: true, error: null };
  }

  let plan: ResetNotificationPlanItem[];
  try {
    plan = planResetNotifications({
      accounts: collectAccounts(),
      scope: preferences.scope,
      leadMinutes: preferences.leadMinutes,
      nowMs: Date.now(),
    });
  } catch (error) {
    return { scheduled: 0, disabled: false, error: errorText(error) };
  }

  // 先清空旧排期再按最新重置时间重排，避免同一窗口出现重复提醒。
  cancelResetNotifications();

  let scheduled = 0;
  for (const item of plan) {
    const delay = createDelayTrigger(item.delaySeconds);
    if (!delay.ok) {
      writeLog({
        level: "warning",
        source,
        category: "settings",
        event: "notification.trigger_unavailable",
        message: `冷却结束提醒无法排期：${delay.error}`,
      });
      return { scheduled, disabled: false, error: delay.error };
    }
    try {
      await Notification.schedule({
        title: item.title,
        body: item.body,
        threadIdentifier: THREAD_IDENTIFIER,
        interruptionLevel: "active",
        userInfo: {
          kind: "reset",
          provider: item.provider,
          accountId: item.accountId,
          windowId: item.windowId,
        },
        tapAction: { type: "runScript", scriptName: Script.name },
        trigger: delay.trigger,
      });
      scheduled += 1;
    } catch (error) {
      const message = errorText(error);
      writeLog({
        level: "warning",
        source,
        category: "settings",
        event: "notification.schedule_failed",
        message: `冷却结束提醒排期失败：${message}`,
      });
      // 大概率是通知权限未开启，继续重试只会重复报错。
      return { scheduled, disabled: false, error: message };
    }
  }

  return { scheduled, disabled: false, error: null };
}

/**
 * 按最新重置时间重排冷却结束提醒。
 *
 * 未开启提醒时等价于清空排期。并发调用会被合并为一次，
 * 任何失败都不会抛出，调用方可以直接 `void syncResetNotifications()`。
 */
export function syncResetNotifications(
  options: { source?: "app" | "intent" } = {},
): Promise<ResetNotificationSyncResult> {
  if (inFlight) return inFlight;
  const source = options.source ?? "app";
  const task = runSync(source).catch(
    (error): ResetNotificationSyncResult => ({
      scheduled: 0,
      disabled: false,
      error: errorText(error),
    }),
  );
  inFlight = task;
  void task.finally(() => {
    if (inFlight === task) inFlight = null;
  });
  return task;
}

export type ResetNotificationTestResult = {
  ok: boolean;
  /** 发生了什么 */
  message: string;
  /** 下一步该做什么；不需要时为 null */
  hint: string | null;
};

/** 通知权限在 iOS 上的两个入口，iOS 18 起按 App 归类。 */
const PERMISSION_PATH_HINT =
  "「设置 > 通知 > Scripting」允许通知；iOS 18 及以上是「设置 > App > Scripting > 通知」。";

/**
 * 发送测试通知，用「先极简、后完整」两段式定位失败原因。
 *
 * Scripting 的 Notification 文档里没有任何申请通知权限的接口，权限完全由
 * 宿主 App 向 iOS 申请。所以 schedule 抛错时必须区分两种情况：
 *   - 极简负载也被拒绝 → 宿主没拿到通知权限，或当前环境不允许通知
 *   - 极简成功、完整被拒绝 → 我们多传的某个字段不被支持
 * 这两种情况的处理方式完全不同，笼统归因为「没开权限」会把人带偏，
 * 因此这里先按官方示例发一条只有 title/body 的最简通知做探针。
 */
export async function sendResetNotificationTest(): Promise<ResetNotificationTestResult> {
  try {
    // 与官方 notification/index.tsx 示例一致：只给 title / body。
    // 不带 trigger、interruptionLevel、threadIdentifier、tapAction 等可选字段。
    await Notification.schedule({
      title: "AI Usage 测试通知",
      body: "这是一条最简通知。收到它说明通知通道正常。",
    });
  } catch (error) {
    const raw = errorText(error);
    writeLog({
      level: "warning",
      source: "app",
      category: "settings",
      event: "notification.test_failed",
      message: `最简通知被拒绝：${raw}`,
    });
    return {
      ok: false,
      message: `连最简通知都被拒绝。原始错误：\n${raw}`,
      hint: `这通常不是参数写法的问题，而是 Scripting 没拿到系统通知权限。请到${PERMISSION_PATH_HINT}如果在设置里找不到 Scripting 这一项，说明宿主 App 从未申请过通知权限，脚本侧无法代替它申请。`,
    };
  }

  // 第二步：真实提醒用的字段一个不少 —— threadIdentifier / interruptionLevel /
  // userInfo / tapAction，加上延迟触发器。与真实排期共用同一套构造逻辑。
  const delay = createDelayTrigger(TEST_DELAY_SECONDS);
  if (!delay.ok) {
    writeLog({
      level: "warning",
      source: "app",
      category: "settings",
      event: "notification.trigger_unavailable",
      message: `测试通知无法排期：${delay.error}`,
    });
    return {
      ok: false,
      message: `最简通知能立即送达，但${delay.error}`,
      hint: "这条与通知权限无关：能收到上一条通知说明权限是正常的。是当前 Scripting 版本没提供延迟触发器，所以「冷却结束提醒」暂时只能在 App 内看倒计时，请把这条反馈给我。",
    };
  }

  try {
    await Notification.schedule({
      title: "AI Usage 测试通知",
      body: "通知权限正常。冷却结束时，会在这里提醒你。",
      threadIdentifier: THREAD_IDENTIFIER,
      interruptionLevel: "active",
      userInfo: { kind: "reset", test: true },
      tapAction: { type: "runScript", scriptName: Script.name },
      trigger: delay.trigger,
    });
    writeLog({
      level: "info",
      source: "app",
      category: "settings",
      event: "notification.test_scheduled",
      message: `已排期一条测试通知（触发器来源：${delay.origin}）`,
    });
    return {
      ok: true,
      message: `最简通知已立即送达，正式测试通知约 ${TEST_DELAY_SECONDS} 秒后到达（共 2 条）。\n触发器来源：${delay.origin}。`,
      hint: null,
    };
  } catch (error) {
    const raw = errorText(error);
    writeLog({
      level: "warning",
      source: "app",
      category: "settings",
      event: "notification.test_failed",
      message: `完整通知被拒绝：${raw}`,
    });
    return {
      ok: false,
      message: `最简通知能送达，带触发器的通知被拒绝。触发器来源：${delay.origin}。原始错误：\n${raw}`,
      hint: "说明通知权限和参数写法都没问题，是延迟触发器本身被平台拒绝。把这条原始错误发出来，我据此换别的方式。",
    };
  }
}
