const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');

let mainWindow = null;
let serverHandle = null;
let localOrigin = null;
let logFile = null;

function writeDesktopLog(message, err) {
    try {
        if (!logFile && app.isReady()) {
            const logsDir = app.getPath('logs');
            fs.mkdirSync(logsDir, { recursive: true });
            logFile = path.join(logsDir, 'main.log');
        }
        if (!logFile) return;
        const detail = err ? `\n${err.stack || err.message || err}` : '';
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}${detail}\n`);
    } catch {}
}

function getDesktopDataDir() {
    if (process.env.INFOMIND_DATA_DIR) return process.env.INFOMIND_DATA_DIR;
    if (!app.isPackaged) return path.join(__dirname, '..', 'data');
    return path.join(app.getPath('userData'), 'data');
}

function prepareDataDir() {
    const dataDir = getDesktopDataDir();
    fs.mkdirSync(path.join(dataDir, 'covers'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true });

    if (app.isPackaged) {
        copySeedDataIfNeeded(dataDir);
    }

    process.env.INFOMIND_DESKTOP = '1';
    process.env.INFOMIND_DATA_DIR = dataDir;
    process.env.INFOMIND_DB_PATH = process.env.INFOMIND_DB_PATH || path.join(dataDir, 'infomind.db');
    process.env.INFOMIND_STT_MODEL_PATH = process.env.INFOMIND_STT_MODEL_PATH || path.join(dataDir, 'models', 'ggml-base.bin');
    process.env.INFOMIND_PORT = process.env.INFOMIND_PORT || '3456';
}

function copySeedDataIfNeeded(dataDir) {
    const seedDir = path.join(process.resourcesPath, 'seed-data');
    if (!fs.existsSync(seedDir)) return;

    const hasDb = fs.existsSync(path.join(dataDir, 'infomind.db'));
    if (!hasDb && fs.existsSync(path.join(seedDir, 'infomind.db'))) {
        copyFileSafe(path.join(seedDir, 'infomind.db'), path.join(dataDir, 'infomind.db'));
    }

    copyDirIfMissing(path.join(seedDir, 'covers'), path.join(dataDir, 'covers'));
    copyDirIfMissing(path.join(seedDir, 'models'), path.join(dataDir, 'models'));
}

function copyDirIfMissing(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir)) return;
    fs.mkdirSync(targetDir, { recursive: true });
    for (const name of fs.readdirSync(sourceDir)) {
        if (name.endsWith('-wal') || name.endsWith('-shm')) continue;
        const source = path.join(sourceDir, name);
        const target = path.join(targetDir, name);
        const stat = fs.statSync(source);
        if (stat.isDirectory()) {
            copyDirIfMissing(source, target);
        } else if (!fs.existsSync(target)) {
            copyFileSafe(source, target);
        }
    }
}

function copyFileSafe(source, target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
}

async function startInfoMindServer() {
    prepareDataDir();
    writeDesktopLog(`data dir: ${process.env.INFOMIND_DATA_DIR}`);
    const { startServer } = require('../server/index');
    const preferredPort = Number(process.env.INFOMIND_PORT || 3456);
    try {
        serverHandle = await startServer({ port: preferredPort, host: '127.0.0.1' });
    } catch (err) {
        if (err && err.code === 'EADDRINUSE') {
            writeDesktopLog(`preferred port ${preferredPort} busy, falling back to a random port`, err);
            serverHandle = await startServer({ port: 0, host: '127.0.0.1' });
        } else {
            throw err;
        }
    }
    localOrigin = `http://127.0.0.1:${serverHandle.port}`;
    writeDesktopLog(`server ready: ${localOrigin}`);
    return localOrigin;
}

function createWindow(url) {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 980,
        minHeight: 680,
        title: 'InfoMind',
        backgroundColor: '#f5f5f7',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 18, y: 18 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        },
    });

    mainWindow.loadURL(url);
    mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
        if (isLocalInfoMindUrl(targetUrl)) return { action: 'allow' };
        shell.openExternal(targetUrl);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
        if (targetUrl === mainWindow.webContents.getURL() || isLocalInfoMindUrl(targetUrl)) return;
        event.preventDefault();
        shell.openExternal(targetUrl);
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function isLocalInfoMindUrl(targetUrl) {
    return !!localOrigin && String(targetUrl || '').startsWith(localOrigin);
}

function installMenu() {
    const template = [
        {
            label: 'InfoMind',
            submenu: [
                { label: '关于 InfoMind', role: 'about' },
                { type: 'separator' },
                { label: '隐藏 InfoMind', role: 'hide' },
                { label: '隐藏其他', role: 'hideOthers' },
                { type: 'separator' },
                { label: '退出 InfoMind', role: 'quit' },
            ],
        },
        {
            label: '编辑',
            submenu: [
                { label: '撤销', role: 'undo' },
                { label: '重做', role: 'redo' },
                { type: 'separator' },
                { label: '剪切', role: 'cut' },
                { label: '复制', role: 'copy' },
                { label: '粘贴', role: 'paste' },
                { label: '全选', role: 'selectAll' },
            ],
        },
        {
            label: '视图',
            submenu: [
                { label: '重新加载', role: 'reload' },
                { label: '实际大小', role: 'resetZoom' },
                { label: '放大', role: 'zoomIn' },
                { label: '缩小', role: 'zoomOut' },
                { type: 'separator' },
                { label: '切换全屏', role: 'togglefullscreen' },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
    installMenu();
    try {
        writeDesktopLog('desktop app ready');
        const url = await startInfoMindServer();
        createWindow(url);
    } catch (err) {
        writeDesktopLog('desktop startup failed', err);
        dialog.showErrorBox('InfoMind 启动失败', err.stack || err.message);
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && localOrigin) {
        createWindow(localOrigin);
    }
});

app.on('before-quit', () => {
    if (serverHandle?.server) {
        serverHandle.server.close();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
