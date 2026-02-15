/**
 * Anduin Dashboard JavaScript
 * 
 * Loads data from API and renders the dashboard
 */

// Configuration
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000/api/v1'
  : `${window.location.origin}/api/v1`;

const API_KEY = localStorage.getItem('anduin_api_key') || 'test-key-1';

// API Helper
async function apiCall(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    return null;
  }
}

// Format currency
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

// Format time ago
function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Load overview stats
async function loadOverview() {
  const settlements = await apiCall('/settlements');
  const insurance = await apiCall('/insurance');
  const clients = await apiCall('/clients');
  
  if (settlements) {
    // Calculate total volume
    const totalVolume = settlements.settlements.reduce((sum, s) => {
      return sum + parseFloat(s.amount);
    }, 0);
    
    document.getElementById('totalVolume').textContent = formatCurrency(totalVolume);
    
    // Pending settlements
    const pending = settlements.settlements.filter(s => s.status === 'pending');
    document.getElementById('pendingCount').textContent = pending.length;
  }
  
  if (insurance) {
    document.getElementById('insuranceFund').textContent = formatCurrency(insurance.balance);
  }
  
  if (clients) {
    document.getElementById('activeClients').textContent = clients.count || 0;
  }
}

// Load settlements
async function loadSettlements() {
  const data = await apiCall('/settlements?limit=10');
  
  if (!data || !data.settlements) return;
  
  const feed = document.getElementById('settlementFeed');
  feed.innerHTML = '';
  
  data.settlements.forEach(settlement => {
    const item = document.createElement('div');
    item.className = 'feed-item';
    
    const iconClass = settlement.type === 'credit' ? 'arrow-up-circle' : 'arrow-down-circle';
    const statusClass = settlement.status === 'confirmed' ? 'confirmed' : 
                       settlement.status === 'pending' ? 'pending' : 'failed';
    
    item.innerHTML = `
      <div class="feed-icon">
        <i data-lucide="${iconClass}"></i>
      </div>
      <div class="feed-content">
        <p class="feed-title">Settlement ${settlement.id}</p>
        <p class="feed-meta">
          Client: ${settlement.clientId} • 
          ${settlement.type === 'credit' ? 'Credit' : 'Debit'}: ${formatCurrency(settlement.amount)} • 
          ${timeAgo(settlement.createdAt)}
        </p>
      </div>
      <span class="status-badge ${statusClass}">
        ${settlement.status.charAt(0).toUpperCase() + settlement.status.slice(1)}
      </span>
    `;
    
    feed.appendChild(item);
  });
  
  lucide.createIcons();
}

// Load vault balances
async function loadVaultBalances() {
  const vaults = await apiCall('/vaults');
  
  if (!vaults || !vaults.vaults) return;
  
  const balancesGrid = document.getElementById('vaultBalances');
  balancesGrid.innerHTML = '';
  
  for (const vault of vaults.vaults) {
    // For demo, show placeholder balances
    // In production, query actual balances per vault
    const balanceCard = document.createElement('div');
    balanceCard.className = 'balance-card';
    balanceCard.innerHTML = `
      <h4>${vault.name}</h4>
      <p>$${(Math.random() * 1000000).toFixed(2)}</p>
    `;
    balancesGrid.appendChild(balanceCard);
  }
}

// Initialize charts
let volumeChart = null;
let nettingChart = null;

function initCharts() {
  // Volume chart
  const volumeCtx = document.getElementById('volumeChart').getContext('2d');
  volumeChart = new Chart(volumeCtx, {
    type: 'line',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [{
        label: 'Settlement Volume',
        data: [12000, 19000, 15000, 25000, 22000, 30000, 28000],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '$' + value.toLocaleString();
            },
          },
        },
      },
    },
  });
  
  // Netting efficiency chart
  const nettingCtx = document.getElementById('nettingChart').getContext('2d');
  nettingChart = new Chart(nettingCtx, {
    type: 'doughnut',
    data: {
      labels: ['Netted', 'Gross'],
      datasets: [{
        data: [65, 35],
        backgroundColor: ['#10b981', '#e5e7eb'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
    },
  });
}

// Update system health
async function updateHealth() {
  // This would call a health endpoint or keeper status
  // For now, use placeholder data
  document.getElementById('lastSettlement').textContent = timeAgo(new Date(Date.now() - 120000));
  document.getElementById('blockHeight').textContent = Math.floor(Math.random() * 1000000).toLocaleString();
}

// Auto-refresh
function startAutoRefresh() {
  // Refresh data every 10 seconds
  setInterval(() => {
    loadOverview();
    loadSettlements();
    updateHealth();
  }, 10000);
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Anduin Dashboard initialized');
  
  // Load all data
  await loadOverview();
  await loadSettlements();
  await loadVaultBalances();
  updateHealth();
  
  // Initialize charts
  initCharts();
  
  // Start auto-refresh
  startAutoRefresh();
  
  // Initialize Lucide icons
  lucide.createIcons();
});
