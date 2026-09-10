# dsh-math-proof

**dsh agda 插件** —— 一个 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（dsh）的 **agent preset**：
把「依赖类型论展示群 + 先算后验证 + 长程台账 + 反刷分」装进 dsh，让会话以 **Agda 内核为唯一裁决**做形式化证明，
并**保留证明信息**（对象的生成方式与关系、命题的证据档位、每一轮被否证的判断都在台账里）。

> 定位：面向 AI 的数学库工作模式——证明不是「写出一段像证明的文本」，而是**能通过内核检查的项**；
> 未验证的东西一律可见地标为未验证，分数不能通过改记录提高。

## 装（两条路，选一条）

**A. 克隆 + 配一个 root（推荐，`git pull` 即可更新）**

```bash
git clone https://github.com/clearnature/dsh-math-proof.git ~/src/dsh-math-proof
```

在 dsh 宿主 patch 层（`~/.dsh/profiles/web/cordis.patch.yml`）加一项：

```yaml
- id: agent-presets
  config:
    roots:
      - path: ~/src/dsh-math-proof
        trust: user
```

**B. 拷进用户目录**（一次性快照，升级要手动重拷）

```bash
cp -r dsh-math-proof/math-proof ~/.dsh/.agent-presets/math-proof
```

两条路都需要**重启 / 重挂 dsh**，然后新建会话时选 `math-proof`（显示名「数学证明模式」）。

> 为什么仓库根不是 preset 目录：dsh 的 `scanRoot` 只认「root 下、名字匹配 `[a-z0-9][a-z0-9-]*`
> 的子目录」，且子目录里必须有 `agent.cordis.yml`。

## 它给你什么

| 能力 | 说明 |
| --- | --- |
| 6 个工具 | `proof_dag`（命题/对象台账 + 状态机 + 体检 + 评分 + 知识图谱导出）、`proof_compile`（Agda 编译 + 错误指纹分诊 + **回执签发**）、`proof_graph`（import DAG）、`proof_oracle`（Python 精确整数 oracle + 回执）、`prover_limits`（工具链限制经验库）、`proof_audit`（静态合规审计） |
| 9 个技能 | 按需加载的领域知识（不进常驻前缀）：类型论展示群、研究系统流程、先算后验证、长程纪律、元诊断等 |
| 3 个钩子 | SessionStart 注入接手简报 / PreToolUse **拦截越过步骤** / Stop 提醒收工 |
| 证据分档 | 只有工具签发的**回执**（与源码哈希绑定，改文件即失效）算「已验证」；模型自报的 evidence 一律标未验证 |
| 可热读规则 | 判定规则（断链豁免 / 评分权重 / postulate 口径 / 编译爆炸分诊）在 `impl/ruleset.mjs`，工具每次调用热读——改规则不用重开会话 |

## 依赖什么

| 依赖 | 用途 | 缺失后果 |
| --- | --- | --- |
| dsh（`@deepseek-ai/dsh`，版本线 0.1.2-rc.1） | 宿主 | 装不上 |
| **Agda**（项目补丁版，路径见 `math-proof/plugins/agda-engine.mjs`） | **唯一裁决器**：exit 0 + 0 postulate/hole | `proof_compile` 不可用 |
| Python 3（零外部依赖） | 先算后验证的 oracle（精确整数，禁浮点） | `proof_oracle` 不可用 |
| 你自己的数学仓库（工作目录） | 证明目标 | 工具可用，但没有可证的库 |

**注意**：部分文本引用作者本机的绝对路径（`/data/work/...`、`/home/<用户>/文档/...`），
它们指向作者的本地资料（数学 wiki、类型论文档、dype 源码）。**换成你的路径即可**——
工具本身按工作目录工作，不受影响。

## 自检

```bash
node math-proof/scripts/check-all.mjs    # 期望 CHECK_ALL_OK（14 个门禁入口）
node math-proof/scripts/plugins.mjs      # 三平面插件盘点（宿主 / preset / 缺口）
node math-proof/scripts/market.mjs       # DSH 插件市场（可装未装 / 版本线 / 前置条件）
```

## 目录

| 路径 | 内容 |
| --- | --- |
| `math-proof/agent.cordis.yml` | 组合：persona + 纪律段 + 工具行 + 技能索引 |
| `math-proof/preset.yml` | 名册元数据（显示名 / 描述 / order） |
| `math-proof/plugins/` | 工具实现（零依赖，只 import `node:` 内建模块） |
| `math-proof/impl/` | 热读实现：纪律文本、判定规则、共享事实层 |
| `math-proof/skills/` | 按需加载的领域知识 |
| `math-proof/hooks/` | 流程钩子 |
| `math-proof/tests/` `scripts/` | 13 套门禁 / 运维脚本（缓存报告、状态维护、插件盘点、市场、发布准备） |
| `math-proof/audit/` `AUDIT.md` | 逐轮审计记录（含**被否证的判断**） |

## 许可证

MIT（见 `LICENSE`）。
