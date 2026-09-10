# math-proof 文档（地图 M1–M6）

> 这里是**架构与数据**文档。人类入口是上一级的 [`README.md`](../README.md)；
> 模型的常驻纪律在 `../agent.cordis.yml` + `../impl/discipline.md`；缓存纪律见 [`CACHE.md`](../CACHE.md)；
> 逐轮审计与**被否证的判断**见 [`AUDIT.md`](../AUDIT.md) + [`audit/rounds.md`](../audit/rounds.md)。

## 六张地图

| 地图 | 回答的问题 | 什么时候看 |
| --- | --- | --- |
| [M1 · 功能架构](maps/M1-architecture.md) | 由哪些部分组成、每部分归谁管、边界在哪 | 第一次读代码 / 想加一个工具或技能之前 |
| [M2 · 依赖图](maps/M2-dependency.md) | 谁 import 谁、组合行怎么排、哪个模块写哪类数据文件 | 改 import / 加行 / 查「这文件谁写的」 |
| [M3 · 数据流](maps/M3-data-flow.md) | 一个命题从猜想到「已证」经过哪些数据、哪步会失效 | 设计新流程 / 排查「证据为什么不算数」 |
| [M4 · 状态与数据管理](maps/M4-state-and-storage.md) | 数据存哪、哪个是主数据、怎么清理不丢东西 | 磁盘涨了 / 换机器 / 备份恢复 |
| [M5 · 会话生命周期](maps/M5-lifecycle.md) | 什么时候注入什么、压缩后靠什么接上、改东西要不要新开会话 | 跨天接手 / 改了规则想知道生效没 |
| [M6 · 证据链与反刷分](maps/M6-evidence-chain.md) | 什么算证据、什么时候失效、什么行为算作弊 | 标 `proven` 之前 / 看评分之前 |

## 三条读法建议

1. **先 M1 再 M2**：M1 给边界（谁该在哪一层），M2 给事实（当前实际是怎么连的）。
2. **遇到「数字/结构」别信文档，跑脚本**：`M2` 由 `scripts/docs-gen.mjs` 生成；数字类事实一律现场取
   （`tests/refs-check.mjs`、`tests/assemble-context.mjs`、`scripts/plugins.mjs`）。
3. **要看「为什么这么设计、走过哪些弯路」**：去 `audit/rounds.md`——那里连**被否证的判断**都记下来。

## 维护约定

- **M2 是生成物**：改代码后跑 `node scripts/docs-gen.mjs` 重生成；忘了改会被门禁抓住：
  ```bash
  node tests/docs-check.mjs      # DOCS_OK：M2 与源码一致 / 地图文件齐 / Mermaid 块闭合 / 文件链接可解析
  ```
- **M1、M3–M6 是手写地图**：改架构/流程时同步改，并在 `audit/rounds.md` 记一轮；
- **不要在文档里写字面数字**（模块数、断言数、字符数）：它们会漂移，一律用命令现场取；
- 文档里所有相对链接必须可解析（`docs-check` 会核）。

## 相关文档

| 文件 | 内容 |
| --- | --- |
| [`../README.md`](../README.md) | 人类入口：这是什么、怎么跑、信什么不信什么 |
| [`CACHE.md`](../CACHE.md) | 缓存前缀纪律（为什么「改插件 = 打穿缓存」） |
| [`../AUDIT.md`](../AUDIT.md) | 结论总表（每一轮一行） |
| [`../audit/rounds.md`](../audit/rounds.md) | 逐轮记录：现场证据、修法、**被否证的判断** |
| [`../schema/knowledge-graph.schema.json`](../schema/knowledge-graph.schema.json) | 知识图谱的发布 schema（消费者可校验） |
| [`../examples/objects.json`](../examples/objects.json) | 信息完整对象层的示例（GF(3) / GF(9) / DC / T⁶ / A₄） |
| [`releases/`](releases/v0.1.0.md) | 版本说明（每个 tag 一份，冻结的快照文案） |
| [`THIRD-PARTY.md`](THIRD-PARTY.md) | 第三方内容与来源声明（哪个技能来自哪里、许可、改了什么、为什么只打包这些） |
