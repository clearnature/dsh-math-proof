# 第三方内容与来源声明

本仓库以 MIT 分发（见 `LICENSE`）。但仓库里有一部分技能**不是本项目原创**——这一页把它们列清楚：
来源、同步到哪个版本、改了什么、许可是什么。**不确定来源的第三方内容不进本仓库。**

## 1. `math-proof/skills/fable5-thinking/`

| 项 | 内容 |
| --- | --- |
| 来源 | <https://github.com/THEBLUEGHOSTSSSS/Fable5-Thinking-Skill>（作者开放共享） |
| 同步版本 | commit `8af252f`（v3.0，2026-08-15 之后同步到本仓库） |
| 许可 | **MIT**——上游 README 的 `## License` 段明确写「MIT © 2026」（README 顶部还有 MIT 徽章）。上游仓库内**没有独立的 `LICENSE` 文件**（徽章链接指向它），但**许可声明就在说明文件里**，本仓库按 MIT 再分发，保留出处与署名 |
| 改动 | **九条原则原文一字未改**；仅：① frontmatter 换成本 preset 的 DSH 技能格式（`name`/`description`/`whenToUse` + 不触发清单）；② 顶部加一段 DSH 适配说明（`claude`/`architect` agent → `subagent` 工具；`EnterPlanMode` → 计划模式；`/memory` → 台账与工作区 `memory/`） |
| 上游更新怎么办 | 直接覆盖该文件正文（保留本仓库加的 frontmatter 与适配说明段），或删掉目录改用你本机的用户级副本 |


<details>
<summary>为什么「上游好像有钩子」——`.git/hooks/` 的误会（证据链）</summary>

克隆下来的仓库里会有 `.git/hooks/`，里面躺着 `pre-commit.sample`、`pre-push.sample` 等十几个文件，
看起来像「作者带了钩子」。**它们是 git 自带的示例**：任何 `git clone` 都有；`.sample` 后缀意味着
git **永远不会执行**它们；要启用得去掉后缀并自己写内容。它们与 agent 钩子（`PreToolUse` 等）是两回事：

| | git 钩子 | agent 钩子 |
| --- | --- | --- |
| 触发者 | git 自身（commit / push / rebase…） | 模型运行时（工具调用前后、会话开始/结束） |
| 注册在哪 | `.git/hooks/`（本地，不进版本库） | `hooks/hooks.json`（Claude Code 方言）或 agent 配置 |
| 本仓库对应 | 无（我们不打包 git 钩子） | `math-proof/hooks/*.mjs` + `hooks.json` |

对上游客隆（任意本地路径 `<clone>/.git`）的核查：

- `git log --all` → **只有 1 个 commit**（`8af252f`，2026-06-14）；
- `git rev-list --count HEAD` = 1，且 `git fetch --unshallow` 报「已是完整仓库」→ **不是浅克隆，没有更早历史**；
- `git for-each-ref` → 只有 `main` / `origin/HEAD` / `origin/main`，**没有别的分支或标签**；
- `git fsck --unreachable --dangling` → **空**，对象库里**没有「删掉的钩子文件」**；
- `git ls-tree -r HEAD` → `README.md`、`SKILL.md` 两个文件。
- `.git/hooks/` → 14 个 `*.sample`，**没有一个启用**。

结论：上游**没有 agent 钩子**；本仓库的 `hooks/fable5-flow.mjs` 是本项目原创实现（MIT）。
</details>

**关于「钩子」**：上游仓库（含全部历史）**只有 `README.md` 与 `SKILL.md`，没有任何 hooks/commands 文件**；
`/fable5-thinking` 是 Claude Code 里对该技能的调用方式，README 描述的「九步闭环工作流」是**用法约定**。
本仓库据此把流程里可机械拦截的两步**自行实现**为 `math-proof/hooks/fable5-flow.mjs`
（`UserPromptSubmit` 注入开工四项、`Stop` 注入收工三项、`PreToolUse` 闸门做计划绑定与防虚假完成），并**没有**声称上游提供了这些钩子；
这两个钩子脚本（`fable5-flow.mjs`、`fable5-gate.mjs`）都是本项目原创代码，按本仓库 MIT 分发。

> 若上游作者对再分发有不同意见，请联系仓库维护者，我们会立即移除或按其要求调整署名方式。

## 2. 曾经引入、现已移出的内容

| 内容 | 处理 | 原因 |
| --- | --- | --- |
| `loop-engineer`（通用自主迭代修复工程师） | **已从本仓库移出** | 它是**通用**技能（适用于任何工程），不属于「数学证明」的范围；与证明强相关的部分已本地化进 `math-proof/skills/agda-proof-engine/SKILL.md` §5.9「编译失败的批量修复协议」。正文里对它的引用一律写成**条件式**（「若环境存在该技能可委托它」） |

> ⚠ 说明：`loop-engineer` 的内容仍留在本仓库的 **git 历史**里（先加入后移除）。
> 若需要连历史一并清除，请告知（需重写历史或重建仓库）。

## 3. 本仓库自带的技能（原创）

`skills/` 下其余技能（`agda-proof-engine`、`compute-then-verify`、`duodecimal-corpus`、`group-first-proof`、
`long-horizon-discipline`、`meta-diagnosis`、`proof-engineer`、`prove2me-method`、`research-system`、
`type-theory-presentation`、`code-reviewer`）随本 preset 一起开发与维护，按本仓库 MIT 许可分发。

> `proof-engineer` / `code-reviewer` 原先是作者本机的用户级技能，2026-09-10 起**随本仓库分发**
> （原因：别人 clone 后不该预设环境相同）。它们的正文除「编译失败委托」一处改为条件式之外未改。

## 4. 判断标准（为什么只打包这些）

**只有同时满足两条的技能才进本仓库**：

1. **与数学证明强关联**（Agda 证明规范、类型论、离散结构、证明长程纪律、证据链……）；
2. **许可清晰**（原创，或上游明确开放共享并保留署名）。

通用技能（无论多好用）与来源/许可不明的技能**一律不打包**——引用时写成条件式，或以本仓库内
等效的小节替代（如 §5.9 替代 `loop-engineer`）。这条由 `tests/skills-ref-check.mjs` 机械检查：
白名单里的技能，其引用必须带条件语。
