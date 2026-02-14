// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ITradingHoursGuard.sol";
import "./IOracleGuard.sol";

/// @title UnifiedAccountVault
/// @notice Core vault managing per-user collateral/PnL sub-ledgers and a broker pool.
///         Collateral is seizable on losses; PnL (winnings) is never seizable.
contract UnifiedAccountVault is Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────── State ────────────────────────────

    IERC20 public immutable usdc;

    address public admin;
    address public settlement;
    address public broker;

    // TODO: Multi-Collateral Haircuts (VS-H003)
    // Future enhancement: support multiple collateral types with different haircuts
    // - Add mapping(address => CollateralConfig) for different tokens (ETH, BTC, etc.)
    // - Each config: haircut percentage, oracle for price conversion
    // - Aggregate collateral value = sum(balance[token] * price[token] * (1 - haircut[token]))
    // - See docs/architecture/multi-collateral.md for full design

    /// @notice Optional guard contracts
    address public tradingHoursGuard;  // 0x0 = disabled
    address public oracleGuard;        // 0x0 = disabled

    /// @notice Per-user collateral balance (only goes up via deposit, down via withdraw/seize)
    mapping(address => uint256) public collateral;

    /// @notice Per-user PnL balance (only goes up via credit, down via user withdraw)
    mapping(address => uint256) public pnl;

    /// @notice Broker's deposited liquidity pool
    uint256 public brokerPool;

    /// @notice Tracks used refIds to enforce idempotent settlement
    mapping(bytes32 => bool) public usedRefIds;

    // ──────────────────────────── Caps ─────────────────────────────

    uint256 public perUserDailyCap;   // 0 = unlimited
    uint256 public globalDailyCap;    // 0 = unlimited

    /// @notice Per-user daily withdrawn amount, resets each day
    mapping(address => uint256) public userDailyWithdrawn;
    mapping(address => uint256) public userLastWithdrawDay;

    uint256 public globalDailyWithdrawn;
    uint256 public globalLastWithdrawDay;

    // ──────────────────────────── Withdrawal Cooldown (VS-H002) ────

    /// @notice Withdrawal cooldown period (default: 0 = disabled, admin-configurable)
    uint256 public withdrawalCooldownPeriod = 0;

    /// @notice Track last deposit timestamp per user
    mapping(address => uint256) public lastDepositTimestamp;

    // ──────────────────────────── Insurance Fund (VS-H001) ─────────

    /// @notice Insurance fund to cover underwater accounts
    uint256 public insuranceFund;

    /// @notice Accumulated socialized losses when insurance fund is insufficient
    uint256 public totalSocializedLosses;

    // ──────────────────────────── Circuit Breaker (VS-H006) ────────

    /// @notice Circuit breaker threshold (0 = disabled)
    uint256 public circuitBreakerThreshold;
    
    /// @notice Circuit breaker time window (e.g., 1 hour = 3600)
    uint256 public circuitBreakerWindow = 3600;
    
    /// @notice Settlement volume tracking for circuit breaker
    struct VolumeRecord {
        uint256 timestamp;
        uint256 amount;
    }
    
    /// @notice Rolling window of settlement volumes
    VolumeRecord[] public settlementVolumes;

    // ──────────────────────────── Withdrawal Queue (VS-H007) ───────

    // TODO: Implement withdrawal queue for broker insolvency edge cases
    // When vault USDC is insufficient for PnL withdrawals, queue them for later processing
    // Requires careful accounting to maintain invariant: vault USDC = sum(collateral + pnl + brokerPool + queuedWithdrawals)

    // ──────────────────────────── Events ───────────────────────────

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event PnLCredited(address indexed user, uint256 amount, bytes32 indexed refId);
    event PnLWithdrawn(address indexed user, uint256 amount);
    event CollateralSeized(address indexed user, uint256 amount, bytes32 indexed refId);
    event BrokerDeposited(uint256 amount);
    event BrokerWithdrawn(uint256 amount);
    
    // Admin events (VS-H005)
    event PerUserDailyCapSet(uint256 cap);
    event GlobalDailyCapSet(uint256 cap);
    event SettlementSet(address indexed settlement);
    event BrokerSet(address indexed broker);
    event AdminSet(address indexed admin);
    event TradingHoursGuardSet(address indexed guard);
    event OracleGuardSet(address indexed guard);
    event WithdrawalCooldownEnforced(address indexed user, uint256 remainingTime);
    event WithdrawalCooldownPeriodSet(uint256 period);
    event Shortfall(address indexed user, uint256 amount, uint256 coveredByInsurance, uint256 socialized);
    event InsuranceFundDeposited(uint256 amount);
    event InsuranceFundWithdrawn(uint256 amount);
    event CircuitBreakerTriggered(uint256 volumeInWindow, uint256 threshold);
    event CircuitBreakerConfigured(uint256 threshold, uint256 window);

    // ──────────────────────────── Errors ───────────────────────────

    error Unauthorized();
    error InsufficientBalance();
    error InsufficientBrokerPool();
    error DuplicateRefId();
    error ExceedsUserDailyCap();
    error ExceedsGlobalDailyCap();
    error ZeroAmount();
    error WithdrawalCooldownActive(uint256 remainingTime);

    // ──────────────────────────── Modifiers ────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlySettlement() {
        if (msg.sender != settlement) revert Unauthorized();
        _;
    }

    modifier onlyBroker() {
        if (msg.sender != broker) revert Unauthorized();
        _;
    }

    // ──────────────────────────── Constructor ──────────────────────

    constructor(
        address _usdc,
        address _admin,
        address _settlement,
        address _broker
    ) {
        usdc = IERC20(_usdc);
        admin = _admin;
        settlement = _settlement;
        broker = _broker;
    }

    // ──────────────────────────── User Functions ───────────────────

    /// @notice Deposit USDC as collateral
    function depositCollateral(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        collateral[msg.sender] += amount;
        lastDepositTimestamp[msg.sender] = block.timestamp; // Track deposit time for cooldown
        emit CollateralDeposited(msg.sender, amount);
    }

    /// @notice Withdraw collateral (respects daily caps and cooldown)
    function withdrawCollateral(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (collateral[msg.sender] < amount) revert InsufficientBalance();
        _enforceWithdrawalCooldown(msg.sender);
        _enforceWithdrawCaps(msg.sender, amount);
        collateral[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    /// @notice Withdraw PnL winnings (respects daily caps and cooldown)
    /// PnL was already deducted from brokerPool during creditPnl, so we just send USDC
    function withdrawPnL(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (pnl[msg.sender] < amount) revert InsufficientBalance();
        _enforceWithdrawalCooldown(msg.sender);
        _enforceWithdrawCaps(msg.sender, amount);
        
        // Process withdrawal immediately
        // Note: brokerPool was already decreased during creditPnl
        pnl[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit PnLWithdrawn(msg.sender, amount);
    }

    // ──────────────────────────── Settlement Functions ─────────────

    /// @notice Credit PnL to a user (positive settlement). Idempotent via refId.
    function creditPnl(
        address user,
        uint256 amount,
        bytes32 refId
    ) external onlySettlement whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (usedRefIds[refId]) revert DuplicateRefId();
        if (brokerPool < amount) revert InsufficientBrokerPool();

        _trackAndCheckCircuitBreaker(amount); // Check circuit breaker

        usedRefIds[refId] = true;
        brokerPool -= amount;
        pnl[user] += amount;

        emit PnLCredited(user, amount, refId);
    }

    /// @notice Seize user collateral (negative settlement). Moves to broker pool. Idempotent via refId.
    function seizeCollateral(
        address user,
        uint256 amount,
        bytes32 refId
    ) external onlySettlement whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (usedRefIds[refId]) revert DuplicateRefId();
        if (collateral[user] < amount) revert InsufficientBalance();

        _trackAndCheckCircuitBreaker(amount); // Check circuit breaker

        usedRefIds[refId] = true;
        collateral[user] -= amount;
        brokerPool += amount;

        emit CollateralSeized(user, amount, refId);
    }

    /// @notice Credit PnL with guard checks (symbolId required if guards are set)
    function creditPnlWithGuards(
        address user,
        uint256 amount,
        bytes32 refId,
        bytes32 symbolId
    ) external onlySettlement whenNotPaused nonReentrant {
        _checkGuards(symbolId);
        
        if (amount == 0) revert ZeroAmount();
        if (usedRefIds[refId]) revert DuplicateRefId();
        if (brokerPool < amount) revert InsufficientBrokerPool();

        usedRefIds[refId] = true;
        brokerPool -= amount;
        pnl[user] += amount;

        emit PnLCredited(user, amount, refId);
    }

    /// @notice Seize collateral with guard checks (symbolId required if guards are set)
    function seizeCollateralWithGuards(
        address user,
        uint256 amount,
        bytes32 refId,
        bytes32 symbolId
    ) external onlySettlement whenNotPaused nonReentrant {
        _checkGuards(symbolId);
        
        if (amount == 0) revert ZeroAmount();
        if (usedRefIds[refId]) revert DuplicateRefId();
        if (collateral[user] < amount) revert InsufficientBalance();

        usedRefIds[refId] = true;
        collateral[user] -= amount;
        brokerPool += amount;

        emit CollateralSeized(user, amount, refId);
    }

    /// @notice Seize collateral up to available balance; insurance fund covers shortfall (VS-H001)
    /// @return seized The amount actually seized from user collateral
    /// @return shortfall The amount that couldn't be seized (covered by insurance or socialized)
    function seizeCollateralCapped(
        address user,
        uint256 amount,
        bytes32 refId
    ) external onlySettlement whenNotPaused nonReentrant returns (uint256 seized, uint256 shortfall) {
        if (amount == 0) revert ZeroAmount();
        if (usedRefIds[refId]) revert DuplicateRefId();

        usedRefIds[refId] = true;

        uint256 availableCollateral = collateral[user];
        seized = amount > availableCollateral ? availableCollateral : amount;
        shortfall = amount - seized;

        // Seize available collateral
        if (seized > 0) {
            collateral[user] -= seized;
            brokerPool += seized;
            emit CollateralSeized(user, seized, refId);
        }

        // Handle shortfall
        if (shortfall > 0) {
            uint256 coveredByInsurance = 0;
            uint256 socialized = 0;

            if (insuranceFund >= shortfall) {
                // Insurance fund covers full shortfall
                coveredByInsurance = shortfall;
                insuranceFund -= shortfall;
                brokerPool += shortfall;
            } else {
                // Partial coverage by insurance, rest is socialized
                coveredByInsurance = insuranceFund;
                socialized = shortfall - insuranceFund;
                
                if (insuranceFund > 0) {
                    brokerPool += insuranceFund;
                    insuranceFund = 0;
                }
                
                totalSocializedLosses += socialized;
            }

            emit Shortfall(user, shortfall, coveredByInsurance, socialized);
        }

        return (seized, shortfall);
    }

    // ──────────────────────────── Broker Functions ─────────────────

    /// @notice Broker deposits USDC into the broker pool
    function brokerDeposit(uint256 amount) external onlyBroker whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        brokerPool += amount;
        emit BrokerDeposited(amount);
    }

    /// @notice Broker withdraws from the broker pool
    function brokerWithdraw(uint256 amount) external onlyBroker whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (brokerPool < amount) revert InsufficientBrokerPool();
        brokerPool -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit BrokerWithdrawn(amount);
    }

    // ──────────────────────────── Admin Functions ──────────────────

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function setPerUserDailyCap(uint256 cap) external onlyAdmin {
        perUserDailyCap = cap;
        emit PerUserDailyCapSet(cap);
    }

    function setGlobalDailyCap(uint256 cap) external onlyAdmin {
        globalDailyCap = cap;
        emit GlobalDailyCapSet(cap);
    }

    function setSettlement(address _settlement) external onlyAdmin {
        settlement = _settlement;
        emit SettlementSet(_settlement);
    }

    function setBroker(address _broker) external onlyAdmin {
        broker = _broker;
        emit BrokerSet(_broker);
    }

    function setAdmin(address _admin) external onlyAdmin {
        admin = _admin;
        emit AdminSet(_admin);
    }

    function setTradingHoursGuard(address _guard) external onlyAdmin {
        tradingHoursGuard = _guard;
        emit TradingHoursGuardSet(_guard);
    }

    function setOracleGuard(address _guard) external onlyAdmin {
        oracleGuard = _guard;
        emit OracleGuardSet(_guard);
    }

    function setWithdrawalCooldownPeriod(uint256 period) external onlyAdmin {
        withdrawalCooldownPeriod = period;
        emit WithdrawalCooldownPeriodSet(period);
    }

    /// @notice Admin deposits into insurance fund (VS-H001)
    function depositInsuranceFund(uint256 amount) external onlyAdmin whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        insuranceFund += amount;
        emit InsuranceFundDeposited(amount);
    }

    /// @notice Admin withdraws from insurance fund
    function withdrawInsuranceFund(uint256 amount) external onlyAdmin nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (insuranceFund < amount) revert InsufficientBalance();
        insuranceFund -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit InsuranceFundWithdrawn(amount);
    }

    /// @notice Configure circuit breaker (VS-H006)
    /// @param threshold Total settlement volume that triggers circuit breaker (0 = disabled)
    /// @param window Time window in seconds (e.g., 3600 = 1 hour)
    function configureCircuitBreaker(uint256 threshold, uint256 window) external onlyAdmin {
        circuitBreakerThreshold = threshold;
        circuitBreakerWindow = window;
        emit CircuitBreakerConfigured(threshold, window);
    }

    // ──────────────────────────── Internal ─────────────────────────

    /// @notice Check trading hours and oracle guards (if set)
    function _checkGuards(bytes32 symbolId) internal view {
        // Check trading hours guard
        if (tradingHoursGuard != address(0)) {
            ITradingHoursGuard(tradingHoursGuard).requireCanTrade(symbolId);
        }
        
        // Oracle guard check is passive - just ensures oracle is configured
        // Actual price validation happens off-chain in bridge service
        if (oracleGuard != address(0)) {
            (bool valid,) = IOracleGuard(oracleGuard).isPriceValid(symbolId);
            require(valid, "Oracle price invalid");
        }
    }

    function _currentDay() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice Enforce withdrawal cooldown (VS-H002)
    function _enforceWithdrawalCooldown(address user) internal {
        if (withdrawalCooldownPeriod == 0) return; // Cooldown disabled
        
        uint256 timeSinceDeposit = block.timestamp - lastDepositTimestamp[user];
        if (timeSinceDeposit < withdrawalCooldownPeriod) {
            uint256 remainingTime = withdrawalCooldownPeriod - timeSinceDeposit;
            emit WithdrawalCooldownEnforced(user, remainingTime);
            revert WithdrawalCooldownActive(remainingTime);
        }
    }

    /// @notice Track settlement and check circuit breaker (VS-H006)
    function _trackAndCheckCircuitBreaker(uint256 amount) internal {
        if (circuitBreakerThreshold == 0) return; // Circuit breaker disabled
        
        // Add current settlement to tracking
        settlementVolumes.push(VolumeRecord({
            timestamp: block.timestamp,
            amount: amount
        }));
        
        // Calculate volume in current window
        uint256 windowStart = block.timestamp - circuitBreakerWindow;
        uint256 volumeInWindow = 0;
        
        for (uint256 i = 0; i < settlementVolumes.length; i++) {
            if (settlementVolumes[i].timestamp >= windowStart) {
                volumeInWindow += settlementVolumes[i].amount;
            }
        }
        
        // Trigger circuit breaker if threshold exceeded
        if (volumeInWindow > circuitBreakerThreshold) {
            emit CircuitBreakerTriggered(volumeInWindow, circuitBreakerThreshold);
            _pause();
        }
    }
    
    /// @notice Clean up old volume records outside the window (gas optimization)
    function cleanupVolumeRecords() external {
        if (settlementVolumes.length == 0) return;
        
        uint256 windowStart = block.timestamp - circuitBreakerWindow;
        uint256 firstValidIndex = 0;
        
        // Find first record still in window
        for (uint256 i = 0; i < settlementVolumes.length; i++) {
            if (settlementVolumes[i].timestamp >= windowStart) {
                firstValidIndex = i;
                break;
            }
        }
        
        // Remove old records by shifting array
        if (firstValidIndex > 0) {
            uint256 newLength = settlementVolumes.length - firstValidIndex;
            for (uint256 i = 0; i < newLength; i++) {
                settlementVolumes[i] = settlementVolumes[i + firstValidIndex];
            }
            for (uint256 i = 0; i < firstValidIndex; i++) {
                settlementVolumes.pop();
            }
        }
    }

    function _enforceWithdrawCaps(address user, uint256 amount) internal {
        uint256 today = _currentDay();

        // Per-user daily cap
        if (perUserDailyCap > 0) {
            if (userLastWithdrawDay[user] != today) {
                userDailyWithdrawn[user] = 0;
                userLastWithdrawDay[user] = today;
            }
            if (userDailyWithdrawn[user] + amount > perUserDailyCap) {
                revert ExceedsUserDailyCap();
            }
            userDailyWithdrawn[user] += amount;
        }

        // Global daily cap
        if (globalDailyCap > 0) {
            if (globalLastWithdrawDay != today) {
                globalDailyWithdrawn = 0;
                globalLastWithdrawDay = today;
            }
            if (globalDailyWithdrawn + amount > globalDailyCap) {
                revert ExceedsGlobalDailyCap();
            }
            globalDailyWithdrawn += amount;
        }
    }
}
