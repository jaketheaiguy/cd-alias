// App State
let activeTab = 'windows';
let appConfig = { windows: [], wsl: [] };
let pathStatus = { windows: false, wsl: false, wslSupported: false };
let hasUnsavedChanges = false;

// DOM Elements
const tabWindows = document.getElementById('tab-windows');
const tabWsl = document.getElementById('tab-wsl');
const pathStatusBadge = document.getElementById('path-status-badge');
const btnPathAction = document.getElementById('btn-path-action');
const tableBody = document.getElementById('table-body');
const btnAddRow = document.getElementById('btn-add-row');
const btnSave = document.getElementById('btn-save');

// Modals
const modalContainer = document.getElementById('modal-container');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const btnModalClose = document.getElementById('btn-modal-close');
const btnModalOk = document.getElementById('btn-modal-ok');

const welcomeModal = document.getElementById('welcome-modal');
const setupWinPath = document.getElementById('setup-win-path');
const setupWslPath = document.getElementById('setup-wsl-path');
const setupWslContainer = document.getElementById('setup-wsl-container');
const btnWelcomeSkip = document.getElementById('btn-welcome-skip');
const btnWelcomeSetup = document.getElementById('btn-welcome-setup');

// Update Save Changes Button state
function updateSaveButtonState() {
  if (hasUnsavedChanges) {
    btnSave.className = 'btn btn-primary';
  } else {
    btnSave.className = 'btn btn-white';
  }
  if (window.electronAPI && window.electronAPI.setUnsavedChanges) {
    window.electronAPI.setUnsavedChanges(hasUnsavedChanges);
  }
}

function markDirty() {
  if (!hasUnsavedChanges) {
    hasUnsavedChanges = true;
    updateSaveButtonState();
  }
}

// Initialize App
window.addEventListener('DOMContentLoaded', async () => {
  // Load configuration
  appConfig = await window.electronAPI.getConfig();
  
  // Load PATH status
  await updatePathStatus();

  // Render initial table
  renderTable();
  updateSaveButtonState();

  // Show first-run welcome dialog if not configured on Windows
  if (!pathStatus.windows) {
    if (!pathStatus.wslSupported) {
      setupWslContainer.style.display = 'none';
      setupWslPath.checked = false;
    }
    welcomeModal.classList.add('active');
  }

  // Setup Event Listeners
  setupEventListeners();
});

// Update PATH Status UI
async function updatePathStatus() {
  pathStatus = await window.electronAPI.checkPathStatus();
  
  const isInstalled = activeTab === 'windows' ? pathStatus.windows : pathStatus.wsl;
  
  if (isInstalled) {
    pathStatusBadge.textContent = 'Installed';
    pathStatusBadge.className = 'status-badge status-installed';
    btnPathAction.textContent = 'Remove from PATH';
    btnPathAction.className = 'btn btn-secondary';
  } else {
    pathStatusBadge.textContent = 'Not Installed';
    pathStatusBadge.className = 'status-badge status-missing';
    btnPathAction.textContent = 'Add to PATH';
    btnPathAction.className = 'btn btn-primary';
  }
}

// Render Alias Table
function renderTable() {
  tableBody.innerHTML = '';
  const list = appConfig[activeTab] || [];

  if (list.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `
      <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 30px;">
        No aliases defined. Click "Add Row" to create one.
      </td>
    `;
    tableBody.appendChild(emptyRow);
    return;
  }

  list.forEach((item, index) => {
    const row = document.createElement('tr');
    
    // Alias Column
    const tdAlias = document.createElement('td');
    const inputAlias = document.createElement('input');
    inputAlias.type = 'text';
    inputAlias.className = 'input-text';
    inputAlias.placeholder = 'e.g. work';
    inputAlias.value = item.alias;
    inputAlias.addEventListener('input', (e) => {
      appConfig[activeTab][index].alias = e.target.value.trim();
      markDirty();
    });
    tdAlias.appendChild(inputAlias);

    // Directory Column
    const tdDir = document.createElement('td');
    const wrapper = document.createElement('div');
    wrapper.className = 'dir-picker-wrapper';
    
    const inputDir = document.createElement('input');
    inputDir.type = 'text';
    inputDir.className = 'input-text';
    inputDir.placeholder = activeTab === 'windows' ? 'C:\\path\\to\\folder' : '/home/user/folder';
    inputDir.value = item.path;
    inputDir.addEventListener('input', (e) => {
      appConfig[activeTab][index].path = e.target.value.trim();
      markDirty();
    });

    const btnBrowse = document.createElement('button');
    btnBrowse.className = 'btn btn-secondary';
    btnBrowse.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    `;
    btnBrowse.addEventListener('click', async () => {
      const selected = await window.electronAPI.selectDirectory(activeTab, inputDir.value);
      if (selected) {
        inputDir.value = selected;
        appConfig[activeTab][index].path = selected;
        markDirty();
      }
    });

    wrapper.appendChild(inputDir);
    wrapper.appendChild(btnBrowse);
    tdDir.appendChild(wrapper);

    // Actions Column
    const tdActions = document.createElement('td');
    tdActions.style.textAlign = 'center';
    
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-icon delete';
    btnDelete.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    btnDelete.addEventListener('click', () => {
      appConfig[activeTab].splice(index, 1);
      markDirty();
      renderTable();
    });
    
    tdActions.appendChild(btnDelete);

    row.appendChild(tdAlias);
    row.appendChild(tdDir);
    row.appendChild(tdActions);
    tableBody.appendChild(row);
  });
}

// Show Custom Alert Dialog
function showModal(title, message) {
  modalTitle.textContent = title;
  modalMessage.innerHTML = message;
  modalContainer.classList.add('active');
}

// Setup all Event Listeners
function setupEventListeners() {
  // Tab Windows click
  tabWindows.addEventListener('click', () => {
    if (activeTab === 'windows') return;
    activeTab = 'windows';
    tabWindows.classList.add('active');
    tabWsl.classList.remove('active');
    updatePathStatus();
    renderTable();
  });

  // Tab WSL click
  tabWsl.addEventListener('click', () => {
    if (activeTab === 'wsl') return;
    activeTab = 'wsl';
    tabWsl.classList.add('active');
    tabWindows.classList.remove('active');
    updatePathStatus();
    renderTable();
  });

  // Add to / Remove from PATH button click
  btnPathAction.addEventListener('click', async () => {
    const isInstalled = activeTab === 'windows' ? pathStatus.windows : pathStatus.wsl;
    
    btnPathAction.disabled = true;
    btnPathAction.textContent = 'Processing...';

    if (isInstalled) {
      // Remove PATH configuration
      const result = await window.electronAPI.removeFromPath(activeTab);
      if (result.success) {
        showModal(
          'PATH Cleaned',
          `The <code>cda</code> integration has been successfully removed from ${activeTab === 'windows' ? 'Windows PATH and PowerShell profile' : 'WSL .bashrc'}.`
        );
      } else {
        showModal('Error', `Failed to remove from PATH: ${result.error}`);
      }
    } else {
      // Add PATH configuration
      const result = await window.electronAPI.addToPath(activeTab);
      if (result.success) {
        showModal(
          'PATH Configured',
          `The <code>cda</code> integration has been successfully set up for ${activeTab === 'windows' ? 'Windows (CMD & PowerShell)' : 'WSL (~/.bashrc)'}.<br><br><strong>Please restart any open terminal windows for changes to take effect.</strong>`
        );
      } else {
        showModal('Error', `Failed to configure PATH: ${result.error}`);
      }
    }

    await updatePathStatus();
    btnPathAction.disabled = false;
  });

  // Add Row button click
  btnAddRow.addEventListener('click', () => {
    appConfig[activeTab].push({ alias: '', path: '' });
    markDirty();
    renderTable();
    // Scroll to bottom
    const container = document.querySelector('.table-container');
    container.scrollTop = container.scrollHeight;
  });

  // Save changes button click
  btnSave.addEventListener('click', async () => {
    btnSave.disabled = true;
    btnSave.textContent = 'Saving...';

    // Validate config list
    let valid = true;
    const currentList = appConfig[activeTab];
    for (let i = 0; i < currentList.length; i++) {
      const item = currentList[i];
      if (!item.alias || !item.path) {
        showModal('Validation Error', 'All rows must have a valid Alias and Directory path.');
        valid = false;
        break;
      }
      // Check for duplicate aliases in the current active tab
      const duplicates = currentList.filter(x => x.alias.toLowerCase() === item.alias.toLowerCase());
      if (duplicates.length > 1) {
        showModal('Validation Error', `Duplicate alias detected: <strong>${item.alias}</strong>`);
        valid = false;
        break;
      }
    }

    if (valid) {
      const result = await window.electronAPI.saveConfig(appConfig);
      if (result.success) {
        hasUnsavedChanges = false;
        updateSaveButtonState();
        showModal('Success', 'Your changes have been saved successfully.');
      } else {
        showModal('Error', `Failed to save changes: ${result.error}`);
      }
    }

    btnSave.disabled = false;
    btnSave.textContent = 'Save Changes';
  });

  // Welcome modal buttons
  btnWelcomeSkip.addEventListener('click', () => {
    welcomeModal.classList.remove('active');
  });

  btnWelcomeSetup.addEventListener('click', async () => {
    const doWin = setupWinPath.checked;
    const doWsl = setupWslPath.checked && pathStatus.wslSupported;

    welcomeModal.classList.remove('active');
    
    let report = [];
    if (doWin) {
      const res = await window.electronAPI.addToPath('windows');
      if (res.success) {
        report.push('Windows (CMD & PowerShell)');
      } else {
        report.push(`Windows failed: ${res.error}`);
      }
    }
    if (doWsl) {
      const res = await window.electronAPI.addToPath('wsl');
      if (res.success) {
        report.push('WSL (~/.bashrc)');
      } else {
        report.push(`WSL failed: ${res.error}`);
      }
    }

    if (report.length > 0) {
      showModal(
        'Setup Completed',
        `Successfully configured integration for:<br><ul><li>${report.join('</li><li>')}</li></ul><br><strong>Please restart any open terminal windows for the command to become active.</strong>`
      );
    }
    
    await updatePathStatus();
  });

  // Close Custom Modals
  btnModalClose.addEventListener('click', () => {
    modalContainer.classList.remove('active');
  });
  btnModalOk.addEventListener('click', () => {
    modalContainer.classList.remove('active');
  });
}
