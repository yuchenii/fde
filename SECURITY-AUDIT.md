# FDE 安全审计（整改复核）

- 初次复核：2026-08-23
- 整改复核：2026-08-24
- 代码基线：`544910b` 加当前未提交整改
- 范围：服务端、客户端、Docker 配置、升级流程及部署文档

## 结论

原审计确认的代码级 High 问题已完成整改。客户端 API 和现有摘要格式 `uploadId` 均未改变，客户无需更新客户端。

| 状态 | 数量 | 项目 |
| --- | ---: | --- |
| 本轮已修复 | 7 | 分片路径、资源限制、环境隔离、ZIP、认证限速、错误响应、临时文件 |
| 已缓解或部分修复 | 3 | HTTP/TLS 部署边界、Docker 权限、自更新真实性 |
| 接受风险 | 2 | 健康检查指纹、本机宿主机 SSH 校验 |
| 此前已修复 | 2 | 单文件路径穿越、Token 恒时比较 |
| 未修复 Critical | 0 | 无 |

## 审计边界

- `server.yaml`、进程环境变量和 `deployCommand` 由可信运维人员管理。
- 外部请求默认不可信。某个环境的有效 Token 不能授权访问其他环境的上传任务。
- Plain HTTP 仅允许用于可信私网；其他网络必须经 TLS 反向代理访问。
- SSH 主机校验关闭仅接受“Docker 容器连接同一台本机宿主机”的场景，不适用于远程 SSH 主机。

## 本轮已修复

### H-01 分片路径逃逸

**状态：已修复**

**文件：** `src/server/services/chunkStorage.ts`

- `uploadId` 统一限制为 1-128 个字母、数字、下划线或连字符。
- 所有任务路径经过 `resolve()` 和目录包含校验。
- 读、写、合并和递归删除都只能使用共享存储层生成的安全路径。

### H-02 上传导致内存或磁盘耗尽

**状态：已修复**

**文件：** `src/server/config/limits.ts`、`src/server/utils/request.ts`、`src/server/routes/handlers.ts`、`src/server/routes/chunkHandlers.ts`、`src/server/services/chunkStorage.ts`

- 普通上传在解析 multipart 前验证 Token，并限制为 128 MiB。
- 普通上传使用单并发槽，并通过私有临时文件处理，避免多请求叠加内存峰值。
- JSON 控制请求限制为 64 KiB。
- 分片限制为 1 MiB；单任务默认最多使用全部可用分片配额，也可用 `limits.chunkFileMB` 单独调低。
- 分片空间默认最多预留 10 GiB，可用 `limits.chunkStorageMB` 调整。
- 空文件任务仍保持兼容，但至少按一个分片计入全局空间预留。
- ZIP 解压后默认最多 2 GiB，并保留固定的条目数量安全上限，阻止压缩炸弹耗尽部署磁盘或 inode。
- `chunkIndex` 和 `totalChunks` 必须是范围内的安全整数。
- 合并改为逐片写入权限受控的临时文件，不再把完整上传载入内存。

全局 Bun 单请求上限仍为 1 GiB；分片路由在读取过程中执行 1 MiB 的实际限制，整个分片任务由磁盘配额控制。

### M-01 上传任务跨环境冲突

**状态：已修复，客户端兼容**

**文件：** `src/server/services/chunkStorage.ts`、`src/server/routes/chunkHandlers.ts`

- 服务端目录调整为 `CHUNK_DIR/<env-id>/<uploadId>`。
- 每次操作都带入并核对环境，完成上传时使用初始化阶段保存的服务端元数据。
- 重复初始化必须保持文件名、校验和、分片数量和解压标记一致。
- 任务进入完成阶段后拒绝补片和取消，避免重复部署或已确认分片被丢弃。
- 客户端继续使用 SHA-256 前 32 位作为 `uploadId`，API 协议未改变。

v1.4.2-v1.4.7 使用 `CHUNK_DIR/<uploadId>` 单层目录。升级后服务端不识别、不迁移也不自动清理这些未完成任务，客户端重新发起上传即可。

### M-02 ZIP 符号链接和特殊文件

**状态：已修复**

**文件：** `src/server/services/deployment.ts`

解压前同时检查条目路径和类型，拒绝绝对路径、目录逃逸、归档内符号链接、目标目录已有符号链接及其他特殊文件。单文件保存也拒绝写入已有符号链接。`unzip` 改为参数数组调用，临时 ZIP 放在 `mkdtemp()` 创建的私有目录中。

### M-03 认证失败限速和弱 Token 示例

**状态：已修复**

**文件：** `src/server/index.ts`、`src/server/services/validation.ts`、`README.md`、`docs/docker.md`

- 同一来源连续 5 次认证失败后锁定 5 分钟。
- 认证状态表最多保留 10,000 个来源，避免限速器本身无限占用内存。
- 请求包含 `X-Real-IP` 时使用该地址，否则回退直连 IP。部署要求可信代理覆盖该请求头，且客户端不能绕过代理。
- 文档改为使用至少 32 字节的随机 Token。

### L-01 5xx 泄露内部异常

**状态：已修复**

**文件：** `src/server/index.ts`、`src/server/routes/handlers.ts`、`src/server/routes/chunkHandlers.ts`

未预期的 5xx 不再返回 `error.message` 或路径。部署命令的 stdout、stderr 和 exit code 仍只返回给已经通过环境认证的客户端。

### L-02 临时文件可预测或异常残留

**状态：已修复**

**文件：** `src/server/services/deployment.ts`、`src/server/services/chunkStorage.ts`、`src/client/services/archive.ts`

客户端压缩、服务端 ZIP 校验和分片合并均使用 `mkdtemp()` 私有临时目录，并在 `finally` 或失败分支中清理。

## 已缓解或部分修复

### H-03 Token 经明文 HTTP 传输

**状态：部署层已缓解**

**文件：** `src/server/index.ts`、`README.md`、`docs/docker.md`、`docs/server-api.md`

FDE 仍不内置 TLS，保持单二进制部署方式和现有配置兼容。启动日志和文档已明确：

- HTTP 只用于可信私网。
- 公网或其他不可信网络必须经 TLS 反向代理。
- 本机代理场景建议只将容器端口绑定到 `127.0.0.1`。

如果运维仍将 HTTP 直接暴露到不可信网络，该风险依然存在。

### M-04 Docker 和宿主机 SSH 权限

**状态：部分修复**

**文件：** `README.md`、`docs/docker.md`

宿主机 SSH 示例已从 root 改为权限受限的 `fde-deploy` 专用账号。容器暂时仍以 root 运行，因为现有用户挂载路径是 `/root/.ssh/id_rsa`，绑定目录权限也依赖当前行为；直接改为非 root 会导致已有部署升级后不可用。

后续若调整容器用户，应作为迁移项处理 SSH key、日志和部署目录的 UID/GID，而不是在补丁版本中静默变更。

### M-05 自更新包真实性

**状态：部分修复**

**文件：** `src/utils/selfUpdate.ts`、`.github/workflows/build.yml`

发布流程原本已经生成 `SHA256SUMS.txt`，升级代码现会在替换二进制前校验对应 SHA-256，能够发现下载损坏或资产错配。

校验清单与二进制仍来自同一个 GitHub Release，不能抵御发布账号或 Release 同时被篡改。完整修复需要用程序内置公钥验证独立签名的清单。

## 接受风险

### L-03 `/health` 暴露版本和运行时间

**状态：接受风险**

匿名健康检查返回版本号和 uptime，只提供少量指纹信息。保持现有响应以兼容监控和客户端；服务按要求放在可信私网或 TLS 代理后时，该风险可接受。

### L-04 SSH 主机校验关闭

**状态：接受风险，仅适用于容器连接本机宿主机**

当前 Docker 模式通过 `host.docker.internal` 连接同一台宿主机。在 Docker 网络和宿主机均可信、`SSH_HOST` 不指向远程机器的前提下，可接受关闭主机校验。

若未来支持远程 SSH 主机，必须挂载经过运维核验的只读 `known_hosts`，并启用 `StrictHostKeyChecking=yes`。

## 此前已修复

### F-01 单文件名路径穿越

`saveFile()` 使用平台对应的 `basename()`，并拒绝空值、`.` 和 `..`。

### F-02 Token 非恒时比较

当前实现分别计算两个 Token 的 SHA-256，再使用 `timingSafeEqual()` 比较固定长度摘要。

## 从原审计移除的误报

### `deployCommand` 被认定为命令注入

`deployCommand` 的产品语义就是由可信运维配置并交给 shell 执行。能篡改配置或进程环境的主体已经拥有同等代码执行能力，因此这不是独立的远程命令注入漏洞。

### `yaml.load()` 被认定为反序列化风险

项目锁定 `js-yaml@4.1.1`。该版本的 `load()` 默认使用 `DEFAULT_SCHEMA`，不是原审计所说的 `JSON_SCHEMA`；4.x 默认不支持旧版不安全的 JavaScript 对象或函数标签。

### PID 文件可读被认定为安全问题

PID 不是秘密。共享可写工作目录属于部署权限配置问题，不应单独计为漏洞。

## 剩余行动

1. 生产部署确认 TLS 代理无法被客户端绕过，并由代理使用直接客户端地址覆盖 `X-Real-IP`。
2. 后续大版本设计容器非 root 迁移，明确卷目录和 SSH key 的 UID/GID。
3. 发布体系增加独立签名清单，并在客户端内置验证公钥。
