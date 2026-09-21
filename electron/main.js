import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appOrigin = 'lfcore://app';

protocol.registerSchemesAsPrivileged([{
  scheme: 'lfcore',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}]);

function localFileFor(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'lfcore:' || parsed.host !== 'app') return null;
  const relative = decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname).replace(/^\/+/, '');
  const file = normalize(join(appRoot, relative));
  return file === appRoot || file.startsWith(appRoot + sep) ? file : null;
}

function createMenu() {
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]);
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#f7f6f2',
    title: 'LF CORE',
    webPreferences: {
      preload: join(appRoot, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin)) event.preventDefault();
  });
  await window.loadURL(`${appOrigin}/index.html`);
}

ipcMain.handle('project:save', async (_event, { defaultName, contents }) => {
  if (typeof defaultName !== 'string' || typeof contents !== 'string') throw new TypeError('Invalid project export.');
  const result = await dialog.showSaveDialog({
    title: 'Save LF CORE Project',
    defaultPath: defaultName,
    filters: [{ name: 'LF CORE Project', extensions: ['lfcore'] }]
  });
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, contents, 'utf8');
  return true;
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open LF CORE Project',
    properties: ['openFile'],
    filters: [{ name: 'LF CORE Project', extensions: ['lfcore'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const path = result.filePaths[0];
  return { name: path.split(sep).pop(), contents: await readFile(path, 'utf8') };
});

app.whenReady().then(async () => {
  protocol.handle('lfcore', (request) => {
    const file = localFileFor(request.url);
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
  });
  app.setName('LF CORE');
  Menu.setApplicationMenu(createMenu());
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
