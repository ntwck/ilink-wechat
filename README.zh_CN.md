# 微信

[English](./README.md)

OpenClaw 的微信渠道插件，支持通过扫码完成登录授权。

## 兼容性

| 插件版本 | OpenClaw 版本            | npm dist-tag | 状态   |
|---------|--------------------------|--------------|--------|
| 2.0.x   | >=2026.3.22              | `latest`     | 活跃   |
| 1.0.x   | >=2026.1.0 <2026.3.22    | `legacy`     | 维护中 |

> 插件在启动时会检查宿主版本，如果运行的 OpenClaw 版本超出支持范围，插件将拒绝加载。

## 前提条件

已安装 [OpenClaw](https://docs.openclaw.ai/install)（需要 `openclaw` CLI 可用）。

查看版本：`openclaw --version`

## 一键安装

```bash
npx -y @tencent-weixin/openclaw-weixin-cli install
```

## 手动安装

如果一键安装不适用，可以按以下步骤手动操作：

### 1. 安装插件

```bash
openclaw plugins install "@tencent-weixin/openclaw-weixin"
```

### 2. 启用插件

```bash
openclaw config set plugins.entries.openclaw-weixin.enabled true
```

### 3. 扫码登录

```bash
openclaw channels login --channel openclaw-weixin
```

终端会显示一个二维码，用手机扫码并在手机上确认授权。确认后，登录凭证会自动保存到本地，无需额外操作。

### 4. 重启 gateway

```bash
openclaw gateway restart
```

## 添加更多微信账号

```bash
openclaw channels login --channel openclaw-weixin
```

每次扫码登录都会创建一个新的账号条目，支持多个微信号同时在线。

## 多账号上下文隔离

默认情况下，私聊可能共用同一会话桶。**多个微信号同时登录**时，建议按「账号 + 渠道 + 对端」隔离：

```bash
openclaw config set session.dmScope per-account-channel-peer
```

## 后端 API 协议

本插件通过 HTTP JSON API 与后端网关通信。二次开发者若需对接自有后端，需实现以下接口。

所有接口均为 `POST`，请求和响应均为 JSON。通用请求头：

| Header | 说明 |
|--------|------|
| `Content-Type` | `application/json` |
| `AuthorizationType` | 固定值 `ilink_bot_token` |
| `Authorization` | `Bearer <token>`（登录后获取） |
| `X-WECHAT-UIN` | 随机 uint32 的 base64 编码 |

### 接口列表

| 接口 | 路径 | 说明 |
|------|------|------|
| getUpdates | `getupdates` | 长轮询获取新消息 |
| sendMessage | `sendmessage` | 发送消息（文本/图片/视频/文件） |
| getUploadUrl | `getuploadurl` | 获取 CDN 上传预签名 URL |
| getConfig | `getconfig` | 获取账号配置（typing ticket 等） |
| sendTyping | `sendtyping` | 发送/取消输入状态指示 |

### getUpdates

长轮询接口。服务端在有新消息或超时后返回。

**请求体：**

```json
{
  "get_updates_buf": ""
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `get_updates_buf` | `string` | 上次响应返回的同步游标，首次请求传空字符串 |

**响应体：**

```json
{
  "ret": 0,
  "msgs": [...],
  "get_updates_buf": "<新游标>",
  "longpolling_timeout_ms": 35000
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ret` | `number` | 返回码，`0` = 成功 |
| `errcode` | `number?` | 错误码（如 `-14` = 会话超时） |
| `errmsg` | `string?` | 错误描述 |
| `msgs` | `WeixinMessage[]` | 消息列表（结构见下方） |
| `get_updates_buf` | `string` | 新的同步游标，下次请求时回传 |
| `longpolling_timeout_ms` | `number?` | 服务端建议的下次长轮询超时（ms） |

### sendMessage

发送一条消息给用户。

**请求体：**

```json
{
  "msg": {
    "to_user_id": "<目标用户 ID>",
    "context_token": "<会话上下文令牌>",
    "item_list": [
      {
        "type": 1,
        "text_item": { "text": "你好" }
      }
    ]
  }
}
```

### getUploadUrl

获取 CDN 上传预签名参数。上传文件前需先调用此接口获取 `upload_param` 和 `thumb_upload_param`。

**请求体：**

```json
{
  "filekey": "<文件标识>",
  "media_type": 1,
  "to_user_id": "<目标用户 ID>",
  "rawsize": 12345,
  "rawfilemd5": "<明文 MD5>",
  "filesize": 12352,
  "thumb_rawsize": 1024,
  "thumb_rawfilemd5": "<缩略图明文 MD5>",
  "thumb_filesize": 1040
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `media_type` | `number` | `1` = IMAGE, `2` = VIDEO, `3` = FILE |
| `rawsize` | `number` | 原文件明文大小 |
| `rawfilemd5` | `string` | 原文件明文 MD5 |
| `filesize` | `number` | AES-128-ECB 加密后的密文大小 |
| `thumb_rawsize` | `number?` | 缩略图明文大小（IMAGE/VIDEO 时必填） |
| `thumb_rawfilemd5` | `string?` | 缩略图明文 MD5（IMAGE/VIDEO 时必填） |
| `thumb_filesize` | `number?` | 缩略图密文大小（IMAGE/VIDEO 时必填） |

**响应体：**

```json
{
  "upload_param": "<原图上传加密参数>",
  "thumb_upload_param": "<缩略图上传加密参数>"
}
```

### getConfig

获取账号配置，包括 typing ticket。

**请求体：**

```json
{
  "ilink_user_id": "<用户 ID>",
  "context_token": "<可选，会话上下文令牌>"
}
```

**响应体：**

```json
{
  "ret": 0,
  "typing_ticket": "<base64 编码的 typing ticket>"
}
```

### sendTyping

发送或取消输入状态指示。

**请求体：**

```json
{
  "ilink_user_id": "<用户 ID>",
  "typing_ticket": "<从 getConfig 获取>",
  "status": 1
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `number` | `1` = 正在输入，`2` = 取消输入 |

### 消息结构

#### WeixinMessage

| 字段 | 类型 | 说明 |
|------|------|------|
| `seq` | `number?` | 消息序列号 |
| `message_id` | `number?` | 消息唯一 ID |
| `from_user_id` | `string?` | 发送者 ID |
| `to_user_id` | `string?` | 接收者 ID |
| `create_time_ms` | `number?` | 创建时间戳（ms） |
| `session_id` | `string?` | 会话 ID |
| `message_type` | `number?` | `1` = USER, `2` = BOT |
| `message_state` | `number?` | `0` = NEW, `1` = GENERATING, `2` = FINISH |
| `item_list` | `MessageItem[]?` | 消息内容列表 |
| `context_token` | `string?` | 会话上下文令牌，回复时需回传 |

#### MessageItem

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `number` | `1` TEXT, `2` IMAGE, `3` VOICE, `4` FILE, `5` VIDEO |
| `text_item` | `{ text: string }?` | 文本内容 |
| `image_item` | `ImageItem?` | 图片（含 CDN 引用和 AES 密钥） |
| `voice_item` | `VoiceItem?` | 语音（SILK 编码） |
| `file_item` | `FileItem?` | 文件附件 |
| `video_item` | `VideoItem?` | 视频 |
| `ref_msg` | `RefMessage?` | 引用消息 |

#### CDN 媒体引用 (CDNMedia)

所有媒体类型（图片/语音/文件/视频）通过 CDN 传输，使用 AES-128-ECB 加密：

| 字段 | 类型 | 说明 |
|------|------|------|
| `encrypt_query_param` | `string?` | CDN 下载/上传的加密参数 |
| `aes_key` | `string?` | base64 编码的 AES-128 密钥 |

### CDN 上传流程

1. 计算文件明文大小、MD5，以及 AES-128-ECB 加密后的密文大小
2. 如需缩略图（图片/视频），同样计算缩略图的明文和密文参数
3. 调用 `getUploadUrl` 获取 `upload_param`（和 `thumb_upload_param`）
4. 使用 AES-128-ECB 加密文件内容，PUT 上传到 CDN URL
5. 缩略图同理加密并上传
6. 使用返回的 `encrypt_query_param` 构造 `CDNMedia` 引用，放入 `MessageItem` 发送

> 完整的类型定义见 [`src/api/types.ts`](src/api/types.ts)，API 调用实现见 [`src/api/api.ts`](src/api/api.ts)。

## 个人机器人模式（不依赖 LLM）

默认情况下，插件将消息转发给 OpenClaw 的 AI 管道（LLM + Tools）处理。如果你希望用自己的后端服务来生成回复，可以通过在 `openclaw.json` 中配置 `provider` 字段来接入。

### 快速配置

编辑 `~/.openclaw/openclaw.json`，在 `channels.openclaw-weixin` 下添加 `provider`：

**使用 REST 接口：**

```json
{
  "channels": {
    "openclaw-weixin": {
      "provider": {
        "type": "rest",
        "endpoint": "http://localhost:8080/chat",
        "authToken": "your-secret-token",
        "timeoutMs": 30000,
        "fallbackMessage": "⚠️ 服务暂时不可用，请稍后再试。"
      }
    }
  }
}
```

**使用 WebSocket 接口：**

```json
{
  "channels": {
    "openclaw-weixin": {
      "provider": {
        "type": "ws",
        "endpoint": "ws://localhost:8080/ws",
        "authToken": "your-secret-token",
        "timeoutMs": 30000,
        "fallbackMessage": "⚠️ 服务暂时不可用，请稍后再试。"
      }
    }
  }
}
```

修改配置后重启 gateway 使配置生效：

```bash
openclaw gateway restart
```

### provider 配置字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `type` | `"openclaw"` \| `"rest"` \| `"ws"` | `"openclaw"` | 回复来源。`openclaw` = 使用内置 AI 管道（默认）；`rest` = 调用 HTTP 接口；`ws` = 调用 WebSocket 接口。 |
| `endpoint` | `string` | — | 你的服务地址（`rest`/`ws` 必填）。 |
| `authHeader` | `string` | `"Authorization"` | 鉴权 header 名称（仅 `rest`）。 |
| `authToken` | `string` | — | 鉴权 token。REST 模式：发送到 `authHeader`；WebSocket 模式：包含在消息载荷的 `authToken` 字段中，或嵌入 URL（如 `ws://host/ws?token=xxx`，见下方说明）。 |
| `timeoutMs` | `number` | `30000` | 单次请求超时（毫秒）。超时后返回 `fallbackMessage`。 |
| `fallbackMessage` | `string` | `"⚠️ 服务暂时不可用，请稍后再试。"` | 外部服务不可达或返回空时发送给用户的提示。 |
| `requestFormat` | `"simple"` \| `"openai"` | `"simple"` | 请求体格式（仅 `rest`）。 |

### REST 接口协议（type = "rest"）

#### requestFormat = "simple"（默认）

**请求体（POST JSON）：**

```json
{
  "from": "<用户 WeChat ID>",
  "body": "<消息文本>",
  "contextToken": "<会话上下文令牌>",
  "accountId": "<机器人账号 ID>",
  "mediaPath": "/tmp/decrypted-image.jpg",
  "mediaType": "image/*"
}
```

> `mediaPath` 和 `mediaType` 仅在消息包含图片/语音/文件/视频时才出现。

**响应体（JSON 或纯文本）：**

```json
{
  "reply": "你好，这是我的回复",
  "mediaUrl": "https://example.com/image.png"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `reply` / `text` / `content` | `string` | 回复文本（三选一均可识别）。 |
| `mediaUrl` | `string?` | 可选。回复中的图片/文件链接（`https://` URL 或本地绝对路径）。 |

也支持直接返回纯文本字符串作为响应体。

#### requestFormat = "openai"

请求体遵循 [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) 格式，兼容任何 OpenAI-compatible 接口（如 Ollama、vLLM、LocalAI 等）：

```json
{
  "model": "gpt-3.5-turbo",
  "messages": [{ "role": "user", "content": "<消息文本>" }]
}
```

响应体按 OpenAI 格式解析 `choices[0].message.content`。

### WebSocket 接口协议（type = "ws"）

每条消息建立一次 WebSocket 连接。连接建立后发送一个 JSON 帧，等待一个回复帧，然后关闭连接。

**发送帧：**

```json
{
  "type": "message",
  "from": "<用户 WeChat ID>",
  "body": "<消息文本>",
  "contextToken": "<会话上下文令牌>",
  "accountId": "<机器人账号 ID>",
  "authToken": "<鉴权 token>",
  "mediaPath": "/tmp/decrypted-image.jpg",
  "mediaType": "image/*"
}
```

> **WebSocket 鉴权说明**：Node.js 22 内置的 `WebSocket` 不支持在构造函数中设置自定义 HTTP 头（如 `Authorization`）。鉴权有两种方式：
> 1. **URL 参数**（推荐）：将 token 嵌入 endpoint，如 `"ws://localhost:8080/ws?token=your-secret-token"`。
> 2. **消息载荷**：配置 `authToken` 后，插件会将其附加在每条发送帧的 `authToken` 字段中，由服务端校验。

**接收帧：**

```json
{ "type": "reply", "text": "你好，这是我的回复" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` / `reply` / `content` | `string` | 回复文本（三选一均可识别）。 |

也支持直接返回纯文本帧。

> **提示**：插件使用 Node.js 22 内置的全局 `WebSocket`（无需额外安装 `ws` 包）。

### 与 OpenClaw 的关系

- 微信登录、消息收发（`getUpdates` / `sendMessage`）、CDN 媒体上传下载、typing 状态指示等均保持不变，依旧通过 OpenClaw 的微信后端通信。
- 仅"生成回复"这一步被替换为你自己的服务。
- 斜杠指令（`/echo`、`/toggle-debug`）在 `rest`/`ws` 模式下同样有效，不经过外部服务。
- 鉴权（allowFrom 配对）机制不变：如果已配置 allowFrom，仅授权用户的消息才会转发给外部服务。

### 示例：Python FastAPI 机器人

```python
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

app = FastAPI()

class ChatRequest(BaseModel):
    # 'from' is a Python keyword; use an alias to map the JSON field name
    from_user: str = Field("", alias="from")
    body: str
    contextToken: Optional[str] = None
    accountId: Optional[str] = None
    mediaPath: Optional[str] = None
    mediaType: Optional[str] = None

    class Config:
        populate_by_name = True

@app.post("/chat")
async def chat(req: ChatRequest, authorization: str = Header(default="")):
    # 在这里接入你自己的逻辑（RAG、规则引擎、其他 LLM 等）
    reply = f"你说了：{req.body}"
    return {"reply": reply}
```

## 卸载

```bash
openclaw plugins uninstall @tencent-weixin/openclaw-weixin
```

## 故障排查

### "requires OpenClaw >=2026.3.22" 报错

你的 OpenClaw 版本太旧，不兼容当前插件版本。检查版本：

```bash
openclaw --version
```

安装旧版插件线：

```bash
openclaw plugins install @tencent-weixin/openclaw-weixin@legacy
```

### Channel 显示 "OK" 但未连接

确保 `~/.openclaw/openclaw.json` 中 `plugins.entries.openclaw-weixin.enabled` 为 `true`：

```bash
openclaw config set plugins.entries.openclaw-weixin.enabled true
openclaw gateway restart
```
