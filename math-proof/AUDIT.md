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
| 五十三 | v0.1.0 Release 文案 | `docs/releases/v0.1.0.md`（数字现场取后冻结：15 门禁 / 784 断言 / 74 文件）；四条诚实边界；docs-check 扩扫 releases |
| 五十二b | 选择器重复生成发布工作流（真事故） | 用户点模板生成 `npm-publish.yml`：`npm ci` 无 lockfile 必失败、`npm test` 无脚本、需长期 token 且与 `publish.yml` 重复触发；已删模板 + 把「唯一发布者」写成机器检查 |
| 五十二 | npm 发布选型 | 选 “Publish Node.js Package” + Trusted Publishing + `--provenance`；不用 GitHub Packages（消费者要 token）与 SLSA Generic generator（npm 自带 provenance 已等价）；`publish.mjs` 生成 package.json / publish.yml / .npmignore，实测打包 73 文件 355 kB 无状态泄漏 |
| 五十一 | 架构文档（地图 M1–M6） | 新增 `docs/`：功能架构 / **依赖图（脚本生成 + 漂移门禁）** / 数据流 / 状态管理 / 生命周期 / 证据链；写文档时发现并修掉「图谱导出无上限」缺口（68 文件 / 65 组） |
| 五十 | 开源仓库初始化 | gh clone→组装→push 到 clearnature/dsh-math-proof（public, MIT）；CI 矩阵 Node 20/22/24 跑全部门禁；发布暴露并修掉「裸环境误报」与「.pyc 被发布」两个真问题 |
| 四十九 | 落到生产台账 + ①可行性实测 | rewrite 声明须有 `{-# REWRITE #-}` 源码依据（自封豁免拒收）；T6/T6Rewrite 裁决落地 → 台账 100/100；**abstract/opaque 界让鸽巢实例化 2.8s exit 0（对照字面量 346s 堆爆）** |
| 四十八 | 真实作业暴露的三个工具缺陷 | 规则热读 + 版本戳 + `doctor` 自证（修旧实例算分）；`postulates` 三分类门禁（proven = 0 **未声明**）；`proof_compile` 结果级分诊（堆爆/被杀/超时不再无指纹）；陈述层 funExt 自检；草稿文件按 git 跟踪过滤 |
| 四十七 | 开源发布准备 | 仓库名 `dsh-math-proof`；布局须比 preset 目录高一层（`scanRoot` 规则）；`publish.mjs` 排除 state/ + 体检（36 处绝对路径/13 文件、0 密钥）+ 生成 MIT 骨架 |

