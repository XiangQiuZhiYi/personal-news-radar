# 个人信息晚报

这个工具由用户在网页上手动触发：从配置的 RSS/Atom 信息源拉取新内容，把候选信息通过标准输入交给 Codex，再将 Codex 返回的结构化分类、摘要和价值评分保存到电脑本地，并生成适合手机阅读的 PWA。默认信息结构以国内政策、财经、社会、商业和科技为主，国际重大事件与前沿研究为辅。

## 工作方式

```text
RSS / Atom 信息源
        ↓
精确去重与时间过滤
        ↓
codex exec + JSON Schema
        ↓
语义去重、分类、价值筛选
        ↓
public/data/latest.json
        ↓
手机 PWA 今日累计与本地历史
```

Codex 只返回候选条目的 ID 和分析字段；标题、来源和原始链接始终从采集结果中回填，避免模型生成不存在的链接。

## 环境要求

- Node.js 20 或更高版本
- 已安装 Codex CLI
- 已执行 `codex login`，可以使用 ChatGPT 订阅登录或 API Key 登录

检查登录状态：

```bash
codex login status
```

Windows 下程序会优先使用 `PATH` 中的 Codex CLI；如果通过 Codex Desktop 安装，也会自动查找 `%LOCALAPPDATA%\OpenAI\Codex\bin` 中随应用提供的 `codex.exe`。仍无法自动找到时，可以在启动服务前显式指定完整路径：

```powershell
$env:CODEX_BIN = "C:\完整路径\codex.exe"
npm run serve
```

macOS 下程序会先查找 `PATH`，随后自动检查 `/Applications/Codex.app`、`/Applications/ChatGPT.app` 以及用户 `Applications` 目录中的内置 Codex CLI。从 Windows 切回 Mac 时，不要沿用指向 `codex.exe` 的 `CODEX_BIN`；可在启动服务前执行 `unset CODEX_BIN`，再重新运行 `npm run serve`。

## 运行与手动刷新

启动本机 Node 服务：

```bash
npm run serve
```

启动后终端会直接打印可用的局域网地址，例如 `http://192.168.1.20:4173`。手机与电脑在同一个 Wi-Fi 时打开该地址，点击页面上的“获取最新消息”即可启动采集与 Codex 整理。

网页刷新采用异步任务，同一时间只允许一个任务运行。只有完整整理并保存成功后才会开始 30 分钟冷却；刷新失败不会计入当日整理次数、不会触发冷却，也不会覆盖已有简报，可以立即重试。

刷新接口不设置访问口令；同一局域网中的其他设备也可能触发任务，30 分钟冷却只限制频率，不提供身份认证。

仍可通过命令行直接生成：

采集真实信息源并生成今晚简报：

```bash
npm run daily
```

用内置测试信息源验证完整 Codex 流程：

```bash
npm run daily:fixture
```

命令行触发不受网页 30 分钟冷却限制，但会与网页任务共享跨进程锁。页面可添加到手机主屏幕。

## 本地记录

同一天多次整理会合并为一个每日集合。相同文章只保留一条，采用最近一次分析，同时记录首次发现时间、最后发现时间和出现次数。首页展示当天累计内容，“历史记录”视图按日期读取电脑中的历史文件。

历史记录永久保存在 `data/history/YYYY-MM-DD.json`，不会使用浏览器 Local Storage 或数据库。不同来源对同一事件的报道不会跨批次进行语义合并。

## 语音播报

页面支持使用浏览器语音引擎连续朗读当前分类，也可以在新闻卡片上单独朗读一条。连续播放会先读当天概览，再读取每条新闻的标题、摘要和“对普通人的影响”；影响分析包括受影响人群、影响路径、短期与中长期变化、可采取行动和不确定性。评分、来源、标签、“为什么值得看”和其他界面文字不会进入应用的语音队列。

可暂停、继续、停止并选择 `0.8×`、`1.0×`、`1.15×` 或 `1.25×` 语速。语音由当前设备浏览器提供，不生成音频文件，也不保存播放进度。切换分类、日期或简报会停止当前播报。

新生成的简报会为每条新闻增加结构化的“对普通人的影响”。旧历史不会重新调用 Codex 补齐；只有一句影响总览的旧记录仍可正常展示和朗读，完全缺少该字段时页面自动隐藏对应区块。

## 配置

- `config/sources.json`：信息源、采集时间范围、请求超时和候选数量。
- `config/preferences.json`：关注主题、排除内容、探索比例和每日精选上限。
- `schema/codex-digest.schema.json`：Codex 必须遵守的输出结构。

新增信息源时，在 `config/sources.json` 的 `sources` 数组中加入：

```json
{
  "name": "信息源名称",
  "url": "https://example.com/feed.xml",
  "categoryHint": "主题提示",
  "region": "domestic",
  "enabled": true
}
```

单个信息源失败不会阻止其他来源生成简报，失败信息会写入 `sourceErrors`。
默认还会限制单一来源和单一分类的入选数量，避免某个高频信息源垄断整份晚报。
`region` 可填写 `domestic` 或 `international`。默认最多保留 4 条国际信息，其余名额优先用于国内内容。

## 可选定时运行

网页手动刷新是默认使用方式。如果确实需要无人值守运行，也可以使用电脑自身的系统定时任务；电脑在执行时间需要保持开机和联网。

在 macOS 安装每天 22:00 执行的任务：

```bash
npm run schedule:install
```

指定其他时间，例如每天 21:30：

```bash
npm run schedule:install -- --hour 21 --minute 30
```

安装前只预览系统任务配置，不产生系统修改：

```bash
npm run schedule:preview
```

安装会把任务写入当前用户的 `~/Library/LaunchAgents`，并把执行日志写入项目的 `logs/`。本项目不会自动安装或启用定时任务。

如果以后部署到云端，建议将采集与 Codex 调用作为受信任的私有任务运行，不要把 Codex CLI 或认证信息暴露给网页用户。

## 数据位置

- `data/raw/YYYY-MM-DD/<runId>.json`：每次采集的原始候选，仅保存在本地并被 Git 忽略。
- `data/history/YYYY-MM-DD.json`：按日期合并的真实历史记录，仅保存在电脑本地。
- `data/runtime/`：跨进程锁和网页刷新冷却状态。
- `public/data/latest.json`：当天累计记录的页面读取副本。

旧版 `public/data/archive/*.json` 和 `latest.json` 会在启动服务或下次生成时幂等迁移，不会自动删除旧文件。

## 测试

```bash
npm test
```

测试不调用网络或 Codex，覆盖 RSS 解析、去重、每日合并、旧数据迁移、文件锁、冷却状态和本地 API。
