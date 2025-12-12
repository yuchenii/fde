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

## 认证机制

除了 `/ping` 和 `/health` 接口外，其他所有接口都需要进行身份验证。

在使用受保护的接口时，必须在 HTTP 请求头中包含 `Authorization` 字段：

```http
Authorization: <your-auth-token>
```

Token 在服务器配置文件 (`server.yaml`) 中定义。

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

### 10. 触发部署 (Trigger Deploy)

仅触发配置好的部署脚本，不上传新文件。

- **URL**: `/deploy`
- **Method**: `POST`
- **Auth Required**: Yes
- **Content-Type**: `application/json`

**请求体:**

```json
{ "env": "dev" }
```

**响应:**

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
