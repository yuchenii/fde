# FDE Server API 文档

FDE Server 提供了一组 RESTful API，用于文件上传、部署触发、健康检查等功能。

## API Endpoints

| Endpoint         | Method | Description                    |
| ---------------- | ------ | ------------------------------ |
| `/ping`          | GET    | Health check                   |
| `/health`        | GET    | Detailed health status         |
| `/verify`        | POST   | Token verification             |
| `/upload`        | POST   | File upload (FormData)         |
| `/upload-stream` | POST   | Streaming upload with progress |
| `/deploy`        | POST   | Execute deployment command     |

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

- Status: `200 OK`
- Body:

```json
{
  "status": "ok",
  "uptime": 123.45, // 运行时间（秒）
  "environments": ["dev", "prod"], // 可用环境列表
  "version": "1.0.0", // 服务器版本
  "timestamp": "2023-10-27T10:00:00.000Z"
}
```

### 3. Token 验证 (Verify)

在执行 build 和 upload 之前验证 token 是否正确，避免耗时的 build 完成后才发现认证失败。

- **URL**: `/verify`
- **Method**: `POST`
- **Auth Required**: Yes
- **Content-Type**: `application/json`

**请求体 (JSON):**

```json
{
  "env": "dev" // 目标环境名称
}
```

**响应:**

- **成功 (`200 OK`)**:

  ```json
  {
    "success": true,
    "message": "Authentication verified for environment 'dev'",
    "env": "dev"
  }
  ```

- **失败**:
  - `400 Bad Request`: 环境不存在
  - `403 Forbidden`: Token 无效

### 4. 文件上传 (Standard Upload)

使用 `multipart/form-data` 格式上传文件。适用于小文件或不支持流式上传的客户端。

- **URL**: `/upload`
- **Method**: `POST`
- **Auth Required**: Yes
- **Max File Size**: 1GB (Default server limit)

**请求参数 (FormData):**

| 字段名          | 类型   | 必填 | 默认值  | 描述                                                  |
| --------------- | ------ | ---- | ------- | ----------------------------------------------------- |
| `file`          | File   | 是   | -       | 要上传的文件                                          |
| `env`           | String | 是   | -       | 目标环境名称 (需在配置中存在)                         |
| `checksum`      | String | 否   | 无      | 文件的 SHA256 校验和，用于完整性校验                  |
| `shouldExtract` | String | 否   | `false` | 是否需要解压。`"true"` 表示解压 zip，其他值视为不解压 |

**响应:**

- **成功 (`200 OK`)**:

  ```json
  {
    "success": true,
    "message": "File uploaded and processed successfully",
    "fileName": "app.zip",
    "fileSize": 102400,
    "checksumVerified": true, // 如果提供了 checksum
    "extracted": true,
    "uploadPath": "/var/www/app"
  }
  ```

- **失败**:
  - `400 Bad Request`: 参数缺失或验证失败
  - `403 Forbidden`: Token 无效
  - `500 Internal Server Error`: 服务器内部错误

### 5. 流式上传 (Stream Upload)

通过请求体直接流式传输文件数据。适用于大文件上传，支持进度监控。

- **URL**: `/upload-stream`
- **Method**: `POST`
- **Auth Required**: Yes

**查询参数 (Query Params):**

| 参数名          | 必填 | 默认值  | 描述                          |
| --------------- | ---- | ------- | ----------------------------- |
| `env`           | 是   | -       | 目标环境名称                  |
| `fileName`      | 是   | -       | 文件名                        |
| `checksum`      | 否   | 无      | 文件的 SHA256 校验和          |
| `shouldExtract` | 否   | `false` | 是否需要解压 (`true`/`false`) |

**请求体:**

- Binary data (Raw file content)

**响应:**

与 `/upload` 接口响应结构一致。

### 6. 触发部署 (Trigger Deploy)

仅触发配置好的部署脚本，不上传新文件。

- **URL**: `/deploy`
- **Method**: `POST`
- **Auth Required**: Yes
- **Content-Type**: `application/json`

**请求体 (JSON):**

```json
{
  "env": "dev" // 目标环境名称
}
```

**响应:**

- **成功 (`200 OK`)**:

  ```json
  {
    "success": true,
    "message": "Deployment to dev completed successfully",
    "uploadPath": "/var/www/app"
  }
  ```

- **失败**:
  - `403 Forbidden`: Token 无效
  - `500 Internal Server Error`: 部署脚本执行失败
