import {
  Button,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  VStack,
  useState,
} from "scripting";
import { PageBackground } from "../components/PageBackground";
import {
  GlassDivider,
  GlassGroup,
  GlassNoteRow,
  GlassSectionHeader,
  glassRowBackground,
} from "../components/GlassList";
import {
  getResetNotificationPreferences,
  RESET_NOTIFICATION_LEAD_LABELS,
  RESET_NOTIFICATION_SCOPE_OPTIONS,
  type ResetNotificationScope,
} from "../services/reset-notification-prefs";
import {
  listPendingResetNotifications,
  syncResetNotifications,
  type PendingResetNotification,
  type PendingResetNotificationList,
} from "../services/reset-notifications";
import type { BackgroundThemeId } from "../services/settings";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 「MM-DD HH:mm」，跨天时也能一眼看出是哪天。 */
function absoluteTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 相对时间只给到「约」的粒度 —— 这些时刻本来就依赖 resetAt 的精度，
 * 装成精确到秒反而会让人觉得"怎么和实际差了几十秒"。
 */
function relativeText(seconds: number | null): string {
  if (seconds === null) return "触发时间未知";
  if (seconds <= 0) return "应已触发";
  if (seconds < 60) return "不到 1 分钟后";
  if (seconds < 3600) return `约 ${Math.round(seconds / 60)} 分钟后`;
  if (seconds < 86400) return `约 ${Math.round(seconds / 3600)} 小时后`;
  return `约 ${Math.round(seconds / 86400)} 天后`;
}

function scopeTitle(scope: ResetNotificationScope): string {
  return (
    RESET_NOTIFICATION_SCOPE_OPTIONS.find((option) => option.id === scope)
      ?.title || scope
  );
}

function PendingRow({ item }: { item: PendingResetNotification }) {
  return (
    <VStack
      alignment="leading"
      spacing={3}
      padding={{ vertical: true }}
      frame={{ minHeight: 44, maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack spacing={6}>
        <Text font={14} fontWeight="semibold" lineLimit={1} truncationMode="tail">
          {item.title || "（无标题）"}
        </Text>
        {item.isTest ? (
          <Text font={11} foregroundStyle="systemOrange">
            测试
          </Text>
        ) : null}
      </HStack>
      {item.body ? (
        <Text font={13} foregroundStyle="secondaryLabel" lineLimit={2}>
          {item.body}
        </Text>
      ) : null}
      <Text font={12} foregroundStyle="secondaryLabel">
        {item.fireAt
          ? `${relativeText(item.secondsFromNow)} · ${absoluteTime(item.fireAt)}`
          : relativeText(item.secondsFromNow)}
      </Text>
    </VStack>
  );
}

export function ResetNotificationPage(props: {
  backgroundTheme: BackgroundThemeId;
}) {
  const [list, setList] = useState<PendingResetNotificationList>({
    ok: true,
    error: null,
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const preferences = getResetNotificationPreferences();

  async function reload() {
    setLoading(true);
    setList(await listPendingResetNotifications());
    setLoading(false);
  }

  /**
   * 手动重排一次。
   *
   * 这一步同时是诊断手段：如果重排后列表仍然为空，说明问题出在排期之前
   * （开关没开、没有可用的重置时间、或触发器不可用）；如果列表有内容却收不到，
   * 问题就在投递侧（系统通知权限、专注模式）。返回结果直接显示出来，不用去翻运行记录。
   */
  async function resync() {
    setBusy(true);
    const result = await syncResetNotifications();
    setSyncNote(
      result.disabled
        ? "提醒开关处于关闭状态，已清空全部排期。请回到上一页打开「冷却结束提醒」。"
        : result.error
          ? `排期失败：${result.error}`
          : `已重新排期 ${result.scheduled} 条。`,
    );
    await reload();
    setBusy(false);
  }

  const enabled = preferences.enabled;

  return (
    <List
      onAppear={() => {
        void reload();
      }}
      navigationTitle="已排期提醒"
      navigationBarTitleDisplayMode="inline"
      scrollContentBackground="hidden"
      listStyle="plain"
      listRowSeparator="hidden"
      listRowSpacing={12}
      listSectionSpacing={12}
      contentMargins={{
        edges: "horizontal",
        insets: 16,
        placement: "scrollContent",
      }}
      background={<PageBackground theme={props.backgroundTheme} />}
    >
      <Section
        header={<GlassSectionHeader title="当前设置" />}
        listRowBackground={glassRowBackground}
      >
        <GlassGroup>
          <HStack
            padding={{ vertical: true }}
            frame={{ minHeight: 44, maxWidth: "infinity" }}
          >
            <Text>冷却结束提醒</Text>
            <Spacer />
            <Text foregroundStyle={enabled ? "systemGreen" : "systemRed"}>
              {enabled ? "已开启" : "已关闭"}
            </Text>
          </HStack>
          <GlassDivider />
          <HStack
            padding={{ vertical: true }}
            frame={{ minHeight: 44, maxWidth: "infinity" }}
          >
            <Text>提醒范围</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">
              {scopeTitle(preferences.scope)}
            </Text>
          </HStack>
          <GlassDivider />
          <HStack
            padding={{ vertical: true }}
            frame={{ minHeight: 44, maxWidth: "infinity" }}
          >
            <Text>提醒时机</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">
              {RESET_NOTIFICATION_LEAD_LABELS[preferences.leadMinutes] ||
                "到点提醒"}
            </Text>
          </HStack>
          {!enabled ? (
            <>
              <GlassDivider />
              <GlassNoteRow text="提醒处于关闭状态，不会排期任何通知。请回到上一页打开「冷却结束提醒」开关。" />
            </>
          ) : null}
        </GlassGroup>
      </Section>

      <Section
        header={
          <GlassSectionHeader
            title={
              list.ok
                ? `待发送提醒（${list.items.length} 条）`
                : "待发送提醒（读取失败）"
            }
          />
        }
        listRowBackground={glassRowBackground}
      >
        <GlassGroup>
          {!list.ok ? (
            <GlassNoteRow
              text={`无法读取已排期的提醒。原始错误：\n${list.error || "未知原因"}`}
            />
          ) : loading ? (
            <Text
              foregroundStyle="secondaryLabel"
              padding={{ vertical: true }}
              frame={{ minHeight: 44, maxWidth: "infinity" }}
            >
              正在读取…
            </Text>
          ) : list.items.length === 0 ? (
            <GlassNoteRow
              text={
                "当前没有任何已排期的提醒。\n\n可能的原因：提醒开关未打开；所有额度窗口都没有可用的重置时间；或者距离重置已不足 30 秒（这种情况会直接跳过，避免排完立刻送达）。点下方「立即重排」可以看到具体结果。"
              }
            />
          ) : (
            list.items.map((item, index) => (
              <VStack
                key={item.identifier || `${item.title}-${index}`}
                spacing={0}
                frame={{ maxWidth: "infinity" }}
              >
                <PendingRow item={item} />
                {index < list.items.length - 1 ? <GlassDivider /> : null}
              </VStack>
            ))
          )}
        </GlassGroup>
      </Section>

      <Section
        listRowBackground={glassRowBackground}
        header={<GlassSectionHeader title="重排" />}
      >
        <GlassGroup>
          <Button
            buttonStyle="plain"
            frame={{ maxWidth: "infinity" }}
            action={() => {
              void resync();
            }}
          >
            <HStack
              padding={{ vertical: true }}
              frame={{ minHeight: 44, maxWidth: "infinity" }}
              contentShape="rect"
            >
              <Text>{busy ? "正在重排…" : "立即重排"}</Text>
              <Spacer />
              <Image
                systemName="arrow.clockwise"
                imageScale="medium"
                foregroundStyle="accentColor"
              />
            </HStack>
          </Button>
          {syncNote ? (
            <>
              <GlassDivider />
              <GlassNoteRow text={syncNote} />
            </>
          ) : null}
          <GlassDivider />
          <GlassNoteRow
            text={
              "• 这里显示的是本机已排期、尚未送达的通知，由 iOS 系统在到点时送达，与 App 是否运行无关。\n• 列表里的时间来自通知触发器，与倒计时显示的 resetAt 一致；提醒范围会影响哪些额度窗口会被排期。\n• 如果列表有内容但到点没收到，问题在投递侧：检查「设置 > 通知 > Scripting」是否允许通知、是否开了专注模式。"
            }
          />
        </GlassGroup>
      </Section>
    </List>
  );
}
