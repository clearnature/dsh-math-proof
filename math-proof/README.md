# 数学证明模式（math-proof）— 人类入口

> DSH agent preset。给「律算合一 / Sovereign」离散数学库做形式化证明的长程工作模式。
> 本文件是**人**看的；模型看的是 `agent.cordis.yml` 里的 persona 与纪律段。

## 一、这是什么

一个 agent preset：把「依赖类型论展示群 + 先算后验证 + 长程台账 + 反刷分」的纪律
装进 DSH，用 6 个工具 + 9 个技能 + 一条常驻纪律段，支撑**可能连续数天**的证明工作。

| 件 | 内容 |
| --- | --- |
| `agent.cordis.yml` | 组合：persona（11.9k）+ 纪律段（8.7k）+ 6 个工具行 + 9 个技能索引 |
| `plugins/*.mjs` | 工具实现（零依赖，只 import `node:` 内建模块） |
| `skills/*/SKILL.md` | 按需加载的领域知识（正文 ≈52k 字符，不进常驻） |
| `oracle-kit/oracle_kit.py` | 先算后验证的共享 Python 库（GF(3)/T⁶/δ 基/CRT/manifest） |
| `tests/` | 14 套门禁，共 700+ 断言（`scripts/check-all.mjs` 一键跑 15 个入口） |
| `scripts/` | 运维：schema 自检、缓存/费用报告、状态目录维护、插件盘点 / **插件市场** |
| `docs/` | **架构地图 M1–M6**（功能架构 / 依赖图 / 数据流 / 状态管理 / 生命周期 / 证据链）|
| `CACHE.md` | 缓存前缀纪律（为什么「改插件 = 打穿缓存」） |
| `AUDIT.md` + `audit/rounds.md` | 结论与逐轮记录（含每次被否证的判断） |

## 一.5 对象层与知识图谱（AI + 人类双读）

| 件 | 用途 |
| --- | --- |
| `proof_dag kind:"object"` + `construction`/`carrier`/`operations`/`relations` | 把数学对象登记为**信息完整节点**（缺 `construction` 直接拒收） |
| `proof_dag action:"import" file:"examples/objects.json"` | 批量登记（幂等）；示例含 GF(3)/GF(9)/DC/T⁶/A₄ |
| `proof_dag action:"graph"` | 导出 `graph-<hash>.json`（机器，带 `$schema`）+ `graph-<hash>.md`（人类视图） |
| `schema/knowledge-graph.schema.json` | 图谱的**发布 schema**（消费者可校验） |
| `graph.gaps` | 缺构造 / 缺关系 / 未验证证据 / 悬空依赖 / **未登记关系目标** |

## 一.8 钩子（流程拦截）

`hooks/hooks.json`（Claude Code 方言，由 `dsh-hooks-claude-code` 桥加载）：

| 事件 | 脚本 | 行为 |
| --- | --- | --- |
| `SessionStart` | `session-start.mjs` | 注入**接手简报**（进度 / 评分 / 证据 / 对象完整度 / 可开工 / 待裁决）；空台账时给开工指引 |
| `PreToolUse`（`proof_dag`） | `gate-dag.mjs` | **拦截越过步骤**：标 `proven` 时若无回执、或依赖未 proven → **exit 2 + 理由**，工具不会执行 |
| `Stop` | `stop-reminder.mjs` | 收工提醒（未验证 / 断链 / 待裁决 → 提示写 `handoff`） |

回归：`node tests/hooks-check.mjs` → `HOOKS_OK 22/22`。

## 一.9 热重载（不新开会话改纪律）

| 档位 | 对象 | 是否需新会话 |
| --- | --- | --- |
| 🔥 热 | `impl/discipline.md`（纪律文本） | **不需要**——每次装配 prompt 重读（按 mtime） |
| 🔥 热 | `impl/ruleset.mjs`（判定规则：断链豁免/评分权重/postulate 口径/编译分诊） | **不需要**——工具每次调用带 `?v=<mtime>` 重新 import；输出带 `规则集 rN/hash` 戳 |
| 🟡 可热 | 工具执行逻辑（若迁到 `impl/`） | 改造后不需要，且**缓存不失效**（描述未变） |
| ❄️ 冷 | 工具描述/schema、`agent.cordis.yml`、persona | 需要新会话，且必然改缓存前缀 |

```bash
node scripts/reload.mjs   # 看当前状态与操作指引
```

**代价说清**：改纪律 = 改缓存前缀 → 下一轮前缀缓存失效（物理必然），但**会话、台账、见证、历史全保留**；
改工具逻辑（不动描述）= **缓存完全不失效**。

## 一.10 DSH 插件：三平面 provenance（谁在提供，谁只是被禁用）

```bash
node scripts/plugins.mjs              # 三平面盘点
node scripts/plugins.mjs --gaps       # 只看接管关系与能力缺口
node scripts/plugins.mjs --refresh-host   # 重跑 `dsh --profile web --dump-config`
```

**为什么必须分平面**：同一个包名在三处出现，含义完全相反——宿主组合里 `disabled: true` 表示
**宿主不提供、等某个 preset 提供**；我们 preset 里同名那一行才表示**我们在提供**。只按包名统计
（本 preset 早期版本的做法）会把 26 个「等 preset 接管」的行算成「宿主已挂」，得出**相反结论**。

| 平面 | 是什么 | 现状（实测） |
| --- | --- | --- |
| 宿主平面 | `base` + `web` 两个 bundle 的组合：注册表、持久化、沙箱、审批、token 计量、spill、检查点 | 145 行，去重后 **117 启用 / 25 禁用** |
| agent 平面 | 本 preset 的 `agent.cordis.yml` | **37 行**（外部包 24 个 / 25 条 spec / 本地插件 6 个） |
| 出厂预设 | `dsh-agent-presets/presets/{standard,cordis,minimal,ptc}` | 用来判断「宿主禁用了，本该谁提供」 |

**宿主启用、升级后自动恢复、正在加强我们的**（不需要我们做任何事）：
`repeat-tool-reminder`（同工具反复调用提醒，阈值 3/5/8）、`spill-local` + `spill-policy`
（大输出落盘，`maxInlineBytes: 50000`）、`token-meter`、`session-checkpoint-policy`、
`code-runtime-worker-thread`、`fs-observation-policy`（先读再改）、`agent-presets`（名册，
本 preset 就是被它挂的）、`sandbox-local` / `user-approval` / `bash-sandbox`（安全栈）。

**宿主故意禁用、由本 preset 接管的 22 行**（web 面注释原文：「the agent plane moves behind
agent presets」）：`tool-bash` / `tool-pwsh` / `tool-fs` / `tool-fs-search` / `tool-jobs` /
`tool-skill` / `skill-filesystem` / `agent-instructions` / `plan-mode` /
`compaction-basic` + `command-compact` + `compaction-tool-result-pruner` /
`tool-subagent`(+`/list-agents`) + `tool-subagent-control` + `workflow-worker-thread` +
`tool-workflow` + `tool-ralph` / `tool-goal` + `command-goal` / `tool-todo` / `tool-web`。
**它们不是「宿主已挂」，是我们自己挂的**——这是本轮改正的分类错误。

**我们写的 6 个本地插件**：`proof-dag` / `proof-graph` / `agda-engine` / `python-oracle` /
`prover-limits` / `proof-discipline`（+ `hooks/hooks.json` 三个钩子）。

**体检结论（可复跑）**：⚠ 双份挂载 **0**｜❗ 真缺口 **0**（宿主禁用且出厂 `standard` 提供的行，
我们全都接了）｜ℹ 对照：`tool-str-replace-editor` 出厂只有 `minimal` 提供，不是缺口。

**装了但没挂 / 待你决策**：`schedule`（客户端行 `ui-schedule` 与宿主 Schedule 服务出厂即关闭，
要开得过 overlay）、`mcp-client`、`session-reference`、`session-query-sqlite`
（行启用但 `openAt: never`，且模型侧工具包没装）。**不建议**：`tool-bash-persistent`、`skill-badge`
（base 自己就禁用）。

## 一.11 插件市场：可装未装的那一半

`scripts/plugins.mjs` 只看**已装**侧；**市场侧**（注册源里还有什么、版本线对不对）看
`scripts/market.mjs`：

```bash
node scripts/market.mjs              # 概览 + 与证明相关的市场候选
node scripts/market.mjs --search lsp # 按名字/描述在市场里搜
node scripts/market.mjs --missing    # 市场有、本地没装的全部包
node scripts/market.mjs --offline    # 用本地快照（不联网）
```

**DSH 的「市场」是什么（事实）**：插件就是 npm 包，市场 = 注册源（本机 `~/.npmrc` 的
`registry`，这里是 npmmirror）。装是 `dsh plugin --profile web add <包>@<版本>`（转发 pnpm 到
`~/.dsh/profiles/web`）；用是在 composition 里加一行——**工具/提示段进 preset，共享服务/持久化进宿主 patch**。

**实测结论（截至本轮）**：

| 事实 | 数字 |
| --- | --- |
| 注册源里的 `@deepseek-ai/dsh-*` | 272 |
| 本地已装 | 214 |
| 可装未装 | 58（其中与本机 `0.1.2-rc.1` 同版本线 **28**） |

**⚠ 版本线陷阱**：这些包的 npm `latest` dist-tag 常停在 `0.0.1-rc.1`，而本机 dsh 是
`0.1.2-rc.1`——**不带版本号 `add` 会装到错版本**。`market.mjs` 只推荐「注册源里存在本机同版本线」
的包，并把版本号写进命令。

**市场里真正与证明流程相关的，只有少数几个**，且每个都带前置条件：

| 包 | 结论 | 前置条件 |
| --- | --- | --- |
| `dsh-lsp` + `dsh-lsp-stdio` + `dsh-tool-lsp` | 待评估 | **本机 Agda 没有 LSP**（`agda --help` 只有 `--interaction-json`，无 `--lsp`，也未装 `als`）；要用得先装 `agda-language-server` |
| `dsh-tool-session-query` | 待评估 | 装包 **且** 宿主把 `dsh-session-query-sqlite` 从 `openAt: never` 改成 `first-search`；+5 工具定义 |
| `dsh-subagent-claude-code` / `-codex` | 待评估 | 需外部 CLI + 账号；用途是**对抗交叉验证** |
| `dsh-code-runtime-python` | 待评估 | 我们自己的 `proof_oracle` 已带**回执签名**，换通用缝等于降级证据链 |
| `dsh-tool-terminal` / `-present` / `llm-replay` / `-mock-server` | 不建议 | +6 工具定义 / 无同版本线 / 依赖 vitest 测试基建 |

> 一句话：**缺前置条件的包，装了也用不起来**——所以「市场里有」不等于「我们能用」。

数据管理：市场快照落在 `state/market/registry-<host>.json`（原子写，TTL 24h）；
联网失败时**降级用旧快照并明确标注陈旧**，绝不假装数据是新的。
回归：`node tests/market-check.mjs` → `MARKET_OK`（离线 fixture，不联网）。

## 一.12 开源发布（仓库名与布局）

**已发布：<https://github.com/clearnature/dsh-math-proof>**（public，MIT；CI `.github/workflows/gates.yml`
在 Node 20/22/24 上跑全部门禁）。

**仓库名 `dsh-math-proof`**——`dsh-` 前缀把它归进 dsh 生态（与官方 `@deepseek-ai/dsh-*` 同风格），
后半段说明它是什么，且与数学库仓库 `discrete-mathematics` 一眼分得开。备选：`dsh-math-proof-preset`
（更明确是 preset）、`dsh-agent-preset-math-proof`（完全对齐官方组件命名，但长）。

**布局必须比 preset 目录高一层**（dsh 的 `scanRoot` 只认「root 下、名字匹配 `[a-z0-9][a-z0-9-]*`
的子目录」，且子目录里必须有 `agent.cordis.yml`）：

```
<repo>/                      ← 这一层配进 roots
└── math-proof/              ← preset id（= 目录名）
    ├── agent.cordis.yml
    ├── preset.yml
    └── plugins/ skills/ hooks/ tests/ scripts/ ...
```

```bash
node scripts/publish.mjs --out ~/src/dsh-math-proof --dry-run   # 先看清单与体检
node scripts/publish.mjs --out ~/src/dsh-math-proof             # 生成仓库骨架
```

发布脚本做三件事：**排除 `state/`**（机器缓存不进公网）、**体检**（绝对路径 / 疑似密钥）、
**生成骨架**（`.gitignore` + MIT `LICENSE` + 根 `README.md` 带安装与依赖说明）。

**体检实测**：要发布 58 个文件 / 792 KB，排除 2 个 state 文件；疑似密钥 **0**；
绝对路径 **36 处 / 13 个文件**——它们是**语义**（persona 与技能里的「来源声明」指向作者本机的
数学 wiki、类型论文档、dype 源码），机械替换会把来源变成假话，所以脚本只报告、由人改。

**装法（写给用户）**：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: agent-presets
  config:
    roots:
      - path: ~/src/dsh-math-proof
        trust: user
```

许可证 **MIT**：与 Agda 证明库（`clearnature/discrete-mathematics`）和 dsh 本体同许可。

## 一.13 使用中发现的三个问题（已修，2026-09-10）

一轮真实长程作业（5 项交付 / 41 节点台账）暴露了三个**工具层**问题，不再是「再写一条纪律」能解决的：

| 问题（现场证据） | 根因 | 修法 |
| --- | --- | --- |
| 会话里 `check` 报 **85/100、断链 25 条**，磁盘新规则算出来是 **0 条**；会话内**无法自证** | 插件实例在挂载时固定，改磁盘不影响本进程；规则与实现混在一起，没有版本痕 | 判定规则抽到 `impl/ruleset.mjs`，**每次调用热读**；所有输出带 `规则集 rN/hash` 与插件本体 hash；新增 `proof_dag action:"doctor"` **自证**「本实例 vs 磁盘」 |
| `T6` 含 3 个 postulate（是 `--rewriting` 规则族，不是缺口）却被旧口径压成 `blocked`，还要人类裁决 | 门禁一刀切「0 postulate」 | 新增 `postulates:[{name,kind,reason}]`：`rewrite`/`unreachable`/`gap` 三分类，**工具按源码核对名字**；门禁看「0 **未声明**」；`gap` 不能 proven；豁免需一条人类裁决流水（§4.7） |
| 同一引理符号版 **3.4s** 过，写死 `12 ^ 729` 的版本 **346s 后 heap exhausted**（exit 251） | 「界」在证明项里被真的求值（鸽巢/`any?` 枚举） | `proof_compile` 新增**结果级分诊**（堆爆/被杀/超时**没有诊断行**，只有退出码）→ 直接给「符号化优先 / opaque 阻断 / 使用点实例化 / 小界探针」处方（§4.6） |

附带两条：陈述层新增 **funExt 自检**（NSE.T15 的「任意 step」陈述缺 `funext` 不可证，§4.5），
`check` 新增**工作区草稿/探针文件**提示（诊断用的 `_Probe*.agda` 要用完删除；已用 git 跟踪状态过滤，
不会误报 `test/_test_*.agda` 这类有意保留的真实模块）。
细节复盘见 `skills/agda-proof-engine/references/bounded-instantiation-and-postulates.md`，逐轮记录见 `audit/rounds.md` §四十八。

## 一.14 分发：不走 npm，三种装法 + Release 离线包

**结论先说：本项目不发布 npm 包**（npm 账号受限，无法建立/维护发布凭据）。
所以「让用户自己装」的路径必须是**不依赖 npm** 的，共三条：

| 装法 | 命令 | 适用 |
| --- | --- | --- |
| **A. clone + roots（推荐）** | `git clone … ~/src/dsh-math-proof` + 在 `~/.dsh/profiles/web/cordis.patch.yml` 配 `roots` | 有 git/网络；`git pull` 即更新 |
| **B. Release 离线包** | 下载 `dsh-math-proof-<tag>.tgz` → `sha256sum -c` → 解到 `~/src/dsh-math-proof`（再按 A 配 roots）或直接 `cp -r math-proof ~/.dsh/.agent-presets/` | 不用 git / 内网传输 / 想固定版本 |
| **C. 拷贝** | `cp -r dsh-math-proof/math-proof ~/.dsh/.agent-presets/math-proof` | 一次性快照，最简单 |

三条都需要**重启/重挂 dsh**，新建会话时选 `math-proof`。

**`release.yml` 做什么**：发布 GitHub Release 时 → 先跑门禁 → 打 `dsh-math-proof-<tag>.tgz` + `.sha256`
→ 附到该 Release。**不含任何 npm 步骤**，而且带一条反向检查：

```bash
n=$(grep -rl 'npm publish' .github/workflows/*.yml | wc -l)
test "$n" -eq 0 || exit 1     # 有人（或选择器模板）加进发布步骤 → 直接失败
```

这条检查是**真事故的产物**：GitHub 的 Actions 选择器生成过 `npm-publish.yml`，
模板里 `npm ci`（我们零依赖、没有 lockfile）与 `npm test`（没有该脚本）都会失败，还与已有工作流重复触发。

**`package.json` 的定位**：只作元数据与离线打包用，标 `private: true`（npm 文档语义：声明为私有、
不发布）。**诚实说明**：本机实测「发布」被拒是 `ENEEDAUTH`（未登录 npm）——`private` 的拦截发生在
认证之后，所以我**没有**在本机完整验证到「private 挡住发布」这一步；**真正的机器闸门是
`release.yml` 里那条 `grep 'npm publish'` 检查**（工作流层面挡住，可复现）。
若将来 npm 侧放开，只需三处小改：去掉 `private`、加回 `publishConfig`、
新增一个带 Trusted Publishing 的发布工作流（`audit/rounds.md` §五十二 记了完整判据）。

## 二、怎么跑

```bash
# 1) 改插件后必须过 schema 自检（否则整个会话启动失败）
node ~/.dsh/.agent-presets/math-proof/scripts/lint-schemas.mjs   # SCHEMA_LINT_OK

# 2) 十四套门禁（全部期望通过）
node tests/run.mjs            # ALL_PASS（插件回归）
node tests/benchmark.mjs      # BENCHMARK_PASS（冻结语料：评分权重不许漂移）
node tests/eval-check.mjs     # EVAL_CHECK_OK（工具/技能覆盖）
node tests/knowledge-check.mjs# KNOWLEDGE_OK（eval 承诺的知识真的在）
node tests/dup-check.mjs      # DUP_OK（同一事实只写一处）
node tests/cache-check.mjs    # CACHE_OK（前缀跨进程字节一致）
node tests/refs-check.mjs     # REFS_OK（代码引用可解析 + 仓库实测报告；无仓库时 SKIP）
node tests/routing-check.mjs  # ROUTING_OK（9 个技能描述两两相似度不超阈值）
node tests/hooks-check.mjs    # HOOKS_OK（SessionStart / PreToolUse 拦截 / Stop 契约）
node tests/market-check.mjs   # MARKET_OK（市场脚本离线 fixture 回归，不联网）
node tests/plugins-check.mjs  # PLUGINS_OK（三平面分类回归 + 跨脚本计数一致）
node tests/publish-check.mjs  # PUBLISH_OK（发布准备：state 排除 / 布局 / 生成物）
node tests/ruleset-check.mjs  # RULESET_OK（规则热读真的生效 / doctor 自证 / postulate 门禁 / 结果级分诊）
node tests/docs-check.mjs     # DOCS_OK（M2 依赖图与源码一致 / 地图齐 / Mermaid 闭合 / 无死链）

# 3) 一键跑全部门禁（15 个入口汇总成一张表）
node ~/.dsh/.agent-presets/math-proof/scripts/check-all.mjs   # CHECK_ALL_OK

# 4) 运维
node scripts/cache-report.mjs        # 缓存命中率 / 费用三段拆解
node scripts/state-gc.mjs            # 状态目录盘点（dry-run）
node scripts/state-gc.mjs --apply --archive-days 90 --rebuild-index --witness-gc
node scripts/plugins.mjs             # 插件盘点（三平面 provenance）
node scripts/market.mjs              # 插件市场（注册源侧）
```

改完插件记得 **bump 组合时间戳**（standing mount 只认 `agent.cordis.yml` 的 mtime+size）：
在本文件留一行改动，或 `touch agent.cordis.yml`，然后开新会话。

## 三、信什么、不信什么

**信**：
- Agda 内核（项目补丁版 `/opt/agda/agda`）的 exit 0 + 0 postulate/hole —— 唯一裁决。
- `proof_compile` 签发的**回执**（源文件哈希绑定，改文件即失效）。
- `proof_oracle` 签发的 **oracle 回执**（工具亲自跑脚本 + 覆盖清单）。

**不信**：
- 模型手写的 `evidence` 字符串（一律标「未验证」）。
- 「枚举到没找到反例」（抽样不算验证；`points < domain` 会被拒）。
- 「编译通过 = 正确」（`postulate` 也能通过；陈述对错仍要人判）。
- 「分数高 = 工作好」（分数是仪表盘，见纪律 §0.6；改记录提高分数是最严重违规）。

## 四、人类要做的两件事

1. **裁决**：`proof_dag journal` 里 `open: true` 的条目（文档与代码冲突、口径分歧）。
   `brief` 会列出来，挂 ≥3 天会标 `⏰`。
2. **授权**：`abandoned`（放弃节点）、大范围重构、以及任何「改红线文本」的动作。

## 五、当前已知边界

- 群论链 8 模块 0 postulate / 0 hole；`Sovereign/` 全库有一批模块含 postulate、个别含 `{!`（精确计数跑 `tests/refs-check.mjs` 现场取——**常驻层不写会漂移的数字**）。
- 常驻前缀 ≈35k 字符（≈16–20k token）；改它 = 打穿所有会话的缓存（一次全价）。
- dype 是实验性内核（不完善），**不构成独立基础**；裁决永远是 Agda。
- 有文件写权限的模型理论上能删掉本地证据；git 见证只保证「删了会被发现」。
