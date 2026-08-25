# 知序

知序是一套面向个人与团队的知识协作平台。产品实现独立开发，Docmost 与语雀只作为能力和交互参考。

## 技术架构

- Web：Vue 3、Vuetify、Pinia、Vue Router、TanStack Query、Vite。
- 业务 API 与 Worker：Java 25、Spring Boot、PostgreSQL。
- 实时协作：Rust、Tokio、Yrs（Yjs 协议）。
- 部署：Docker Compose、Nginx、GitHub Actions。

## 主要能力

- 邮箱账号、密码或邮箱验证码登录、邀请注册、首次启动管理员初始化。
- 工作区、团队、知识库、目录、文档、白板、电子表格和数据表。
- 实时协作、离线编辑与冲突提示、评论、权限、附件、历史和发布。
- 小记、全局搜索、消息、动态、模板、导入导出、回收站和统计。
- 公开主页、知识花园、公开阅读、分享链接、开放平台与管理后台。

## 持续集成与部署

`main` 分支上的 Web 变更会由 GitHub Actions 安装锁定依赖、运行单元测试、构建前端并验证容器。部署步骤默认关闭；手动触发工作流，或显式设置仓库变量 `DEPLOY_WEB_ON_PUSH=true` 后才会更新服务器上的 `web` 服务。数据库、API、Worker 和协作服务不会在 Web 部署中重建。

生产连接信息只应保存为 GitHub Environment Secrets，不得提交 `.env`、私钥或服务器地址。工作流需要 `VPS_HOST`、`VPS_PORT`、`VPS_USER`、`VPS_DEPLOY_PATH`、`VPS_SSH_PRIVATE_KEY` 和 `VPS_KNOWN_HOSTS`。
