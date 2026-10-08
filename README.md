# Enjoy English Coach

Enjoy English Coach 是一个面向中文母语成人学习者的英语精读教练项目。

它的目标不是做普通的文件管理器，也不是简单堆叠聊天、视频、音频和电子书功能，而是把用户选择的英文材料转化为可以阅读、查词、高亮、练习、复习和持续跟踪的学习内容。

## 产品目标

用户可以导入自己的英文书籍，在统一阅读器中完成精读。系统记录阅读位置、查词、高亮和复习结果，并逐步形成可用于个性化学习计划的真实学习数据。

当前优先服务 B1–B2 水平的中文母语成人用户。核心学习流程即使没有配置 AI 也应正常使用；AI 只负责按需解释和增强练习，并通过缓存与每日额度控制成本。

## 当前学习流程

1. 导入 EPUB、TXT 或可提取文字的 PDF。
2. 系统解析目录、章节、段落和学习分页。
3. 用户按章节阅读并自动保存进度。
4. 单独选择英文单词，查看英英释义、音标和发音。
5. 将重点单词加入生词本，并保留书籍、章节和上下文来源。
6. 对句子或段落添加红色、黄色或绿色高亮。
7. 在书内或全局高亮页面整理、改色和删除高亮。
8. 完成基础练习和到期复习，更新词汇学习状态。
9. 在需要时主动请求 AI 上下文解释或语法分析。

## 已实现功能

### 电子书导入与书库

- 支持 EPUB、TXT 和可提取文字的 PDF。
- 支持点击选择和拖拽导入单本书籍。
- 展示文件格式、大小、解析状态和阅读进度。
- 自动提取 EPUB 封面、生成 PDF 第一页封面或文字封面。
- 支持上传自定义 JPG、PNG 或 WebP 封面。
- 删除书籍时同步清理本地原文件和封面。

### 精读阅读器

- EPUB 和 TXT 按章节及语义边界拆分学习页。
- 学习分页以约 350–500 个英文单词为目标，并设置硬上限。
- PDF 保留原始页码，避免合并不同 PDF 页面。
- 自动保存当前章节、学习位置和完成进度。
- 重新打开书籍时可以继续上次阅读位置。

### 词典与生词

- 单独选择英文单词后查询免费英英词典。
- 显示词条、音标、英文释义和可用发音。
- 支持从词典释义中继续查询陌生单词。
- 右侧最多保留五张词典卡，重复词不会重复添加。
- 保存生词时记录书籍、章节、上下文和来源类型。

### 高亮与整理

- 支持对选中的句子或段落添加红、黄、绿三种高亮。
- 已有高亮可以修改颜色或删除。
- 支持查看单本书的全部高亮。
- 支持跨书籍查看和复习全部高亮。

### 练习与复习

- 无需 AI 即可根据当前章节生成基础选择练习。
- 错误词汇会进入学习状态并安排后续复习。
- 提供生词复习和高亮复习入口。
- 首页展示继续阅读、今日复习和近期学习数据。

### 按需 AI

- 提供统一的 OpenAI-compatible Provider 配置。
- AI 上下文解释由用户主动触发，不在普通阅读时自动消耗额度。
- 支持每日调用上限与结果缓存。
- 未配置 API Key、达到额度或 AI 服务失败时，阅读、词典和基础复习仍可工作。

### 邀请制访问与私有存储

- 登录邮箱由 `LOGIN_ALLOWED_EMAILS` 白名单控制。
- 登录验证码通过 Resend 发送，验证码只以摘要形式保存。
- 登录状态使用 HttpOnly Cookie；修改数据的接口执行同源检查。
- 新导入的书籍和封面保存在非公开的数据目录，并按账号校验访问权限。

## 当前限制

- 扫描版 PDF 暂不支持 OCR，因此无法提取图片中的文字。
- 加密、损坏或排版复杂的 PDF 可能解析失败或丢失布局信息。
- EPUB 中的复杂图片、公式、脚注和内部链接可能无法完全还原。
- PDF 使用原始页作为学习页，个别页面可能包含过多文字。
- AI Provider 的真实输出质量、费用和模型兼容性仍需继续验证。
- 视频字幕学习、音频精听、跟读和口语评分不属于当前 MVP 核心范围。

## 技术架构

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Prisma 5
- SQLite
- 本地文件存储
- EPUB、PDF 与纯文本解析
- JWT 与 HttpOnly Cookie 登录状态
- OpenAI-compatible AI Provider

当前阶段保留 Next.js 单体架构、SQLite 和本地文件存储，以较低成本验证完整学习闭环。产品稳定后再考虑迁移 PostgreSQL、对象存储和独立解析服务。

## 本地运行

### 环境要求

- Node.js 20 或更高版本
- npm
- 一个 Resend 账号和已验证的发件地址（登录验证码需要）

### 1. 克隆与安装

```bash
git clone https://github.com/Kimjoejjjjj/enjoy-english-reading-room.git
cd enjoy-english-reading-room
npm ci
```

项目会从仓库内固定版本的 Open English WordNet 数据包生成本地词典索引，不需要在安装时下载词典。

### 2. 配置本地环境

复制 `.env.example` 为 `.env.local`：

```powershell
Copy-Item .env.example .env.local
```

macOS 或 Linux：

```bash
cp .env.example .env.local
```

至少填写以下值：

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="生成一个至少 32 字符的随机值"
OTP_HASH_SECRET="生成另一个至少 32 字符的随机值"
LOGIN_ALLOWED_EMAILS="your-email@example.com"
RESEND_API_KEY="你的 Resend API Key"
RESEND_FROM_EMAIL="你在 Resend 验证过的发件地址"
TRUST_PROXY_HOPS="0"
APP_DATA_DIR=""
AI_QUOTA_ENABLED="false"
```

可以运行下面的命令两次，分别生成 `JWT_SECRET` 和 `OTP_HASH_SECRET`：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

当前版本没有绕过验证码的开发登录入口。未配置 Resend 时可以安装和构建项目，但无法完成登录。不要把 `.env.local` 或真实密钥提交到仓库。

### 3. 初始化与启动

```bash
npx prisma generate
npx prisma db push
npm run dev
```

打开 `http://localhost:3000`。

### 可选 AI 配置

AI 不是阅读、词典、标记和基础复习的必需条件：

```env
AI_API_KEY=""
AI_BASE_URL="https://api.deepseek.com"
AI_MODEL="deepseek-flash"
AI_PROVIDER="deepseek"
AI_DAILY_LIMIT="20"
AI_QUOTA_ENABLED="false"
```

如果需要保存用户自己的 AI Key，还需设置一个 32 字节 Base64 编码的 `AI_CREDENTIAL_ENCRYPTION_KEY`。真实 API Key 只应写在本机 `.env.local`，不要提交到 Git 仓库，也不要在网页、Issue 或聊天中粘贴。

### 生产部署

生产环境必须使用持久化绝对路径、正确配置反向代理层数，并提供完整的邀请登录配置。部署前请阅读 [`docs/vps-invitation-beta.md`](docs/vps-invitation-beta.md)。本地开发配置不能直接当作生产配置使用。

## 常用命令

```bash
npm run dev
npm run typecheck
npm run test:security
npm run build
```

当前完整 `npm run lint` / `npm run check` 仍会扫描历史备份、压缩后的 PDF 第三方脚本和暂时关闭的旧媒体页面，因此尚未作为公开发布验收命令。当前版本的干净副本已通过依赖安装、数据库初始化、125 项隔离测试、TypeScript、生产构建和本地 HTTP 启动检查；完整 Lint 技术债仍需后续单独收敛。

## 本地数据与隐私

开发环境中的数据库、上传书籍、自动生成封面、临时文件和 `.env` 均被排除在 Git 之外，不会随代码推送到 GitHub。

默认本地数据主要位于：

- `prisma/dev.db`
- `.tmp/app-data/`
- `public/uploads/`（旧版本数据）
- `public/covers/`（旧版本数据）
- `public/temp/`（旧版本数据）

删除或迁移项目前，请根据需要单独备份这些目录和数据库。

## 许可证与第三方数据

项目代码遵循仓库中的 [MIT License](LICENSE)。仓库包含 Open English WordNet 2025 Core 原始数据包，用于离线生成词典索引；该数据集遵循 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，来源、版本和校验值记录在 [`vendor/dictionaries/README.md`](vendor/dictionaries/README.md)。

## 后续方向

1. 扩大 EPUB、TXT 和 PDF 的真实书籍回归测试集。
2. 改进复杂排版、超长 PDF 页面和旧书籍分页迁移。
3. 完善高亮、词汇和章节练习形成的复习闭环。
4. 基于真实学习事件生成用户英语画像和每日学习计划。
5. 阅读闭环稳定后，再复用现有数据模型开发视频与音频学习。

## 产品原则

这个项目最终要成为一个知道用户今天应该学什么、能够解释学习材料，并能根据真实学习结果持续调整计划的 AI 英语教练。

功能数量不是首要目标。阅读、理解、记录、练习、复习和反馈形成稳定闭环，才是项目持续开发的判断标准。
