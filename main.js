const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 适配希沃白板等低配设备：禁用硬件加速，减少 GPU 进程开销、提升启动速度与稳定性
app.disableHardwareAcceleration();

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    title: '课堂点名',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: false, // 先隐藏，待页面就绪后再显示，避免白屏闪烁
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'icon.ico')
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // 页面渲染就绪后再显示窗口，提升体感启动速度
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------ IPC ------------------------------ */

// 选择表格文件（可多选）
ipcMain.handle('select-files', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择人名表格文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '表格文件', extensions: ['xlsx', 'xls', 'csv'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths;
});

// 读取指定的表格文件，提取人名
ipcMain.handle('read-files', async (event, filePaths) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { ok: false, reason: 'no-files' };
    }
    const names = new Set();
    let fileCount = 0;
    for (const fp of filePaths) {
      try {
        const ext = path.extname(fp).toLowerCase();
        if (!['.xlsx', '.xls', '.csv'].includes(ext)) continue;
        parseTable(fp).forEach((n) => names.add(n));
        fileCount++;
      } catch (e) {
        /* 跳过无法解析的文件 */
      }
    }
    const list = [...names].filter((n) => n && String(n).trim().length > 0);
    if (list.length === 0) {
      return { ok: false, reason: 'no-names' };
    }
    return { ok: true, names: list, fileCount };
  } catch (e) {
    return { ok: false, reason: 'error', message: String((e && e.message) || e) };
  }
});

// 解析表格：任意位置单元格中的单个人名
function parseTable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const names = [];

  if (ext === '.csv') {
    const text = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      // 支持逗号 / 制表符 / 中文逗号分隔
      for (const cell of line.split(/[,，\t]/)) {
        const v = cell.trim();
        if (v) names.push(v);
      }
    }
  } else {
    // 懒加载 xlsx：仅在导入表格时才加载，降低启动耗时
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
      for (const row of data) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          if (cell === null || cell === undefined) continue;
          const v = String(cell).trim();
          if (v) names.push(v);
        }
      }
    }
  }

  return names;
}
