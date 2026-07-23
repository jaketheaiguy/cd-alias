const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');

let mainWindow;
let hasUnsavedChanges = false;

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Paths
const appDir = path.join(app.getPath('appData'), 'cd-alias');
const appBinDir = path.join(appDir, 'bin');
const configFilePath = path.join(appDir, 'config.json');
const appPathFile = path.join(appDir, 'app-path.txt');

// Ensure base directories exist
if (!fs.existsSync(appDir)) {
  fs.mkdirSync(appDir, { recursive: true });
}
if (!fs.existsSync(appBinDir)) {
  fs.mkdirSync(appBinDir, { recursive: true });
}

// Write the current application path so the CLI can spawn the GUI
fs.writeFileSync(appPathFile, process.execPath, 'utf8');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 700,
    icon: path.join(__dirname, '..', 'icon', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true,
    backgroundColor: '#121214',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (hasUnsavedChanges) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Leave Without Saving'],
        defaultId: 0,
        cancelId: 0,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Are you sure you want to exit?'
      });
      if (choice === 0) {
        event.preventDefault();
      }
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Helper: Run a command and return promise
function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(stderr || error.message);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Helper: Parse Windows network mapped drives (net use)
async function getMappedDrives() {
  const map = {};
  try {
    const output = await runCommand('net use');
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      // Match lines containing drive letters like Z: and network paths like \\wsl$\... or \\wsl.localhost\...
      const match = line.match(/([A-Za-z]:)\s+(\\\\[^\s]+)/);
      if (match) {
        const driveLetter = match[1].toUpperCase();
        const remotePath = match[2];
        map[driveLetter] = remotePath;
      }
    }
  } catch (e) {
    // Ignore error if net use fails
  }
  return map;
}

// Helper: Spawn WSL process and pipe stdin
function runWslCommand(command, stdinContent = null) {
  return new Promise((resolve, reject) => {
    const process = spawn('wsl.exe', ['bash', '-c', command]);
    let stdout = '';
    let stderr = '';
    
    if (stdinContent !== null) {
      process.stdin.write(stdinContent);
      process.stdin.end();
    }
    
    process.stdout.on('data', (data) => { stdout += data.toString(); });
    process.stderr.on('data', (data) => { stderr += data.toString(); });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `WSL command failed with exit code ${code}`));
      }
    });
  });
}

// Helper: Check if WSL is available
async function isWslAvailable() {
  try {
    await runCommand('wsl.exe --status');
    return true;
  } catch (e) {
    return false;
  }
}

// Helper: Get PowerShell profile path
async function getPsProfilePath() {
  try {
    const profilePath = await runCommand('powershell.exe -NoProfile -Command "$PROFILE"');
    return profilePath;
  } catch (e) {
    return null;
  }
}

// IPC Handlers

// Track unsaved changes state from renderer
ipcMain.on('set-unsaved-changes', (event, flag) => {
  hasUnsavedChanges = flag;
});

// Get current configuration
ipcMain.handle('get-config', async () => {
  let config = { windows: [], wsl: [] };
  if (fs.existsSync(configFilePath)) {
    try {
      config = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
    } catch (e) {
      console.error('Error parsing config file:', e);
    }
  }
  
  // Make sure keys exist
  config.windows = config.windows || [];
  config.wsl = config.wsl || [];
  return config;
});

// Save configuration (saves to Windows and syncs with WSL if available)
ipcMain.handle('save-config', async (event, config) => {
  try {
    // Save to Windows config location
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');

    // If WSL is available, sync to WSL
    const wslOk = await isWslAvailable();
    if (wslOk) {
      const configStr = JSON.stringify(config, null, 2);
      // Write config to ~/.config/cd-alias/config.json in WSL
      await runWslCommand('mkdir -p ~/.config/cd-alias && cat > ~/.config/cd-alias/config.json', configStr);
      
      // Also write the app-path.txt to WSL so cda --open can spawn the GUI
      await runWslCommand('mkdir -p ~/.config/cd-alias && cat > ~/.config/cd-alias/app-path.txt', process.execPath);
    }
    hasUnsavedChanges = false;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Check PATH installation status for both Windows and WSL
ipcMain.handle('check-path-status', async () => {
  const status = { windows: false, wsl: false, wslSupported: false };

  // 1. Check Windows PATH status
  try {
    const userPath = await runCommand('powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'User\')"');
    const hasBinInPath = userPath ? userPath.toLowerCase().includes(appBinDir.toLowerCase()) : false;

    // Also verify PowerShell profile has the cda function
    let hasProfileFunc = false;
    const psProfile = await getPsProfilePath();
    if (psProfile && fs.existsSync(psProfile)) {
      const content = fs.readFileSync(psProfile, 'utf8');
      hasProfileFunc = content.includes('# Added by cd-alias');
    }

    // Windows is fully configured if bin folder is in PATH and PowerShell profile function is set
    status.windows = hasBinInPath && hasProfileFunc;
  } catch (e) {
    console.error('Error checking Windows PATH:', e);
  }

  // 2. Check WSL PATH status
  const wslOk = await isWslAvailable();
  status.wslSupported = wslOk;
  if (wslOk) {
    try {
      // Check if ~/.bashrc contains the hook
      const bashrc = await runWslCommand('cat ~/.bashrc');
      status.wsl = bashrc.includes('# Added by cd-alias');
    } catch (e) {
      console.error('Error checking WSL PATH:', e);
    }
  }

  return status;
});

// Add to PATH
ipcMain.handle('add-to-path', async (event, platform) => {
  try {
    if (platform === 'windows') {
      // 1. Generate CLI script copies in AppData/Roaming/cd-alias/bin
      const cliSourcePath = path.join(__dirname, 'cda-cli.js');
      const cliDestPath = path.join(appBinDir, 'cda-cli.js');
      fs.copyFileSync(cliSourcePath, cliDestPath);

      // Create cda.bat
      const cdaBatContent = `@echo off\nnode "%~dp0cda-cli.js" %*\nif exist "%TEMP%\\cda_goto.bat" (\n    call "%TEMP%\\cda_goto.bat"\n    del "%TEMP%\\cda_goto.bat"\n)\n`;
      fs.writeFileSync(path.join(appBinDir, 'cda.bat'), cdaBatContent, 'utf8');

      // 2. Add Bin folder to Windows User PATH
      const userPath = await runCommand('powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'User\')"');
      const paths = (userPath || '').split(';').map(p => p.trim()).filter(Boolean);
      
      const normalizedBinDir = appBinDir.toLowerCase();
      const alreadyInPath = paths.some(p => p.toLowerCase() === normalizedBinDir);
      
      if (!alreadyInPath) {
        paths.push(appBinDir);
        const newPathVal = paths.join(';');
        const escapedPath = newPathVal.replace(/"/g, '\\"');
        await runCommand(`powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable('PATH', '${escapedPath}', 'User')"`);
      }

      // 3. Add cda function to PowerShell Profile
      const psProfile = await getPsProfilePath();
      if (psProfile) {
        const profileDir = path.dirname(psProfile);
        if (!fs.existsSync(profileDir)) {
          fs.mkdirSync(profileDir, { recursive: true });
        }

        let content = '';
        if (fs.existsSync(psProfile)) {
          content = fs.readFileSync(psProfile, 'utf8');
        }

        if (!content.includes('# Added by cd-alias')) {
          const block = `\n# Added by cd-alias\nfunction cda {\n    node "${cliDestPath.replace(/\\/g, '\\\\')}" $args\n    if (Test-Path "$env:TEMP\\cda_goto.ps1") {\n        . "$env:TEMP\\cda_goto.ps1"\n        Remove-Item "$env:TEMP\\cda_goto.ps1"\n    }\n}\n# End cd-alias\n`;
          fs.writeFileSync(psProfile, content + block, 'utf8');
        }
      }
      return { success: true };
    } else if (platform === 'wsl') {
      const wslOk = await isWslAvailable();
      if (!wslOk) throw new Error('WSL is not available on this system.');

      // 1. Write the scripts in WSL
      // Read the local cda-cli.js content
      const cliSourcePath = path.join(__dirname, 'cda-cli.js');
      const cliContent = fs.readFileSync(cliSourcePath, 'utf8');

      // Write ~/.cd-alias/bin/cda-cli.js
      await runWslCommand('mkdir -p ~/.cd-alias/bin && cat > ~/.cd-alias/bin/cda-cli.js', cliContent);

      // Write ~/.cd-alias/bin/cda-cli wrapper script
      const wslWrapper = `#!/usr/bin/env bash\nnode "$(dirname "$0")/cda-cli.js" "$@"\n`;
      await runWslCommand('cat > ~/.cd-alias/bin/cda-cli', wslWrapper);
      await runWslCommand('chmod +x ~/.cd-alias/bin/cda-cli');

      // 2. Append to ~/.bashrc if not already present
      const bashrcContent = await runWslCommand('cat ~/.bashrc');
      if (!bashrcContent.includes('# Added by cd-alias')) {
        const bashrcBlock = `\n# Added by cd-alias\nexport PATH="$PATH:$HOME/.cd-alias/bin"\ncda() {\n    cda-cli "$@"\n    if [ -f /tmp/cda_goto.sh ]; then\n        . /tmp/cda_goto.sh\n        rm /tmp/cda_goto.sh\n    fi\n}\n# End cd-alias\n`;
        // Append to .bashrc by typing it in
        await runWslCommand('cat >> ~/.bashrc', bashrcBlock);
      }
      return { success: true };
    }
  } catch (e) {
    return { success: false, error: e.message || e };
  }
});

// Remove from PATH
ipcMain.handle('remove-from-path', async (event, platform) => {
  try {
    if (platform === 'windows') {
      // 1. Remove Bin folder from PATH env var
      const userPath = await runCommand('powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'User\')"');
      const paths = (userPath || '').split(';').map(p => p.trim()).filter(Boolean);
      
      const normalizedBinDir = appBinDir.toLowerCase();
      const filteredPaths = paths.filter(p => p.toLowerCase() !== normalizedBinDir);
      
      if (filteredPaths.length !== paths.length) {
        const newPathVal = filteredPaths.join(';');
        const escapedPath = newPathVal.replace(/"/g, '\\"');
        await runCommand(`powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable('PATH', '${escapedPath}', 'User')"`);
      }

      // 2. Remove function from PowerShell Profile
      const psProfile = await getPsProfilePath();
      if (psProfile && fs.existsSync(psProfile)) {
        let content = fs.readFileSync(psProfile, 'utf8');
        if (content.includes('# Added by cd-alias')) {
          const regex = /\r?\n?# Added by cd-alias[\s\S]*?# End cd-alias\r?\n?/g;
          content = content.replace(regex, '');
          fs.writeFileSync(psProfile, content, 'utf8');
        }
      }

      // 3. Clean up the bin folder files
      try {
        if (fs.existsSync(path.join(appBinDir, 'cda-cli.js'))) fs.unlinkSync(path.join(appBinDir, 'cda-cli.js'));
        if (fs.existsSync(path.join(appBinDir, 'cda.bat'))) fs.unlinkSync(path.join(appBinDir, 'cda.bat'));
      } catch (err) {
        console.error('Error deleting bin files:', err);
      }

      return { success: true };
    } else if (platform === 'wsl') {
      const wslOk = await isWslAvailable();
      if (!wslOk) throw new Error('WSL is not available on this system.');

      // 1. Remove block from ~/.bashrc
      const bashrcContent = await runWslCommand('cat ~/.bashrc');
      if (bashrcContent.includes('# Added by cd-alias')) {
        await runWslCommand("sed -i '/# Added by cd-alias/,/# End cd-alias/d' ~/.bashrc");
      }

      // 2. Clean up files in WSL
      await runWslCommand('rm -rf ~/.cd-alias/bin');

      return { success: true };
    }
  } catch (e) {
    return { success: false, error: e.message || e };
  }
});

// Select folder dialog
ipcMain.handle('select-directory', async (event, platform, currentPath) => {
  let defaultPath = undefined;

  if (currentPath && typeof currentPath === 'string' && currentPath.trim().length > 0) {
    const trimmed = currentPath.trim();
    if (fs.existsSync(trimmed)) {
      defaultPath = trimmed;
    }
  }

  if (!defaultPath && platform === 'wsl') {
    // Try opening at WSL share folder to help user browse
    if (fs.existsSync('\\\\wsl.localhost')) {
      defaultPath = '\\\\wsl.localhost';
    } else if (fs.existsSync('\\\\wsl$')) {
      defaultPath = '\\\\wsl$';
    }
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  
  let selectedPath = result.filePaths[0];

  // Resolve mapped drives (e.g. Z:\ -> \\wsl$\Ubuntu...)
  const mappedDrives = await getMappedDrives();
  const driveMatch = selectedPath.match(/^([A-Za-z]:)/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toUpperCase();
    if (mappedDrives[driveLetter]) {
      selectedPath = selectedPath.replace(/^[A-Za-z]:/i, mappedDrives[driveLetter]);
    }
  }

  // If platform is wsl and the path is a Windows network path to WSL,
  // convert it to local Linux path (e.g., \\wsl.localhost\Ubuntu\home\user -> /home/user)
  if (platform === 'wsl' && (selectedPath.startsWith('\\\\wsl.localhost') || selectedPath.startsWith('\\\\wsl$'))) {
    const parts = selectedPath.split('\\').filter(Boolean);
    if (parts.length >= 3) {
      selectedPath = '/' + parts.slice(2).join('/');
    } else if (parts.length === 2) {
      selectedPath = '/';
    }
  }

  return selectedPath;
});
