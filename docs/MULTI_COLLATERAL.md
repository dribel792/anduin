# Multi-Collateral Support — Architecture & Design

**Status:** 🚧 Planned (design complete, deferred to post-MVP)

---

## Problem

Currently only **USDC accepted as collateral**:
- Users stuck with single stablecoin exposure
- Misses users who prefer ETH, BTC, or other tokens
- Liquidations require selling crypto → stablecoin (slippage, tax events)
- No leverage on crypto holdings

**What users want:**
- Deposit ETH, use it as margin for trading
- Deposit WBTC, earn yield while trading
- Multi-token portfolios as collateral

---

## Design Goals

1. **Accept multiple tokens** as collateral (ETH, WBTC, USDT, DAI, etc.)
2. **LTV ratios** per token (ETH = 80%, WBTC = 75%, etc.)
3. **Oracle-based pricing** for real-time collateral valuation
4. **Margin calls** when collateral value < maintenance threshold
5. **Liquidations** if user fails to top up
6. **Settlements still in USDC** (or allow multi-currency settlements?)

---

## Proposed Solution: Multi-Token Vault with Oracle-Based Margin

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  USER COLLATERAL                            │
│                                                             │
│  User deposits:                                             │
│  - 1 ETH (price = $2000)                                    │
│  - 0.5 WBTC (price = $40,000 × 0.5 = $20,000)               │
│  - 10,000 USDC                                              │
│                                                             │
│  Total Collateral Value: $32,000                            │
│                                                             │
│  LTV Applied:                                               │
│  - ETH: $2000 × 80% = $1,600                                │
│  - WBTC: $20,000 × 75% = $15,000                            │
│  - USDC: $10,000 × 100% = $10,000                           │
│                                                             │
│  Effective Margin: $26,600                                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  MARGIN CALCULATION                         │
│                                                             │
│  Open positions:                                            │
│  - Long 100 AAPL @ $150 = $15,000 notional                  │
│  - Short 50 TSLA @ $200 = $10,000 notional                  │
│  Total notional: $25,000                                    │
│                                                             │
│  Required margin (10%): $2,500                              │
│  Available margin: $26,600                                  │
│  Margin ratio: 1064% (healthy)                              │
│                                                             │
│  Liquidation threshold: 110%                                │
│  Margin call threshold: 120%                                │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               PRICE DROP → MARGIN CALL                      │
│                                                             │
│  ETH drops to $1500 (-25%)                                  │
│  New collateral value:                                      │
│  - ETH: $1500 × 80% = $1,200                                │
│  - WBTC: $20,000 × 75% = $15,000                            │
│  - USDC: $10,000 × 100% = $10,000                           │
│  Effective Margin: $26,200                                  │
│                                                             │
│  Margin ratio: 1048% → still safe                           │
│                                                             │
│  ETH drops to $1000 (-50%)                                  │
│  - ETH: $1000 × 80% = $800                                  │
│  - WBTC: $20,000 × 75% = $15,000                            │
│  - USDC: $10,000 × 100% = $10,000                           │
│  Effective Margin: $25,800                                  │
│                                                             │
│  Margin ratio: 1032% → still above liquidation              │
│  But below 120% → MARGIN CALL triggered                     │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    LIQUIDATION                              │
│                                                             │
│  ETH drops to $500 (-75%)                                   │
│  - ETH: $500 × 80% = $400                                   │
│  - WBTC: $20,000 × 75% = $15,000                            │
│  - USDC: $10,000 × 100% = $10,000                           │
│  Effective Margin: $25,400                                  │
│                                                             │
│  Margin ratio: 1016% → BELOW 110% → LIQUIDATION             │
│                                                             │
│  Liquidation process:                                       │
│  1. Sell ETH for USDC (via DEX or oracle-based pricing)     │
│  2. Use USDC to cover losses                                │
│  3. Close positions                                         │
│  4. Return remaining collateral to user                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Smart Contract Design

### New Contract: `MultiCollateralVault`

```solidity
contract MultiCollateralVault {
    using SafeERC20 for IERC20;
    
    // ═══════════════════════ State ═══════════════════════
    
    struct TokenConfig {
        bool enabled;
        uint16 ltvBps;              // Loan-to-value in basis points (8000 = 80%)
        uint16 liquidationThresholdBps;  // 11000 = 110%
        uint16 marginCallThresholdBps;   // 12000 = 120%
        bytes32 oracleSymbolId;     // For price lookup
        address tokenAddress;
    }
    
    struct UserCollateral {
        mapping(address => uint256) balances;  // token => amount
        uint256 lastUpdateTimestamp;
    }
    
    mapping(address => TokenConfig) public tokenConfigs;
    mapping(address => UserCollateral) private userCollateral;
    
    address public oracleGuard;
    address public liquidator;
    
    // ═══════════════════════ Deposit / Withdraw ═══════════════════════
    
    function depositCollateral(address token, uint256 amount) external nonReentrant {
        TokenConfig storage cfg = tokenConfigs[token];
        require(cfg.enabled, "Token not supported");
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        userCollateral[msg.sender].balances[token] += amount;
        userCollateral[msg.sender].lastUpdateTimestamp = block.timestamp;
        
        emit CollateralDeposited(msg.sender, token, amount);
    }
    
    function withdrawCollateral(address token, uint256 amount) external nonReentrant {
        require(userCollateral[msg.sender].balances[token] >= amount, "Insufficient balance");
        
        // Check margin after withdrawal
        uint256 marginAfter = _calculateEffectiveMargin(msg.sender, token, amount);
        uint256 required = _getRequiredMargin(msg.sender);
        require(marginAfter >= required, "Would exceed margin limit");
        
        userCollateral[msg.sender].balances[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        
        emit CollateralWithdrawn(msg.sender, token, amount);
    }
    
    // ═══════════════════════ Margin Calculation ═══════════════════════
    
    function getEffectiveMargin(address user) public view returns (uint256 totalMarginUSD) {
        UserCollateral storage uc = userCollateral[user];
        address[] memory supportedTokens = getSupportedTokens();
        
        for (uint i = 0; i < supportedTokens.length; i++) {
            address token = supportedTokens[i];
            uint256 balance = uc.balances[token];
            if (balance == 0) continue;
            
            TokenConfig storage cfg = tokenConfigs[token];
            (uint256 priceUSD, uint8 decimals) = _getTokenPrice(token);
            
            // Convert balance to USD
            uint256 valueUSD = (balance * priceUSD) / (10 ** decimals);
            
            // Apply LTV
            uint256 marginUSD = (valueUSD * cfg.ltvBps) / 10000;
            totalMarginUSD += marginUSD;
        }
    }
    
    function getMarginRatio(address user) public view returns (uint256 ratioBps) {
        uint256 effectiveMargin = getEffectiveMargin(user);
        uint256 requiredMargin = _getRequiredMargin(user);  // From positions
        
        if (requiredMargin == 0) return type(uint256).max;  // No positions
        return (effectiveMargin * 10000) / requiredMargin;
    }
    
    function isMarginCall(address user) public view returns (bool) {
        uint256 ratio = getMarginRatio(user);
        // Margin call if ratio < 120%
        return ratio < 12000;
    }
    
    function isLiquidatable(address user) public view returns (bool) {
        uint256 ratio = getMarginRatio(user);
        // Liquidate if ratio < 110%
        return ratio < 11000;
    }
    
    // ═══════════════════════ Liquidation ═══════════════════════
    
    function liquidate(address user) external onlyLiquidator nonReentrant {
        require(isLiquidatable(user), "User not liquidatable");
        
        // 1. Close user's positions (via broker)
        emit LiquidationStarted(user);
        
        // 2. Sell user's collateral for USDC (simplified - in production use DEX)
        UserCollateral storage uc = userCollateral[user];
        address[] memory tokens = getSupportedTokens();
        
        uint256 totalUSDC = 0;
        for (uint i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 balance = uc.balances[token];
            if (balance == 0) continue;
            
            // Swap token for USDC via DEX or oracle-based pricing
            uint256 usdcReceived = _swapForUSDC(token, balance);
            totalUSDC += usdcReceived;
            uc.balances[token] = 0;
        }
        
        // 3. Cover losses from broker pool
        uint256 losses = _getUserLosses(user);
        if (totalUSDC >= losses) {
            brokerPool += losses;
            uint256 remaining = totalUSDC - losses;
            // Return remaining to user
            usdc.safeTransfer(user, remaining);
        } else {
            // Insufficient collateral - broker takes the loss
            brokerPool += totalUSDC;
        }
        
        emit LiquidationCompleted(user, totalUSDC, losses);
    }
    
    // ═══════════════════════ Admin ═══════════════════════
    
    function registerToken(
        address token,
        uint16 ltvBps,
        uint16 liquidationThresholdBps,
        uint16 marginCallThresholdBps,
        bytes32 oracleSymbolId
    ) external onlyAdmin {
        tokenConfigs[token] = TokenConfig({
            enabled: true,
            ltvBps: ltvBps,
            liquidationThresholdBps: liquidationThresholdBps,
            marginCallThresholdBps: marginCallThresholdBps,
            oracleSymbolId: oracleSymbolId,
            tokenAddress: token
        });
        
        emit TokenRegistered(token, ltvBps);
    }
    
    // ═══════════════════════ Helpers ═══════════════════════
    
    function _getTokenPrice(address token) internal view returns (uint256 priceUSD, uint8 decimals) {
        TokenConfig storage cfg = tokenConfigs[token];
        (uint256 price, ) = IOracleGuard(oracleGuard).getValidatedPrice(cfg.oracleSymbolId);
        return (price, 8);  // Prices in 8 decimals
    }
    
    function _swapForUSDC(address token, uint256 amount) internal returns (uint256 usdcAmount) {
        // In production: use Uniswap, 1inch, or oracle-based pricing
        // For MVP: simplified oracle-based conversion
        (uint256 priceUSD, uint8 decimals) = _getTokenPrice(token);
        usdcAmount = (amount * priceUSD) / (10 ** decimals);
        
        // Assume 1% slippage
        usdcAmount = (usdcAmount * 99) / 100;
    }
}
```

---

## Token Configuration

| Token | LTV | Liquidation Threshold | Margin Call | Oracle |
|-------|-----|----------------------|-------------|---------|
| USDC | 100% | 100% | 100% | N/A (stablecoin) |
| ETH | 80% | 110% | 120% | Chainlink ETH/USD |
| WBTC | 75% | 110% | 120% | Chainlink BTC/USD |
| USDT | 95% | 105% | 110% | Chainlink USDT/USD |
| DAI | 95% | 105% | 110% | Chainlink DAI/USD |

**Rationale:**
- **USDC**: Most stable, 100% LTV
- **ETH/WBTC**: Volatile, lower LTV to protect against flash crashes
- **USDT/DAI**: Stablecoins but with slight depeg risk, 95% LTV

---

## Margin Call Flow

```
1. Monitor service checks margin ratios every 30 seconds
2. If ratio < 120%, trigger margin call:
   - Send email/SMS to user
   - Show warning banner in UI
   - User has 1 hour to top up collateral
3. If user tops up, margin call cleared
4. If ratio drops < 110%, liquidation triggered immediately
```

### Margin Monitor Service

```typescript
async function checkMargins() {
  const users = await db.getUsersWithPositions();
  
  for (const user of users) {
    const ratio = await vault.getMarginRatio(user.address);
    
    if (ratio < 11000) {
      // Liquidate immediately
      console.log(`🔴 LIQUIDATING ${user.address}, ratio=${ratio}`);
      await liquidate(user.address);
    } else if (ratio < 12000) {
      // Margin call
      console.log(`🟡 MARGIN CALL ${user.address}, ratio=${ratio}`);
      await sendMarginCallAlert(user);
    }
  }
}

// Run every 30 seconds
setInterval(checkMargins, 30_000);
```

---

## Oracle Integration

Using **OracleGuard** for price feeds:

```solidity
function _getTokenPrice(address token) internal view returns (uint256 priceUSD) {
    TokenConfig storage cfg = tokenConfigs[token];
    (uint256 price, ) = IOracleGuard(oracleGuard).getValidatedPrice(cfg.oracleSymbolId);
    return price;  // 8 decimals
}
```

**Price sources:**
- **Chainlink**: ETH/USD, BTC/USD, LINK/USD
- **Pyth**: High-frequency price feeds
- **Fallback**: TWAP from Uniswap V3

**Staleness protection:**
- Revert if price > 5 minutes old
- Halt trading if oracle offline

---

## Liquidation Engine

### Option 1: DEX-Based (Recommended)

Liquidator sells collateral via Uniswap/1inch:
```solidity
function _swapForUSDC(address token, uint256 amount) internal returns (uint256) {
    // Approve Uniswap router
    IERC20(token).approve(UNISWAP_ROUTER, amount);
    
    // Swap token → USDC
    ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
        tokenIn: token,
        tokenOut: address(usdc),
        fee: 3000,  // 0.3% pool
        recipient: address(this),
        deadline: block.timestamp,
        amountIn: amount,
        amountOutMinimum: 0,  // Accept any amount (liquidation priority)
        sqrtPriceLimitX96: 0
    });
    
    return ISwapRouter(UNISWAP_ROUTER).exactInputSingle(params);
}
```

### Option 2: Oracle-Based (Simpler, Gas-Efficient)

Liquidator uses oracle price directly (assumes instant liquidity):
```solidity
function _swapForUSDC(address token, uint256 amount) internal returns (uint256) {
    (uint256 priceUSD, ) = _getTokenPrice(token);
    uint256 usdcAmount = (amount * priceUSD) / 1e8;
    
    // Apply 1% haircut for slippage
    return (usdcAmount * 99) / 100;
}
```

---

## Migration Path

### Phase 1: Add ETH Support
- Deploy `MultiCollateralVault` with ETH + USDC support
- Users can deposit ETH as collateral
- Settlements still in USDC

### Phase 2: Add WBTC, USDT, DAI
- Register additional tokens
- Monitor oracle reliability
- Adjust LTV based on volatility

### Phase 3: Multi-Currency Settlements
- Allow settlements in ETH, WBTC (not just USDC)
- User preference: "Settle my losses in ETH, not USDC"

---

## Security Considerations

### 1. **Oracle Manipulation**

- Use multiple price sources (Chainlink + Pyth)
- Price band checks (reject if deviation > 5%)
- Circuit breakers: halt if oracle offline

### 2. **Flash Loan Attacks**

- Time-weighted prices (TWAP)
- Minimum deposit duration (e.g., 5 minutes before withdrawable)

### 3. **Liquidation Cascades**

- Gradual liquidations (don't dump all tokens at once)
- Backstop liquidity pool

### 4. **Slippage in DEX Swaps**

- Set maximum slippage (e.g., 5%)
- Revert if slippage exceeded
- Use limit orders for large liquidations

---

## Gas Cost Analysis

| Operation | Gas (Single Collateral) | Gas (Multi-Collateral) | Delta |
|-----------|------------------------|------------------------|-------|
| Deposit | 50k | 60k | +20% |
| Withdraw | 50k | 80k | +60% (margin check) |
| Settlement | 50k | 50k | 0% (same) |
| Liquidation | N/A | 200k | New |

**Extra cost: Manageable** (margin checks add ~30k gas)

---

## Alternatives Considered

### 1. **Single-Collateral Vaults**
- **Pros**: Simpler, less oracle risk
- **Cons**: Users can't use ETH/BTC as collateral

### 2. **Over-Collateralized Stablecoin (like DAI)**
- **Pros**: Users deposit ETH → get synthetic USDC
- **Cons**: Still requires liquidations, complex

### 3. **Lending Protocol Integration (Aave, Compound)**
- **Pros**: Proven liquidation engine
- **Cons**: External dependency, composability risk

---

## Conclusion

**Multi-collateral vault with oracle-based margin** enables:
- **ETH/WBTC as collateral** (huge user demand)
- **Automated liquidations** (protects broker)
- **Flexible LTV ratios** (risk-adjusted per token)
- **Oracle integration** (reuses existing OracleGuard)

Recommended for **Phase 2** after MVP, starting with ETH-only pilot.

---

## Next Steps

1. **Deploy `MultiCollateralVault.sol`** with ETH support
2. **Build margin monitor service** (check ratios every 30s)
3. **Integrate OracleGuard** for ETH/USD pricing
4. **Test liquidation flow** with simulated price drops
5. **Pilot with 10 users** (ETH collateral only)
6. **Expand to WBTC, USDT, DAI** after 30 days
