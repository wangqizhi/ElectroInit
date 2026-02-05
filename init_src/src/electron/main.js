const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  const devUrl = process.env.ELECTRON_DEV_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    return;
  }

  const distPath = path.join(__dirname, "..", "frontend", "dist", "index.html");
  if (fs.existsSync(distPath)) {
    win.loadFile(distPath);
    return;
  }

  win.loadURL(
    "data:text/html," +
      encodeURIComponent(
        "<h2>Frontend not built</h2><p>Run frontend build or dev server.</p>"
      )
  );
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
