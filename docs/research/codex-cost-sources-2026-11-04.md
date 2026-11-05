# Codex 官方用量与费用估算方案核对

初次核对：2026-11-04；诊断及实现：2026-11-05。目标：尽量用官方数据替代本机日志的月均单价外推，同时保留网站既有双账号历史与主账号新增用量。账号联调仅只读；最终实现接入网站现有每日同步与构建流程。

## 最终实施选择（2026-11-05）

在获知上述限制后，用户选择“按照社区平均的来算”，并要求解释为何历史采用不同方法。现已统一社区参考值 **$0.04/credit**：主账号归档截止日后的有效日样本按 `Profile 当日 token / analytics 当日已识别 Codex token × 当日已识别 Codex credits × 0.04` 换算；其他日期、此前双账号历史和未分配到日期的 lifetime token 全部采用 `剩余 token × 有效样本总 credits × 0.04 / 有效样本总 token`。样本限定为 Profile 已有正用量日期，不使用未来日期。每个 token 只估价一次，本地日志价格不再参与首页费用计算。

这里明确将主账号样本均价用于双账号历史，假设它可以代表早期平均消费强度；这是用户接受的平均估算，不是找回了历史 credits 或模型组合。保留的本地日志报告仅用于诊断。

这项选择接受了日均费用外推，并没有解决两条统计管线的差异或补出缺失的模型计数。提示文案保留参考价、日均外推、历史 fallback 和非实际账单的说明。采集已接入原有主账号 OAuth 流程，增量重读最近三天，失败保留旧样本；复用现有每日任务，没有额外创建自动化。下文保留此前诊断阶段的结论与停止实施记录。

## 2026-11-05：模型明细卡点已确认

用户确认桌面 App 的模型看板单位是 **百分比（%）**。这与原始响应、当前安装客户端的实现一致。当前 OAuth 的套餐类型是 Pro；同一凭据可成功读取个人相对用量与 analytics 总计，因此本次卡点不是 OAuth 登录失败，也不是 GitHub Pages 部署导致的。

### 可复现证据

只读诊断脚本：`/private/tmp/diagnose_codex_model_usage.py`。直接检查服务器返回的模型行，先于本站任何归一化处理；脚本不输出凭据、账户标识、会话内容。

已执行 `python3 /private/tmp/diagnose_codex_model_usage.py`，查询 2026-11-01 至 2026-11-03，得到：

```text
balanceUnit: credit
dayCount: 3
modelRows: 11
modelFields: credits, model, threads, turns, users
modelRowsWithTokenParts: 0
modelRowsWithNonzeroCredits: 0
FAIL: model token parts missing
```

这里的 FAIL 是“能否按模型原始 token 计价”这一检查失败，不是 HTTP 请求失败。

对照验证：

- 增加客户端使用的 `x-openai-codex-usage-categories: 1` 后，模型字段和模型数不变，token 总计不变；credits 仅有约 `2e-12` 的浮点差异。不是漏了该请求头。
- 改为 `start_date=end_date=2026-11-02`，成功返回这一天的 4 条模型记录，仍没有 token 字段。当前实测日期上界包含当天，之前以“排他上界”解释缺失不成立。
- 重新检查个人 `daily-token-usage-breakdown` 的完整字段路径：`units=percent`，有 model/speed/credits，以及 model/surface/thread_source/turn_trigger 的相对归属值；没有任何输入、缓存输入、输出 token 字段。此前的归一化没有漏掉隐藏的模型 token。
- `credit-usage-events` 成功返回 11 条已购 credits 消费记录，包含日期、消费量和使用端，没有模型 token。不能用已购 credits 的消费记录代表订阅内全部用量。
- 没有继续尝试绕过此前返回 403 的线程费用或美元估值接口。

本地客户端版本 `26.1029.61003`（build `24614`）。检查的是安装包静态代码，不读取或操控 App UI：

| 安装包中的静态资源 | 验证结果 |
| --- | --- |
| `webview/assets/async/61039.28e4fa29ed.js` | 个人模型图直接读取相对用量接口及其 `units`；真正的模型 token history 查询明确排除 `scope=consumer`。 |
| 同一资源的 `daily-workspace-usage-counts` 调用 | 官方客户端将 `models[].turns` 用于按模型的轮数统计，没有用这些行计算模型 token 费用。 |
| `webview/assets/async/556836.477c5b4f1b.js` | 个人图按 relative usage 展示；输入/缓存/输出 token 图的文案明确指向 Business / workspace；使用历史的说明包含 Work、Codex 和其他 agentic tasks。 |

因此，可以确认当前个人看板的模型分布可读，但不能把其中的百分比当作 token 份额。输入、缓存、输出、模型和速度的权重不同，缺少原始计数时不能唯一还原它们。这个结论针对本次账号和已验证接口，不声称所有套餐、导出或未来接口都没有模型明细。

官方文档另明确：用于自动化的 [Analytics API](https://learn.chatgpt.com/docs/enterprise/analytics-api) 属于 ChatGPT workspace，并要求相应 workspace Admin key 和权限。它不是当前 Pro OAuth 或网站已有 OpenAI API Admin key 的同一种授权。不能把升级权限或更换密钥当作已验证的修复。

### 总 token 差异仍有独立边界

2026-10-25 至 2026-11-02，同一主账号的 Profile 为 `1,235,578,221` token，analytics totals 为 `1,108,158,578`。analytics 可识别 Work 为 `1,528,968` token；去掉 Work 后，Profile 与其余 client 合计仍差 `129,508,070`。因此 Work 混入不足以解释差额。

已经排除本站解析丢字段、上述请求头和简单日期上界错误，但没有服务器端证据确定 Profile 与 analytics 两条统计管线的所有差异来源。不要再把一个接口的费用除以 token，再放大到另一个接口的总数来掩盖这个未解决的问题。

### 可行解决路径与验收条件

1. **模型展示**：直接同步个人官方看板的模型及相对用量，保留单位。若只展示 Codex，使用已返回的 model/surface 联合 attribution 做范围过滤；不能把包含 Work 的模型总份额直接改名为 Codex。该数据适合回答“用了哪些模型、相对用量怎样”，不用于反推模型 token。
2. **按模型计价**：从实际使用记录提取模型、输入、缓存、输出、速度和时间，逐条计算 API 等价费用，再汇总。模型别名无法确定、速度不明或价格缺失的记录必须保持未分类，不能静默套默认模型或月均单价。现有 [官方 token rate card](https://learn.chatgpt.com/docs/pricing#token-rates) 也区分模型、token 类型与速度；订阅额度和购买 credits 的倍率不应混用。
3. **真实明细来源验证**：本次重新运行 `ccusage codex daily --json --offline --no-cost --timezone UTC`，只取 token，不读取它的美元结果。2025-12-29 至 2026-11-05 返回 155 个活跃日、15 个模型分组、`10,500,799,920` token，输入/缓存/输出合计检查通过。工具读取普通、压缩和归档日志并处理重复记录，但模型分组仍有 fallback 标记；不能把所有分组都宣称为已确认的实际后端模型。[ccusage 原始文档](https://github.com/ccusage/ccusage/blob/main/docs/guide/codex/index.md)明确说明别名、继承、压缩与缺失元数据的边界。
4. **历史范围**：本地日志总数尚未与网站 `20,921,100,198` Codex token、两个账号的归档逐项对齐；两者不能简单相除称“覆盖率”。先核对账号、时间、继承/重放去重与数据缺口。保留 2026-10-24 前双账号历史、之后主账号的既有范围，不重启次账号新增同步。
5. **后续增量**：在产生实际日志的设备上持续导出脱敏模型计数，按账号、来源和事件去重后保存增量；GitHub Actions 读取聚合快照。仅在 GitHub Actions 中保存 OAuth 不会使本机日志自动出现在 runner。此处是待实现设计，未创建自动化或发送数据。
6. **完整费用的门槛**：确认对应统计范围的模型明细都已获得后，才能把逐项计价总和标为全范围 Estimated cost。无法恢复的历史标为未覆盖，不能将本地约一半数量的费用按比例补成全部费用。已经停止“官方每日 credits 单位费用 × Profile token”的接入草稿；本轮没有修改网站费用公式。

目前确认的解决方向是“补齐并校验真实明细”，不是再选择一种平均价。以下 11 月 4 日的内容保留为调查记录；涉及用参考 credits 价格补齐全部历史的建议以上述边界为准。

## 结论

找到了此前未查询的有效接口：`GET /backend-api/wham/analytics/daily-workspace-usage-counts`。开源项目用它取得每日绝对 token 组成和 credits；本次使用现有 OAuth 的联调也成功返回这些字段。它不同于已返回 400 的 workspace 模型明细接口。因此，“个人账号只有百分比，无法读绝对消费值”的结论过强，应修正。

但完整的 **每模型原始 token**、**历史双账号完整美元费用**仍未验证可得。新的官方每日 token 数与现有 Profile 日桶并不完全一致，模型行也可能没有 token 或为空，必须先对齐账户、日期边界和统计范围。

## 主项目源码核对

| 项目 | 真实数据来源与用途 | 可借鉴部分与边界 |
| --- | --- | --- |
| [How Much I Get From Codex](https://github.com/bigbobro/how-much-i-get-from-codex/blob/main/how-much-i-get-from-codex.user.js#L1037-L1071) | 并行读取 analytics 每日计数、可选 workspace 模型明细、个人相对用量。每日计数请求带 `workspace_user=true`，结束日期为排他上界。 | 找到了本次有效的新接口。不能因为 workspace 模型接口不可用，就把其他 analytics 绝对值接口也视为不可用。 |
| [同项目计算代码](https://github.com/bigbobro/how-much-i-get-from-codex/blob/main/how-much-i-get-from-codex.user.js#L1184-L1235) | 优先采用每日 reported credits；没有模型 token 明细时，按个人看板份额分摊每日 credits，代码还按同一份额分摊总 token。 | 分摊后的模型 token **属于推算**，不是官方原始明细，不应照搬成精确模型统计。其 `on_demand_credits` 合并规则也是项目自己的兼容逻辑，应独立核对。 |
| [Codex Meter 数据边界](https://github.com/Wangnov/codex-meter#数据来源与范围)、[请求代码](https://github.com/Wangnov/codex-meter/blob/main/codex-meter-extension/application/report-service.js#L85-L110) | 同样读取 analytics 日计数。文档说明 `totals`、`clients` 可含绝对 token/credits；`models` 不含 token，部分账号的模型 credits 为零。 | 与前述方案独立印证。按组成/使用端展示 token；仅在有效模型 credits 存在时展示模型消费分组，缺失不当零。 |
| [CodexBar](https://github.com/steipete/CodexBar/blob/main/docs/codex.md#cost-usage-local-log-scan) | OAuth/CLI 获取远端额度；web extras 增补用量分布、credit 历史。token 费用另从本机日志扫描。 | 多账号/多个 Codex home 可分开管理，支持本机历史缓存；没有通用的 dots/cloud 历史导入器。远端额度覆盖更广，不能凭额度百分比补出丢失 token 类别。 |
| [Codexometer](https://github.com/merefield/codexometer#usage) | Profile 的每日总 token、个人相对用量、历史额度窗口分别展示；本机 API 等价费用采用日志。 | 不把不同计量混在一起。其相对用量接口请求 30 天只是客户端选择，不证明后端最大历史窗口；日总 token 无法还原历史输入/缓存/输出结构。 |
| [Codex-Usage 源码](https://github.com/MacSteini/Codex-Usage/blob/main/codex_usage.py) | 分开读取 SQLite/JSONL 本机统计、在线 usage/profile，以及独立 OpenAI Admin API 用量和成本。 | 可辅助找本机遗漏；本机 `tokens_used` 与服务器计费统计不能假定相等。没有发现它提供个人账号完整云端每模型美元明细的证据。 |

以上是项目主分支的文档及源码核对，不把项目作者的经验当作 OpenAI 保证。它们使用的 `/backend-api/wham` 路由属于客户端内部接口，存在账号与后端版本差异。

## 本次联调证据

沿用本机已有 OAuth，未更改权限、未重新登录、未输出凭据或账户标识：

1. `daily-token-usage-breakdown`：成功读取 2026-10-05 至 2026-11-04 的 31 个日桶。`units=percent`；模型/速度行名为 `credits` 的数值实际服从这个单位，不能直接解释为 token、真实 credits 或美元。
2. `daily-workspace-user-token-usage-breakdown`：当前账号返回 HTTP 400。`thread_usage/query`：返回 HTTP 403。没有绕过这些访问限制。
3. **新发现的 `analytics/daily-workspace-usage-counts` 成功**。`totals` 包含 `credits`、`uncached_text_input_tokens`、`cached_text_input_tokens`、`text_output_tokens`、`text_total_tokens`；已观察的 `models` 只有模型名、credits、users、threads、turns，缺少 token 字段，部分日期为空。
4. `start_date=2026-10-05`、`end_date=2026-11-04` 返回 30 个日桶（10 月 5 日至 11 月 3 日）。`balance_unit=credit`，这段时间合计 154,754.170746 credits、2,820,781,947 token。这是已取得的绝对消费统计，不依赖本机日志平均单价。**日期边界仍须核对**：社区实现按排他上界请求，但另一笔 `start_date=2026-11-01`、`end_date=2026-11-03` 的实测返回了 11 月 1、2、3 日。不能仅因当天没有返回数据就断定上界排他；采集应按返回日期过滤、去重，并在接入前复核历史相邻窗口。
5. 请求 `start_date=2025-12-29`、`end_date=2026-11-04`，实际返回 117 条日记录，首条日期为 2026-07-05，第一条非零记录为 2026-08-05，末条为 2026-11-03；83 个非零日，合计约 293,052.946332 credits、5,634,938,399 token。**这只是当前账号的实测返回范围，不能推出固定 90 天保留规则，也不能把更早缺失数据视为零。**
6. 全历史响应中已返回的 `models[].credits` 全为零，`models` 没有 token，故当前账号尚不能用它计算模型费用。`clients` 同时包括 Codex CLI/Desktop/Exec 与 Work Desktop/Mobile/Web，必须先核对网站是否应纳入 Work，避免把来源名称相近当作范围相同。

示例：2026-11-01 返回 40,312,534 token、1,478.4417605 credits；2026-11-02 返回 208,362,530 token、8,565.652021 credits。网站现有 Profile 相应日期为 43,909,695 和 251,898,018 token，不能直接认定两者范围相同。时区、后端延迟/修订、使用端范围等都是待核对因素，尚无证据确定哪一个解释了差额。

该证据仅覆盖当前本机账号的读取结果；不能据此宣称另一个已退役账号的历史也已恢复。

## 从 credits 到美元

[How Much I Get From Codex 的说明](https://github.com/bigbobro/how-much-i-get-from-codex#dollars)采用可配置的 `1 credit = $0.04`。作者明确这是显示假设，不是所有套餐通用的官方换算。因此不能无条件将该常数用于本站历史。

桌面客户端另有 `POST /backend-api/wham/usage/credits/estimate`。本次用 `{credits: 100}` 只读验证，当前账号返回 HTTP 403，已停止尝试。因此目前已有官方绝对 credits，但没有通过此接口取得官方美元估值。美元显示仍需披露参考换算价，不能称官方美元账单。

相对份额本身没有绝对金额分母。项目中“每日 credits ÷ 相对份额”是**已有绝对 credits 后**进行的额度估值，并不能仅凭百分比创造缺失的金额。

## 对本站的建议

- 下一步以新的每日绝对统计接口为主，验证日期、使用端和已保存 Profile 的对应关系。保存原始单位和来源，不改写现有 token 归档。
- 当前最可靠的直接展示是“官方报告的 credits”，而不是声称完整模型美元明细。若首页继续需要一个美元数字，应明确美元换算参考价，并将未覆盖的早期/另一账号历史继续标记为估算。不能把本次 5.63B token 的费用直接当作现有约 20.92B Codex token 的全部费用。
- 使用官方 credits 及其参考美元估值时，只计入相同账号、相同时间段的用量；剩余历史单独标为推算，不能把两种来源对同一用量重复相加。官方美元估值接口在本次验证中不可用。
- 如果只有模型 credits，没有模型 token，就展示模型消费分布；不要把按消费份额分摊的 token 标为官方 token。
- 保持二账号边界：截止日期前归档包含两账号，之后只新增主账号。补齐另一账号需要它自己的有效授权历史数据或已保存日志，不能从主账号合计猜出。
- 保留本机日志作为核对和缺失数据的后备。多设备/多 home/归档文件去重可提高覆盖，但无法保证重建已删除、未同步的全部历史。
- [ccusage 的 Codex 文档](https://github.com/ccusage/ccusage/blob/main/docs/guide/codex/index.md)支持逗号分隔的多个 `CODEX_HOME`，读取 `sessions`、`archived_sessions` 及 `.jsonl.zst`，并处理继承前缀和 compaction 的重复计数。适合补齐其他机器或登录目录保留的记录；它仍是日志与公布价格算出的 API 等价估值。
- 建立长期增量账本是本站可以落地的改进（实现建议，不是上游保证）：按账号、UTC 日期、来源、单位保存脱敏绝对统计；每日重读最近几天以接纳迟报/修订并替换原日桶，旧历史保留。OAuth 由现有 Actions 登录续期机制管理，模型明细/费用查询失败只保留旧快照，不阻断其他部署。

本报告不将额度、credits、实际账单金额、API 等价估值混称为“花费”。最终首页可以继续保持单个简洁数字，但其提示与采集数据必须保留可审查的统计口径。
