#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

// Determine environment
const isWSL = process.platform === 'linux' && (os.release().toLowerCase().includes('microsoft') || process.env.WSL_DISTRO_NAME);
const isWindows = process.platform === 'win32';

// Resolve configuration file path
let configPath = '';
if (isWindows) {
  configPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'cd-alias', 'config.json');
} else {
  // WSL/Linux
  configPath = path.join(os.homedir(), '.config', 'cd-alias', 'config.json');
}

// Load configurations
let config = { windows: [], wsl: [] };
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('Error reading configuration file:', e.message);
  }
}

// Ensure structures exist
config.windows = config.windows || [];
config.wsl = config.wsl || [];

// Choose active aliases list based on execution environment
const activeList = isWSL ? config.wsl : (isWindows ? config.windows : []);

function showHelp() {
  console.log(`cda - Quick Directory Alias Changer

Usage:
  cda <alias>         cd into the directory associated with the alias
  cda --list          list all aliases
  cda --open          open the configuration GUI
  cda --config        open the configuration GUI
  cda --help          show this help message
`);
  showAllAliases();
}

function showAllAliases() {
  if (activeList.length === 0) {
    console.log('No aliases defined yet.');
    return;
  }
  console.log('Defined Aliases:');
  console.log('--------------------------------------------------');
  activeList.forEach(item => {
    console.log(`${item.alias.padEnd(15)} -> ${item.path}`);
  });
  console.log('--------------------------------------------------');
}

function isProcessRunning(processName) {
  try {
    if (isWindows) {
      const output = child_process.execSync(`tasklist /FI "IMAGENAME eq ${processName}" /FO CSV 2>NUL`, { encoding: 'utf8' });
      return output.toLowerCase().includes(processName.toLowerCase());
    } else {
      const output = child_process.execSync(`pgrep -f "${processName}" 2>/dev/null`, { encoding: 'utf8' });
      return output.trim().length > 0;
    }
  } catch (e) {
    return false;
  }
}

function openGUI() {
  // Read app path to spawn the GUI
  let appPathFile = '';
  if (isWindows) {
    appPathFile = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'cd-alias', 'app-path.txt');
  } else {
    appPathFile = path.join(os.homedir(), '.config', 'cd-alias', 'app-path.txt');
  }

  if (fs.existsSync(appPathFile)) {
    const appPath = fs.readFileSync(appPathFile, 'utf8').trim();
    if (appPath && fs.existsSync(appPath)) {
      const exeName = path.basename(appPath);
      const alreadyRunning = isProcessRunning(exeName) || isProcessRunning('cd-alias.exe');

      if (alreadyRunning) {
        console.log('cd-alias GUI is already running. Bringing window into focus...');
      } else {
        console.log('Launching cd-alias GUI...');
      }

      const spawnOptions = { detached: true, stdio: 'ignore' };
      if (isWindows) {
        child_process.spawn(appPath, [], spawnOptions).unref();
      } else {
        try {
          const wslPath = child_process.execSync(`wslpath "${appPath}"`).toString().trim();
          child_process.spawn(wslPath, [], spawnOptions).unref();
        } catch (err) {
          child_process.spawn('cmd.exe', ['/c', `"${appPath}"`], spawnOptions).unref();
        }
      }
      return;
    }
  }
  console.error('Could not find cd-alias GUI executable path. Please launch the app manually.');
}

function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function handleAlias(aliasInput) {
  const normalizedInput = aliasInput.trim().toLowerCase();
  const match = activeList.find(item => item.alias.toLowerCase() === normalizedInput);

  if (match) {
    const targetPath = match.path;
    // Generate the temp cd commands
    if (isWindows) {
      const tempDir = process.env.TEMP || os.tmpdir();
      // CMD goto script
      const cmdScript = `@echo off\ncd /d "${targetPath}"\n`;
      fs.writeFileSync(path.join(tempDir, 'cda_goto.bat'), cmdScript, 'utf8');

      // PowerShell goto script
      const psScript = `Set-Location "${targetPath}"\n`;
      fs.writeFileSync(path.join(tempDir, 'cda_goto.ps1'), psScript, 'utf8');
    } else {
      // WSL
      const tempDir = '/tmp';
      const shScript = `cd "${targetPath}"\n`;
      fs.writeFileSync(path.join(tempDir, 'cda_goto.sh'), shScript, 'utf8');
    }
  } else {
    console.log(`Alias '${aliasInput}' not found.\n`);
    showAllAliases();

    // Calculate distance for all aliases and pick top 1 or 2 closest
    const scored = activeList
      .map(item => ({
        alias: item.alias,
        dist: levenshtein(normalizedInput, item.alias)
      }))
      .filter(item => item.dist <= 3)
      .sort((a, b) => a.dist - b.dist);

    if (scored.length > 0) {
      const topMatches = scored.slice(0, 2).map(x => x.alias);
      console.log(`\nDid you mean: ${topMatches.join(', ')}?`);
    }
  }
}

// Main execution
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  showHelp();
} else if (args[0] === '--list') {
  showAllAliases();
} else if (args[0] === '--open' || args[0] === '--config') {
  openGUI();
} else {
  handleAlias(args[0]);
}
