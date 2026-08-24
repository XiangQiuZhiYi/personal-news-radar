# 个人信息晚报

这个项目在 Mac 本地拉取公开信息，由本机已登录的 Codex CLI 进行去重、分类、筛选和影响分析，再把最终精选生成成静态网站。Mac 每天 17:00 自动运行，成功后只提交静态晚报数据并推送到 GitHub；GitHub Pages 随后完成发布，手机始终通过同一个网址阅读。

不需要让 Mac 长期运行 Web 服务，也不需要 OpenAI API。Codex 只在本机执行，GitHub Actions 只部署已经生成好的静态文件。

## 工作流程

```text
每天 17:00，Mac 的 launchd 启动任务
        ↓
RSS / Atom / 城市公开网页
        ↓
时间过滤、精确去重
        ↓
本机 codex exec + JSON Schema
        ↓
语义去重、分类、价值筛选、普通人影响分析
        ↓
原子更新 public/data/latest.json
        ↓
只提交这一个数据文件并推送 main
        ↓
GitHub Actions 部署 public/ 到 GitHub Pages
        ↓
手机打开固定网址阅读
```

如果抓取、Codex 分析或静态结果校验失败，`public/data/latest.json` 不会被覆盖，线上继续显示上一份成功晚报。如果 Git 推送或 Pages 部署失败，线上版本同样保持不变。

## 环境要求

- macOS
- Node.js 20 或更高版本
- 已安装并登录 Codex CLI
- 当前仓库位于 `main` 分支
- 已配置可免交互推送的 GitHub SSH Key

检查 Codex：

```bash
codex login status
```

检查 GitHub 推送权限：

```bash
ssh -T git@github.com
```

程序会优先查找 `PATH` 中的 Codex，随后检查 `/Applications/Codex.app`、`/Applications/ChatGPT.app` 及用户 `Applications` 目录中的内置 CLI。如果从 Windows 迁移过来，不要保留指向 `codex.exe` 的 `CODEX_BIN`：

```bash
unset CODEX_BIN
```

自动整理使用 Codex 的非交互模式，并带有 `--ignore-user-config`：继续复用现有登录凭据，但不读取 `~/.codex/config.toml`，因此不会加载桌面端的模型、插件或 MCP 设置。项目单独固定使用 `gpt-5.6-terra`、`high` 推理强度和 `default` 标准速度，并通过禁用提供方的 WebSocket 支持从请求开始就使用 HTTPS，不再等待 WebSocket 重试后降级。单次分析最长等待 30 分钟。

## 首次启用 GitHub Pages

仓库远端应为：

```text
git@github.com:XiangQiuZhiYi/personal-news-radar.git
```

先把本次代码改造正常提交并推送到 `main`。然后进入 GitHub 仓库：

1. 打开 `Settings → Pages`。
2. 在 `Build and deployment` 中选择 `GitHub Actions`。
3. 推送 `main` 后等待 `Deploy static news radar` 工作流完成。

页面地址预计为：

```text
https://xiangqiuzhiyi.github.io/personal-news-radar/
```

部署工作流位于 `.github/workflows/pages.yml`，它只读取 `public/` 并发布，不包含 Codex 登录信息、SSH Key 或 OpenAI API Key。

GitHub Pages 通常是公开网页。当前部署内容仅包含公开新闻及其 AI 摘要；手机收藏不会上传。

## 手动生成和发布

只生成静态晚报、不提交 Git：

```bash
npm run static:build
```

执行完整流程，包括抓取、Codex 分析、生成、提交和推送：

```bash
npm run publish:daily
```

`publish:daily` 只提交 `public/data/latest.json`。即使工作区中存在其他未提交或已暂存文件，也不会把它们加入每日晚报提交。当前分支不是 `main` 时，脚本会在分析前停止，避免推错分支。

使用测试 RSS 验证静态生成但不推送：

```bash
npm run static:fixture
```

这个命令会更新本地 `public/data/latest.json`，不应作为正式晚报发布。

## 安装每天 17:00 的 Mac 任务

先预览将要安装的 launchd 配置：

```bash
npm run schedule:preview
```

确认后安装：

```bash
npm run schedule:install
```

配置文件会写入：

```text
~/Library/LaunchAgents/com.personal-news-radar.daily.plist
```

日志位置：

```text
logs/daily.log
logs/daily-error.log
```

`daily.log` 记录任务阶段、Codex 会话开始、HTTPS 传输方式和 token 用量；`daily-error.log` 记录 Codex CLI 的 HTTPS 连接重试、警告、错误及超时前的最近输出。Codex 采用 JSONL 事件模式运行，连接过程不会再等到超时后只留下一个笼统错误。

任务使用安装时的当前 macOS 用户、Node 路径和 Codex 路径。`RunAtLoad` 只负责补跑检查：17:00 前登录会直接跳过；17:00 后如果当天尚未成功发布，则执行一次；当天已经成功发布时不会重复运行。Mac 睡眠期间错过时间后会在任务恢复运行时检查补跑，完全关机时无法在 17:00 执行。

卸载定时任务：

```bash
npm run schedule:uninstall
```

如需临时改为其他时间，可以直接运行安装脚本，例如 18:30：

```bash
node scripts/install-schedule.mjs --hour 18 --minute 30
```

## 手机页面

手机页面是纯静态 PWA：

- “本次结果”展示国内优先、国际补充的综合精选。
- “关注城市”追踪杭州、衢州、伊春。
- 每张卡片显示发布日期，并提供独立朗读、停止和语速。
- 页面没有“获取最新消息”按钮；更新固定由 Mac 的计划任务完成。
- Service Worker 对晚报 JSON 使用网络优先策略，离线时回退到最近一次成功缓存。

## 收藏

点击卡片“收藏”后，完整卡片写入当前手机浏览器的 Local Storage；没有点击收藏的内容不会写入收藏存储。“我的收藏”可以按收藏日期查看。

收藏不会进入 Git 仓库或 GitHub Pages，也不会在手机和电脑之间同步。清理浏览器网站数据、更换浏览器或更换手机会丢失本机收藏。原来保存在 `data/favorites/` 中的旧版收藏文件仍保留，但静态页面不会读取它们。

## 数据位置

- `public/data/latest.json`：唯一发布到 Pages 的最终精选晚报。
- `data/runtime/refresh.lock`：本地任务运行时的跨进程锁，完成后删除。
- `data/runtime/last-publish.json`：本机最近一次成功推送标记，用于避免当天重复补跑。
- 浏览器 Local Storage：当前设备的用户收藏。
- `logs/`：launchd 标准输出和错误日志。

不会发布原始候选数据、Codex 认证、GitHub 凭据或本地运行日志。

## 本地预览

需要在 Mac 上预览当前静态页面时运行：

```bash
npm run serve
```

然后打开终端显示的 `http://localhost:4173` 或局域网地址。页面读取的仍然是 `public/data/latest.json`；本地 Node API 不再是手机 Pages 页面的依赖。

## 信息与分析规则

默认每份晚报最多 22 条，每条信息只能归入一个板块。以下最低数量仅在存在合格候选时满足，最高数量由程序强制限制：

| 板块 | 每日数量 | 选择标准 |
| --- | ---: | --- |
| 关注城市 | 4–6 条 | 杭州、衢州、伊春的政策、公共服务、机会和风险；有合格候选时每座城市至少 1 条、单城市最多 3 条 |
| 职业/收入/技术 | 3–5 条 | 能改变工作方法、收入路径或职业判断，并包含真实需求或可验证入口 |
| 国家级 | 2–4 条 | 国家层面的变化能通过规则、就业、价格或公共服务明确传导到个人 |
| 实用提醒 | 1–3 条 | 包含截止时间、安全风险、价格调整或办事规则变化，个人能够采取行动 |
| 国际 | 0–2 条 | 对国内生活、工作、价格、产业或安全存在明确传导 |
| 热点 | 0–2 条 | 包含新增事实或具有长期意义，不收录纯情绪争议和围观内容 |

每条信息的“对普通人的影响”必须给出明确方向、受影响人群、变化结论、影响路径、短期和中长期变化、可执行行动及证据边界。Codex 只能分析采集程序提供的候选内容，不会在整理过程中自行搜索网络或生成不存在的链接。

职业机会以“前端开发 + UI 设计”作为能力迁移起点，但不把内容限制在当前岗位。候选证据充足时，职业板块中的 3–5 条由 1–2 条相邻领域机会和 2–3 条陌生领域机会组成，并分别添加 `相邻领域机会`、`陌生领域机会` 标签；融资、发布会或行业预测本身不算真实机会。

商业与技术来源使用爱范儿、开源中国和人人都是产品经理，不再使用会返回验证页的 36 氪。教育部和应急管理部采用 30 天时间窗口补充低频但可行动的教育、就业、考试、安全和灾害提醒。为避免单类资讯挤占晚报，爱范儿、开源中国各最多采用 2 条，人人都是产品经理、教育部、应急管理部各最多采用 1 条；这些上限由程序再次强制执行。

主要配置：

- `config/sources.json`：信息源、城市、时间范围和请求限制。
- `config/preferences.json`：关注主题、排除内容和精选数量。
- `schema/codex-digest.schema.json`：Codex 必须遵守的输出结构。

## 测试

```bash
npm test
```

测试不调用真实网络或 Codex，覆盖信息解析、筛选结构、静态原子写入、失败保留上一版、17:00 补跑判断、只提交静态数据文件、浏览器收藏、语音和本地预览 API。
