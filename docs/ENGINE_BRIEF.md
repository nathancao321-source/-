# THE LAST ARK · Agent 3 开发执行说明

状态：接口评审与实施计划，**尚未实现游戏，尚未执行 npm install / dev / build / test，尚未创建或推送 GitHub 仓库**。基于 `src/shared/contracts.ts` v0.1.0。计时从三方确认契约并开始实施的 T+0 起算，共 240 分钟；最后 30 分钟专用于交付缓冲。

## 1. 职责和文件归属

- Agent 3：`src/physics/**`、`src/game/**`、`src/input/**`、`src/main.ts`、`src/debug/**`、`tests/**`、`package.json`、lockfile、Vite/TS 配置、`index.html`、`.gitignore`、`README.md`、`LICENSE`、`docs/ENGINE_BRIEF.md`、`docs/TEST_RESULTS.md`、`.github/**`；负责模拟、控制、集成、测试、安装与 Git 操作。
- Agent 1：关卡、星体位置、可通关路线和叙事；只通过 `src/levels/index.ts` 的 `levels: readonly LevelSpec[]` 输出。
- Agent 2：`src/render/**` 视觉层及 `src/style.css`，导出 `createRenderer(canvas): CanvasRenderer`；不修改物理状态。Agent 3 仅在 main.ts 导入样式。
- 主 Agent：唯一有权修改 `src/shared/contracts.ts`，负责协议、时间计划、跨模块裁决、发布审核和最终汇报。Agent 3 维护 README 并独占 install、Git stage/commit/push，禁止三方分别提交或改 lockfile。
- 本轮本代理仅提交此说明文件，不创建上述实现文件。后续使用 TypeScript + Vite + Canvas 2D；不引入 React、Three.js、PixiJS 或游戏引擎。

## 2. 固定步进和单位

逻辑世界位置、碰撞半径、软化距离和作用范围使用 px；时间使用 s；速度 px/s；加速度 px/s²；`FieldSpec.strength` 使用 px³/s²。Canvas CSS 像素和设备像素比不得改变物理世界坐标。

每个物理步长固定为 `fixedDt = 1 / 60`。`GameRuntime.step(input)` 不接受渲染帧 dt。每步依次执行：

1. 根据当前 phase 决定是否允许推进；ready 仅允许玩家重新定位，running 推进全部对象，paused / won / lost 冻结全部位置。
2. 将两个玩家输入方向按欧氏长度归一化，更新玩家位置并按自身半径夹在世界内。两位玩家不参与受力积分，不发生彼此或天体碰撞。
3. 保存所有天体旧位置和旧速度。使用同一份旧天体状态，以及步骤 2 得到的玩家位置，计算每个天体的加速度；禁止边遍历边更新造成后处理对象读取新位置。
4. 完成全部加速度计算后，统一进行半隐式欧拉积分：`v1 = clampLength(v0 + a * dt, maxBodySpeed)`，`p1 = p0 + v1 * dt`。
5. 对本步旧、新状态之间的运动区间检测危险天体和吞噬范围，并检查飞船整圆边界；先判失败，再按本步末位置和速度判断安全入港。空间港不使用 swept 捕获。
6. 提交新状态和事件；running 才增加 `tick`，`elapsedSeconds = tick * fixedDt`。ready 的玩家定位不增加任务时间。

初始候选护栏与 `docs/DESIGN_BRIEF.md` 保持一致：`maxBodySpeed = 220`、`maxTotalAcceleration = 160`、`maxCatchUpSteps = 6`，宿主每帧 wall delta 最多 0.1 秒。这些是待调参值，不是已经验证的关卡数值；最终使用 Agent 1 的 `LevelSpec.physics`，在 90 分钟集成后依据回放收敛，不在引擎另留一组冲突默认值。

## 3. 引力、斥力和所有可受力天体

对目标位置 `p`、力源位置 `q`，定义 `d = q - p`、`r² = dot(d,d)`、`r = sqrt(r²)`、`R = radius`。使用半径边缘平滑，范围外贡献为零：

```text
a_raw = sign * strength * d / (r² + softening²)^(3/2) * max(0, 1-r/R)^2
a_source = clampLength(a_raw, source.maxAcceleration)
sign = +1：吸引或天体引力；sign = -1：玩家排斥
a_sum = Σ a_source
a_effective = clampLength(motionResponse * a_sum, maxTotalAcceleration)
```

`R > 0`、`softening > 0`，强度和上限必须为有效有限数。在 `d = (0,0)` 时贡献严格为零；`clampLength` 必须对零向量安全。严格采用每源限幅 → 合向量乘 `motionResponse` → 总限幅的次序；`motionResponse ∈ [0,1]`。边缘平滑是本轮固定物理语义，不能省略或改为硬截止；视觉代理不能调整模拟公式。

- `receivesPlayerFields` 为 true 的**所有**天体都接收蓝色吸引和金色排斥，不能写成只查找 ark 的分支。
- `receivesGravity` 为 true 的天体接收所有其他带 `gravity` 的天体的引力，按 id 排除自引力。
- 玩家两种力和大型天体引力按向量叠加；力源遍历按稳定 id 顺序，保证回放结果稳定。
- 飞船与陨石通常 `motionResponse = 1`。大型天体通常为 `0.002`，仍受力，只是加速度响应很小。这是为保留构图和易操作性而采用的游戏化简化，并非牛顿质量定律；初速度建议设为零。
- `motionResponse = 0` 只用于明确静止的对象，配置校验应要求其初速度为零，并跳过位移积分；否则仅将加速度乘零无法保证不移动。
- 大型天体的引力强度独立于它的运动响应；减小响应不应削弱它对其他天体的引力。
- 本阶段无需实现天体之间的弹性碰撞。陨石撞飞船直接失败，陨石之间可穿过。所有动态天体仍需做有限性检查；没有任务意义的陨石越界可以继续运动，不能导致飞船任务失败。

## 4. 碰撞、黑洞、边界和入港

飞船渲染成三角形，但碰撞用圆形代理，半径由 `BodySpec.radius` 决定，避免视觉层决定碰撞形状。

危险天体检测使用相对运动扫掠圆：`r0 = arkP0 - bodyP0`、`dr = (arkP1 - arkP0) - (bodyP1 - bodyP0)`；求 `|r0 + t*dr|² <= (arkRadius + bodyRadius)²` 在 `t ∈ [0,1]` 是否成立。零长度区间走静态重叠分支；相切算碰撞。这样陨石和飞船同时移动时也不会穿透。

黑洞吞噬使用同样的相对扫掠，但按契约以中心距离阈值 `consumeRadius` 判断，不再额外加飞船半径；无该配置则不启用吞噬。只有方舟被吞才触发整局失败，非方舟被吞则在本步检测完成后移除该天体，不失败。若黑洞同时 `hazardousToArk = true`，吞噬和普通碰撞均可产生候选，统一按失败类别优先级裁决。本轮首关不含黑洞。

边界以飞船整圆必须留在世界内为准；检测本步运动段出界，而非仅判断中心点。所有同一步的失败候选优先于胜利。失败类别固定优先级为 consumed → collision → out-of-bounds；先选类别，同一类别内再取最早接触时间。类别优先级不是仅用于同时接触的平局裁决。

入港要求本步末飞船整圆位于港内，即中心在 `dock.radius - ark.radius` 内，且本步更新后的速度 **小于等于** `maxEntrySpeed`。完整圆入港但超速才设置 `dockOverspeed=true`，绝不立即判失败；仅部分进入港口不设置警告。飞船高速进入后在港内减速至阈值也可胜利，不要求离港后重新进入。

本轮空间港不做 swept 捕获；若一整步穿过港口但步末整圆不在港内，不获胜。对于半隐式欧拉，本步平移采用 `v1`，入港判定统一使用 `|v1|`，事件的 `entrySpeed` 记录同一数值。胜利前必须先排除本步全部失败候选。

## 5. 键盘、状态机和宿主循环

输入层维护 `Set<KeyboardEvent.code>`：WASD、Arrow 键、KeyF、Enter 可同时存在；不能用单个 lastKey。sample 返回新的 `InputFrame`，DOM 事件不直接推动模拟。使用 code 保持键位稳定。F 和 Enter 是**开关**：非 repeat 的 keydown 切换一次，keyup 不改变开关状态；失焦、重试和切关会清零开关。

- keydown 将移动键和技能键加入 Set，keyup 删除；Space / R 仅在非 repeat 且该键原先未按下时加入命令队列。
- 方向键、Space，以及可能触发默认按钮行为的 Enter 调用 preventDefault；页面不应因双人操作而滚动或误触按钮。
- blur、隐藏页签时调用 `clear()` 清掉按键和待执行命令；若当前 running，宿主只发送一次 toggle-pause。返回页面后保持暂停，避免后台飞行或粘键。
- Space：ready → running；running ↔ paused；won / lost 忽略。R：任何 phase 重建当前关卡并回到 ready，`runId += 1`，清空旧事件、积压时间和旧输入，tick 归零。
- ready 可以移动两个玩家，但不能预览开启力场，飞船和陨石不受力。所有非 running 状态的快照 `fieldActive=false`；paused / won / lost 全部位置冻结，不能在暂停中继续移动玩家。
- 命令按 DOM 事件顺序处理，先命令后 fixed step。例如同一帧 R 然后 Space 应重试并发射，Space 然后 R 则回到 ready。

`main.ts` 是唯一组合入口：创建关卡、GameRuntime、InputAdapter、CanvasRenderer。冻结工厂为 `createGame(level: LevelSpec, availableLevels?: readonly LevelSpec[]): GameRuntime`。注册表始终包含初始关卡；启动时遇到同 id 的冲突定义须拒绝。未知 `load-level` id 抛出 `RangeError`，原有状态、runId 和事件队列均不改变。成功载入时 runtime 内部递增 runId、重建 ready 状态。main 根据 `snapshot.levelId` 查注册表取得当前关卡 dt 和 narrative，不自行递增 runId，也不依赖私有状态。requestAnimationFrame 只负责调度：

1. 排出命令并依次传给 runtime，处理阶段变化；如暂停、恢复、重试或载入关卡，清空 accumulator 并重置 lastTimestamp。
2. 在 ready 或 running 时累计不超过 0.1 秒的 wall dt，每轮最多执行 6 个 fixed step（来自当前关卡 maxCatchUpSteps）。ready 的 step 只更新玩家。
3. 一旦本轮出现 won / lost，立即停止继续步进并清掉剩余时间。若达到追帧上限，丢弃剩余 backlog，防止卡顿后瞬移。
4. paused / won / lost 不积累任何模拟时间。恢复首帧不追赶暂停期间的时长。
5. 取得脱离可变内部状态的 readonly snapshot；宿主在本帧命令和全部子步结束后调用一次 `drainEvents()`，收集全部子步事件，不能只保留最后一个子步。将同一事件批次分发给 UI 和渲染消费者。
6. running 插值系数为 accumulator / fixedDt 并夹在 [0,1]；其他 phase 用 1。视觉时间可以继续流逝，只用于视觉，绝不能回写到模拟。

事件唯一键为 `runId:eventId`，eventId 在一次运行内单调递增；新 run 可以从零重新编号。连续 render 同一快照不得重复播放胜利/失败效果。renderer 只能读取 `RenderFrame`，不得访问 GameRuntime 的私有数据、输入 Set 或关卡内部的可变对象。resize 只改变视口比例和留白，不改逻辑世界尺寸。

## 6. 可复现回放和自动化测试

使用 Vitest 做无 DOM 核心测试，浏览器流程测试可用 Playwright（以实际可用依赖为准）。所有测试状态通过合法关卡 fixture 初始化；通关回放开始后只输入玩家操作和命令，不能直接改飞船位置、速度、phase 或随机状态。

回放唯一格式使用契约的 `InputReplay` / `ReplayAction`，不另定义 frameIndex 格式。InputReplay 包含 contractVersion、levelId、levelContentHash、fixedDt 和 actions。action 是单个 command，或 count 为正整数的 step；step 完全展开为 count 次相同 InputFrame，按 actions 原顺序调用 runtime。这样 ready 的走位、paused 中的命令也保留了实际顺序，不依赖仅在 running 前进的 tick。

Harness 对完整 LevelSpec 递归按对象键字典序排序、数组保序，再 JSON.stringify，以 UTF-8 计算 SHA-256 小写十六进制，核验版本、配置哈希与 fixedDt 后运行。seed 已包含在完整关卡哈希中，不另外发明字段。每次回放从干净 createGame(level) 开始，之后只允许 command / step / snapshot / drainEvents；不得中途写入位置、速度或 phase。

计划验收用例：

- 施力方向：四个象限的吸引朝向玩家、排斥背离玩家，近零距离和重合不产生 NaN。
- 范围和限幅：作用范围边缘平滑趋零、范围外贡献为零；每源限幅、响应系数乘法和总限幅次序正确，速度不超上限。
- 叠加：对称两源相消，垂直两源得到正确合向量。
- 全体受力：测试 fixture 中飞船和两颗陨石都响应，首关至少保留一颗可见可受力陨石；receivesPlayerFields 为 false 不响应。
- 大型天体：0.002 的速度变化符合响应比例，motionResponse 为 0 且初速零时保持静止。
- 玩家独立：开启强天体引力仍不改变玩家位置；同时按 WASD 与方向键均能移动，斜向速度与直线一致，边界夹紧。
- 同步更新：调换 bodies 数组顺序结果相同（按 id 比较并采用数值容差）；无自引力。
- 稳定性：多个力场与近距离体连续模拟 10 分钟等效 tick，所有坐标、速度保持有限且上限有效。
- 暂停/恢复：暂停前后物理状态一致；模拟一分钟暂停 wall time 后恢复一步不跳跃。
- 重试/切关：初始玩家、天体、速度、phase 和 tick 恢复，runId 增加、旧事件不重放；连续多次 R 可用。未知 levelId 抛 RangeError 且状态不变，同 id 冲突定义启动拒绝。
- 输入：同时按键、keyup、repeat、blur、visibilitychange，Space/R 命令顺序和防滚动。
- 碰撞：静态重叠、擦边、高速穿越、移动陨石相对扫掠；黑洞中心吞噬和边界半径判定；非方舟被吞移除不失败；失败类别优先级和类别内最早接触均正确。
- 入港：步末完整圆处于港内才判定；等于速度阈值成功；完整入港超速仅警告；港内减速成功；本步扫过但步末在港外不胜利；同一步所有失败优先于入港。
- 关卡对照：全零 InputFrame 自然漂移无法通关；两人固定回放在约定时间内获胜，执行结束断言 phase === won。
- 调度：以 30 / 60 / 144 Hz 渲染同一 fixed-step 输入，模拟结果相同；大间隔触发追帧上限并丢弃积压。
- 隔离：修改/冻结返回快照不影响内部状态；重复渲染不改变物理；新 run 事件不与旧 run 混淆。

回放可以用搜索或离线调参发现，但提交的关卡必须附上固定可读操作段（玩家目标位置、移动时段、开关场时段），并在浏览器中验证。自动回放证明存在可行路线，不能替代两个人同键盘的人体工学和乐趣测试。键盘硬件可能存在多键冲突，README 应如实区分自动按键与真实双人试玩。

## 7. 四小时开发节点

- **T+0–15**：冻结契约；确认坐标、捕获语义、黑洞规则；建立配置校验、项目脚本和最小 smoke test；Agent 3 同步启动 GitHub 权限检查并报告主 Agent。
- **T+15–60**：实现向量、力场、同步固定步进、键盘和状态机；60 分钟必须已有能启动、移动两个玩家、发射/暂停/重试的浏览器骨架，先使用简单几何占位渲染。
- **T+60–90**：接入 Agent 1 正式关卡和 Agent 2 renderer；统一 DPR/世界坐标，验收快照和事件；90 分钟完成第一次三方可运行集成。
- **T+90–150**：完善 swept 碰撞、入港、数值护栏；与 Agent 1 调整关卡并固化合法 InputFrame 回放；150 分钟必须证明无操作失败且双人回放成功。
- **T+150–180**：浏览器实际操作、截图/控制台检查、暂停/重试/双人输入检查；补齐关键测试和 README 事实记录。
- **T+180–210**：只处理影响稳定性、控制和视觉集成的缺陷；执行 install/dev/build/test 验证；210 分钟冻结功能，不再增加第二关或新机制。
- **T+210–240**：Agent 3 汇总 README 实测结果、MIT License、已实现/未实现与扩展点，执行 git diff 检查、commit、创建公开仓库和 push、核验远端可访问；主 Agent 审核发布交付并最终汇报。若 GitHub 阻塞，保留可运行本地交付并明确列出阻塞，不能宣称已发布。

时间降级规则：90 分钟尚不能启动则停止非必要视觉扩展，全员修集成；150 分钟尚无可通关回放则收敛为单大型危险天体、单空间港和至少一颗可见可受两位玩家作用的移动陨石，可把陨石移远主航线，但不能删除最后一颗，保留双人矢量施力核心；210 分钟后只修阻塞缺陷。最终“视觉 > 剧情 > 玩法”的表现偏好建立在能运行、能通关的最低门槛上，开发代理不把额外关卡抢在视觉集成之前。

## 8. 工程脚本、GitHub 检查与阻塞预案

计划配置 `npm run dev`（Vite）、`npm run build`（tsc --noEmit + vite build）、`npm test`（vitest run），可选 `npm run test:e2e`。必须实际执行后才把成功和版本写入 README；浏览器应检查 canvas 可见、双人输入、胜败反馈、刷新、console error 和网络资源错误。

当前收到的环境事实：Node 24.19、npm 11.17、Git 2.53 可用；gh 不在 PATH；当前 Git 无提交、无 remote，且 user.name / user.email 未配置。这不等于 GitHub 已登录，也不等于没有其他已授权连接方式。

由 Agent 3 依次确认 gh 的可用路径或已授权 GitHub connector；若可用执行 auth status 并读取当前账户，核验 repo 创建权限和同名仓库是否存在，并交主 Agent 审核发布事实。不要在日志打印 token。优先仓库名 the-last-ark；若同名存在，检查是否就是本项目，禁止覆盖无关仓库，可选择明确的新后缀并报告。用户已授权创建公开仓库及推送，无需为常规创建和 push 再次询问。

Git 作者身份必须来自用户已有配置或经认证账户资料；不要捏造姓名/email。缺失时可使用已经确认的 GitHub 账户 noreply 邮箱，仓库级设置，不能改全局设置。创建前完成本地检查，提交必要源代码与 lockfile，排除 node_modules、dist、临时日志、凭证。仓库明确 public 并含 MIT License，push 后核对 remote URL 和提交 SHA。

若 CLI 安装、登录、OAuth/令牌 scope、网络或作者身份是阻塞，只说明具体卡在哪里以及仍需何种用户动作，继续完成不依赖远端的实现和测试。不能用一个网页登录页面当作授权成功，也不能将本地 git init 误报为 GitHub 仓库创建成功。

## 9. 已确认并闭合的接口决策

1. 力场必须有半径边缘平滑；次序为每源限幅 → 合向量乘 motionResponse → 总限幅。motionResponse 限制 [0,1]，零响应要求零初速度且不积分位移。
2. 空间港只做本步末整圆在港内 + v1 速度检测；完整入港超速仅警告，港内减速可以胜利，不做 swept 港口捕获。
3. 同一步失败类别优先 consumed > collision > out-of-bounds，类别内取最早接触；任何失败优先胜利。非方舟被黑洞吞噬时移除而不失败，首关不含黑洞。
4. 工厂冻结为 createGame(level: LevelSpec, availableLevels?: readonly LevelSpec[]): GameRuntime；注册表总包含初始关卡，启动拒绝同 id 冲突定义，未知 load-level 抛 RangeError 且状态不变。运行时自行递增 runId，main 按 snapshot.levelId 查配置。
5. 非 running 快照 fieldActive=false；ready 可以走位但不预览开启力场，paused 冻结全部位置。
6. 回放统一 InputReplay / ReplayAction，动作序列包含准备走位和边沿命令；完整配置使用规范 JSON 的 SHA-256 校验，不另设 frameIndex 数据格式。
7. 物理从同一旧状态同步计算并统一积分；按稳定 id 顺序求和；校验全部配置有限性。主循环使用 0.1 秒 delta 上限、6 步追赶上限，暂停/恢复/重试/切关清积压。
8. README、依赖安装和 Git 写操作由 Agent 3 串行负责；主 Agent 负责唯一共享契约与最终审核发布。保留至少一颗可受力陨石是任何降级下的机制验收底线。

以上是本轮已确认规则；共享类型和主协议由主 Agent 统一维护，Agent 3 仅落实所属文件，不另行复制或扩展契约。
