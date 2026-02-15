/**
 * Anduin Admin Panel - Client-side Logic
 */

const API_BASE = window.location.origin.replace(':8080', ':3000');

// Page Navigation
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const page = item.dataset.page;
    
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');
    
    // Update active page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`${page}-page`).classList.add('active');
    
    // Update title
    const titles = {
      clients: 'Client Management',
      insurance: 'Insurance Fund Management',
      controls: 'System Controls',
      audit: 'Audit Log'
    };
    document.getElementById('page-title').textContent = titles[page];
    
    // Load page data
    loadPageData(page);
  });
});

// Refresh button
document.getElementById('refresh-btn').addEventListener('click', () => {
  const activePage = document.querySelector('.nav-item.active').dataset.page;
  loadPageData(activePage);
});

// Load page data
async function loadPageData(page) {
  switch (page) {
    case 'clients':
      await loadClients();
      await loadClientStats();
      break;
    case 'insurance':
      await loadInsuranceData();
      break;
    case 'controls':
      await loadSystemStatus();
      break;
    case 'audit':
      await loadAuditLog();
      break;
  }
}

// Client Management
document.getElementById('onboard-client-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const address = document.getElementById('client-address').value;
  const name = document.getElementById('client-name').value;
  const vault = document.getElementById('vault-select').value;
  
  try {
    const response = await fetch(`${API_BASE}/api/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, name, vault })
    });
    
    if (!response.ok) throw new Error('Failed to onboard client');
    
    alert('Client onboarded successfully!');
    e.target.reset();
    await loadClients();
    await loadClientStats();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
});

async function loadClients() {
  try {
    const response = await fetch(`${API_BASE}/api/clients`);
    const clients = await response.json();
    
    const tbody = document.getElementById('clients-table-body');
    
    if (clients.length === 0) {
      tbody.innerHTML = '<tr class="empty-state"><td colspan="6">No clients registered yet</td></tr>';
      return;
    }
    
    tbody.innerHTML = clients.map(client => `
      <tr>
        <td><code>${client.address.slice(0, 10)}...${client.address.slice(-8)}</code></td>
        <td>${client.name || '-'}</td>
        <td>${client.vaultAddress.slice(0, 10)}...</td>
        <td>$${client.balance || '0.00'}</td>
        <td>${new Date(client.createdAt).toLocaleDateString()}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem;" onclick="viewClient('${client.id}')">
            View
          </button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Failed to load clients:', error);
  }
}

async function loadClientStats() {
  try {
    const response = await fetch(`${API_BASE}/api/clients`);
    const clients = await response.json();
    
    document.getElementById('total-clients').textContent = clients.length;
    
    // TODO: Fetch actual collateral from blockchain
    document.getElementById('total-collateral').textContent = '$0';
    
    // TODO: Fetch active settlements
    document.getElementById('active-settlements').textContent = '0';
  } catch (error) {
    console.error('Failed to load client stats:', error);
  }
}

function viewClient(clientId) {
  // TODO: Implement client detail view
  alert(`View client: ${clientId}`);
}

// Insurance Fund Management
document.getElementById('deposit-insurance-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const amount = document.getElementById('deposit-amount').value;
  
  try {
    const response = await fetch(`${API_BASE}/api/insurance/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    
    if (!response.ok) throw new Error('Failed to deposit to insurance fund');
    
    alert('Deposit successful!');
    e.target.reset();
    await loadInsuranceData();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
});

document.getElementById('withdraw-insurance-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const amount = document.getElementById('withdraw-amount').value;
  
  if (!confirm(`Withdraw $${amount} from insurance fund?`)) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/insurance/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    
    if (!response.ok) throw new Error('Failed to withdraw from insurance fund');
    
    alert('Withdrawal successful!');
    e.target.reset();
    await loadInsuranceData();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
});

async function loadInsuranceData() {
  try {
    // Load balances
    const balanceResponse = await fetch(`${API_BASE}/api/insurance/balance`);
    const balances = await balanceResponse.json();
    
    document.getElementById('insurance-balance').textContent = `$${parseFloat(balances.insuranceFund || 0).toFixed(2)}`;
    document.getElementById('broker-balance').textContent = `$${parseFloat(balances.brokerPool || 0).toFixed(2)}`;
    document.getElementById('socialized-loss').textContent = `$${parseFloat(balances.socializedLoss || 0).toFixed(2)}`;
    
    // Load events
    const eventsResponse = await fetch(`${API_BASE}/api/insurance/events`);
    const events = await eventsResponse.json();
    
    const tbody = document.getElementById('insurance-events-table');
    
    if (events.length === 0) {
      tbody.innerHTML = '<tr class="empty-state"><td colspan="4">No insurance events yet</td></tr>';
      return;
    }
    
    tbody.innerHTML = events.map(event => `
      <tr>
        <td>${event.event_type}</td>
        <td>$${parseFloat(event.amount).toFixed(2)}</td>
        <td><code>${event.transaction_hash ? event.transaction_hash.slice(0, 10) + '...' : '-'}</code></td>
        <td>${new Date(event.created_at).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Failed to load insurance data:', error);
  }
}

// System Controls
document.getElementById('pause-btn').addEventListener('click', async () => {
  if (!confirm('⚠️ This will pause ALL vaults. Are you sure?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/system/pause`, {
      method: 'POST'
    });
    
    if (!response.ok) throw new Error('Failed to pause system');
    
    alert('System paused successfully');
    await loadSystemStatus();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
});

document.getElementById('unpause-btn').addEventListener('click', async () => {
  try {
    const response = await fetch(`${API_BASE}/api/system/unpause`, {
      method: 'POST'
    });
    
    if (!response.ok) throw new Error('Failed to unpause system');
    
    alert('System resumed successfully');
    await loadSystemStatus();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
});

async function loadSystemStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/system/status`);
    const status = await response.json();
    
    // Update vault statuses
    document.getElementById('vault-unified-status').textContent = status.unifiedVault || 'Unknown';
    document.getElementById('vault-batch-status').textContent = status.batchVault || 'Unknown';
    document.getElementById('vault-private-status').textContent = status.privateVault || 'Unknown';
    document.getElementById('keeper-status').textContent = status.keeper || 'Unknown';
  } catch (error) {
    console.error('Failed to load system status:', error);
  }
}

// Audit Log
async function loadAuditLog() {
  try {
    const response = await fetch(`${API_BASE}/api/audit`);
    const logs = await response.json();
    
    const tbody = document.getElementById('audit-log-table');
    
    if (logs.length === 0) {
      tbody.innerHTML = '<tr class="empty-state"><td colspan="5">No audit events yet</td></tr>';
      return;
    }
    
    tbody.innerHTML = logs.map(log => `
      <tr>
        <td>${new Date(log.created_at).toLocaleString()}</td>
        <td>${log.action}</td>
        <td>${log.actor || '-'}</td>
        <td>${log.entity_type ? `${log.entity_type}:${log.entity_id}` : '-'}</td>
        <td><code>${log.details ? JSON.stringify(JSON.parse(log.details)).slice(0, 50) + '...' : '-'}</code></td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Failed to load audit log:', error);
  }
}

// Initial load
loadPageData('clients');
