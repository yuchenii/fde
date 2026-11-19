# FDE Server API 文档

FDE Server 提供了一组 RESTful API，用于文件上传、部署触发、健康检查等功能。

## API Endpoints

| Endpoint           | Method | Description             |
| ------------------ | ------ | ----------------------- |
| `/ping`            | GET    | Health check            |
| `/health`          | GET    | Detailed health status  |
| `/verify`          | POST   | Token verification      |
| `/upload`          | POST   | File upload (FormData)  |
| `/upload/init`     | POST   | Initialize chunk upload |
| `/upload/chunk`    | POST   | Upload single chunk     |
| `/upload/complete` | POST   | Complete and merge      |
| `/upload/status`   | GET    | Query upload status     |
| `/upload/cancel`   | DELETE | Cancel upload           |
| `/deploy`          | POST   | Execute deployment      |
| `/deploy/status`   | GET    | Query deploy status     |

## 认证机制

除了 `/ping` 和 `/health` 接口外，其他所有接口都需要进行身份验证。

在使用受保护的接口时，必须在 HTTP 请求头中包含 `Authorization` 字段：

```http
Authorization: <your-auth-token>
```

Token 在服务器配置文件 (`server.yaml`) 中定义。

Token 应使用 `openssl rand -hex 32` 等密码学安全方式生成。连续 5 次认证失败后，同一来源会被锁定 5 分钟并返回 `429 Too Many Requests`。请求包含 `X-Real-IP` 时，服务端使用该地址；可信反向代理必须用直接客户端地址覆盖该请求头，并禁止客户端绕过代理直连。

Plain HTTP 仅适用于可信私网；其他网络必须通过 TLS 反向代理访问。

## 接口列表

### 1. 基础检查 (Ping)

用于简单的连接性测试。

- **URL**: `/ping`
- **Method**: `GET`
- **Auth Required**: No

**响应:**

- Status: `200 OK`
- Body: `pong` (text/plain)

### 2. 健康检查 (Health Check)

获取服务器的运行状态和版本信息。

- **URL**: `/health`
- **Method**: `GET`
- **Auth Required**: No

**响应:**

```json
{
  "status": "ok",
  "uptime": 123.45,
  "version": "1.0.0",
  "timestamp": "2023-10-27T10:00:00.000Z"
}
```

### 3. Token 验证 (Verify)

在执行 build 和 upload 之前验证 token 是否正确。

- **URL**: `/verify`
- **Method**: `POST`
- **Auth Required**: Yes
- **Content-Type**: `application/json`

**请求体:**

```json
{ "env": "dev" }
```

**响应:**

- **成功 (`200 OK`)**: `{ "success": true, "env": "dev" }`
- **失败**: `400` 环境不存在 / `403` Token 无效

### 4. 文件上传 (Standard Upload)

使用 `multipart/form-data` 格式上传文件。适用于小文件。

请求体上限为 128 MiB。服务端同时只处理一个普通上传，繁忙时返回 `503` 和 `Retry-After`；更大文件或并发上传应使用分片上传。

- **URL**: `/upload`
- **Method**: `POST`
- **Auth Required**: Yes

**请求参数 (FormData):**

| 字段名          | 类型   | 必填 | 描述                      |
| --------------- | ------ | ---- | ------------------------- |
| `file`          | File   | 是   | 要上传的文件              |
| `env`           | String | 是   | 目标环境名称              |
| `checksum`      | String | 否   | 文件的 SHA256 校验和      |
| `shouldExtract` | String | 否   | 是否解压 (`true`/`false`) |

---

## 分片上传 (Chunk Upload)

用于大文件上传，支持断点续传和并发上传。

- 单个分片上限：1 MiB
- 单任务默认最多使用全部可用分片配额，可通过 `limits.chunkFileMB` 设置更小上限
- 默认分片空间预留上限：10 GiB，可通过 `limits.chunkStorageMB` 调整
- `uploadId` 仅允许 1-128 个字母、数字、下划线或连字符
- ZIP 默认最多解压 2 GiB，可通过 `limits.zipExtractMB` 调整；条目数量另有服务端固定安全上限

### 5. 初始化上传 (Init)

- **URL**: `/upload/init`
- **Method**: `POST`
- **Auth Required**: Yes
- **Content-Type**: `application/json`

**请求体:**

```json
{
  "uploadId": "abc123...",
  "totalChunks": 100,
  "fileName": "dist.zip",
  "checksum": "sha256...",
  "shouldExtract": true,
  "env": "production"
}
```

**响应:**

```json
{
  "success": true,
  "uploadedChunks": [0, 1, 2],
  "totalChunks": 100,
  "isResume": true
}
```

### 6. 上传分片 (Chunk)

- **URL**: `/upload/chunk`
- **Method**: `POST`
- **Auth Required**: Yes
- **Content-Type**: `application/octet-stream`

**查询参数:**

| 参数         | 必填 | 描述        |
| ------------ | ---- | ----------- |
| `uploadId`   | 是   | 上传任务 ID |
| `chunkIndex` | 是   | 分片索引    |
| `env`        | 是   | 目标环境    |

**请求头:**

| Header        | 描述          |
| ------------- | ------------- |
| `X-Chunk-MD5` | 分片的 MD5 值 |

**请求体:** Binary chunk data

**响应:**

```json
{ "success": true, "chunkIndex": 0 }
```

### 7. 完成上传 (Complete)

- **URL**: `/upload/complete`
- **Method**: `POST`
- **Auth Required**: Yes
- **Content-Type**: `application/json`

**请求体:**

```json
{
  "uploadId": "abc123...",
  "fileName": "dist.zip",
  "checksum": "sha256...",
  "shouldExtract": true,
  "env": "production"
}
```

**响应:**

```json
{
  "success": true,
  "fileName": "dist.zip",
  "fileSize": 10485760,
  "checksumVerified": true,
  "extracted": true
}
```

### 8. 查询状态 (Status)

- **URL**: `/upload/status`
- **Method**: `GET`
- **Auth Required**: Yes

**查询参数:**

| 参数       | 必填 | 描述        |
| ---------- | ---- | ----------- |
| `uploadId` | 是   | 上传任务 ID |
| `env`      | 是   | 目标环境    |

**响应:**

```json
{
  "exists": true,
  "uploadedChunks": [0, 1, 2],
  "totalChunks": 100
}
```

### 9. 取消上传 (Cancel)

- **URL**: `/upload/cancel`
- **Method**: `DELETE`
- **Auth Required**: Yes

**查询参数:**

| 参数       | 必填 | 描述        |
| ---------- | ---- | ----------- |
| `uploadId` | 是   | 上传任务 ID |
| `env`      | 是   | 目标环境    |

**响应:**

```json
{ "success": true, "message": "Upload cancelled" }
```

---

## 部署相关接口

### 10. 触发部署 (Trigger Deploy)

执行配置好的部署脚本。支持流式输出（SSE）和断连续接。

- **URL**: `/deploy`
- **Method**: `POST`
- **Auth Required**: Yes
- **Content-Type**: `application/json`

**请求体:**

```json
{
  "env": "dev",
  "stream": true
}
```

| 字段     | 类型    | 必填 | 描述                             |
| -------- | ------- | ---- | -------------------------------- |
| `env`    | String  | 是   | 配置文件中声明的非空环境名称     |
| `stream` | Boolean | 否   | 是否启用流式输出（默认 `false`） |

**请求头（可选）:**

| Header          | 描述                        |
| --------------- | --------------------------- |
| `Last-Event-ID` | SSE 断连续接时的最后事件 ID |
| `X-Deployment-ID` | 首次 SSE 响应返回的部署编号，续接和查询状态时原样发回 |

#### 非流式响应 (`stream: false`)

- **成功 (`200 OK`)**:

  ```json
  {
    "success": true,
    "message": "Deployment to dev completed successfully",
    "stdout": "...",
    "stderr": "..."
  }
  ```

- **失败 (`500`)**:

  ```json
  {
    "error": "Deploy command failed",
    "stdout": "...",
    "stderr": "...",
    "exitCode": 1
  }
  ```

#### 流式响应 (`stream: true`)

返回 Server-Sent Events (SSE) 流：

```http
Content-Type: text/event-stream
```

**事件类型:**

| Event    | 描述         | Data 格式                                    |
| -------- | ------------ | -------------------------------------------- |
| `output` | 命令输出     | `{"type": "stdout"/"stderr", "data": "..."}` |
| `done`   | 部署成功完成 | `{"success": true, "exitCode": 0, ...}`      |
| `error`  | 部署失败     | `{"error": "...", "exitCode": 1, ...}`       |

**示例 SSE 流:**

```
id: 1
event: output
data: {"type":"stdout","data":"Building...\n"}

id: 2
event: output
data: {"type":"stdout","data":"Done!\n"}

id: 3
event: done
data: {"success":true,"message":"Deployment completed","exitCode":0}
```

#### SSE 断连续接

首次连接时保存响应头 `X-Deployment-ID`。重连时发回该编号及最后一个已处理的数字事件 ID。如果尚未收到事件，使用 `0`。

```http
Last-Event-ID: 2
X-Deployment-ID: 31995c4e-41c9-4ed7-bf00-3782d46ad12a
```

服务端按部署编号续接。

1. 如果部署还在运行：从 ID 2 之后继续输出
2. 如果部署已完成：返回最终结果（`done` 或 `error`）
3. 每个环境保留最近一次流式部署的记录。其后发起普通部署仍可续接原流。下次流式部署开始或服务进程重启后，原编号返回 **410 Gone**。

旧客户端也可以在同一服务进程内使用服务端实际发出的数字 `Last-Event-ID` 续接。完整的部署编号核对需要客户端和服务端都升级。新版 CLI 连接旧服务端时支持正常流式部署，断线后若无法确认部署编号，会报错退出。

同一服务进程内，每个环境同时最多运行一个部署，流式和非流式共用这一限制。部署进行中或结束后的冷却期内，发起同环境的新部署返回 **409 Conflict**。`limits.deployCooldownSec` 指定冷却秒数，默认 `30`。设为 `0` 后，上一次部署结束即可开始下一次。

---

### 11. 查询部署状态 (Deploy Status)

默认返回该环境最近一次部署的状态。带 `X-Deployment-ID` 请求头时，只返回该编号的状态，记录已过期时返回 **410 Gone**。失败记录包含退出码，详细命令和诊断输出保留在部署日志中。

- **URL**: `/deploy/status`
- **Method**: `GET`
- **Auth Required**: Yes

**查询参数:**

| 参数  | 必填 | 描述       |
| ----- | ---- | ---------- |
| `env` | 是   | 目标环境名 |

**响应:**

```json
{
  "env": "dev",
  "deploymentId": "31995c4e-41c9-4ed7-bf00-3782d46ad12a",
  "running": false,
  "startTime": "2025-12-13T10:30:00.000Z",
  "bufferedCount": 0,
  "lastResult": {
    "success": true,
    "startTime": "2025-12-13T10:30:00.000Z",
    "endTime": "2025-12-13T10:31:30.000Z",
    "exitCode": 0
  }
}
```

| 字段            | 类型    | 描述                         |
| --------------- | ------- | ---------------------------- |
| `running`       | Boolean | 是否正在部署                 |
| `startTime`     | String  | 部署开始时间（ISO 格式）     |
| `bufferedCount` | Number  | 缓冲区中的输出数量           |
| `lastResult`    | Object  | 最后一次部署结果（可能为空） |
