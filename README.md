# ElectroInit

Electron + React + Vite + Tailwind + shadcn/ui 项目脚手架生成器。

一键生成包含前端（React + Vite + Tailwind）、后端（Node / FastAPI / Gin）和 Electron 桌面壳的完整项目结构，并支持将生成结果缓存到 `init_src` 目录，后续可快速复制到新项目。

## 环境要求

- Node.js (会自动检测版本并匹配兼容的 Electron)
- npm

## 使用方法

```bash
node init.js [options]
```

### 参数

| 参数 | 说明 |
|------|------|
| `--force` | 强制重新生成 `init_src` 缓存，跳过交互提示直接覆盖 |
| `--audit` | 在 `npm install` 时启用安全审计（默认关闭以加速安装） |
| `-h, --help` | 显示帮助信息 |

### 示例

```bash
# 交互式生成项目
node init.js

# 强制重建 init_src 缓存
node init.js --force

# 安装时启用 npm audit
node init.js --audit
```

## 交互流程

1. 选择目标目录（默认 `init_src`）
2. 若目标目录已存在，提示是否覆盖
3. 是否使用已缓存的 `init_src` 脚手架直接复制
4. 是否配置 npm 镜像（npmmirror.com）
5. 选择后端类型：`node` / `python-fastapi` / `golang-gin`
6. 自动根据本地 Node.js 版本匹配兼容的 Electron 版本
7. 安装依赖（根目录 + 前端）

## 生成的项目结构

```
<target>/
├── package.json              # 根 package.json（含 Electron 依赖）
├── .gitignore
├── .npmrc                    # npm 配置（镜像、audit 等）
├── src/
│   ├── electron/
│   │   ├── main.js           # Electron 主进程
│   │   └── preload.js        # Electron preload 脚本
│   ├── frontend/
│   │   ├── package.json      # 前端 package.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── components.json   # shadcn/ui 配置
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── index.css
│   │       └── lib/utils.ts
│   └── backend/              # 后端代码（根据选择不同）
├── scripts/                  # 启动/开发/构建脚本
├── docs/
├── data/
├── dist/
└── logs/
```

## 开发脚本

生成的项目在 `scripts/` 目录下包含以下脚本：

| 脚本 | 说明 |
|------|------|
| `dev.ps1` / `dev.sh` | 启动 Vite 开发服务器 + Electron（热重载模式） |
| `start.ps1` / `start.sh` | 仅启动 Electron |
| `start-backend.ps1` / `start-backend.sh` | 启动后端服务 |
| `build.ps1` / `build.sh` | 构建占位脚本 |
