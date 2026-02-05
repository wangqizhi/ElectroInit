"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync, spawnSync } = require("child_process");
const readline = require("readline");

const DEFAULT_TARGET = "init_src";
const NPM_MIRROR_REGISTRY = "https://registry.npmmirror.com/";
const ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
const RELEASES_URL = "https://releases.electronjs.org/releases.json";
const argv = new Set(process.argv.slice(2));
const enableAudit = argv.has("--audit");
const forceRebuild = argv.has("--force");
const showHelp = argv.has("--help") || argv.has("-h");

if (showHelp) {
  console.log(`
ElectroInit - Electron + React + Vite project scaffold generator

Usage:
  node init.js [options]

Options:
  --force   Force rebuild the init_src cache, skip interactive prompts
  --audit   Enable npm audit during dependency installation
  -h, --help  Show this help message

Interactive Flow:
  1. Choose target directory (default: init_src)
  2. If target exists, prompt to overwrite
  3. Choose whether to use cached scaffold from init_src
  4. Configure npm mirror (npmmirror.com)
  5. Select backend type: node / python-fastapi / golang-gin
  6. Auto-detect compatible Electron version based on local Node.js
  7. Install dependencies (root + frontend)

Examples:
  node init.js              Interactive scaffold generation
  node init.js --force      Rebuild init_src cache non-interactively
  node init.js --audit      Enable npm audit during install
`);
  process.exit(0);
}
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const TEMPLATE_DIR = DEFAULT_TARGET;
const COPY_IGNORE = new Set(["dist", "logs", ".git"]);

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch (err) {
    return null;
  }
}

function getNodeVersion() {
  const out = run("node -v");
  if (!out) return null;
  return out.startsWith("v") ? out.slice(1) : out;
}

function parseMajor(version) {
  if (!version) return null;
  const clean = version.startsWith("v") ? version.slice(1) : version;
  const major = parseInt(clean.split(".")[0], 10);
  return Number.isFinite(major) ? major : null;
}

function normalizeVersion(version) {
  if (!version) return "";
  return version.startsWith("v") ? version.slice(1) : version;
}

function parseSemver(version) {
  const clean = normalizeVersion(version);
  const core = clean.split("-")[0];
  const parts = core.split(".").map((n) => parseInt(n, 10));
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function isPreRelease(version) {
  return normalizeVersion(version).includes("-");
}

function isEmptyDir(dir) {
  if (!fs.existsSync(dir)) return true;
  const entries = fs.readdirSync(dir);
  return entries.length === 0;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(target, content) {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content, "utf8");
}

function toPackageName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-") || "electron-app";
}

function promptLine(rl, question, defaultValue) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const value = answer.trim();
      resolve(value === "" ? defaultValue : value);
    });
  });
}

async function confirm(rl, question, defaultYes) {
  const suffix = defaultYes ? " (Y/n): " : " (y/N): ";
  const answer = await promptLine(rl, question + suffix, "");
  if (!answer) return !!defaultYes;
  const normalized = answer.toLowerCase();
  return normalized === "y" || normalized === "yes";
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

function pickElectronVersion(releases, nodeMajor) {
  const candidates = releases
    .map((r) => {
      const version = normalizeVersion(r.version || r.tag_name || "");
      const node = r.node || (r.deps && r.deps.node) || "";
      return {
        version,
        node,
        nodeMajor: parseMajor(node),
      };
    })
    .filter((r) => r.version && r.nodeMajor !== null)
    .filter((r) => !isPreRelease(r.version));

  const exact = candidates.filter((r) => r.nodeMajor === nodeMajor);
  if (exact.length > 0) {
    exact.sort((a, b) => compareSemver(parseSemver(b.version), parseSemver(a.version)));
    return { ...exact[0], match: "exact" };
  }

  const lower = candidates.filter((r) => r.nodeMajor < nodeMajor);
  if (lower.length > 0) {
    lower.sort((a, b) => compareSemver(parseSemver(b.version), parseSemver(a.version)));
    return { ...lower[0], match: "lower" };
  }

  candidates.sort((a, b) => compareSemver(parseSemver(b.version), parseSemver(a.version)));
  return candidates[0] ? { ...candidates[0], match: "any" } : null;
}

function buildGitignore() {
  return [
    "node_modules/",
    "dist/",
    "logs/",
    "data/*.db",
    "*.log",
    "npm-debug.log*",
    "yarn-debug.log*",
    "yarn-error.log*",
    ".DS_Store",
    "Thumbs.db",
    ".idea/",
    ".vscode/",
    ".fleet/",
    ".env",
    "coverage/",
    "out/",
  ].join("\n");
}

function buildElectronMain() {
  return [
    "const { app, BrowserWindow } = require(\"electron\");",
    "const path = require(\"path\");",
    "const fs = require(\"fs\");",
    "",
    "function createWindow() {",
    "  const win = new BrowserWindow({",
    "    width: 1200,",
    "    height: 800,",
    "    webPreferences: {",
    "      preload: path.join(__dirname, \"preload.js\"),",
    "      contextIsolation: true,",
    "    },",
    "  });",
    "",
    "  const devUrl = process.env.ELECTRON_DEV_URL;",
    "  if (devUrl) {",
    "    win.loadURL(devUrl);",
    "    return;",
    "  }",
    "",
    "  const distPath = path.join(__dirname, \"..\", \"frontend\", \"dist\", \"index.html\");",
    "  if (fs.existsSync(distPath)) {",
    "    win.loadFile(distPath);",
    "    return;",
    "  }",
    "",
    "  win.loadURL(",
    "    \"data:text/html,\" +",
    "      encodeURIComponent(",
    "        \"<h2>Frontend not built</h2><p>Run frontend build or dev server.</p>\"",
    "      )",
    "  );",
    "}",
    "",
    "app.whenReady().then(() => {",
    "  createWindow();",
    "",
    "  app.on(\"activate\", () => {",
    "    if (BrowserWindow.getAllWindows().length === 0) createWindow();",
    "  });",
    "});",
    "",
    "app.on(\"window-all-closed\", () => {",
    "  if (process.platform !== \"darwin\") app.quit();",
    "});",
    "",
  ].join("\n");
}

function buildElectronPreload() {
  return [
    "const { contextBridge } = require(\"electron\");",
    "",
    "contextBridge.exposeInMainWorld(\"api\", {",
    "  ping: () => \"pong\",",
    "});",
    "",
  ].join("\n");
}

function buildFrontendIndexHtml() {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"UTF-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    "    <title>ElectroInit</title>",
    "  </head>",
    "  <body class=\"bg-background text-foreground\">",
    "    <div id=\"root\"></div>",
    "    <script type=\"module\" src=\"/src/main.tsx\"></script>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function buildFrontendMainTsx() {
  return [
    "import React from \"react\";",
    "import ReactDOM from \"react-dom/client\";",
    "import App from \"./App\";",
    "import \"./index.css\";",
    "",
    "ReactDOM.createRoot(document.getElementById(\"root\")!).render(",
    "  <React.StrictMode>",
    "    <App />",
    "  </React.StrictMode>",
    ");",
    "",
  ].join("\n");
}

function buildFrontendAppTsx() {
  return [
    "export default function App() {",
    "  return (",
    "    <div className=\"min-h-screen bg-background text-foreground\">",
    "      <div className=\"mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-16\">",
    "        <div className=\"rounded-2xl border bg-card p-8 shadow-sm\">",
    "          <p className=\"text-sm font-medium uppercase tracking-wide text-muted-foreground\">",
    "            ElectroInit",
    "          </p>",
    "          <h1 className=\"mt-3 text-3xl font-semibold\">",
    "            React + Vite + Tailwind + shadcn/ui",
    "          </h1>",
    "          <p className=\"mt-2 text-base text-muted-foreground\">",
    "            Frontend scaffold is ready. Run the dev script to enable hot reload.",
    "          </p>",
    "          <div className=\"mt-6 flex flex-wrap gap-3\">",
    "            <button className=\"rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground\">",
    "              Primary Action",
    "            </button>",
    "            <button className=\"rounded-md border px-4 py-2 text-sm font-medium\">",
    "              Secondary",
    "            </button>",
    "          </div>",
    "        </div>",
    "      </div>",
    "    </div>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function buildFrontendCss() {
  return [
    "@tailwind base;",
    "@tailwind components;",
    "@tailwind utilities;",
    "",
    "@layer base {",
    "  :root {",
    "    --background: 0 0% 100%;",
    "    --foreground: 222.2 84% 4.9%;",
    "    --card: 0 0% 100%;",
    "    --card-foreground: 222.2 84% 4.9%;",
    "    --popover: 0 0% 100%;",
    "    --popover-foreground: 222.2 84% 4.9%;",
    "    --primary: 222.2 47.4% 11.2%;",
    "    --primary-foreground: 210 40% 98%;",
    "    --secondary: 210 40% 96.1%;",
    "    --secondary-foreground: 222.2 47.4% 11.2%;",
    "    --muted: 210 40% 96.1%;",
    "    --muted-foreground: 215.4 16.3% 46.9%;",
    "    --accent: 210 40% 96.1%;",
    "    --accent-foreground: 222.2 47.4% 11.2%;",
    "    --destructive: 0 84.2% 60.2%;",
    "    --destructive-foreground: 210 40% 98%;",
    "    --border: 214.3 31.8% 91.4%;",
    "    --input: 214.3 31.8% 91.4%;",
    "    --ring: 222.2 84% 4.9%;",
    "    --radius: 0.75rem;",
    "  }",
    "",
    "  .dark {",
    "    --background: 222.2 84% 4.9%;",
    "    --foreground: 210 40% 98%;",
    "    --card: 222.2 84% 4.9%;",
    "    --card-foreground: 210 40% 98%;",
    "    --popover: 222.2 84% 4.9%;",
    "    --popover-foreground: 210 40% 98%;",
    "    --primary: 210 40% 98%;",
    "    --primary-foreground: 222.2 47.4% 11.2%;",
    "    --secondary: 217.2 32.6% 17.5%;",
    "    --secondary-foreground: 210 40% 98%;",
    "    --muted: 217.2 32.6% 17.5%;",
    "    --muted-foreground: 215 20.2% 65.1%;",
    "    --accent: 217.2 32.6% 17.5%;",
    "    --accent-foreground: 210 40% 98%;",
    "    --destructive: 0 62.8% 30.6%;",
    "    --destructive-foreground: 210 40% 98%;",
    "    --border: 217.2 32.6% 17.5%;",
    "    --input: 217.2 32.6% 17.5%;",
    "    --ring: 212.7 26.8% 83.9%;",
    "  }",
    "}",
    "",
    "@layer base {",
    "  * {",
    "    @apply border-border;",
    "  }",
    "  body {",
    "    @apply bg-background text-foreground;",
    "  }",
    "}",
    "",
  ].join("\n");
}

function buildFrontendViteConfig() {
  return [
    "import { defineConfig } from \"vite\";",
    "import react from \"@vitejs/plugin-react\";",
    "import path from \"path\";",
    "",
    "export default defineConfig({",
    "  plugins: [react()],",
    "  resolve: {",
    "    alias: {",
    "      \"@\": path.resolve(__dirname, \"src\"),",
    "    },",
    "  },",
    "  server: {",
    "    port: 5173,",
    "    strictPort: true,",
    "  },",
    "});",
    "",
  ].join("\n");
}

function buildFrontendTsconfig() {
  return [
    "{",
    "  \"compilerOptions\": {",
    "    \"target\": \"ES2020\",",
    "    \"useDefineForClassFields\": true,",
    "    \"lib\": [\"ES2020\", \"DOM\", \"DOM.Iterable\"],",
    "    \"module\": \"ESNext\",",
    "    \"skipLibCheck\": true,",
    "    \"moduleResolution\": \"bundler\",",
    "    \"allowImportingTsExtensions\": true,",
    "    \"resolveJsonModule\": true,",
    "    \"isolatedModules\": true,",
    "    \"noEmit\": true,",
    "    \"jsx\": \"react-jsx\",",
    "    \"strict\": true,",
    "    \"noUnusedLocals\": true,",
    "    \"noUnusedParameters\": true,",
    "    \"noFallthroughCasesInSwitch\": true,",
    "    \"baseUrl\": \".\",",
    "    \"paths\": {",
    "      \"@/*\": [\"src/*\"]",
    "    }",
    "  },",
    "  \"include\": [\"src\"]",
    "}",
    "",
  ].join("\n");
}

function buildFrontendTsconfigNode() {
  return [
    "{",
    "  \"compilerOptions\": {",
    "    \"composite\": true,",
    "    \"skipLibCheck\": true,",
    "    \"module\": \"ESNext\",",
    "    \"moduleResolution\": \"bundler\",",
    "    \"allowSyntheticDefaultImports\": true",
    "  },",
    "  \"include\": [\"vite.config.ts\"]",
    "}",
    "",
  ].join("\n");
}

function buildFrontendPostcssConfig() {
  return [
    "module.exports = {",
    "  plugins: {",
    "    tailwindcss: {},",
    "    autoprefixer: {},",
    "  },",
    "};",
    "",
  ].join("\n");
}

function buildFrontendTailwindConfig() {
  return [
    "import type { Config } from \"tailwindcss\";",
    "",
    "export default {",
    "  darkMode: [\"class\"],",
    "  content: [\"./index.html\", \"./src/**/*.{ts,tsx}\"],",
    "  theme: {",
    "    extend: {",
    "      colors: {",
    "        border: \"hsl(var(--border))\",",
    "        input: \"hsl(var(--input))\",",
    "        ring: \"hsl(var(--ring))\",",
    "        background: \"hsl(var(--background))\",",
    "        foreground: \"hsl(var(--foreground))\",",
    "        primary: {",
    "          DEFAULT: \"hsl(var(--primary))\",",
    "          foreground: \"hsl(var(--primary-foreground))\",",
    "        },",
    "        secondary: {",
    "          DEFAULT: \"hsl(var(--secondary))\",",
    "          foreground: \"hsl(var(--secondary-foreground))\",",
    "        },",
    "        destructive: {",
    "          DEFAULT: \"hsl(var(--destructive))\",",
    "          foreground: \"hsl(var(--destructive-foreground))\",",
    "        },",
    "        muted: {",
    "          DEFAULT: \"hsl(var(--muted))\",",
    "          foreground: \"hsl(var(--muted-foreground))\",",
    "        },",
    "        accent: {",
    "          DEFAULT: \"hsl(var(--accent))\",",
    "          foreground: \"hsl(var(--accent-foreground))\",",
    "        },",
    "        popover: {",
    "          DEFAULT: \"hsl(var(--popover))\",",
    "          foreground: \"hsl(var(--popover-foreground))\",",
    "        },",
    "        card: {",
    "          DEFAULT: \"hsl(var(--card))\",",
    "          foreground: \"hsl(var(--card-foreground))\",",
    "        },",
    "      },",
    "      borderRadius: {",
    "        lg: \"var(--radius)\",",
    "        md: \"calc(var(--radius) - 2px)\",",
    "        sm: \"calc(var(--radius) - 4px)\",",
    "      },",
    "    },",
    "  },",
    "  plugins: [require(\"tailwindcss-animate\")],",
    "} satisfies Config;",
    "",
  ].join("\n");
}

function buildFrontendViteEnv() {
  return ["/// <reference types=\"vite/client\" />", ""].join("\n");
}

function buildFrontendComponentsJson() {
  return [
    "{",
    "  \"$schema\": \"https://ui.shadcn.com/schema.json\",",
    "  \"style\": \"new-york\",",
    "  \"rsc\": false,",
    "  \"tsx\": true,",
    "  \"tailwind\": {",
    "    \"config\": \"tailwind.config.ts\",",
    "    \"css\": \"src/index.css\",",
    "    \"baseColor\": \"slate\",",
    "    \"cssVariables\": true,",
    "    \"prefix\": \"\"",
    "  },",
    "  \"aliases\": {",
    "    \"components\": \"@/components\",",
    "    \"utils\": \"@/lib/utils\"",
    "  }",
    "}",
    "",
  ].join("\n");
}

function buildFrontendUtils() {
  return [
    "import { clsx, type ClassValue } from \"clsx\";",
    "import { twMerge } from \"tailwind-merge\";",
    "",
    "export function cn(...inputs: ClassValue[]) {",
    "  return twMerge(clsx(inputs));",
    "}",
    "",
  ].join("\n");
}

function buildFrontendPackageJson(projectName) {
  const pkg = {
    name: `${projectName}-frontend`,
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "vite build",
      preview: "vite preview",
    },
    dependencies: {
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      clsx: "^2.1.1",
      "tailwind-merge": "^2.5.2",
      "class-variance-authority": "^0.7.1",
    },
    devDependencies: {
      "@types/react": "^18.3.12",
      "@types/react-dom": "^18.3.1",
      "@vitejs/plugin-react": "^4.3.4",
      autoprefixer: "^10.4.20",
      postcss: "^8.4.47",
      tailwindcss: "^3.4.15",
      "tailwindcss-animate": "^1.0.7",
      typescript: "^5.6.3",
      vite: "^5.4.10",
    },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

function buildNodeBackend() {
  return [
    "const http = require(\"http\");",
    "",
    "const server = http.createServer((req, res) => {",
    "  res.writeHead(200, { \"Content-Type\": \"application/json\" });",
    "  res.end(JSON.stringify({ ok: true }));",
    "});",
    "",
    "const port = process.env.PORT || 3001;",
    "server.listen(port, () => {",
    "  console.log(`Backend running on http://localhost:${port}`);",
    "});",
    "",
  ].join("\n");
}

function buildFastApiBackend() {
  return [
    "from fastapi import FastAPI",
    "import uvicorn",
    "",
    "app = FastAPI()",
    "",
    "@app.get(\"/\")",
    "def read_root():",
    "    return {\"ok\": True}",
    "",
    "if __name__ == \"__main__\":",
    "    uvicorn.run(app, host=\"0.0.0.0\", port=3001)",
    "",
  ].join("\n");
}

function buildGinBackend() {
  return [
    "package main",
    "",
    "import (",
    "  \"net/http\"",
    "  \"github.com/gin-gonic/gin\"",
    ")",
    "",
    "func main() {",
    "  r := gin.Default()",
    "  r.GET(\"/\", func(c *gin.Context) {",
    "    c.JSON(http.StatusOK, gin.H{\"ok\": true})",
    "  })",
    "  r.Run(\":3001\")",
    "}",
    "",
  ].join("\n");
}

function buildDocs() {
  return [
    "# Project Docs",
    "",
    "This folder is reserved for project documentation.",
    "",
  ].join("\n");
}

function buildScripts(isWindows, backend) {
  if (isWindows) {
    const start = [
      "$ErrorActionPreference = \"Stop\"",
      "Write-Host \"Starting Electron...\"",
      "npx electron .",
      "",
    ].join("\n");
    const dev = [
      "$ErrorActionPreference = \"Stop\"",
      "$root = Resolve-Path \"$PSScriptRoot\\..\"",
      "$frontend = Join-Path $root \"src\\frontend\"",
      "$env:ELECTRON_DEV_URL = \"http://localhost:5173\"",
      "Write-Host \"Starting Vite dev server...\"",
      "$vite = Start-Process -PassThru -NoNewWindow -WorkingDirectory $frontend -FilePath \"cmd.exe\" -ArgumentList \"/c\",\"npm\",\"run\",\"dev\"",
      "Start-Sleep -Seconds 2",
      "Write-Host \"Starting Electron...\"",
      "Set-Location $root",
      "try {",
      "  npx electron .",
      "} finally {",
      "  if ($vite -and -not $vite.HasExited) {",
      "    Write-Host \"Stopping Vite dev server...\"",
      "    taskkill /T /F /PID $vite.Id 2>$null",
      "  }",
      "}",
      "",
    ].join("\n");
    const build = [
      "$ErrorActionPreference = \"Stop\"",
      "Write-Host \"Build script placeholder.\"",
      "",
    ].join("\n");
    let backendCmd = backend.startCommandWindows;
    const backendScript = [
      "$ErrorActionPreference = \"Stop\"",
      "Write-Host \"Starting backend...\"",
      backendCmd,
      "",
    ].join("\n");

    return {
      "start.ps1": start,
      "dev.ps1": dev,
      "build.ps1": build,
      "start-backend.ps1": backendScript,
    };
  }

  const start = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "echo \"Starting Electron...\"",
    "npx electron .",
    "",
  ].join("\n");
  const dev = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "root=\"$(cd \"$(dirname \"$0\")/..\" && pwd)\"",
    "export ELECTRON_DEV_URL=\"http://localhost:5173\"",
    "echo \"Starting Vite dev server...\"",
    "( cd \"$root/src/frontend\" && npm run dev ) &",
    "vite_pid=$!",
    "cleanup() {",
    "  if kill -0 \"$vite_pid\" 2>/dev/null; then",
    "    echo \"Stopping Vite dev server...\"",
    "    kill \"$vite_pid\" 2>/dev/null || true",
    "  fi",
    "}",
    "trap cleanup EXIT INT TERM",
    "sleep 2",
    "echo \"Starting Electron...\"",
    "cd \"$root\"",
    "npx electron .",
    "",
  ].join("\n");
  const build = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "echo \"Build script placeholder.\"",
    "",
  ].join("\n");
  let backendCmd = backend.startCommandUnix;
  const backendScript = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "echo \"Starting backend...\"",
    backendCmd,
    "",
  ].join("\n");

  return {
    "start.sh": start,
    "dev.sh": dev,
    "build.sh": build,
    "start-backend.sh": backendScript,
  };
}

function writeExecutableIfUnix(target, content, isWindows) {
  writeFile(target, content);
  if (!isWindows) {
    fs.chmodSync(target, 0o755);
  }
}

function copyDir(src, dest, isRoot) {
  if (!fs.existsSync(src)) {
    throw new Error(`Template directory not found: ${src}`);
  }
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (isRoot && COPY_IGNORE.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to, false);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
    }
  }
}

function runNpmInstall(cwd, env, label) {
  const installArgs = ["install"];
  if (!enableAudit) installArgs.push("--no-audit");

  console.log(`Installing npm dependencies${label ? ` (${label})` : ""}...`);
  let install;
  if (isWindows) {
    const cmdExe = process.env.ComSpec || "cmd.exe";
    install = spawnSync(cmdExe, ["/c", "npm", ...installArgs], {
      cwd,
      stdio: "inherit",
      env,
      windowsHide: true,
    });
  } else {
    install = spawnSync(npmCommand, installArgs, {
      cwd,
      stdio: "inherit",
      env,
    });
  }

  if (install.status !== 0) {
    console.error("npm install failed.");
    if (install.error) {
      console.error(`npm spawn error: ${install.error.message}`);
    }
    if (install.signal) {
      console.error(`npm terminated by signal: ${install.signal}`);
    }
    if (typeof install.status === "number") {
      console.error(`npm exit code: ${install.status}`);
    }
    process.exit(1);
  }
}

async function main() {
  const nodeVersion = getNodeVersion();
  if (!nodeVersion) {
    console.error("Node.js is not available in PATH. Please install Node.js first.");
    process.exit(1);
  }

  const npmVersion = run(`${npmCommand} -v`);
  if (!npmVersion) {
    console.error("npm is not available in PATH. Please install npm first.");
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let targetDir;

  if (forceRebuild) {
    targetDir = path.resolve(process.cwd(), TEMPLATE_DIR);
  } else {
    const targetInput = await promptLine(
      rl,
      `Target directory (default: ${DEFAULT_TARGET}): `,
      DEFAULT_TARGET
    );
    targetDir = path.resolve(process.cwd(), targetInput);
  }

  if (fs.existsSync(targetDir) && !isEmptyDir(targetDir)) {
    const overwrite = forceRebuild || await confirm(
      rl,
      `Target directory is not empty: ${targetDir}\nOverwrite?`,
      false
    );
    if (!overwrite) {
      rl.close();
      process.exit(1);
    }
    console.log(`Clearing: ${targetDir}`);
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  if (!forceRebuild) {
    const useLocalTemplate = await confirm(
      rl,
      `Use cached scaffold from ${TEMPLATE_DIR}?`,
      false
    );

    if (useLocalTemplate) {
      const templateDir = path.resolve(process.cwd(), TEMPLATE_DIR);
      if (!fs.existsSync(templateDir) || isEmptyDir(templateDir)) {
        console.error(`Template directory is missing or empty: ${templateDir}`);
        rl.close();
        process.exit(1);
      }
      if (path.resolve(templateDir) === path.resolve(targetDir)) {
        console.log(`Using cached scaffold in place: ${templateDir}`);
        rl.close();
        return;
      }
      try {
        copyDir(templateDir, targetDir, true);
      } catch (err) {
        console.error(`Failed to copy template: ${err.message}`);
        rl.close();
        process.exit(1);
      }
      console.log(`Scaffold copied from ${templateDir} to ${targetDir}`);
      rl.close();
      return;
    }
  }

  const useMirror = await confirm(rl, "Configure npm mirror?", false);

  const backends = [
    {
      key: "node",
      label: "node (default)",
      startCommandWindows: "node src\\backend\\index.js",
      startCommandUnix: "node src/backend/index.js",
      createFiles: (targetDir) => {
        writeFile(
          path.join(targetDir, "src", "backend", "index.js"),
          buildNodeBackend()
        );
      },
    },
    {
      key: "python-fastapi",
      label: "python-fastapi",
      startCommandWindows: "python src\\backend\\app.py",
      startCommandUnix: "python src/backend/app.py",
      createFiles: (targetDir) => {
        writeFile(
          path.join(targetDir, "src", "backend", "app.py"),
          buildFastApiBackend()
        );
        writeFile(
          path.join(targetDir, "src", "backend", "requirements.txt"),
          "fastapi\nuvicorn\n"
        );
      },
    },
    {
      key: "golang-gin",
      label: "golang-gin",
      startCommandWindows: "go run src\\backend\\main.go",
      startCommandUnix: "go run src/backend/main.go",
      createFiles: (targetDir, projectName) => {
        writeFile(
          path.join(targetDir, "src", "backend", "main.go"),
          buildGinBackend()
        );
        const moduleName = projectName || "backend";
        writeFile(
          path.join(targetDir, "src", "backend", "go.mod"),
          `module ${moduleName}\n\ngo 1.20\n`
        );
      },
    },
  ];

  console.log("Select backend:");
  backends.forEach((b, i) => {
    console.log(`${i + 1}) ${b.label}`);
  });
  const backendInput = await promptLine(rl, "Enter choice [1-3]: ", "1");
  const backendIndex = Math.max(1, Math.min(backends.length, parseInt(backendInput, 10) || 1)) - 1;
  const backend = backends[backendIndex];

  const nodeMajor = parseMajor(nodeVersion);
  console.log(`Local Node.js: v${nodeVersion}`);
  console.log("Fetching Electron releases...");

  let releases = null;
  try {
    releases = await fetchJson(RELEASES_URL);
  } catch (err) {
    console.error(`Failed to fetch Electron releases: ${err.message}`);
  }

  let selected = null;
  if (releases && Array.isArray(releases)) {
    selected = pickElectronVersion(releases, nodeMajor);
  }

  if (!selected) {
    console.log("Could not auto-select Electron version.");
    const manual = await promptLine(rl, "Enter Electron version manually (e.g. 30.0.0): ", "");
    if (!manual) {
      console.error("No Electron version provided. Aborting.");
      rl.close();
      process.exit(1);
    }
    selected = { version: manual, node: "unknown" };
  }

  if (selected.match === "lower") {
    console.log(
      `No exact Node ${nodeMajor} match. Using latest Electron with Node ${selected.node}.`
    );
  } else if (selected.match === "any") {
    console.log("No compatible Node match found. Using latest stable Electron.");
  }

  console.log(
    `Candidate Electron: v${selected.version} (bundled Node ${selected.node})`
  );
  const ok = await confirm(rl, `Install Electron v${selected.version}?`, true);
  rl.close();

  if (!ok) {
    console.error("Cancelled by user.");
    process.exit(1);
  }

  ensureDir(targetDir);
  const projectName = toPackageName(path.basename(targetDir));

  const dirs = [
    "src/frontend",
    "src/backend",
    "src/electron",
    "docs",
    "scripts",
    "data",
    "logs",
    "dist",
  ];
  dirs.forEach((d) => ensureDir(path.join(targetDir, d)));

  writeFile(path.join(targetDir, ".gitignore"), buildGitignore() + "\n");

  writeFile(path.join(targetDir, "docs", "README.md"), buildDocs() + "\n");

  const frontendRoot = path.join(targetDir, "src", "frontend");
  writeFile(path.join(frontendRoot, "index.html"), buildFrontendIndexHtml());
  writeFile(path.join(frontendRoot, "package.json"), buildFrontendPackageJson(projectName));
  writeFile(path.join(frontendRoot, "vite.config.ts"), buildFrontendViteConfig());
  writeFile(path.join(frontendRoot, "tsconfig.json"), buildFrontendTsconfig());
  writeFile(path.join(frontendRoot, "tsconfig.node.json"), buildFrontendTsconfigNode());
  writeFile(path.join(frontendRoot, "postcss.config.cjs"), buildFrontendPostcssConfig());
  writeFile(path.join(frontendRoot, "tailwind.config.ts"), buildFrontendTailwindConfig());
  writeFile(path.join(frontendRoot, "components.json"), buildFrontendComponentsJson());

  ensureDir(path.join(frontendRoot, "src"));
  ensureDir(path.join(frontendRoot, "src", "lib"));
  ensureDir(path.join(frontendRoot, "src", "components"));

  writeFile(path.join(frontendRoot, "src", "main.tsx"), buildFrontendMainTsx());
  writeFile(path.join(frontendRoot, "src", "App.tsx"), buildFrontendAppTsx());
  writeFile(path.join(frontendRoot, "src", "index.css"), buildFrontendCss());
  writeFile(path.join(frontendRoot, "src", "lib", "utils.ts"), buildFrontendUtils());
  writeFile(path.join(frontendRoot, "src", "vite-env.d.ts"), buildFrontendViteEnv());

  writeFile(
    path.join(targetDir, "src", "electron", "main.js"),
    buildElectronMain()
  );
  writeFile(
    path.join(targetDir, "src", "electron", "preload.js"),
    buildElectronPreload()
  );

  backend.createFiles(targetDir, projectName);

  const scripts = buildScripts(isWindows, backend);
  Object.entries(scripts).forEach(([name, content]) => {
    writeExecutableIfUnix(path.join(targetDir, "scripts", name), content, isWindows);
  });

  const pkg = {
    name: projectName,
    version: "0.1.0",
    private: true,
    main: "src/electron/main.js",
    scripts: {
      "electron:dev": "electron .",
      "electron:pack": "echo \"TODO: add packaging step\"",
    },
    devDependencies: {
      electron: normalizeVersion(selected.version),
    },
  };
  writeFile(path.join(targetDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  const npmrcLines = [];
  if (useMirror) {
    npmrcLines.push(`registry=${NPM_MIRROR_REGISTRY}`);
    npmrcLines.push(`electron_mirror=${ELECTRON_MIRROR}`);
  }
  if (!enableAudit) {
    npmrcLines.push("audit=false");
  }
  if (npmrcLines.length > 0) {
    writeFile(path.join(targetDir, ".npmrc"), npmrcLines.join("\n") + "\n");
  }

  const env = { ...process.env };
  if (useMirror) {
    env.ELECTRON_MIRROR = ELECTRON_MIRROR;
  }
  runNpmInstall(targetDir, env, "root");
  runNpmInstall(path.join(targetDir, "src", "frontend"), env, "frontend");

  console.log(`Scaffold created at: ${targetDir}`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
