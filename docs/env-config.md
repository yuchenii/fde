# 环境变量配置

FDE 支持在执行构建和部署脚本时净化子进程的环境变量，避免父进程（如 Bun 自动加载的 `.env`）污染子进程环境。

## 问题背景

Bun 运行时会自动加载项目目录下的 `.env` 文件。当使用 `fde-client deploy` 执行 `vite build` 时，Vite 会继承已存在的 `VITE_*` 变量，而不是从 `.env.production` 重新加载，导致构建结果不正确。

## 配置方式

### 客户端 (`deploy.yaml`)

```yaml
# 顶层配置（所有环境默认值）
env:
  mode: inherit        # inherit | isolate
  exclude:
    - DEBUG_*          # 排除 DEBUG_ 开头的变量
  custom:
    CI: "true"         # 自定义变量

environments:
  prod:
    serverUrl: "http://server:3000"
    localPath: "./dist"
    buildCommand: "npm run build"
    env:
      exclude:
        - VERBOSE_*    # 追加到顶层 exclude
      custom:
        BUILD_ENV: production  # 覆盖或新增
```

### 服务端 (`server.yaml`)

```yaml
port: 3000
env:
  mode: inherit
  exclude:
    - INTERNAL_*

environments:
  prod:
    uploadPath: "/var/www/html"
    deployCommand: "./deploy.sh"
    env:
      custom:
        DEPLOY_ENV: production
```

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | `inherit` \| `isolate` | `inherit` | 环境变量模式 |
| `exclude` | `string[]` | - | 排除的变量（支持通配符和正则） |
| `include` | `string[]` | - | 包含的变量（支持通配符和正则） |
| `custom` | `object` | - | 自定义变量（覆盖已有或新增） |

## 模式说明

### `inherit` 模式（默认）

继承父进程的所有环境变量，然后：
1. 删除匹配内置 exclude 规则的变量
2. 删除匹配用户 exclude 规则的变量
3. 恢复匹配 include 规则的变量
4. 应用 custom 变量

**内置 exclude 规则：**
- `NODE_ENV`
- `VITE_*`
- `REACT_APP_*`
- `NEXT_PUBLIC_*`
- `NUXT_*`
- `VUE_APP_*`

### `isolate` 模式

从空环境开始，只保留必要的系统变量 + 用户 include：

**内置 include 变量：**
- `PATH` / `Path`（Windows）
- `HOME`, `USER`, `SHELL`, `LANG`, `LC_*`, `TERM`, `TMPDIR`
- `SSH_AUTH_SOCK`, `DISPLAY`, `XDG_*`
- Windows: `USERPROFILE`, `APPDATA`, `COMSPEC`, `SYSTEMROOT` 等

## 模式匹配

支持两种匹配语法：

### Glob 通配符

| 语法 | 示例 | 匹配 |
|------|------|------|
| 前缀 | `VITE_*` | `VITE_APP`, `VITE_PORT` |
| 后缀 | `*_SECRET` | `DB_SECRET`, `API_SECRET` |
| 包含 | `*DEBUG*` | `MY_DEBUG_VAR`, `DEBUG_LEVEL` |
| 精确 | `NODE_ENV` | `NODE_ENV` |

### 正则表达式

用 `/` 包裹的字符串会被解析为正则表达式，支持标志：

```yaml
exclude:
  - /^VITE_\d+$/       # 匹配 VITE_123，不匹配 VITE_ABC
  - /secret/i          # 大小写不敏感，匹配 SECRET、secret、Secret
  - /^MY_.*_KEY$/gi    # 支持多个标志
```

支持的标志：`g` `i` `m` `s` `u` `y`

## 合并规则

环境级配置会与顶层配置合并：

| 字段 | 合并方式 |
|------|----------|
| `mode` | 环境级优先 |
| `exclude` | 顶层 + 环境级拼接 |
| `include` | 顶层 + 环境级拼接 |
| `custom` | 合并，环境级覆盖同名 key |

## 示例

### 仅排除特定变量

```yaml
env:
  exclude:
    - MY_LOCAL_*
```

### 完全隔离环境

```yaml
env:
  mode: isolate
  include:
    - MY_APP_*
  custom:
    NODE_ENV: production
```

### 恢复被默认排除的变量

```yaml
env:
  include:
    - VITE_PUBLIC_URL  # 恢复这个被默认排除的变量
```
