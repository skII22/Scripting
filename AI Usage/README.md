# AI Usage

<table>
  <tr>
    <td align="center" width="25%"><img src="assets/ai-usage-preview-app-light.jpeg" alt="AI Usage 浅色应用预览" /></td>
    <td align="center" width="25%"><img src="assets/ai-usage-preview-widgets-light.jpeg" alt="AI Usage 浅色 Small 与 Medium 小组件" /></td>
    <td align="center" width="25%"><img src="assets/ai-usage-preview-layouts-light.jpeg" alt="AI Usage 浅色 Medium 布局" /></td>
    <td align="center" width="25%"><img src="assets/ai-usage-preview-dashboard-light.jpeg" alt="AI Usage 浅色多账号小组件" /></td>
  </tr>
  <tr>
    <td align="center" width="25%"><img src="assets/ai-usage-preview-app-dark.jpeg" alt="AI Usage 深色应用预览" /></td>
    <td align="center" width="25%"><img src="assets/ai-usage-preview-widgets-dark.jpeg" alt="AI Usage 深色 Small 与 Medium 小组件" /></td>
    <td align="center" width="25%"><img src="assets/ai-usage-preview-layouts-dark.jpeg" alt="AI Usage 深色 Medium 布局" /></td>
    <td align="center" width="25%"><img src="assets/ai-usage-preview-dashboard-dark.jpeg" alt="AI Usage 深色多账号小组件" /></td>
  </tr>
</table>

面向 [Scripting App](https://scriptingapp.github.io/) 的非官方多平台用量查看应用。在一个项目里管理 Codex、Grok、Claude、Antigravity、Cursor、Kimi Code、GitHub Copilot、Z.ai 与 MiniMax 的多账号用量、主屏幕小组件和自动化刷新。

当前版本：`1.7.6`

> 本项目不是 OpenAI、xAI、Anthropic、Google 或 Scripting App 官方产品，与上述平台无隶属或合作关系。

## 功能

- 统一管理 Codex、Grok、Claude、Antigravity、Cursor、Kimi Code、GitHub Copilot、Z.ai 与 MiniMax 多个账号
- 应用内用量总览支持按账号控制显示，并可在账号详情中选择需要展示的额度窗口
- Access Token、Refresh Token 和相关身份凭据保存在本机 Keychain
- Token 到期前自动刷新
- 主屏幕小组件支持普通单账号和多账号模式，覆盖 Small、Medium 与 Large 尺寸
- 普通小组件可在账号详情中选择要显示的额度窗口：Small 最多 2 项、Medium 最多 4 项
- 多账号小组件可集中选择账号和每账号最多 2 个额度窗口，并按尺寸展示 2、4 或 8 个账号
- 小组件主数值和进度条固定显示剩余额度，刷新与重置时间使用相对表述
- 统一绿 / 橙 / 红风险配色：剩余不高于 40% 显示橙色，不高于 15% 显示红色
- 网络失败或接口限流时回退最近一次成功缓存
- 冷却结束提醒：额度重置时发送本机 iOS 通知，可配置提醒范围与提前量，并可在「已排期提醒」中查看实际排期与手动重排
- 内置只读演示模式，可在未授权时预览界面和小组件
- 支持快捷指令与 App Intent，手动或定时刷新全部账号
- 运行记录不包含 Token、授权码、Cookie 或完整接口响应；账号仅显示本机已保存的邮箱或账号名

## 系统要求

- iPhone 或 iPad
- 已安装 Scripting App
- 具备对应平台用量查询资格的账号
- 需要联网完成 OAuth 和用量查询
- 不需要 Scripting Pro

## 安装

1. 下载本项目目录或发布的 `AI-Usage.scripting` 安装包。
2. 将 `AI Usage` 导入 Scripting App。
3. 在 Scripting 中运行 `AI Usage`，进入用量页。
4. 按下方步骤完成对应平台的 OAuth。
5. 在主屏幕添加 Scripting 小组件，并选择 `AI Usage`。

远程导入地址：

```text
https://raw.githubusercontent.com/skII22/Scripting/main/AI-Usage.scripting
```

请在 Scripting App 中用「导入远程脚本」的方式安装，并保持该地址不变：应用会记住导入时使用的地址，按安装包里 `remoteResource.autoUpdateInterval`（本项目为 86400 秒，即每天一次）自动检查新版本。直接把 `.scripting` 文件导入则不会自动更新，需要手动重新导入。

## OAuth 登录

在用量页点击右上角 `+` 选择平台后，应用会打开对应授权页。完成登录后，把回调内容复制回应用并提交。

### Codex

- 回调：`http://localhost:1455/auth/callback?...`
- 复制 Safari 地址栏中的完整回调地址

### Grok

- 回调：`http://127.0.0.1:56122/callback?...`
- 可复制完整回调地址，或页面显示的一次性代码

### Claude

- 回调页会显示一次性授权码，通常形如 `code#state`
- 复制整段授权码

### Antigravity

- 回调：`http://localhost:51121/oauth-callback?...`
- 复制 Safari 地址栏中的完整回调地址

### Cursor

- 在应用打开的授权页中完成登录
- 返回应用后直接提交完成授权，无需粘贴回调内容

### Kimi Code

- 使用设备码在浏览器完成登录和授权
- 返回应用后直接提交完成授权，无需粘贴回调内容

### GitHub Copilot

- 使用设备码在 GitHub 完成设备授权
- 返回应用后直接提交完成授权

### Z.ai

- 在 Z.ai 或智谱控制台创建并复制 API Key
- 将 API Key 粘贴回应用提交验证

### MiniMax

- 先选择国际站 `minimax.io` 或国内站 `minimaxi.com`
- 从对应站点复制 Subscription Key 并粘贴回应用

OAuth 临时状态有效期为 10 分钟。Authorization Code 通常只能交换一次；授权失败或超时后请重新开始。

> 回调 URL 和一次性授权码属于短期敏感凭据。不要截图、公开或发送给他人。

## 多账号与小组件参数

- 每个账号拥有独立的 Keychain 凭证和用量缓存
- 可以同时添加同一平台或多个平台的账号
- 小组件参数为空时，若只有一个已授权账号，会自动选择该账号
- 多账号时请填写对应参数，每个主屏幕小组件可以绑定不同账号
- 布局按账号独立保存；刷新频率对所有账号生效

绑定账号的方法：

1. 打开目标账号详情页，点击“复制组件参数”
2. 长按主屏幕小组件，选择“编辑小组件”
3. 将参数粘贴到“参数”

参数格式：

```text
provider:profileId
```

多账号小组件使用固定参数：

```text
dashboard
```

在设置页的“多账号小组件”中可以控制账号标识、进入账号配置、选择每个账号的额度窗口并预览不同尺寸。

## 应用内用量总览

- 设置页可以集中控制每个已连接账号是否显示在应用的“用量”页面
- 账号详情页可以独立选择该账号要显示的额度窗口，并至少保留一个窗口
- 这些设置只影响应用内用量总览，不影响普通单账号主屏幕小组件、授权或刷新

## 小组件显示

小组件不再提供“已用 / 剩余”切换。主数值和进度条长度都固定为剩余额度；颜色仍按已用比例判断风险。刷新时间和重置时间使用相对表述。

- 绿色：剩余高于 40%
- 橙色：剩余不高于 40%、高于 15%
- 红色：剩余不高于 15%

### Small

- 按账号所选窗口自适应：1 个窗口显示单额度详情，2 个窗口上下排列
- 单额度详情同时列出已用和剩余百分比，主数字与进度条仍表示剩余
- 超过 2 项时只显示所选顺序中的前 2 项

### Medium

- 按账号所选窗口自上而下排列，最多 4 项
- 1 个窗口时用大数字突出剩余额度；多个窗口时每项显示剩余百分比、进度条和相对重置时间

所选窗口缺失时，对应位置显示 `—`，不会改用其他额度。

## 小组件设置

在账号详情中勾选要显示的额度窗口；同一账号的 Small 与 Medium 共用这份选择。刷新频率对全部账号生效。

- Small 最多 2 项，Medium 最多 4 项
- 窗口按平台列表顺序显示，不按勾选先后
- 这些设置只影响普通单账号主屏幕小组件，不影响应用内用量总览

### 刷新频率

- 手动
- 5 分钟（默认）
- 15 分钟
- 30 分钟
- 60 分钟

该设置同时控制应用启动自动刷新与小组件自动联网的最短间隔；选择“手动”后，仅在下拉、点击刷新或运行快捷指令时联网。iOS WidgetKit 可能根据系统调度延后小组件重建，所选时间不是严格定时器。

## 冷却结束提醒

额度重置后希望第一时间知道时，可以在设置页开启本机通知提醒。

1. 打开设置页的“通知”
2. 打开“冷却结束提醒”
3. 按需选择提醒范围和提醒时机

- 提醒范围
  - `每个账号最近一次`（默认）：每个账号只提醒最近一次重置，最安静
  - `全部额度窗口`：5 小时与每周额度等每个窗口各发一条
  - `仅告急窗口`：只提醒剩余额度不高于 15% 的窗口，与红色风险配色一致
- 提醒时机：`到点提醒`（默认）、`提前 5 分钟`、`提前 15 分钟`

行为说明：

- 提醒在 App 启动、回到前台、应用内刷新完成以及快捷指令刷新完成后，按各账号最新的重置时间重新排期
- 重排采用「先排新的、整批成功后再撤旧的」：能读到上一轮排期时精确撤销，因此每个额度窗口只保留一条；读不到时改为在排期**之前**整批清空，避免重复条目随刷新次数累积并撞上系统上限；整批排期中途失败时，会回滚本轮已排的部分，让系统恢复到本轮开始前的状态，宁可少一轮也不重复响
- 点按通知会打开 AI Usage；通知完全在本机排期，不经过任何服务器
- “发送测试通知”会先发一条只有标题和正文的最简通知（立即送达），再发一条与真实提醒字段完全一致的正式通知（约 5 秒后送达）；后者失败时会标明触发器的查找来源，便于区分是权限问题还是 API 暴露方式的问题
- 未收到通知时，请到「设置 > 通知 > Scripting」允许通知；iOS 18 及以上是「设置 > App > Scripting > 通知」。如果两个位置都找不到 Scripting，说明宿主 App 从未向 iOS 申请过通知权限

系统限制：单个 App 最多保留 64 条待处理通知，本项目最多排期 48 条；距重置不足 30 秒的窗口不再排期。

### 查看已排期的提醒

设置页的「通知 > 已排期提醒」会列出本机当前已排期、尚未送达的通知，每条显示标题、正文与预计触发时间，并提供「立即重排」。页面顶部同时显示开关状态、提醒范围与提醒时机。

这个页面的用途是把排期变成**可验证**的。出现「到点没收到」时可以直接定位到哪一环：

- **列表为空** —— 问题在排期侧：提醒开关未打开、所有额度窗口都没有可用的重置时间，或距重置不足 30 秒被跳过。点「立即重排」会直接显示本轮结果（排了几条、或失败原因）
- **列表有内容但到点没收到** —— 问题在投递侧：系统通知权限被关闭，或被专注模式静默送达

延迟触发用的 `TimeIntervalNotificationTrigger` 是运行环境（bridge）暴露的**全局类**，不是 `scripting` 模块的导出成员 —— 官方文档的示例也始终不 import 它。因此代码按「全局 → 模块命名空间」探测后使用，找不到时给出可读错误而不是抛出 `undefined is not a constructor`。

### 长期不开 App 时如何续排

排期只在 App 运行或快捷指令刷新时更新，而一批排期是有限的。如果习惯只看小组件、长期不打开 App，可以加一条快捷指令自动化定期续排：

1. 快捷指令 → 自动化 → 新建 → 选「特定时间」，设一个时间点，重复方式选「每天」，并勾选「立即运行」（否则每次都要手动确认）
2. 添加操作「运行脚本」（Run Script，后台执行、无界面），目标脚本选本脚本
3. 想覆盖一天里的多个时段就多建几条 —— iOS 的时间自动化只支持每天 / 每周 / 每月，没有「每 N 小时」

这条自动化会在 App 上下文里跑完整刷新流程：既更新用量数据，也按最新的重置时间重排提醒。执行结果同样会写进运行记录，排期失败时以 `notification.` 开头记录警告，可据此排查。

## 数据来源

用量数据来自各平台官方客户端当前使用的认证和内部用量接口，不是面向第三方承诺长期稳定的公开 API。

- Codex：OpenAI OAuth 与 ChatGPT 内部用量接口
- Grok：xAI OAuth 与 Grok Build / CLI 订阅额度接口
- Claude：Anthropic OAuth 与 Claude Code 用量接口
- Antigravity：Google OAuth 与 Antigravity / Code Assist 用量接口
- Cursor：Cursor 账户授权与用量接口
- Kimi Code：Kimi Code 设备授权与额度接口
- GitHub Copilot：GitHub 设备授权与 Copilot 用量接口
- Z.ai：Z.ai / 智谱 API Key 与用量接口
- MiniMax：MiniMax Subscription Key 与 Token Plan 用量接口

服务端更新后，路径、字段或访问策略可能变化。

## 自动化刷新

小组件日常依赖系统时间线调度。如需更稳定地更新桌面用量，可通过快捷指令创建定时自动化：

1. 打开 iOS 快捷指令 → 自动化
2. 添加动作：Scripting → 运行意图脚本
3. 脚本选择 `AI Usage`
4. 关闭“运行前询问”

该动作会拉取全部已授权账号的最新用量，并请求刷新主屏幕小组件。也可以使用系统 App Intent 按平台或全量刷新。

## 隐私与安全

- OAuth Token 仅保存在当前设备的 Scripting Keychain
- 账号注册表、小组件设置和用量缓存仅保存在本机 Scripting Storage
- 项目不通过作者服务器转发登录或用量数据
- 冷却结束提醒仅由本机按本地缓存的用量窗口排期，通知内容只包含平台名、账号标签和额度窗口名
- 源代码和正常导出的安装包不包含你的账号、邮箱、Token 或用量缓存
- 运行记录保留请求状态、本机账号标签和必要错误摘要，不输出 Token、授权码、Cookie 或完整接口响应
- 删除账号时会同时删除该账号的本机凭证、用量缓存和独立布局设置
- 不要分享 OAuth 回调 URL、一次性授权码、Token、Keychain 导出或完整 App 容器备份
- Antigravity 使用 Google 已公开的官方桌面客户端 OAuth 凭据完成登录，不是作者个人云项目密钥；你的账号 Token 仍只保存在本机

## 已知限制

- 各平台内部用量接口可能随时变化
- OAuth 成功不代表所有账号都具有对应用量查询资格
- 账号实际拥有的额度窗口由服务端决定，缺失窗口显示 `—`
- WidgetKit 不保证严格按照所选分钟数刷新
- 冷却结束提醒由 iOS 本机调度，专注模式、低电量模式或系统策略可能延后或静默送达
- Scripting 没有提供申请通知权限的接口，通知权限只能由宿主 App 向 iOS 申请；脚本侧无法代替它弹框，只能检测失败并提示
- 单账号小组件未专门适配 Large；未知或不支持的尺寸按现有回退渲染
- Small 使用所选窗口顺序中的前 2 项
- 演示模式只用于预览界面，不会写入真实账号或发起授权请求

## 项目结构

```text
AI Usage/
├── assets/                   平台 Logo、水印与展示图
├── components/               共享 UI 与用量卡片
├── docs/                     当前架构说明与历史验收记录
├── pages/                    用量、设置、账号详情、日志页
├── providers/                Codex / Grok / Claude / Antigravity / Cursor / Kimi / Copilot / Z.ai / MiniMax 适配
├── services/                 刷新编排、配色、设置、演示与存储
├── tests/                    业务回归测试；tsc/esbuild/测试门禁由 Mac Build Worker 执行
├── widget/                   小组件分发、Loader 与平台布局
├── app_intents.tsx           系统 App Intent
├── index.tsx                 应用入口
├── intent.tsx                快捷指令刷新入口
├── widget.tsx                小组件入口
├── changelog.ts              版本更新日志
├── script.json               Scripting 项目元数据
├── LICENSE                   MIT License
└── README.md
```

## 免责声明

本项目仅用于查看本人账号的用量信息。请自行评估内部接口变更、账号策略和第三方脚本带来的风险，并遵守 OpenAI、xAI、Anthropic、Google 与 Scripting App 的服务条款。项目不保证接口永久可用，也不对用量数据延迟、解析差异、限流或服务端策略变化承担责任。
