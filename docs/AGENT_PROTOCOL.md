# 三 agent 接口协议 · v0.2.0

状态：可供三位 agent 开工使用；候选地图参数仍须通过物理回放验证。唯一类型来源是 `src/shared/contracts.ts`。

> **v0.2.0 可选扩展（2026-10-18）**：新增 `LevelSpec.mission`、`FrameSnapshot.mission`、`RenderFrame.level/campaign`、`NarrativeSpec.chapter/sector`、`NarrativeHint.voice/title`、`DockSpec.kind/label`。v0.1 字段语义不变；任务层实现见 `src/game/mission.ts`，底板实现与验收见 `docs/LEVEL_DESIGN.md`。

## 1. 冻结范围与取舍

做一个 3—5 分钟可探索、可反复尝试的单关卡：两位观察者通过吸引与排斥，护送方舟绕过中央危险星体，减速进入右侧空间港。单关卡优先验证稳定合作，不强制证明任何单人策略绝对无法通关。

可启动、双人输入正确、物理稳定、真实可通关是发布门槛。满足门槛后的投入顺序为视觉呈现 > 简短剧情 > 增加玩法。不开第二套技术路线，不追求复杂关卡。仅 TypeScript + Vite + Canvas 2D；无 React、Three.js、PixiJS、服务器、账号、AI API、音乐或未经授权素材。原始需求中的精美 UI、粒子和复杂动画不进入本次范围。视觉提升只用基础几何、构图、颜色、清晰比例与少量程序绘制背景。未收到实际视觉参考附件，不声称复刻任何参考图。

## 2. 责任人与文件边界

- **Agent 1 / 策划**：`src/levels/**`、`docs/DESIGN_BRIEF.md`、`docs/PLAYTEST.md`；关卡配置、地图坐标、初始速度、简短文案、协作路线、通关回放脚本的设计和参数调校。不得写模拟器和 renderer。
- **Agent 2 / 视觉**：`src/render/**`、`src/style.css`、`docs/RENDER_BRIEF.md`；Canvas renderer、比例适配、配色和基础 HUD。不得改胜负判定、输入、物理或共享类型。
- **Agent 3 / 开发**：`src/physics/**`、`src/game/**`、`src/input/**`、`src/main.ts`、`src/debug/**`、`tests/**`、`package.json`、lockfile、Vite/TS 配置、`index.html`、`.gitignore`、`README.md`、`LICENSE`、`docs/ENGINE_BRIEF.md`、`docs/TEST_RESULTS.md`、`.github/**`；物理、运行时、集成、测试、Git 操作。依赖安装和 lockfile 只有此 agent 修改。
- **主 agent / 协调**：`src/shared/contracts.ts`、`docs/AGENT_PROTOCOL.md`、`docs/FOUR_HOUR_PLAN.md`、`docs/README.md`；维护契约、解决跨模块分歧、验收与最后汇报。主 agent 不另起第四条功能开发线。

本轮三位 agent 只输出各自 `*_BRIEF.md`，并报告契约问题；实际编码冲刺按上述所有权分配。共享工作区直接按目录并行，不另建三套 package.json。只有 Agent 3 执行 install、Git stage/commit/push；测试可并行读文件，禁止并行改 lockfile。不得通过重置或清理他人工作来解冲突。

## 3. 三条数据接口

1. **策划 → 开发**：`src/levels/index.ts` 导出 `levels: readonly LevelSpec[]`。它包含世界尺寸、两名玩家参数、天体数组、空间港、物理上限、固定 seed、文案。关卡是纯数据，不含 DOM、Canvas、随机函数或私有状态。
2. **开发 → 渲染**：`src/game/index.ts` 导出 `createGame(level: LevelSpec, availableLevels?: readonly LevelSpec[]): GameRuntime`，满足 `GameFactory`；`snapshot()` 返回 `FrameSnapshot`，`drainEvents()` 返回一次性 `GameEvent[]`。每次快照与可变模拟数据断开引用，渲染不可写回。注册表始终包含初始关卡，同 ID 冲突在构造时拒绝；未知 `load-level` ID 抛出 RangeError 且不改变状态，已知 ID 加载时 runId 递增。main 用 `snapshot.levelId` 查当前配置的 dt 与 narrative，不需要全局关卡变量。
3. **渲染 → 主程序**：`src/render/index.ts` 导出 `createRenderer(canvas: HTMLCanvasElement): CanvasRenderer`。`render(RenderFrame)` 只画画；`resize(width,height,dpr)` 负责显示尺寸；`dispose()` 清理资源。`src/main.ts` 组合关卡、键盘、模拟器、渲染。

入口约定：`src/input/index.ts` 导出 `createKeyboardInput(target: Window): InputAdapter`。Agent 2 先用符合契约的 ready/running/won/lost mock 快照实现，45 分钟内至少能渲染静态地图；90 分钟前用真实快照替换 mock。Mock 不得成为生产胜负数据源。

## 4. 时间、空间、状态约定

- 世界初版为 1200 × 720 逻辑像素；原点左上，x 向右，y 向下。长度 px，速度 px/s，加速度 px/s²，时间秒。物理永远使用逻辑坐标。
- 两名玩家固定 ID 为 `attractor`、`repulsor`；天体 ID 关卡内唯一且稳定；每关恰有一个 `ark`。数组顺序不得决定更新结果。
- 固定步长 1/60 秒；浏览器帧率只影响渲染次数。单帧墙钟 delta 限制到 0.1 秒，最多补算 6 步，超额积压丢弃。暂停、标签页失焦、重试或切关时清 accumulator 和前帧时钟。
- `ready`：方舟与其他天体冻结，玩家可预先走位；场强不作用于天体。`running`：按固定步长完整模拟。`paused`、`won`、`lost`：所有位置冻结。PlayerView.fieldActive 表示实际施力状态，非 running 必须为 false；InputFrame.fieldActive 仍只是按键意图。
- Space：ready→running，running→paused，paused→running；won/lost 无操作。R：任意状态恢复关卡初值→ready；runId 加一，tick=0，清事件/输入/轨迹缓存。
- 失焦或页面隐藏：清按键；若正在 running 则显式暂停，返回后需要 Space 恢复，避免后台追赶。
- tick 仅在 running 前进；elapsedSeconds = tick × fixedDt。ready 玩家移动使用相同步长，但不增加任务时间。
- 插值只用于绘画：`lerp(previousPosition, position, interpolationAlpha)`；非 running 时 alpha=1，重试后 previous=current。视觉墙钟可用于装饰但绝不回传模拟器。

## 5. 力、碰撞和入港的唯一语义

每步先读取玩家输入、移动并限制边界，再从同一时刻的天体位置计算所有加速度，最后统一积分位置。天体之间不得边更新边读新位置。

设源位置与受力天体位置的差为 d，r=|d|，R 为力场半径，ε>0 为软化距离，s=+1 为吸引、s=-1 为排斥：

`a_source = s × strength × d / (r² + ε²)^(3/2) × max(0, 1-r/R)²`

先限制每个源的加速度模长；合向量乘 `motionResponse`，再限制 `maxTotalAcceleration`；半隐式 Euler 更新 v 再更新 x，更新位置前限制 `maxBodySpeed`。d=0 时加速度为零。所有配置必须有限，半径/softening/dt/上限必须有效，禁止 NaN/Infinity 进入模拟器。

玩家对所有 `receivesPlayerFields=true` 的天体施力，不可硬编码只取方舟。引力源影响所有 `receivesGravity=true` 的其他天体，自身排除。玩家不在受力天体数组中，不参与物理碰撞和引力更新。大型星体用很小但非零的 `motionResponse` 近似稳定，仍能受玩家作用；这是可控关卡的游戏化简化，不是质量守恒/真实 N 体模拟。响应系数必须处于 [0,1]；为 0 时要求初速为零且跳过位移积分，不能只把加速度清零。

方舟与危险天体用相对运动的 swept circle 检测，避免高速穿透。黑洞吞噬检查中心距离是否进入 `consumeRadius`，无该配置则不启用。第一关无需黑洞；若将来加入，非方舟被吞只移除该天体，方舟被吞才任务失败。方舟整个碰撞圆越界失败；玩家圆限制在世界内；非方舟飞离世界后仍按模拟保留，本版数量少且不新增隐形反弹规则。

同一步失败优先于胜利，失败原因优先级 consumed > collision > out-of-bounds；同类别多个接触选最早命中者。方舟整个碰撞圆在本步末处于港内且积分后速度 <= maxEntrySpeed 才获胜，事件 entrySpeed 记录该速度；本轮不使用扫掠入港捕获。同一完整入港条件下速度过高时才设置 `dockOverspeed=true`，可以继续减速或再入港。未设生命值，也不设置港口碰撞墙。

## 6. 输入与事件边界

InputFrame 是本物理步的持续状态：WASD/F 与方向键/Enter 同时读取；移动向量由引擎归一化，斜向不加速。使用 KeyboardEvent.code 和 Set，拦截方向键、Space、Enter 的浏览器默认行为。Space/R 使用非 repeat 的 keydown 边沿进入命令队列，与持续场强分开处理。

DOM 边沿命令按到达顺序执行；命令队列每浏览器帧只取一次。多个物理子步产生的事件统一收集给一次 render，主程序不可只保留最后一个子步的事件。渲染按 runId+eventId 去重，runId 变化清理上一轮缓存。快照是绘画和 HUD 的事实来源，事件只触发视觉提示，漏事件不会改变物理/胜负。

## 7. 变更、验收、移交

前 15 分钟提出字段缺口，由主 agent 统一更新；15 分钟后契约冻结。必要变更必须同时说明新增/修改字段、生产者、消费者、兼容方式和测试影响。优先可选字段加默认值；禁止消费者自行扩充一份类型或使用 `any` 绕过契约。150 分钟后原则上只修缺陷。

每次移交用同一格式：完成文件 / 导出接口 / 已运行的验证命令及结果 / 尚未验证项 / 阻塞与需要谁处理 / 下个可集成时间。约 30 分钟内部同步一次，只向用户报告实质进展。

回放统一使用契约中的 `InputReplay` / `ReplayAction`，按实际 command/step 调用顺序记录，不能只以 tick 定位，因为 ready 阶段玩家走位不增加 tick。`step.count` 是正整数，完全展开重复输入；每次 replay 从干净 createGame(level) 开始。Harness 将 LevelSpec 对象键递归字典序排序、数组保序、JSON.stringify 后以 UTF-8 计算 SHA-256，核对配置哈希和版本再运行。通关回放必须只用输入/命令，不得中途写位置或速度。

装饰背景的确定性 seed 可由 levelId 的稳定字符串哈希生成；渲染不要求读取模拟器 seed。`src/style.css` 明确由 Agent 2 维护，Agent 3 只在 main.ts 导入它。

首次真实集成必须覆盖 ready、running、paused、won、lost、restart；检查所有状态均能画出，重试后不残留场强和轨迹。策划提供输入回放方案，开发提供可执行 harness，视觉基于真实快照提供正常/危险/入港三张画面证据。

发布前安装、dev、build、自动测试必须实跑。真实人类双人键盘手感、硬件按键冲突和目标机器性能若未试过，README 必须列为未验证，不能用模拟键盘测试替代。GitHub URL 仅在仓库创建、公开属性确认和 push 成功后报告。
