/**
 * Settlements Dashboard Page
 */

const API_BASE = window.location.origin.replace(':8080', ':3000');

let settlements = [];
let filteredSettlements = [];
let currentPage = 1;
const itemsPerPage = 20;

// Load settlements on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettlements();
  setupFilters();
});

// Refresh button
document.getElementById('refresh-btn').addEventListener('click', loadSettlements);

async function loadSettlements() {
  try {
    const response = await fetch(`${API_BASE}/api/settlements`);
    settlements = await response.json();
    filteredSettlements = settlements;
    
    updateStats();
    renderTable();
    renderPagination();
  } catch (error) {
    console.error('Failed to load settlements:', error);
    showError('Failed to load settlements');
  }
}

function updateStats() {
  document.getElementById('total-settlements').textContent = settlements.length;
  
  const confirmed = settlements.filter(s => s.status === 'confirmed').length;
  const pending = settlements.filter(s => s.status === 'pending').length;
  const failed = settlements.filter(s => s.status === 'failed').length;
  
  document.getElementById('confirmed-settlements').textContent = confirmed;
  document.getElementById('pending-settlements').textContent = pending;
  document.getElementById('failed-settlements').textContent = failed;
}

function renderTable() {
  const tbody = document.getElementById('settlements-table');
  
  if (filteredSettlements.length === 0) {
    tbody.innerHTML = '<tr class="empty-state"><td colspan="9">No settlements found</td></tr>';
    return;
  }
  
  // Paginate
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pageSettlements = filteredSettlements.slice(startIndex, endIndex);
  
  tbody.innerHTML = pageSettlements.map(settlement => `
    <tr>
      <td><code>${settlement.id}</code></td>
      <td>
        <code class="address-short">${settlement.client_id.slice(0, 10)}...</code>
      </td>
      <td>
        <span class="badge ${settlement.type === 'credit' ? 'badge-success' : 'badge-danger'}">
          ${settlement.type === 'credit' ? '➕ Credit' : '➖ Debit'}
        </span>
      </td>
      <td><strong>$${parseFloat(settlement.amount).toFixed(2)}</strong></td>
      <td>
        <span class="badge ${getStatusBadgeClass(settlement.status)}">
          ${settlement.status}
        </span>
      </td>
      <td>
        ${settlement.transaction_hash 
          ? `<a href="https://basescan.org/tx/${settlement.transaction_hash}" target="_blank" class="tx-link">
               ${settlement.transaction_hash.slice(0, 10)}...
             </a>`
          : '-'}
      </td>
      <td>${settlement.metadata?.venue || '-'}</td>
      <td>${new Date(settlement.created_at).toLocaleString()}</td>
      <td>
        <button class="btn-icon" onclick="viewSettlement('${settlement.id}')" title="View details">
          <i data-lucide="eye"></i>
        </button>
      </td>
    </tr>
  `).join('');
  
  lucide.createIcons();
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'confirmed': return 'badge-success';
    case 'pending': return 'badge-warning';
    case 'failed': return 'badge-danger';
    default: return '';
  }
}

function renderPagination() {
  const totalPages = Math.ceil(filteredSettlements.length / itemsPerPage);
  
  if (totalPages <= 1) {
    document.getElementById('pagination').innerHTML = '';
    return;
  }
  
  let html = '<div class="pagination-controls">';
  
  // Previous button
  html += `
    <button class="btn-page" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">
      <i data-lucide="chevron-left"></i>
    </button>
  `;
  
  // Page numbers
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      html += `
        <button class="btn-page ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">
          ${i}
        </button>
      `;
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      html += '<span class="pagination-ellipsis">...</span>';
    }
  }
  
  // Next button
  html += `
    <button class="btn-page" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">
      <i data-lucide="chevron-right"></i>
    </button>
  `;
  
  html += '</div>';
  
  document.getElementById('pagination').innerHTML = html;
  lucide.createIcons();
}

function goToPage(page) {
  const totalPages = Math.ceil(filteredSettlements.length / itemsPerPage);
  if (page < 1 || page > totalPages) return;
  
  currentPage = page;
  renderTable();
  renderPagination();
}

function setupFilters() {
  const searchInput = document.getElementById('search-input');
  const statusFilter = document.getElementById('status-filter');
  const typeFilter = document.getElementById('type-filter');
  
  searchInput.addEventListener('input', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  typeFilter.addEventListener('change', applyFilters);
}

function applyFilters() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const status = document.getElementById('status-filter').value;
  const type = document.getElementById('type-filter').value;
  
  filteredSettlements = settlements.filter(settlement => {
    const matchesSearch = !searchTerm || 
      settlement.id.toLowerCase().includes(searchTerm) ||
      settlement.client_id.toLowerCase().includes(searchTerm);
    
    const matchesStatus = !status || settlement.status === status;
    const matchesType = !type || settlement.type === type;
    
    return matchesSearch && matchesStatus && matchesType;
  });
  
  currentPage = 1; // Reset to first page
  renderTable();
  renderPagination();
}

async function viewSettlement(settlementId) {
  try {
    const response = await fetch(`${API_BASE}/api/settlements/${settlementId}`);
    const settlement = await response.json();
    
    const modal = document.getElementById('settlement-modal');
    const detailsDiv = document.getElementById('settlement-details');
    
    detailsDiv.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item">
          <label>Settlement ID</label>
          <code>${settlement.id}</code>
        </div>
        <div class="detail-item">
          <label>Client Address</label>
          <code>${settlement.client_id}</code>
        </div>
        <div class="detail-item">
          <label>Vault Address</label>
          <code>${settlement.vault_address}</code>
        </div>
        <div class="detail-item">
          <label>Type</label>
          <span class="badge ${settlement.type === 'credit' ? 'badge-success' : 'badge-danger'}">
            ${settlement.type}
          </span>
        </div>
        <div class="detail-item">
          <label>Amount</label>
          <strong>$${parseFloat(settlement.amount).toFixed(2)} USDC</strong>
        </div>
        <div class="detail-item">
          <label>Status</label>
          <span class="badge ${getStatusBadgeClass(settlement.status)}">
            ${settlement.status}
          </span>
        </div>
        <div class="detail-item">
          <label>Reference ID</label>
          <code>${settlement.ref_id}</code>
        </div>
        <div class="detail-item">
          <label>Transaction Hash</label>
          ${settlement.transaction_hash 
            ? `<a href="https://basescan.org/tx/${settlement.transaction_hash}" target="_blank" class="tx-link">
                 ${settlement.transaction_hash}
               </a>`
            : '-'}
        </div>
        <div class="detail-item">
          <label>Created At</label>
          ${new Date(settlement.created_at).toLocaleString()}
        </div>
        <div class="detail-item">
          <label>Confirmed At</label>
          ${settlement.confirmed_at ? new Date(settlement.confirmed_at).toLocaleString() : '-'}
        </div>
        ${settlement.metadata ? `
          <div class="detail-item full-width">
            <label>Metadata</label>
            <pre>${JSON.stringify(JSON.parse(settlement.metadata), null, 2)}</pre>
          </div>
        ` : ''}
      </div>
    `;
    
    modal.style.display = 'flex';
    lucide.createIcons();
  } catch (error) {
    console.error('Failed to load settlement details:', error);
    alert('Failed to load settlement details');
  }
}

function showError(message) {
  const tbody = document.getElementById('settlements-table');
  tbody.innerHTML = `<tr class="empty-state"><td colspan="9" style="color: var(--danger);">${message}</td></tr>`;
}
