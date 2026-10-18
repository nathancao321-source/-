# THE LAST ARK · 文档索引

当前阶段：**可运行垂直切片**（2026-10-18）。四关已实现，33 个自动测试通过；真人双人试玩尚未验证。

## 试玩

- [单文件版本](playable.html)：内联全部 JS/CSS，直接双击打开或用静态服务器托管；嵌入 iframe 时先点击画面获取键盘焦点。
- [项目 README](../README.md)：启动方式、操作、已验证项与已知限制。
- [游戏设计（细化版）](GAME_DESIGN.md)：世界观、物理原则、速度预算、摄像机与场景状态机、评分与合作场景设计。
- [关卡设计与数值](LEVEL_DESIGN.md)：逐关地图、对象、路线、调参、验收。
- [剧情线（实现版）](CAMPAIGN_STORY.md)：开场卡、提示、失败/通关文案、触发映射。
- [完整剧情与 UI 设定](../STORY_AND_UI_DESIGN.md)：世界观、四段旅程、Boss、无限模式。

## 协作与实现

- [三 agent 接口协议](AGENT_PROTOCOL.md)：文件所有权、物理/渲染边界、集成与变更规则；当前契约 v0.2.0。
- [四小时计划](FOUR_HOUR_PLAN.md)：并行安排、验收门槛和降级顺序。
- [策划说明](DESIGN_BRIEF.md)：单关验收原则、容错设计与回放要求（已被 `LEVEL_DESIGN.md` 扩展）。
- [渲染说明](RENDER_BRIEF.md)：视觉 agent 的渲染层设计。
- [引擎说明](ENGINE_BRIEF.md)：开发 agent 的物理、输入和测试设计。

## 契约

- 唯一共享 TypeScript 接口：[`src/shared/contracts.ts`](../src/shared/contracts.ts)，版本 **0.2.0**。
- v0.2 为 v0.1 的可选扩展：任务层、HUD 任务状态、静态关卡几何、章节卡信息；v0.1 字段语义不变。

## 截图

`docs/screenshots/` 保存了 Edge headless 实机画面：

- `00-first-contact-*`：准备、运行、蓝场、双场；
- `01-moving-world-*`：行星关准备与运行；
- `02-solar-exodus-*`：太阳关准备、运行、冲击波警示；
- `03-beyond-horizon-*`：黑洞关准备与喷流开启。
