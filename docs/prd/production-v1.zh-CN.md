# FluxArt Production V1 PRD 中文版

## 问题陈述

FluxArt 当前已经有一个打磨较好的 Next.js App Router 产品界面，使用 mock 仓储数据和优先 mock 的图片生成流程。但它还不是一个生产级产品，因为用户身份、持久化积分记账、付费订单履约、基于 MinIO 的资产存储、模型供应商执行，以及支付通知都还没有完全由持久化基础设施支撑。

下一个生产切片需要在保留当前 UI 方向和 API 边界的前提下，把 mock 产品变成真正的在线 AI 图片生成服务。

## 解决方案

基于当前 Next.js、React 和 TypeScript 应用构建 FluxArt Production V1。将内存仓储替换为由 MySQL 支撑的 Prisma 适配器，增加用户自填用户名/密码账号，实现服务端 session，让积分和会员具备账本支撑，把源图和生成图存储到公开 MinIO bucket，通过可替换的模型供应商 runner 执行图片生成，并根据已验证的 Epay 支付通知履约积分包和 Pro 会员。

默认图片供应商仍为 OpenAI `gpt-image-2`，同时支持自定义 OpenAI 兼容图片供应商，以及未来的异步供应商。

## 用户故事

1. 作为新用户，我希望用用户名和密码注册，这样不用手机号或邮箱验证也能使用 FluxArt。
2. 作为回访用户，我希望用用户名和密码登录，这样可以访问我的工作区。
3. 作为用户，我希望登录 session 安全地保持，这样每次打开应用时不需要重新登录。
4. 作为用户，我希望修改密码后清理旧 session，这样被泄露的 session 会失效。
5. 作为新用户，我希望获得注册赠送积分，这样可以立即尝试图片生成。
6. 作为免费用户，我希望在使用产品时获得每日免费积分，这样可以持续轻量试用 FluxArt。
7. 作为免费用户，我希望清楚看到生成和历史记录限制，这样能理解为什么可能需要积分或 Pro。
8. 作为积分包用户，我希望购买固定积分包，这样可以为偶尔的生成工作付费。
9. 作为 Pro 会员，我希望获得每月积分和更高限制，这样 FluxArt 能支持重复的生产使用。
10. 作为 Pro 会员，我希望在公平使用额度内下载高清无水印图片，这样会员权益有可见价值。
11. 作为用户，我希望生成前先冻结积分，并在没有可用输出时退回积分，这样失败任务不会不公平地消耗余额。
12. 作为用户，我希望图片任务显示稳定状态，这样能知道生成处于排队、运行、存储、审核、成功、失败或已退款状态。
13. 作为用户，我希望安全上传源图和蒙版，这样编辑和扩图不会因为输入损坏而失败。
14. 作为用户，我希望生成资产被可靠存储，这样历史记录和下载不依赖服务端内存。
15. 作为 Pro 会员，我希望符合条件的资产带有商业授权说明，这样可以识别哪些生成结果享有 Pro 权益。
16. 作为运营者，我希望图片供应商抽象在统一 runner 后面，这样 OpenAI 可以作为默认供应商，同时保留其他供应商的可能性。
17. 作为运营者，我希望同步和异步供应商被归一化，这样供应商特定响应形态不会泄漏到产品逻辑里。
18. 作为运营者，我希望支付回调经过验证且幂等，这样积分和会员不会被重复发放。
19. 作为运营者，我希望订单履约失败可重试，这样付费用户可以被补偿，而不需要手动改数据库。
20. 作为运营者，我希望积分和支付账本不可变，这样可以支持账单客服和对账。
21. 作为运营者，我希望使用公开 MinIO URL 和不可猜测的 key，这样 V1 交付简单，同时资产不容易被枚举。
22. 作为运营者，我希望校验 MySQL、MinIO、OpenAI、自定义供应商和 Epay 环境配置，这样部署错误能尽早暴露。

## 实现决策

- 保持应用使用 Next.js App Router、React 和 TypeScript。
- 将安全操作放在服务端模块和 route handler 中。客户端组件调用类型化 client API，而不是直接调用供应商、MinIO 或支付 API。
- 将数据访问边界后面的内存仓储替换为 Prisma/MySQL 实现，而不是修改页面级契约。
- 使用用户自填的用户名/密码账号。V1 不要求手机号或邮箱。
- 在服务端存储密码哈希，使用现代密码哈希。优先使用 Argon2id；如果部署约束让 Argon2 较难落地，则 bcrypt 可接受。
- 使用 httpOnly cookie session，sameSite=lax，生产环境启用 secure cookie，30 天滑动续期，90 天绝对过期，并限制最多 5 个活跃 session。
- 注册时赠送 50 Promotional Credits。
- 免费用户首次查询余额或当天首次开始任务创建时，懒发放 10 Daily Free Credits，且 Daily Free Credits 上限为 30。
- 对所有发放、消费、退款、冻结和调整使用 Credit Buckets 和不可变 Credit Ledger Entries。
- 优先消耗即将过期的 Promotional Credits，其次消耗月度会员赠送积分，最后消耗 Purchased Credits。
- 创建图片任务前先冻结积分。只有可用输出通过审核时，才把冻结转换为最终消费。系统失败或输出审核失败时释放或退款冻结积分。
- 使用固定 V1 成本：文生图每张 10 credits，图生图每张 15 credits，局部重绘每次 20 credits，扩图每次 30 credits，非 Pro 用户高清无水印下载每张 5 credits。
- 提供 3 个长期积分包：500 credits 售价 CNY 29，1500 credits 售价 CNY 79，5000 credits 售价 CNY 199。
- 提供 CNY 69/月的 Pro 会员占位方案，赠送 1000 月度 Promotional Credits，并提供更高限制。Pro 不是无限制，也不在 V1 享有积分折扣。
- Pro 每月包含 300 次高清无水印下载；超出后每张收取 5 credits。
- 将月度 Pro 赠送积分存储为 Promotional Credit Buckets，并在会员周期结束时过期。
- 使用紧凑任务状态机：queued、running、storing、reviewing、succeeded、failed、refunded。
- 使用可替换的 Image Task Runner 边界。V1 可以从 Next.js 服务端进程执行，但任务状态、优先级和供应商抽象必须允许后续迁移到 BullMQ、cloud tasks 或独立 worker。
- 将同步和异步图片供应商归一化为 Provider Submission 和 Provider Result 记录。
- 默认使用供应商 `openai` 和模型 `gpt-image-2`，同时支持自定义 OpenAI 兼容图片供应商。
- 使用公开 MinIO bucket。对象 key 必须包含 UUID 或 ULID 标识，并且不应依赖连续 id 作为保密手段。
- 为每次上传或资产存储 `objectKey`、`publicUrl`、MIME 类型、大小、宽度和高度。
- 在服务端强制上传约束：JPEG、PNG 和 WebP 源图最大 10MB，最大边长 4096px；必要时将 PNG/WebP 蒙版规范化。
- 最终扣除积分前审核生成输出。初始 V1 审核可以轻量，但必须保留审核状态，以便后续接入内容审核。
- 使用服务端 Epay 集成。服务端创建本地订单，并把供应商 notify 回调视为真实支付结果来源。
- 支付通知必须验证签名、金额、商户、状态，并且必须幂等。
- 付费订单必须事务性履约。积分包订单创建 Purchased Credit Buckets；Pro 订单创建或延长 Membership Cycles，并发放月度积分。
- 区分可见资产历史与物理对象删除。免费用户保留 7 天或最多 20 个可见历史资产，以更严格者为准。V1 中付费资产长期保留。
- 在符合条件的资产上存储 Pro 商业授权快照。不要对上传内容、商标、肖像或其他外部材料的第三方权利作过度承诺。

### Prisma/MySQL 表设计

V1 应建模以下持久化记录：

- `User`：账号身份、显示名、状态和时间戳。
- `UserCredential`：用户名、密码哈希、哈希版本和密码修改时间戳。
- `UserSession`：哈希后的 session token、滑动过期、绝对过期、撤销时间戳、user agent 和 IP 元数据。
- `CreditBucket`：用户、来源类型、积分类型、原始金额、剩余金额、有效期窗口、优先级、来源订单或会员周期。
- `CreditLedgerEntry`：不可变的发放、冻结、消费、退款、释放、调整记录，包含余额增量和来源引用。
- `CreditHold`：任务或下载预留、冻结金额、状态、过期、转换或退款时间戳。
- `CreditPackSku`：套餐 code、显示名称、积分数量、价格和启用标记。
- `MembershipPlan`：方案 code、月度价格、月度积分赠送、HD 公平使用上限和启用标记。
- `MembershipCycle`：用户、方案、周期开始/结束、支付订单和状态。
- `Order`：用户、SKU 或方案、金额、币种、供应商、outTradeNo、状态和履约状态。
- `PaymentNotification`：订单、供应商交易号、验证状态、原始 payload 摘要、接收时间戳和处理时间戳。
- `ImageUpload`：用户拥有的源图或蒙版上传、对象 key、公开 URL、MIME 类型、大小、尺寸和校验状态。
- `ImageTask`：用户、任务类型、prompt、模型/供应商、状态、优先级、成本、queued/running/storing/review 时间戳和失败原因。
- `ProviderSubmission`：任务、供应商、模型、供应商模式、请求元数据和外部任务 id。
- `ProviderResult`：submission、归一化结果状态、原始 payload 摘要、输出元数据和错误元数据。
- `ImageAsset`：任务和用户、对象 key、公开 URL、尺寸、审核状态、水印/HD 标记、权益快照和删除时间戳。
- `DownloadEvent`：资产、用户、下载类型、积分成本、Pro 公平使用统计和时间戳。
- `AssetCleanupJob`：可选的延迟物理 MinIO 清理任务，用于软删除或保留期过期的资产。

## 测试决策

- 优先在行为边界测试：route handlers、服务端 services、repository adapter 契约和浏览器 smoke flows。
- 仓储测试应证明 Prisma adapter 行为匹配当前 repository 契约，而不是测试 Prisma 内部实现。
- 认证测试应覆盖注册、登录、session 续期、活跃 session 上限、登出和密码修改后的撤销。
- 积分测试应覆盖注册赠送、懒发放每日积分、消费优先级、冻结、最终消费、退款和余额不足失败。
- 支付测试应覆盖 Epay 签名、notify 验证、重复回调、错误金额、错误商户和履约重试。
- 图片测试应覆盖上传校验、任务状态转换、供应商成功/失败、MinIO 写入、输出审核和资产创建。
- 浏览器验证应覆盖 `/workspace/image`、`/workspace/image/edit/[assetId]`、`/workspace/image/assets`、`/workspace/account` 和 `/workspace/billing`。
- 构建门禁应包含 typecheck、lint、build、环境校验和 API smoke checks。

## 范围外

- 手机验证、邮箱验证、OAuth 登录、SSO 和企业账号。
- 完整法律商业授权文本起草。
- 无限 Pro 生成。
- 将 Redis、BullMQ 或专用 worker 部署作为 V1 硬性要求。
- 私有 MinIO bucket 和签名 URL。
- 完整人工审核工具。
- 超出单次付费 Pro 周期和付款后延期行为之外的订阅自动续费边界情况。
- 退回到外部支付方式的退款。

## 补充说明

- 应保留现有 UI，并逐步接入真实生产 API。
- 本地开发应继续尽可能支持 mock 或降级模式，但生产路径必须明确且通过环境校验。
- `docs/adr/` 中的 ADR 文件是本 PRD 背后详细权衡的事实来源。
