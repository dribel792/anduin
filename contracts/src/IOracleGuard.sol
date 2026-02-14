// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOracleGuard {
    function getValidatedPrice(bytes32 symbolId) external view returns (uint256 price, uint256 timestamp, bool usedFallback);
    function isPriceValid(bytes32 symbolId) external view returns (bool valid, string memory reason);
}
