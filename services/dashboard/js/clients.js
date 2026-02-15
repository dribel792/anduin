/**
 * Clients Dashboard Page
 */

const API_BASE = window.location.origin.replace(':8080', ':3000');

let clients = [];
let filteredClients = [];

// Load clients on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadClients();
  setupFilters();
});

// Refresh button
document.getElementById('refresh-btn').addEventListener('click', loadClients);

async function loadClients() {
  try {
    const response = await fetch(`${API_BASE}/api/clients`);
    clients = await response.json();
    filteredClients = clients;
    
    updateStats();
    renderTable();
  } catch (error) {
    console.error('Failed to load clients:', error);
    showError('Failed to load clients');
  }
}

function updateStats() {
  document.getElementById('total-clients').textContent = clients.length;
  
  // Calculate active clients (had settlements in last 24h)
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const activeCount = clients.filter(c => 
    c.lastSettlement && new Date(c.lastSettlement).getTime() > oneDayAgo
  ).length;
  document.getElementById('active-clients').textContent = activeCount;
  
  // TODO: Calculate total collateral from blockchain
  document.getElementById('total-collateral').textContent = '$0';
  
  // TODO: Calculate total settlements
  document.getElementById('total-settlements').textContent = '0';
}

function renderTable() {
  const tbody = document.getElementById('clients-table');
  
  if (filteredClients.length === 0) {
    tbody.innerHTML = '<tr class="empty-state"><td colspan="8">No clients found</td></tr>';
    return;
  }
  
  tbody.innerHTML = filteredClients.map(client => `
    <tr>
      <td>
        <code class="address-short">${client.address.slice(0, 10)}...${client.address.slice(-8)}</code>
      </td>
      <td>${client.name || '-'}</td>
      <td>${formatVaultType(client.vaultAddress)}</td>
      <td><strong>$${parseFloat(client.balance || 0).toFixed(2)}</strong></td>
      <td>${client.settlementsToday || 0}</td>
      <td class="${(client.pnl24h || 0) >= 0 ? 'positive' : 'negative'}">
        ${(client.pnl24h || 0) >= 0 ? '+' : ''}$${parseFloat(client.pnl24h || 0).toFixed(2)}
      </td>
      <td>${new Date(client.createdAt).toLocaleDateString()}</td>
      <td>
        <button class="btn-icon" onclick="viewClientDetails('${client.id}')" title="View details">
          <i data-lucide="eye"></i>
        </button>
      </td>
    </tr>
  `).join('');
  
  lucide.createIcons();
}

function formatVaultType(vaultAddress) {
  // This is a placeholder - you'd map vault addresses to types
  if (vaultAddress.toLowerCase().includes('unified')) return 'Unified';
  if (vaultAddress.toLowerCase().includes('batch')) return 'Batch';
  if (vaultAddress.toLowerCase().includes('private')) return 'Private';
  return 'Unknown';
}

function setupFilters() {
  const searchInput = document.getElementById('search-input');
  const vaultFilter = document.getElementById('vault-filter');
  
  searchInput.addEventListener('input', applyFilters);
  vaultFilter.addEventListener('change', applyFilters);
}

function applyFilters() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const vaultType = document.getElementById('vault-filter').value;
  
  filteredClients = clients.filter(client => {
    const matchesSearch = !searchTerm || 
      client.address.toLowerCase().includes(searchTerm) ||
      (client.name && client.name.toLowerCase().includes(searchTerm));
    
    const matchesVault = !vaultType || 
      formatVaultType(client.vaultAddress).toLowerCase() === vaultType;
    
    return matchesSearch && matchesVault;
  });
  
  renderTable();
}

function viewClientDetails(clientId) {
  // TODO: Implement client detail modal or redirect to detail page
  alert(`View details for client: ${clientId}`);
}

function showError(message) {
  const tbody = document.getElementById('clients-table');
  tbody.innerHTML = `<tr class="empty-state"><td colspan="8" style="color: var(--danger);">${message}</td></tr>`;
}
