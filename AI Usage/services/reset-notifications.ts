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

/** 触发器构造器的探测结果。origin 用于把「从哪取到的」写进运行记录。 */
type ResolvedTrigger = {
  create: TimeIntervalTriggerConstructor | null;
  origin: string;
};

/**
 * 构造器缺失时的说明文案。
 *
 * 这段话会被复用三处（排期前置检查、排期循环、测试通知），必须一致：
 * 明确区分「定时通知不可用」和「通知权限/立即送达」，避免又把人往权限方向带。
 */
const TRIGGER_UNAVAILABLE_MESSAGE =
  "当前 Scripting 版本没有提供 TimeIntervalNotificationTrigger，无法安排定时通知（立即送达的通知不受影响）。";

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
function buildDelayTrigger(
  resolved: ResolvedTrigger,
  delaySeconds: number,
): DelayTriggerResult {
  if (!resolved.create) {
    return { ok: false, error: TRIGGER_UNAVAILABLE_MESSAGE };
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

function createDelayTrigger(delaySeconds: number): DelayTriggerResult {
  return buildDelayTrigger(resolveTimeIntervalTrigger(), delaySeconds);
}

/**
 * 清空本脚本已排期的通知（整批）。
 *
 * 两条路径会用它：
 * 1. 「提醒被关掉」—— 语义就是"不再需要任何排期"，整批清理安全且幂等；
 * 2. 重排时**读不到旧排期**（见 runSync）—— 无法精确清理，只能整批清空，
 *    且必须发生在排新之前。
 * 能读到旧排期时，重排走 revokePreviousSchedule 精确撤销，不动这里。
 * 如果以后新增其他类型的本地通知，需要改为按 userInfo.kind 精确清理
 * （排期时已写入 kind: "reset" 便于后续收窄范围）。
 */
export async function cancelResetNotifications(): Promise<void> {
  try {
    // await 刻意为之：官方文档同样没标注这个方法是同步还是异步，
    // 而「清空」必须严格发生在本轮排期之前 —— 不 await 的话，一旦它实际返回
    // Promise，清空就可能落到排期之后，把刚排好的又删掉（与 getAllPendings 同一类坑）。
    await Notification.removeAllPendingsOfCurrentScript();
  } catch {
    /* 通知接口不可用时静默忽略，不能影响刷新与页面渲染 */
  }
}

/**
 * 读取本脚本「待发送通知」的原始请求数组；读不到时返回 null。
 *
 * 返回 null 表示**读不到**（接口不存在 / 抛错 / 返回的不是数组）。
 * 调用方必须把 null 理解成「无法精确清理」，绝不能理解成「当前没有排期」。
 *
 * 用 `await` 取值是刻意的：官方文档「通知管理」表里只列了
 * `getAllPendingsOfCurrentScript()` 这个方法名，**没有标注它是同步还是异步**。
 * await 一个普通数组同样成立，所以同步/异步两种实现都能正确拿到结果。
 * 早期版本按同步处理，一旦实际返回 Promise，`Array.isArray(Promise)` 为 false，
 * 就会一路退化成 null，进而触发误删（见 revokePreviousSchedule 的注释）。
 */
async function readPendingRequests(): Promise<unknown[] | null> {
  const reader = (
    Notification as unknown as {
      getAllPendingsOfCurrentScript?: () =>
        | Promise<ReadonlyArray<unknown>>
        | ReadonlyArray<unknown>
        | null
        | undefined;
    }
  ).getAllPendingsOfCurrentScript;
  if (typeof reader !== "function") return null;

  let pendings: unknown;
  try {
    pendings = await reader();
  } catch {
    return null;
  }
  return Array.isArray(pendings) ? [...pendings] : null;
}

/** 取请求对象上的标识符：官方文档写 `identifier`，另试 `id`（成本极低，免掉一类静默失败）。 */
function requestIdentifier(request: unknown): string {
  if (!request || typeof request !== "object") return "";
  const value = (request as Record<string, unknown>).identifier ??
    (request as Record<string, unknown>).id;
  return typeof value === "string" ? value : "";
}

/**
 * 当前待发送通知的标识符列表，用于「先排新的、成功后再撤旧的」这一安全顺序。
 *
 * 返回 null 的含义是「**无法精确管理**」，有两种情况：
 * 1. 根本读不到待发送列表（接口不存在 / 抛错 / 返回的不是数组）；
 * 2. 列表读到了、里面也有条目，但任何一条的标识符字段都取不出来 ——
 *    这种情况**绝不能**当作「当前没有排期」返回空数组：空数组会让精确撤销
 *    变成空操作，每次重排都在旧排期之上再叠一批，随刷新不断重复，
 *    最终撞上 iOS 单 App 64 条上限、所有排期整体失败。
 */
async function readPendingIdentifiers(): Promise<string[] | null> {
  const requests = await readPendingRequests();
  if (requests === null) return null;
  const ids = requests.map(requestIdentifier).filter((id) => id.length > 0);
  if (ids.length === 0 && requests.length > 0) return null;
  return ids;
}

/**
 * 精确撤销上一轮排期。
 *
 * 只接受**真实的 id 列表**，刻意不接受 null —— 因为本函数是在新排期写入之后调用的，
 * 若在这里对 null 做 `removeAllPendingsOfCurrentScript()`，会把**刚刚排好的这一批**
 * 也一起删掉，结果是「每次重排都等于什么都没排」：用户永远收不到提醒，
 * 而且日志里只有一条成功的排期记录，没有任何报错，极难排查。
 *
 * 读不到旧排期的情况改在排期**之前**处理（见 runSync，用 cancelResetNotifications）。
 */
async function revokePreviousSchedule(previousIds: string[]): Promise<void> {
  if (previousIds.length === 0) return;
  try {
    // 同样 await：「立即重排」流程在重排完成后立刻重新读取列表，
    // 删除不落盘的话页面会短暂显示已撤销的旧条目。
    await Notification.removePendings(previousIds);
  } catch {
    /* 同 cancelResetNotifications：失败也不能影响刷新与页面渲染 */
  }
}

/**
 * 回滚本轮已写入的部分排期，把系统恢复到「本轮开始前」的精确状态。
 *
 * 用在整批排期**中途失败**时：旧排期还在、本轮又排了一部分，两者叠加会让
 * 同一提醒到点响两遍。Notification.schedule 不返回标识符，只能用
 * 「当前待发送列表 − 本轮开始前列表」的差集找出本轮新增并精确删除。
 * 差集读不出来时放弃回滚（最多多几条重复，好过误删）。
 */
async function rollbackPartialSchedule(
  source: "app" | "intent",
  previousIds: readonly string[],
): Promise<void> {
  const currentIds = await readPendingIdentifiers();
  if (currentIds === null) {
    writeLog({
      level: "warning",
      source,
      category: "settings",
      event: "notification.rollback_unavailable",
      message:
        "部分排期失败后读不到待发送列表，无法回滚本轮已排的部分，可能出现重复提醒。",
    });
    return;
  }
  const previous = new Set(previousIds);
  const added = currentIds.filter((id) => !previous.has(id));
  if (added.length === 0) return;
  try {
    await Notification.removePendings(added);
  } catch {
    /* 回滚失败最多多几条重复提醒，不能让它抛出影响主流程 */
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
    await cancelResetNotifications();
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

  // 触发器是整批条目共用的前置条件，必须在动旧排期之前先确认可用。
  //
  // 否则在拿不到全局类的运行环境里（intent / widget 等非 App 环境都有可能）
  // 会「先清空、再失败」，把上一条本来有效的排期也一起抹掉 —— 那比这次没排上更糟：
  // 用户会连已经排好的提醒都收不到，而且没有任何提示。宁可什么都不动。
  const resolved = resolveTimeIntervalTrigger();
  if (!resolved.create) {
    writeLog({
      level: "warning",
      source,
      category: "settings",
      event: "notification.trigger_unavailable",
      message: `冷却结束提醒无法排期：${TRIGGER_UNAVAILABLE_MESSAGE}`,
    });
    return {
      scheduled: 0,
      disabled: false,
      error: TRIGGER_UNAVAILABLE_MESSAGE,
    };
  }

  // 先记下旧排期的标识符，等本轮排完再撤 —— 中途失败时旧排期仍在，不会两头落空。
  //
  // 注意顺序：读取在排新**之前**，撤销在新排期全部成功**之后**。
  const previousIds = await readPendingIdentifiers();
  if (previousIds === null) {
    // 读不到旧排期就无法精确清理，只能在排新之前整批清空。
    // 必须「先清后排」：放到排新之后清空会把本轮刚排的也一起删掉（曾经的 bug，
    // 表现为所有冷却提醒彻底不响且无任何报错）。
    // 代价是清空与排完之间有极短空档，真被中断也只是这一轮没排上；
    // 反之若不清空，重复条目会随每次重排累积，最终撞上 iOS 的 64 条上限全部失败。
    writeLog({
      level: "warning",
      source,
      category: "settings",
      event: "notification.revoke_unavailable",
      message:
        "读不到上一轮排期（或读不到其标识符），本轮改为先清空再排期。若此提示反复出现，说明 getAllPendingsOfCurrentScript 在当前环境不可用。",
    });
    await cancelResetNotifications();
  }

  let scheduled = 0;
  let failure: string | null = null;
  for (const item of plan) {
    const delay = buildDelayTrigger(resolved, item.delaySeconds);
    if (!delay.ok) {
      writeLog({
        level: "warning",
        source,
        category: "settings",
        event: "notification.trigger_unavailable",
        message: `冷却结束提醒无法排期：${delay.error}`,
      });
      failure = delay.error;
      break;
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
      failure = message;
      break;
    }
  }

  if (failure !== null) {
    // 部分失败：回滚本轮已排的部分，恢复到本轮开始前的精确状态 ——
    // 否则它们会与旧排期叠加，同一提醒到点响两遍。
    // 「先清空再排期」路径（previousIds 为 null）不回滚：旧排期已经清掉了，
    // 留着部分新排期好过一条都没有。
    if (previousIds !== null && scheduled > 0) {
      await rollbackPartialSchedule(source, previousIds);
    }
    return { scheduled, disabled: false, error: failure };
  }

  // 只有整批都排成功（含「本轮无需排期」的空计划）才撤旧排期，保证不会出现
  // 「旧的被删了、新的没排上」的空档。previousIds 为 null 时清理已经在排期之前
  // 做完了，这里不能再动。
  if (previousIds !== null && scheduled === plan.length) {
    await revokePreviousSchedule(previousIds);
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

export type PendingResetNotification = {
  identifier: string;
  title: string;
  body: string;
  /** 预计触发时刻（ISO）；触发器读不出时间时为 null */
  fireAt: string | null;
  /** 距当前时刻的秒数；fireAt 为 null 时同为 null */
  secondsFromNow: number | null;
  /** 排期时写入的 userInfo.kind */
  kind: string | null;
  /** 是否为「发送测试通知」排下的那两条 */
  isTest: boolean;
};

export type PendingResetNotificationList = {
  ok: boolean;
  /** ok 为 false 时的原始错误或原因说明 */
  error: string | null;
  items: PendingResetNotification[];
};

/**
 * 读取当前脚本已排期、尚未送达的通知，供设置页的「已排期提醒」页展示。
 *
 * 这个入口存在的意义是**让排期可被验证**：此前设置页只能开关，
 * 排期到底有没有成功、什么时候会响，用户无从确认，出问题时只能翻运行记录。
 *
 * 与 readPendingIdentifiers 共用读取层，但这里还要把内容解析出来，
 * 所以 content / trigger / nextTriggerDate 逐层防御 —— 任何一层缺失或抛错
 * 只影响对应字段（降级为 null 或空串），不能让整页读取失败。
 */
export async function listPendingResetNotifications(): Promise<PendingResetNotificationList> {
  const reader = (
    Notification as unknown as {
      getAllPendingsOfCurrentScript?: unknown;
    }
  ).getAllPendingsOfCurrentScript;
  if (typeof reader !== "function") {
    return {
      ok: false,
      error:
        "当前 Scripting 版本没有提供 getAllPendingsOfCurrentScript()，无法读取已排期的提醒。",
      items: [],
    };
  }

  const requests = await readPendingRequests();
  if (requests === null) {
    return {
      ok: false,
      error:
        "调用 getAllPendingsOfCurrentScript() 失败或没有返回数组，无法读取已排期的提醒。",
      items: [],
    };
  }

  const now = Date.now();
  const items: PendingResetNotification[] = [];

  for (const request of requests) {
    if (!request || typeof request !== "object") continue;
    const record = request as Record<string, unknown>;
    const content =
      record.content && typeof record.content === "object"
        ? (record.content as Record<string, unknown>)
        : {};
    const userInfo =
      content.userInfo && typeof content.userInfo === "object"
        ? (content.userInfo as Record<string, unknown>)
        : {};

    // Number(Date) 就是毫秒时间戳；非 Date 时得到 NaN，正好表示"读不出时间"。
    let fireAt: string | null = null;
    const trigger = record.trigger as
      | { nextTriggerDate?: () => unknown }
      | null
      | undefined;
    if (trigger && typeof trigger.nextTriggerDate === "function") {
      try {
        const time = Number(trigger.nextTriggerDate());
        if (Number.isFinite(time)) fireAt = new Date(time).toISOString();
      } catch {
        /* 触发器读不出时间就只显示标题与正文，不影响整页渲染 */
      }
    }

    items.push({
      identifier: requestIdentifier(request),
      title: typeof content.title === "string" ? content.title : "",
      body: typeof content.body === "string" ? content.body : "",
      fireAt,
      secondsFromNow:
        fireAt === null
          ? null
          : Math.round((new Date(fireAt).getTime() - now) / 1000),
      kind: typeof userInfo.kind === "string" ? userInfo.kind : null,
      isTest: userInfo.test === true,
    });
  }

  items.sort((left, right) => {
    const a = left.secondsFromNow ?? Number.MAX_SAFE_INTEGER;
    const b = right.secondsFromNow ?? Number.MAX_SAFE_INTEGER;
    return a - b;
  });

  return { ok: true, error: null, items };
}
