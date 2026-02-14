// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TimelockController
/// @notice Simple 24h timelock for critical admin functions (VS-H005)
/// @dev Admin queues action → 24h delay → anyone can execute after delay
contract TimelockController {
    
    // ──────────────────────────── Types ────────────────────────────

    struct QueuedAction {
        address target;       // Contract to call
        bytes data;          // Encoded function call
        uint256 queuedAt;    // When it was queued
        bool executed;       // Whether it's been executed
    }
    
    // ──────────────────────────── State ────────────────────────────

    address public admin;
    uint256 public constant DELAY = 24 hours;
    
    /// @notice Queued actions by ID
    mapping(bytes32 => QueuedAction) public queuedActions;
    
    // ──────────────────────────── Events ───────────────────────────

    event ActionQueued(bytes32 indexed actionId, address indexed target, bytes data, uint256 executeAfter);
    event ActionExecuted(bytes32 indexed actionId, address indexed target, bytes data);
    event ActionCancelled(bytes32 indexed actionId);
    event AdminSet(address indexed newAdmin);
    
    // ──────────────────────────── Errors ───────────────────────────

    error Unauthorized();
    error ActionNotQueued();
    error ActionAlreadyExecuted();
    error TimelockNotExpired(uint256 executeAfter);
    error ExecutionFailed();
    error ActionAlreadyQueued();
    
    // ──────────────────────────── Modifiers ────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }
    
    // ──────────────────────────── Constructor ──────────────────────

    constructor(address _admin) {
        admin = _admin;
    }
    
    // ──────────────────────────── Queue Actions ────────────────────

    /// @notice Queue a critical admin action with 24h delay
    /// @param target The contract to call
    /// @param data The encoded function call
    /// @return actionId The unique ID for this action
    function queueAction(address target, bytes calldata data) external onlyAdmin returns (bytes32 actionId) {
        actionId = keccak256(abi.encodePacked(target, data, block.timestamp));
        
        if (queuedActions[actionId].queuedAt != 0) revert ActionAlreadyQueued();
        
        uint256 executeAfter = block.timestamp + DELAY;
        
        queuedActions[actionId] = QueuedAction({
            target: target,
            data: data,
            queuedAt: block.timestamp,
            executed: false
        });
        
        emit ActionQueued(actionId, target, data, executeAfter);
        
        return actionId;
    }
    
    /// @notice Execute a queued action after the delay has passed
    /// @param actionId The ID of the action to execute
    function executeAction(bytes32 actionId) external {
        QueuedAction storage action = queuedActions[actionId];
        
        if (action.queuedAt == 0) revert ActionNotQueued();
        if (action.executed) revert ActionAlreadyExecuted();
        
        uint256 executeAfter = action.queuedAt + DELAY;
        if (block.timestamp < executeAfter) {
            revert TimelockNotExpired(executeAfter);
        }
        
        action.executed = true;
        
        // Execute the action
        (bool success, ) = action.target.call(action.data);
        if (!success) revert ExecutionFailed();
        
        emit ActionExecuted(actionId, action.target, action.data);
    }
    
    /// @notice Cancel a queued action (admin only)
    /// @param actionId The ID of the action to cancel
    function cancelAction(bytes32 actionId) external onlyAdmin {
        QueuedAction storage action = queuedActions[actionId];
        
        if (action.queuedAt == 0) revert ActionNotQueued();
        if (action.executed) revert ActionAlreadyExecuted();
        
        delete queuedActions[actionId];
        
        emit ActionCancelled(actionId);
    }
    
    /// @notice Change the admin (with timelock)
    function setAdmin(address newAdmin) external onlyAdmin {
        admin = newAdmin;
        emit AdminSet(newAdmin);
    }
    
    // ──────────────────────────── View Functions ───────────────────

    /// @notice Check if an action can be executed
    function canExecute(bytes32 actionId) external view returns (bool) {
        QueuedAction storage action = queuedActions[actionId];
        if (action.queuedAt == 0 || action.executed) return false;
        return block.timestamp >= action.queuedAt + DELAY;
    }
    
    /// @notice Get the time remaining before an action can be executed
    function timeUntilExecutable(bytes32 actionId) external view returns (uint256) {
        QueuedAction storage action = queuedActions[actionId];
        if (action.queuedAt == 0 || action.executed) return 0;
        
        uint256 executeAfter = action.queuedAt + DELAY;
        if (block.timestamp >= executeAfter) return 0;
        
        return executeAfter - block.timestamp;
    }
}
