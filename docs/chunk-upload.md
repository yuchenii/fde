# 分片上传技术文档

## 概述

分片上传是 FDE 的核心上传机制，支持**大文件上传**、**断点续传**和**网络容错**。

## 架构设计

```
┌───────────────────────────────────────────────────────────────────┐
│                            客户端                                  │
│  ┌──────────┐   ┌──────────┐   ┌────────────┐   ┌──────────────┐  │
│  │ 计算Hash  │ → │ 初始化   │ → │ 并发分片   │ → │   完成合并   │  │
│  │(uploadId) │   │  (init)  │   │  (chunks)  │   │  (complete)  │  │
│  └──────────┘   └──────────┘   └────────────┘   └──────────────┘  │
└────────────────────────────┬──────────────────────────────────────┘
                             │ HTTP
┌────────────────────────────▼──────────────────────────────────────┐
│                            服务端                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐   │
│  │ 验证请求  │   │ 存储分片  │   │ 合并文件  │   │   清理目录   │   │
│  └──────────┘   └──────────┘   └──────────┘   └──────────────┘   │
│                                                                   │
│  临时存储: {系统临时目录}/fde-chunks/{uploadId}/                   │
│    - macOS/Linux: /tmp/fde-chunks/                                │
│    - Windows: %TEMP%\fde-chunks\                                  │
└───────────────────────────────────────────────────────────────────┘
```

## API 端点

| 端点               | 方法   | 描述           |
| ------------------ | ------ | -------------- |
| `/upload/init`     | POST   | 初始化上传任务 |
| `/upload/chunk`    | POST   | 上传单个分片   |
| `/upload/complete` | POST   | 完成上传并合并 |
| `/upload/status`   | GET    | 查询上传状态   |
| `/upload/cancel`   | DELETE | 取消上传       |

## 核心参数

| 参数                  | 默认值 | 说明               |
| --------------------- | ------ | ------------------ |
| `CHUNK_SIZE`          | 1 MB   | 单个分片大小       |
| `CONCURRENCY`         | 3      | 并发上传数         |
| `MAX_RETRIES`         | 3      | 最大重试次数       |
| `INITIAL_RETRY_DELAY` | 1s     | 初始重试延迟       |
| `MAX_RETRY_DELAY`     | 10s    | 最大重试延迟       |
| `EXPIRY_MS`           | 24h    | 未完成上传过期时间 |

## 上传流程

### 1. 计算 uploadId

使用文件内容的 SHA256 前 32 位作为 uploadId：

- 相同文件 = 相同 uploadId → 自动断点续传
- 文件变化 = 新 uploadId → 全新上传

```typescript
const checksum = await calculateChecksumFromFile(filePath);
const uploadId = checksum.substring(0, 32);
```

### 2. 初始化上传

```http
POST /upload/init
Content-Type: application/json
Authorization: <token>

{
  "uploadId": "abc123...",
  "totalChunks": 100,
  "fileName": "dist.zip",
  "checksum": "sha256...",
  "shouldExtract": true,
  "env": "production"
}
```

响应：

```json
{
  "success": true,
  "uploadedChunks": [0, 1, 2], // 已上传的分片（断点续传）
  "isResume": true
}
```

### 3. 分片上传

```http
POST /upload/chunk?uploadId=abc123&chunkIndex=3&env=production
Content-Type: application/octet-stream
Authorization: <token>
X-Chunk-MD5: d41d8cd98f00b204e9800998ecf8427e

<binary chunk data>
```

服务端验证 MD5 后存储到 `/tmp/fde-chunks/{uploadId}/chunk_000003`

### 4. 完成上传

```http
POST /upload/complete
Content-Type: application/json
Authorization: <token>

{
  "uploadId": "abc123...",
  "fileName": "dist.zip",
  "checksum": "sha256...",
  "shouldExtract": true,
  "env": "production"
}
```

服务端：

1. 合并所有分片
2. 验证文件 SHA256
3. 解压或保存
4. 清理临时文件

## 容错机制

### 分片级重试

```
失败 → 等待 1s → 重试
失败 → 等待 2s → 重试
失败 → 等待 4s → 重试
失败 → 报错
```

退避算法：`min(初始延迟 × 2^attempt, 最大延迟) + 随机抖动`

### 断点续传

```
第一次部署：
  上传 100 个分片...
  分片 75 失败，3 次重试后放弃
  ❌ 部署失败

第二次部署：
  计算 hash，得到相同 uploadId
  查询状态：已有 74 个分片
  ♻️ 从分片 75 继续上传
  ✅ 上传完成
```

### 数据完整性

```
┌────────────────┬────────────────────────────────────┐
│     层级       │              校验方式               │
├────────────────┼────────────────────────────────────┤
│ 传输层 (TCP)   │ 内置校验和                          │
│ 分片级         │ MD5（快速，检测传输错误）            │
│ 文件级         │ SHA256（安全，最终验证）             │
└────────────────┴────────────────────────────────────┘
```

## 自动清理

服务端每小时检查一次，删除超过 24 小时未完成的上传任务：

```typescript
// 清理调度器
setInterval(cleanupExpiredUploads, 60 * 60 * 1000);
```

## 文件结构

```
src/
├── client/
│   └── services/
│       └── chunkUpload.ts      # 客户端分片上传
│
└── server/
    ├── routes/
    │   └── chunkHandlers.ts    # API 路由处理
    │
    └── services/
        └── chunkStorage.ts     # 分片存储管理
```

## 与流式上传对比

| 特性           | 流式上传      | 分片上传    |
| -------------- | ------------- | ----------- |
| 大文件支持     | ⚠️ 受内存限制 | ✅ 无限制   |
| 断点续传       | ❌            | ✅          |
| 网络容错       | ❌ 整体失败   | ✅ 单片重试 |
| nginx 代理进度 | ⚠️ 不准确     | ✅ 准确     |
| 实现复杂度     | 低            | 中          |
