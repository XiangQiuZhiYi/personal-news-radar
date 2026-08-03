# 个人信息晚报

这个工具每天集中运行一次：从配置的 RSS/Atom 信息源拉取新内容，把候选信息通过标准输入交给 Codex，再将 Codex 返回的结构化分类、摘要和价值评分生成成适合手机阅读的静态 PWA。默认信息结构以国内政策、财经、社会、商业和科技为主，国际重大事件与前沿研究为辅。

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
手机 PWA 信息晚报
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

## 运行

采集真实信息源并生成今晚简报：

```bash
npm run daily
```

用内置测试信息源验证完整 Codex 流程：

```bash
npm run daily:fixture
```

启动手机页面：

```bash
npm run serve
```

电脑访问 `http://localhost:4173`。手机与电脑在同一个 Wi-Fi 时，使用 `http://电脑局域网IP:4173` 访问，然后添加到手机主屏幕。

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

## 每晚运行

第一版建议使用电脑自身的系统定时任务，在每天晚上运行 `npm run daily`。这样不需要购买服务器，但电脑在执行时间需要保持开机和联网。

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

安装会把任务写入当前用户的 `~/Library/LaunchAgents`，并把执行日志写入项目的 `logs/`。本项目不会自动执行安装，避免未经确认修改系统计划任务。

如果以后部署到云端，建议将采集与 Codex 调用作为受信任的私有任务运行，不要把 Codex CLI 或认证信息暴露给网页用户。

## 数据位置

- `data/raw/YYYY-MM-DD.json`：本次采集的原始候选，仅保存在本地并被 Git 忽略。
- `public/data/latest.json`：手机页面读取的最新简报。
- `public/data/archive/YYYY-MM-DD.json`：历史简报，默认被 Git 忽略。

## 测试

```bash
npm test
```

测试不调用网络或 Codex，只验证 RSS 解析、去重和 Codex 结果合并边界。
