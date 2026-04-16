# 微信ClawBot RESTful异步通信版

OpenClaw 的微信渠道插件，支持通过扫码完成登录授权 [微信ClawBot English](./README.wx.md) [微信ClawBot 中文](./README.wx.zh_CN.md)。

## 独立 Node.js 服务器模式（不依赖 OpenClaw 主进程）

除了作为 OpenClaw 插件运行，本项目还可以**作为一个独立的 Node.js 进程**启动，无需安装或运行 OpenClaw 网关。  
这适合将微信机器人集成到自己的 CI/CD 或 Docker 流程中。

### 前置条件

- Node.js ≥ 22（已安装）
- 已 clone 本仓库并安装依赖：

```bash
git clone https://github.com/ntwck/ilink-wechat.git
cd ilink-wechat
npm install
```

### 第一步：扫码登录

```bash
npm run login
```

终端会显示一个二维码，用微信扫码后即完成授权。

**凭证存储位置：**

```
~/.openclaw/
└── openclaw-weixin/
    ├── accounts.json               # 已登录账号 ID 索引
    └── accounts/
        └── <accountId>.json        # 每个账号的 token 和 baseUrl
```

**迁移到另一台服务器：** 只需把 `~/.openclaw/openclaw-weixin/` 目录整体复制过去即可（无需重新扫码）：

```bash
# 在原机器上打包
tar czf wechat-accounts.tar.gz -C ~/.openclaw openclaw-weixin/

# 在新机器上解压
mkdir -p ~/.openclaw
tar xzf wechat-accounts.tar.gz -C ~/.openclaw/
```

### 第二步：创建配置文件

在**项目根目录**（运行 `npm run serve` 的目录）创建 `ilink-wechat.json`：

```json
{
  "id": "openclaw-weixin",
  "version": "2.1.8",
  "channels": [
    "openclaw-weixin"
  ],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  },
  "accountId": "单账号可不填写，多个账号请填写账号ID",
  "provider": {
    "type": "rest",
    "endpoint": "http://localhost:3000/api/bot/ilink",
    "authToken": "请自行设置一个随机字符串，确保接口安全",
    "timeoutMs": 30000,
    "fallbackMessage": "Ooops...",
    "mode": "async",
    "callbackPort": 8765,
    "callbackPath": "/callback",
    "callbackAuthToken": "请自行设置一个随机字符串，确保回调接口安全"
  }
}
```

> **注意：** 即使你已有 `~/.openclaw/openclaw.json`，也需要单独创建这个文件，因为现有的 `openclaw.json` 中通常没有 `provider` 配置。也可以在 `ilink-wechat.json` 中通过 `accountId` 指定账号（省略则自动使用唯一已登录账号）。
>
> 支持 `rest` 和 `ws` 两种 provider，协议格式与"个人机器人模式"一节完全相同。

### 第三步：启动服务器

```bash
npm run serve
```

启动后输出：

```
🤖 ilink-wechat standalone server
   account : abc123-im-bot
   provider: rest
   baseUrl : https://ilinkai.weixin.qq.com
   logFile : /tmp/openclaw/openclaw-2026-04-15.log

Press Ctrl+C to stop.
```

### 命令行参考

```bash
# 扫码登录（保存凭证到 ~/.openclaw）
npm run login

# 启动服务器
npm run serve

# 帮助
node dist/src/server/index.js help
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | 凭证和状态的存放目录 |
| `OPENCLAW_LOG_LEVEL` | `INFO` | 日志级别：`TRACE` `DEBUG` `INFO` `WARN` `ERROR` |
| `ILINK_CONFIG` | 自动检测 | 配置文件路径（优先级：`$ILINK_CONFIG` > `./ilink-wechat.json` > `~/.openclaw/openclaw.json`） |

### Docker 部署示例

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Mount pre-exported credentials directory at /root/.openclaw
# 1. Run `npm run login` on the host machine first
# 2. Then `docker-compose up`

CMD ["node", "dist/src/server/index.js", "start"]
```

`docker-compose.yml`：

```yaml
services:
  wechat-bot:
    build: .
    volumes:
      - ~/.openclaw/openclaw-weixin:/root/.openclaw/openclaw-weixin   # 挂载凭证
      - ./ilink-wechat.json:/app/ilink-wechat.json                    # 挂载配置文件
    restart: unless-stopped
```

### 多账号支持

登录多个账号后，在配置文件中指定要使用的账号：

```json
{
  "accountId": "abc123-im-bot",
  "provider": { "type": "rest", "endpoint": "http://localhost:8080/chat" }
}
```

如果只登录了一个账号，可省略 `accountId`，服务器会自动使用唯一的那个账号。
