# 数学证明模式 · 可用性审核报告

**日期**: 2026-09-09
**审核者**: 本地 AI（fable5 九步流程：拓扑扫描 → 多路径 → 分解 → 并行审查 → 自验 → 沙盒验证 → 防虚假完成 → 记忆 → 对抗自检）
**范围**: preset 结构一致性 / 工具运行时 / 技能发现 / 上下文成本 / 失败模式 / 端到端可达性

---

## 一、结论

**可用（有条件）**：静态门禁与运行时门禁全绿；两次真实证明验收（`DCInvolution`、`Pi4Homomorphism`）与 14 条 Python 交叉验证通过；
本次审核另**修复 2 处缺陷**、**记录 1 个进程级陷阱**。
**唯一未验证环节**：真实会话端到端（原因见 §五）。

## 二、证据

| # | 检查项 | 方法 | 结果 |
| --- | --- | --- | --- |
| 1 | 组合 YAML | loader 方言 `entryListSchema` 解析 | 21 行 ✅ |
| 2 | 插件语法 | `node --check` × 5 文件 | 全部 ✅ |
| 3 | 工具 schema | `scripts/lint-schemas.mjs`（含 output 子集 + object 根） | `SCHEMA_LINT_OK`（4 工具）✅ |
| 4 | 挂载 | `agentPresets.standingKeyFor('math-proof')` | `mounted OK` ✅ |
| 5 | 名册可见性 | `agentPresets.list()` | `math-proof` / trust=user / `broken=null` ✅ |
| 6 | 技能发现 | 真实 `FileSystemSkillProvider`（customSkillDirs → preset skills） | **8/8 发现**，rank 300 ✅ |
| 7 | 技能目录合并 | provider + 默认根 | 31 个技能，**无重名冲突** ✅ |
| 8 | 工具边缘情况 | 13 个非法输入探针 | 全部给出明确错误或降级 ✅ |
| 9 | shell 注入 | `shellQuote`（`;`/`$()`/反引号/单引号/换行） | 单引号包裹 + `'\''` 转义 ✅ |
| 10 | 失败模式 | 技能目录缺失/为空 | provider 返回 0 个技能，不抛错 ✅ |
| 11 | 验收产物回归 | `agda` × 2 + `pytest` | exit 0 ×2 / 43 passed ✅ |
| 12 | 台账完整性 | `proof_dag check` | 6/6 proven，无环无悬空 ✅ |
| 13 | 上下文成本 | 字符统计 | 常驻 ≈ 20 090 字符（约 20–28k tokens） |

## 三、本次审核修复的缺陷

| # | 缺陷 | 影响 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | `proof_dag` 未知 `action` **静默退回 `list`** | 拼错动作时得到误导性成功 | 改为抛错并列出合法动作 | `bogus` → 报错；`null`/`""` 仍降级 `list` ✅ |
| 2 | `proof_dag` **并发丢更新**（读-改-写竞争；preset 明确鼓励 workflow 扇出） | 多 agent 同时写台账会丢节点 | 原子写（temp+rename）+ 咨询锁（`wx` 独占，5s 陈旧抢占） | 20 并发 `add` → 台账 20/20 ✅ |
| 3 | （上一轮）`parameters` 非法 schema | 整个会话启动/请求失败 | 修 `required` 为字符串数组 + 新增 `scripts/lint-schemas.mjs` | lint 有牙齿（能抓回原 bug）✅ |

## 四、进程级陷阱（必须知道）

`dsh-agent-presets` 的 `compositionStamp()` **只统计 `agent.cordis.yml` 的 mtime+size**，
**不追踪 `./plugins/*.mjs`**（源码：`lib/index.js:1807-1821`）。
因此 **只改插件、不改 composition 时，同进程内的 standing mount 会继续复用旧插件代码**——
新会话不会自愈。

**规程**：改完插件 → ①跑 `scripts/lint-schemas.mjs`；②在 `agent.cordis.yml` 留一行改动（或 `touch`）以 bump stamp；③仍不生效则重启 web profile 进程。

## 五、未验证环节与已知限制（诚实清单）

1. **无真实会话端到端验证**：`dsh --profile headless` 的组合**不含 `dsh-agent-presets`**，CLI 也没有 preset 选择器 → 无法在命令行起一个「数学证明模式」会话。必须由人类在 GUI 新建会话验收（上次的事故正发生在这一步）。
2. **上下文常驻 ≈ 20k 字符**：persona 11 557 + 纪律 5 888 + 工具描述 735 + 8 技能摘要 1 910（技能正文 47 344 按需加载）。1M 窗口下安全，但若未来模型窗口收紧需拆分 persona。
3. **绝对路径假设**：persona/skills 引用 `/data/work/discrete-mathematics`、`/home/yanli/.agents/skills/...`；仓库搬迁后文本失效（工具本身按 cwd 工作，不受影响）。
4. **dype 二进制仍不可用**（data-dir 烙入 `/src/data`）：`proof_compile` 自动跳过并回退 `agda`，已记录修复路径。
5. **`proof_dag` 台账按 workspace 分桶**（`~/.dsh/state/math-proof/dag-<hash>.json`），不跨机同步。
6. **Lean 轨道未验证**：`~/.dsh/prove2me_workspace` 仅跑过 smoke test。
7. **定理级 DAG 缺失**：`proof_dag` 是人工命题台账，`proof_graph` 是模块级 import 图，二者不自动衔接。

## 六、复现命令

```bash
# 静态门禁
node ~/.dsh/.agent-presets/math-proof/scripts/lint-schemas.mjs
node --check ~/.dsh/.agent-presets/math-proof/plugins/*.mjs

# 挂载（需在会话内用 agentPresets 服务；或 GUI 新建会话）
# standingKeyFor('math-proof') → mounted OK

# 技能发现（真实 provider）
node /tmp/skill_discovery.mjs

# 验收产物回归
cd /data/work/discrete-mathematics
agda --guardedness src/Sovereign/Algebra/GroupTheory/DCInvolution.agda
agda --guardedness src/Sovereign/Algebra/Pi4Homomorphism.agda
python3 -m pytest engineering/tests/ -q     # 43 passed
```

---

## 七、第二轮：真实会话测试（GUI）+ 事实审计（2026-09-09）

### 7.1 GUI 会话端到端测试：**通过（8/8）**

测试题：闭合 `sigmaDC` 的群同态性（`src/Sovereign/Algebra/GroupTheory/DCSigmaAut.agda`）。

| # | 检查点 | 结果 |
| --- | --- | --- |
| 1 | 4 个工具齐全、无 schema 报错 | ✅ |
| 2 | 8 个 preset 技能可见 | ✅ |
| 3 | **侦察质量**：找到 `DuodecClock.agda:552 rho-alphaInv-homo`，`sigmaDC-homo` 一行复用（未重证 144 case） | ✅ 与原型一致 |
| 4 | 先算后验证：pytest 43 → 49（+6，全整数） | ✅ |
| 5 | 陈述忠实（三条命题逐字一致） | ✅ |
| 6 | `proof_compile` exit 0（3.1s）+ `proof_audit` 合规 | ✅ |
| 7 | 台账 3 节点 proven + evidence；`check` 9 节点 100% | ✅ |
| 8 | 0 postulate / 0 hole / 0 sorry | ✅ |

**结论**：预设设计的关键纪律（侦察优先 + 复用已有引理）在真实会话中**生效**。

### 7.2 会话暴露的环境限制（已文档化）

群论链闸门 `engineering/check_group_chain.sh` 在 `workspace-write` 沙箱下会因 stdlib 接口目录只读而 `exit=42`
（`agda-stdlib/_build/...agdai` 写入被拒）——**权限问题，非类型错误**。
已写入 persona §三 与 `group-first-proof` §6：此时改用 `proof_compile` 逐模块验证。

### 7.3 事实审计（第二视角）：23 条发现，逐条复算后修 24 处

| 优先级 | 修复 |
| --- | --- |
| P0 | ①`1458/1000`「3 位」→**4 位**（源头 `docs/duodecimal/16:70` 一并修）②π₄ G2 → 已闭合 ③量子对齐状态更新 ④**Orbit 断言改正** ⑤T8 ℤ→**ℕ 层** |
| P1 | `Physics/NSE.agda`→`Problem/NavierStokes/NSE.agda`；4897→4899；05=228；清单 12→11；Mermaid 5→6；`mulAlpha` 12→13 子句；`GF729.agda:580`→577；ProjectiveCore 129-136→**130-137**；T6 postulate 1→**3 块** |
| P2 | 截断检查四类→**五类**；路线四条→**五条**；`sovereign_core` 浮点残留标注；dype 二进制两处→**三处**；`dcZeroOblivion` 120→**133** |

**同时把审计的 UNVERIFIED 补实**：

- 挂谷 4 模块全绿 → 实跑 `KakeyaGF3/MF/GF9`（exit 0，3–4s）+ `KakeyaPathology`（exit 0，65s）✅
- prove2me smoke test → 实跑 `✔ [845/845] 26s, exit 0` ✅
- `-M6G` 误杀 → 实测 `-M6G` 1.2s Heap exhausted、`-M8G` exit 0 ✅（该结论不在 19a 文档，属实测）

**文档同步**：`docs/duodecimal/16:70` 算术修正；`docs/duodecimal/21` 顶部加「初扫快照 vs §六 已完成」状态横幅。

### 7.4 待人类裁决（未擅自选边）

`memory/crt-wave-physics-not-modular-arithmetic.md:52-57` 称
「`orbitStabilizer` 不是等式、不是同构，是谱域转换」「`Orbit x` = 729 格点」，与代码冲突：

```agda
Orbit x = Σ T6Lattice (λ y → ∥ A4OrbitEquiv x y ∥₂)   -- T6.agda:937-938，A₄-轨道（≤12）
orbitIso             : Iso (Orbit x) (A4/Stab x)      -- :1062
orbitStabilizer-path : Orbit x ≡ A4/Stab x            -- :1065
orbitStabilizer      : Orbit x ≃ A4/Stab x            -- :1068
-- 但依赖 postulate φ-respects（:976-977），非 postulate-free
```

技能已按项目权威层级（Agda 库 > 文档）写成代码事实并**标注冲突**；是否保留 memory 原口径，待人类决定。

### 7.5 复验

| 项 | 结果 |
| --- | --- |
| 组合 YAML | 21 行 ✅ |
| `standingKeyFor('math-proof')` | **mounted OK** ✅ |
| `scripts/lint-schemas.mjs` | `SCHEMA_LINT_OK` ✅ |
| persona 模板变量 | 仅 `{{model}}` / `{{cwd}}` ✅ |
| 挂谷 4 模块 | exit 0 ✅ |
| 验收产物（2 Agda + pytest 43） | 全绿 ✅ |

---

## 逐轮记录（第八轮起）

详细记录已拆到 `audit/rounds.md`（避免正文膨胀）。摘要：

| 轮 | 主题 | 关键产出 |
| --- | --- | --- |
| 八 | 网络检索驱动优化 | 失败分诊 / 级联失效 / 证据完整性 |
| 九 | 长程任务架构 | brief / journal / source / 断链检测 |
| 十 | 对标 brooks-lint | 铁律、误报防护、评分趋势、负向边界 |
| 十一 | 可测量性 | 冻结语料 benchmark + eval 覆盖校验 |
| 十二 | 上下文装配与单一事实源 | assemble-context / knowledge-check / dup-check |
| 十三 | 反刷分 | `proof_compile` 回执 + 证据三档 + 纪律 §0.6 |
| 十四 | git 本地见证 | witness 仓库 + checkpoint + 篡改检测 |
| 十五 | Agda 权威修正 | `agda-engine`（agda 优先）、dype 降为实验性 |
| 十六 | 编译预算 + 先算后验证 | 编译预算闸门 / 三闸门 / 探针模块 |
| 十七 | oracle 回执 + 编译热点 | `proof_oracle` + `compileHotspots` |
| 十八 | 缓存前缀纪律 | `cache-check` + 输出有界化 + `CACHE.md` |
| 十九 | 缓存与费用实测 | 98.6% 命中、费用三段拆解、`cache-report` |
| 二十 | 先算后验证沉淀复用 | `oracle-kit/oracle_kit.py` + lint |
| 二十一 | Fable5 复盘 | 策略经验（`journal(kind:"lesson")`）+ 优化路线 |
| 二十二 | 工具合并 + 超期提醒 | 7→6 工具；`⏰ 已挂 N 天`；自证否证「合并省前缀」 |
| 二十三 | 收尾 | 截断优先保关键节点；经验库两视图互指（不做合并）；AUDIT 拆分 |
| 二十四 | 理论定位与事实校准 | HoTT/Cubical 边界（§11）；修正 505/536、35/12、25 postulate、2 hole |
| 二十五 | 相等观纠正 + GF(9) 案例 | 「相等是判定，不是结构」；§12 结构相似 ≠ 结构同一 |
| 二十六 | 再找一轮优化 | 修 `compileHistory` 子串误匹配 + import 解析去重；新增 `refs-check`（50/50）；余 10 处排序 |
| 二十七 | 全部修复 | 回执索引/归档/锁 PID/见证节流；abandoned；粒度；审计联动；指纹一致性；README；路由门禁；纪律分层 |
| 二十八 | 信息完整对象层 | `kind:object` + `construction` 门禁 + `relations` + 对象信息完整度；§13 本体论 |
| 三十 | AI 接口 | `proof_dag action:"graph"` 导出知识图谱 JSON（objects/claims/edges/gaps） |
| 三十一 | 完善基础 + 可用性 | carrier/operations 字段；`action:"import"` 批量登记 + 示例模板；`check-all.mjs` 一键门禁；易漂移数字请出常驻层 |
| 三十二 | 对象层够不够当基础设施 | 引用完整性（未登记关系目标必须暴露）+ 双读法（JSON/MD）+ 发布 schema；诚实列出 6 项未做好 |
| 三十三 | 样本落地真实台账 | 5 个对象登记进生产台账；`extends` 参与断链核对；查出 25 条断链 / 15 个未验证证据 |
| 三十四 | 回执补全 + 传递依赖 | 编译 4 模块补 14 个回执（未验证 15→7）；传递依赖三态；修「回执覆盖证据」缺陷 |
| 三十五 | 断链收尾 | 断链 52→2（语义区分 + 机械补 31 条依赖 + 修 3 处错误声明）；未验证→0；评分 65→94 |
| 三十六 | 钩子 + 拦截 | SessionStart 简报 / PreToolUse 拦截越过步骤 / Stop 提醒；修「补依赖误降级」「节流未提交」 |
| 三十七 | 三方定位 | `research-system` §12：Claude FLT / OpenAI NS / 大衍对照；Clay (C)/(D) 语义边界；借/不借清单 |
| 三十八 | 复用优先 + 数位分离核对 | `action:"search"` 复用查找；纪律加「复用优先」「离散是基座非上限」；引用原文确认位数分离已废弃 |
| 三十九 | 计算许可 + 12 进制非域 | 「计算是工具不是裁决」+ 大数证据；红线「12 进制≠有限域」（R₁₂ 有零因子） |
| 四十 | 五层对照 | DC / DuodecClock（本源）vs C₁₂ / R₁₂ / Doz（投影）；零因子来源 = `_*12_` 而非 `mixedOp` |
| 四十一 | Doz 不是序概念 | §5.2：Doz = 表示层；序来自被表示对象；连续统序属 ℝ（被诊断对象） |
| 四十二 | 常见混淆清单 | §5.3：DC/D₁₂、C₃×C₄、A₄、Trit/Fin3、AlphaPower/GF9Star、零冥族/零元等 8 组 |
| 四十三 | 热重载 | 纪律文本移到 `impl/discipline.md` + section 用函数；`scripts/reload.mjs`；热/可热/冷三档 |
| 四十四 | DSH 插件盘点 | `scripts/plugins.mjs`；相关插件宿主多已挂载；唯一待定 `schedule`（+前缀成本） |
| 四十五 | 插件市场 | `scripts/market.mjs`：市场 272 / 已装 214 / 可装未装 58（同版本线 28）；版本线陷阱（latest 停在 0.0.1-rc.1）；相关 18 条均带前置条件 |
| 四十六 | 升级后插件对账 | 三平面 provenance：宿主 117 启用/25 禁用、preset 37 行（接管 22 行）、双份 0、真缺口 0；改正「禁用=已挂」的分类错误；宿主平面本就无我们的改动，重置没丢东西 |
| 六十一 | fable5 是流程而非纯知识 |
| 八十 | **npm 格式包（不发布也能打）** | 用户问「云端能不能打包 npm 格式，不一定要发布」。实测：**`private: true` 只挡 `npm publish`，不挡 `npm pack`** → 能打标准 npm 包。已实现 `publish.mjs --npm-pack`（产出 `<scope>-<name>-<ver>.tgz` + `.sha256`，报告 size/shasum/integrity）、`release.yml` 改用 `npm pack` 出包、并新增 **bin 安装器** `dsh-math-proof install/print-root/verify`（默认拒绝覆盖）。实测端到端：`npm i -g <tgz>` → 装出来的副本跑**全套 23 门禁全绿**；包内权限 npm 统一 **0644**（bin 0755）→ 「别人读不了」在这条路径上不存在；包内不含 state/__pycache__/.pyc/.github。`publish-check` +17 条（41→58），含「装出来的副本能跑自身门禁」「重复安装拒绝覆盖」 |
| 七十九 | **数据保留策略：每个存储保留多少条 / 还是覆盖** | 用户问「这个数据保留多少条，还是覆盖的」。逐条从代码查出并落成 M4 表：样本 400 / 余额采样 500 / 基线窗口 20 / 回合实况**每会话覆盖** / 信箱 6 / 待结算 20 / 评分历史 200/ws；回执与图谱导出**追加型无上限**（靠 `state-gc --archive-days` 与 `--graph-keep` 归档，不删数据）。**补上两个洞**：①`flow-*` 流程标记原先**无任何清理路径**（堆到 124 个、83 个已过期）→ state-gc 报告 + `--apply --flow-min-age-days 3`；②**会话日志 harness 侧无任何保留策略**（26 个 / 51.6MB）→ state-gc 只报告绝不删。另修 `state-gc` 自己硬编码状态目录（`--apply` 会打在真实状态上）。新增门禁 `tests/state-check.mjs`（34 条：上限存在且真的生效、维护脚本覆盖每个类别、只动该动的、覆盖 vs 追加语义）→ 23 个入口 |
| 七十八 | **状态目录唯一实现 + 修掉「本机红、CI 绿」的测试污染** | 用户那次 **345.9s/169.0s** 的真实编译回执，把 `tests/run.mjs` 的「编译热点」断言挤红——查下去是**测试把假回执写进用户真实回执目录**，还断言自己是「最贵的 3 条」（CI 状态目录为空所以永远绿）。修法：新增唯一实现 `impl/state-dir.mjs`（`MATH_PROOF_STATE_DIR` 优先，默认行为不变），`proof-dag`/`agda-engine`/`python-oracle`/`prover-limits` 四处硬编码全部改走它；`run.mjs` 与 `hooks-check` 把**整份套件**（含进程内插件与派生钩子）指向同一临时目录；`paths-check` +6 条门禁（含「插件不许再硬编码状态目录」）。生产状态目录实测未被改动（回执仍 111 条） |
| 七十七 | **四向量核对 + 命中率显示规则对齐** | 用户又给两条（同一会话：大轮 `14,897,701`（98% / 293,757 / 14,541,696 / 62,248（35,326））、小轮 `180,279`（81% / 33,577 / 143,360 / 3,342（1,562）））。日志逐字段核对**全中**；但 **`98%`（不是 `98.0%`）** 暴露我渲染用了 `toFixed(1)` → 去读界面 `formatCacheHitPercent`，按其规则重写：分母 = prompt tokens、**整数算术取 0.1 个百分点、中值向上**、**整数去尾随 .0**、**部分命中绝不显示 100%**（`999999/1000000 → 99.9999`，与界面闭式一致），只有真全命中才写 `100`。四条真实向量全部进回归（335→345） |
| 七十六 | **第二条真实向量核对 + 预设归属修正** | 用户贴出**数学证明模式会话**那一轮（11,924,953 / 99.8% / 22,269 / 11,852,288 / 50,396（33,493））。去日志里找到该回合（`session-925bd92b` turn 5）逐字段比对：**五处全中**，两条真实向量都进回归。同时发现真问题：该会话 header 写 `agentPreset: standard`，但 seq 4 有 `agent-preset/selected: math-proof` —— **header 只是创建时的值，中途切换不改它**，按 header 分组会归错档（报表 70 轮 math-proof 里 6 轮来自这里）。已按事件折**生效预设**并逐回合记录（切换前后分开算），`sessionTotals` 同时给 `presetAtCreation`/`preset`/`byPreset`；另修一处惰性初始化 bug（循环前取 header 导致第一轮 preset 丢失） |
| 七十五 | **对齐界面数据格式（同一把尺子）** | 用户贴出界面那一块（本轮用量 25,178,836 tok / 提供方·模型 / 缓存命中 99.9% / 未缓存输入 26,872 / 缓存读取 25,116,032 / 输出 35,932（推理 9,672））并问「怎么利用当前会话的数据格式」。核实：界面 `TurnUsagePanel` 与日志 `assistant/message.usage` **是同一套字段**，`本轮用量 ≡ 未缓存输入+缓存读取+输出`（用户给的数验算成立）。已加 `turnUsageRow` / `renderUsageBlock`（界面同款标签 + **分组整数**，不写 k/M）与 `budget action:"usage"`（本轮 + 最近 N 轮 + 会话累计），并把这一轮的真实向量当回归用例钉死（+20 条 → 328/328） |
| 七十四 | **监控口径纠正：token 是主，钱是特例** | 用户指出「dsh 不只 DeepSeek，MiMo/Qwen 是积分制，钱无意义；**输入/输出 token 每次会话才是有意义的监控数据**」。据此把主监控改成**跨 provider 的 token 账**：按 `输入 = 未缓存 + 缓存命中`、`输出 = 生成 + 其中思考` 分解，`report` 新增**按 provider / model** 的全机汇总，`status`/公告/播报/结算全部改成「输入 … · 输出 …」；`SESSION` 预算的 token 单位由此得到正当性（唯一能跨 provider 对齐的额度单位）。余额（`quota`）降级为 **DeepSeek 专属**并在报告首行声明。本机实测：输入 1764.0M（缓存命中 **99.4%**）· 输出 4.59M（思考占输出 45%）⇒ 吃额度的是输入侧重复上下文，杠杆仍是少跑几轮 |
| 七十三 | **额度监控：官方给的是「钱」不是「token 配额」** | 用户转来两份现成实现（Python/Node 的熔断 + 额度监控 + 一个 TS 包计划）。核对后：①**熔断那半不用加**——harness 已有有界重试/指数退避+抖动/可重试码分类/遵循 Retry-After/耗尽即终止，且用户上轮已决定不加；②**额度那半的价值在于接口事实**：官方是 `GET /user/balance`（不是 `/v1/user/info`），返回 `{is_available, balance_infos:[{currency,total_balance,granted_balance,topped_up_balance}]}`，**金额是字符串、没有总量** ⇒ 那套「剩余/总量=百分比 + 50/20/5% 阈值」**算不出来**。已按官方形状重写：采样（有界落盘）+ 燃烧速率（只算最近单调下降段，充值不算负消耗）+ ETA + 自定基线百分比；默认不联网、凭据走 `ctx.credentials` 不碰密钥文件。③顺带修掉被暴露的门禁缺陷：密钥扫描把「取凭据的代码」当硬编码密钥（17 处假阳性）→ 收紧为「引号字面量且 ≥12」，抽到 `impl/secret-scan.mjs`，并加 4 条断言证明**仍会咬** |
| 七十二 | **会话级 token 预算 + 监控接口盘点** | 用户问「有没有单次会话的百万 token 预算 / dsh 有没有监控接口」。查实：**没有任何会话级 token 上限**（`maxTokens` 是单次请求输出上限、compaction 是上下文压力、`tokenUsage` 投影只测不限）。实测先定标：单会话累计 tok 中位 **1.25M**、p90 89M、max **832M**，而**单个中位回合 6.61M** ⇒ 「1M 一次会话」不可行（第一次调用即撞线），默认取 **5e8**。新增 `SESSION` 表 + 会话累计（`sessionTok` 闭合回合累加 + `liveTok` 每 N 次刷新）+ 硬线拦非白名单工具 + `budget action:"session"` 看设 + 公告/播报/state-gc 全带进度；`budget-check` 256/256（+38 条）。监控接口盘点 9 条（全部官方缝） |
| 七十一 | **「文件只有属主可读」的根因不在脚本** | 用户提醒 `engineering/tests/` 两个 oracle 脚本是 0600。查实：①范围远不止两个——工作区 **103 个仓库文件**、本 preset 仓库 **83 个**；②**git 只记可执行位**，0600 提交后就是 100644 → **CI 读不到的真原因是这些文件「未跟踪」**（Burnside 整块 141 条未提交）；③根因在 harness：`dsh-fs-local` 原子写把暂存文件设 0o600，**只有目标已存在才 chmod 还原** → 新文件一律 0600（已复现：write 工具 0600 / bash 664 / 同一 umask）。修法：仓库侧 `chmod 664`；**分发包**曾有真问题（`cpSync` 保留权限）→ `publish.mjs` 显式归一化 + `publish-check` 两条断言（去掉归一化即变红，已实测）；`--dry-run` 顺带报本地 0600 计数。上游修法（新文件按 `0o666 & ~umask`）留给 `dsh-fs-local` |
| 七十 | **思考强度自动调节 + 三个被实测否证的直觉** | 用户：「防止无限循环输出/浪费流量/过度思考，让模型自动调节思考强度」。先量：reasoning 只占流量 **0.12%**、**高思考回合反而更省**（≥1000/步：15.5 步 4.05M；<300/步：17 步 9.32M）→ 否掉「过度思考烧流量」；159 个含长文本回合里重复长文本块 **0 次** → 否掉「输出刷屏」；**50% 的回合整轮不写任何文件**、连续无推进中位 11 次 → 否掉「无推进熔断」。**保留并新建**：原地打转检测（成立且便宜）+ 新增 `agent/request` 瀑布调速器（预算过 60%→`low`、85%→`off`，任务结束还原；只降不升、看不懂不动、异常退回原配置），并把 `effortAtStart/effortLast` 落进样本与报表，让「降档是否真省」用用户自己的数据回答 |
| 六十九 | **任务预算与流量账本**（用户提问：能否让模型自己 ±10% 加预算） | 先把「流量」量出来再设计：本机 26 会话 / 174 回合实测单回合 tok 中位 6.61M（p90 17.63M、max 84.14M）、步数中位 16（max 325），中位回合 `input 8.2k + cacheRead 6.58M + output 14.2k` ⇒ **99.6% 是上下文重复读、输出只占 0.9%**，故主控量取**工具调用次数**、统计取**中位数**（均值会被单个 84M 失控拉偏 ~50%）。自适应只两处动手：**已验证完成 −10% / 撞墙 +10%**（失败与无证据完成不动），夹紧 [0.5×,2×] 中位、样本 <5 不动手；追加走**申请制 + 记债**（限 1 次/任务、理由 ≥20 字、批 +50%、下个已验证任务扣回 10%）。落到 2 个共享模块 + 1 工具 + 4 钩子 + 报表脚本 + 168 条门禁。**同时查出并修掉两个真问题**：① Stop 钩子的 `additionalContext` 官方桥根本不注入（只处理 deny→steer），`stop-reminder.mjs` 从来没生效过 → 改为「Stop 只做副作用 + 信箱由下轮 UserPromptSubmit 投递」；② CI 的 **Node 20** 作业抓到 `import { zstdDecompressSync } from 'node:zlib'` 是**链接期** SyntaxError（Node 22.15/23.8 才有）→ `plugins/budget.mjs` 整个挂不上、第 7 个工具不注册；已改为命名空间导入 + 运行时探测（`ZSTD_SUPPORTED`），老 Node 降级为「读不了压缩日志」而不是崩，并加静态断言禁止再写成命名导入 |
| 六十八 | **批量登记通道的证据洞** | `import` 字段白名单缺 `receipt`/`oracle`/`postulates` 却允许直接写 `proven` → 9 个节点变「proven 无证据」，评分 100→55 且报告只写「更新 9」；已修：批量通道校验证据、proven 必须有有效回执（三选一）、显式逃生 `allowUnevidencedProven` 单独列出、覆盖时保证据；+10 断言（run 423/423）。**持久化本身无问题**（原子写 + 见证 git 含回执原件，可从历史恢复） |
| 六十七 | 判定规则**退回冷档** | 用户：「冷的」→ 删掉 `?v=<mtime>` 动态 import（本 preset 唯一自造机制），规则改为静态 import；`doctor` 比对「磁盘 vs 进程内」哈希，改了没重启会明确报出；规则 r6→r7；门禁改为冷档断言。热路径只剩官方缝（提示段文本函数 + 数据读盘 + 命令钩子） |
| 六十六 | 提示段文字做成真热 | section text 是同步调用（不能用 `?v=`）→ 把「本机路径」小节的**文字**搬到 `impl/path-section.md`，每次装配同步读盘（`{paths}` 占位符）→ 改文字不必重启；新增 `hot-section-check`（21 个入口）；并确认 hooks 与本机制正交（钩子脚本本来就热，注册表冷） |
| 六十五 | 修好了却仍报同一个错：**ESM 缓存** | Cordis 用无 query 的 `import(url)`，Node ESM 缓存按 URL 固化 → 改插件/钩子**代码必须重启进程**（新会话不够）；用户 12:27 重启、我的修复 12:29 才写 → 迟 2 分钟；reload.mjs 增加「代码 mtime vs 进程启动」判定并修掉漏查 impl/ 的误判；新增 `reload-check` 门禁（20 个入口） |
| 六十四 | **本轮运行失败的第二个根因** | 「本机路径」小节里的示例文字 `{{key}}` 被 system-prompt 当成未注册变量 → 整轮装配失败；已改掉 + 新增 `prompt-vars-check` 门禁（19 个入口，10/10；放回 bug 立刻红） |
| 六十三 | **数学模式不可用的真根因** | `proof-discipline.mjs` 用 `ctx.systemPrompt` 却未 `inject`（升级后 Cordis 检查变严）→ 该行挂不上 → 整个模式不可用；已修 + 新增 `inject-check` 门禁（静态 + 严格 ctx 真挂载模拟，20/20）；并加固「配置坏掉不连坐 preset」（内置兜底 + 防漂移断言） |
| 六十二 | fable5 两条升级为机器挡 | 新增 `hooks/fable5-gate.mjs`（PreToolUse）：**计划绑定**（多步任务未落台账就动文件 → 拦一次）+ **防虚假完成**（完成宣称无证据 → 拦）；`MATH_PROOF_FLOW_GATE=off` 可关；hooks-check 35→48 |
| 六十一c | `.git/hooks` 澄清 | 上游 `.git/hooks/` 是 git 自带 `*.sample` 示例（永不执行），非 agent 钩子；1 commit / 非浅克隆 / 无悬空对象 / 仅两个文件 → 上游确无钩子，`fable5-flow.mjs` 为本项目原创 |
| 六十一b | 许可判断更正 | 上游 README 的 `## License` 段明确写 MIT © 2026（无独立 LICENSE 文件）→ 之前「许可不清」是错判；三处表述已改准 | 查证上游全历史只有 README+SKILL.md（无 hooks）；九步闭环里能拦截的两步由本项目新钩子 `hooks/fable5-flow.mjs` 承担（UserPromptSubmit 开工四项 / Stop 收工三项，短问句与纯应答不打扰），其余映射到既有关卡；文档与署名明确「钩子非上游提供」 |
| 六十 | 技能打包范围收紧 + 第三方声明 | 标准＝「强关联 + 许可清晰」；移出通用技能 `loop-engineer`（其证明相关部分本地化为 `agda-proof-engine` §5.9），保留第三方 `fable5-thinking`（上游 MIT、作者开放共享）并新增 `docs/THIRD-PARTY.md` 署名出处；引用一律条件式（门禁新增检查，当场抓出 12 处） |
| 五十九 | 技能依赖再核（不预设环境） | 以**本机 988 个用户级技能**为候选集交叉核对：打包 13 个之外流程未引用任何未打包技能；门禁升级为「本机目录交叉核对」（单词名需上下文，防英文词误报）；修掉 M1 里自带的坏示例 |
| 五十八 | 本机路径集中化 | 51 处/20 文件 → **唯一配置处 `impl/local-paths.json`**（8 键，env 可覆盖）+ token/键名指针；解析器 `impl/local-paths.mjs`；纪律段自动附「本机路径」真值小节；新增 `paths-check` 门禁（操作性文件禁绝对路径、历史豁免但计数、token 有定义、无死键、解析器行为），当场修 3 处 |
| 五十七 | 技能引用完整性 | 用户指出「引用的技能依赖本机没打包」→ 打包 `loop-engineer`/`code-reviewer`，重复 60 行改指针，新增 `skills-ref-check` 门禁（引用必须随包分发或在白名单 / frontmatter 规范 / 提示词无本机路径 / 评测覆盖），当场修掉 3 处死链 |
| 五十六 | 打包两个技能进 preset | `fable5-thinking`（九条原则）+ `proof-engineer`（1289 行库规范）随仓库分发；原文不动、只加 harness 适配层；修掉 persona 里的本机绝对路径死链；dup-check 抓到重复输出格式并改为指针；常驻 +1.3k 字符 |
| 五十五 | 取消 npm 发布 → Release 离线包 | npm 账号受限：删 publish.yml、改 release.yml（打 tgz+sha256 附 Release）、`package.json` 置 `private: true`、加「禁止 npm publish」反向检查；分发改为 clone+roots / 离线包 / 拷贝三条 |
| 五十四 | 更正堆爆归因 + 历史按规则集切开 | 否证「字面量界触发 any? 枚举」：真凶是**含具体数字递归的定义体被展开**（探针 P1/P2/P3：3s vs >75s vs 339s）；只封界不够，须把定义**连同体**封进同一 `abstract` 块；分诊加 `notThis` 反例与 stdlib/环境双规则；`history` 带 `ruleset` 戳，跨规则集不再误报「回退」 |
| 五十三 | v0.1.0 Release 文案 | `docs/releases/v0.1.0.md`（数字现场取后冻结：15 门禁 / 784 断言 / 74 文件）；四条诚实边界；docs-check 扩扫 releases |
| 五十二b | 选择器重复生成发布工作流（真事故） | 用户点模板生成 `npm-publish.yml`：`npm ci` 无 lockfile 必失败、`npm test` 无脚本、需长期 token 且与 `publish.yml` 重复触发；已删模板 + 把「唯一发布者」写成机器检查 |
| 五十二 | npm 发布选型 | 选 “Publish Node.js Package” + Trusted Publishing + `--provenance`；不用 GitHub Packages（消费者要 token）与 SLSA Generic generator（npm 自带 provenance 已等价）；`publish.mjs` 生成 package.json / publish.yml / .npmignore，实测打包 73 文件 355 kB 无状态泄漏 |
| 五十一 | 架构文档（地图 M1–M6） | 新增 `docs/`：功能架构 / **依赖图（脚本生成 + 漂移门禁）** / 数据流 / 状态管理 / 生命周期 / 证据链；写文档时发现并修掉「图谱导出无上限」缺口（68 文件 / 65 组） |
| 五十 | 开源仓库初始化 | gh clone→组装→push 到 clearnature/dsh-math-proof（public, MIT）；CI 矩阵 Node 20/22/24 跑全部门禁；发布暴露并修掉「裸环境误报」与「.pyc 被发布」两个真问题 |
| 四十九 | 落到生产台账 + ①可行性实测 | rewrite 声明须有 `{-# REWRITE #-}` 源码依据（自封豁免拒收）；T6/T6Rewrite 裁决落地 → 台账 100/100；**abstract/opaque 界让鸽巢实例化 2.8s exit 0（对照字面量 346s 堆爆）** |
| 四十八 | 真实作业暴露的三个工具缺陷 | 规则热读 + 版本戳 + `doctor` 自证（修旧实例算分）；`postulates` 三分类门禁（proven = 0 **未声明**）；`proof_compile` 结果级分诊（堆爆/被杀/超时不再无指纹）；陈述层 funExt 自检；草稿文件按 git 跟踪过滤 |
| 四十七 | 开源发布准备 | 仓库名 `dsh-math-proof`；布局须比 preset 目录高一层（`scanRoot` 规则）；`publish.mjs` 排除 state/ + 体检（36 处绝对路径/13 文件、0 密钥）+ 生成 MIT 骨架 |

