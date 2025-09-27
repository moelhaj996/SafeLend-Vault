// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ISafeLendVault.sol";
import "../libraries/LiquidationMath.sol";

contract Liquidator is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant EMERGENCY_ADMIN = keccak256("EMERGENCY_ADMIN");

    struct LiquidationData {
        address vault;
        address borrower;
        uint256 debtToCover;
        uint256 collateralReceived;
        uint256 timestamp;
        address liquidator;
    }

    mapping(address => LiquidationData[]) public liquidationHistory;
    mapping(address => bool) public authorizedVaults;

    uint256 public totalLiquidations;
    uint256 public minProfitThreshold = 1e16;
    bool public emergencyStop = false;

    event LiquidationExecuted(
        address indexed vault,
        address indexed borrower,
        address indexed liquidator,
        uint256 debtCovered,
        uint256 collateralReceived
    );

    event VaultAuthorized(address indexed vault, bool authorized);
    event EmergencyStopToggled(bool stopped);
    event MinProfitThresholdUpdated(uint256 newThreshold);

    modifier notEmergencyStopped() {
        require(!emergencyStop, "Emergency stop activated");
        _;
    }

    modifier onlyAuthorizedVault(address vault) {
        require(authorizedVaults[vault], "Vault not authorized");
        _;
    }

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(KEEPER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ADMIN, msg.sender);
    }

    function liquidate(
        address vault,
        address borrower
    ) external nonReentrant notEmergencyStopped onlyAuthorizedVault(vault) returns (uint256) {
        require(hasRole(KEEPER_ROLE, msg.sender) || isPublicLiquidation(), "Not authorized");

        ISafeLendVault vaultContract = ISafeLendVault(vault);

        uint256 healthFactor = vaultContract.getUserHealthFactor(borrower);
        require(healthFactor < 1e18, "Position is healthy");

        // Get position details to know how much debt to repay
        ISafeLendVault.Position memory position = vaultContract.getPosition(borrower);
        uint256 totalDebt = position.borrowedAmount + position.accumulatedInterest;
        uint256 maxDebtToRepay = (totalDebt * 110) / 100; // Add 10% buffer for any additional interest

        // Get the asset from the vault
        IERC20 asset = vaultContract.asset();

        // Transfer tokens from keeper to this contract (with buffer for interest)
        asset.transferFrom(msg.sender, address(this), maxDebtToRepay);

        // Approve vault to take tokens from this contract
        asset.approve(vault, maxDebtToRepay);

        uint256 collateralReceived = vaultContract.liquidate(borrower);

        // Transfer collateral received back to the keeper
        asset.transfer(msg.sender, collateralReceived);

        // Transfer any remaining tokens back to the keeper
        uint256 remainingBalance = asset.balanceOf(address(this));
        if (remainingBalance > 0) {
            asset.transfer(msg.sender, remainingBalance);
        }

        LiquidationData memory data = LiquidationData({
            vault: vault,
            borrower: borrower,
            debtToCover: totalDebt / 2,  // Actual debt covered (50% close factor)
            collateralReceived: collateralReceived,
            timestamp: block.timestamp,
            liquidator: msg.sender
        });

        liquidationHistory[borrower].push(data);
        totalLiquidations++;

        emit LiquidationExecuted(vault, borrower, msg.sender, totalDebt / 2, collateralReceived);

        return collateralReceived;
    }

    function batchLiquidate(
        address[] calldata vaults,
        address[] calldata borrowers
    ) external nonReentrant notEmergencyStopped returns (uint256[] memory) {
        require(vaults.length == borrowers.length, "Array length mismatch");
        require(hasRole(KEEPER_ROLE, msg.sender), "Not authorized for batch");

        uint256[] memory collateralReceived = new uint256[](vaults.length);

        for (uint256 i = 0; i < vaults.length; i++) {
            if (!authorizedVaults[vaults[i]]) continue;

            ISafeLendVault vaultContract = ISafeLendVault(vaults[i]);
            uint256 healthFactor = vaultContract.getUserHealthFactor(borrowers[i]);

            if (healthFactor < 1e18) {
                try vaultContract.liquidate(borrowers[i]) returns (uint256 collateral) {
                    collateralReceived[i] = collateral;

                    LiquidationData memory data = LiquidationData({
                        vault: vaults[i],
                        borrower: borrowers[i],
                        debtToCover: 0,
                        collateralReceived: collateral,
                        timestamp: block.timestamp,
                        liquidator: msg.sender
                    });

                    liquidationHistory[borrowers[i]].push(data);
                    totalLiquidations++;

                    emit LiquidationExecuted(vaults[i], borrowers[i], msg.sender, 0, collateral);
                } catch {
                    continue;
                }
            }
        }

        return collateralReceived;
    }

    function checkLiquidationOpportunity(
        address vault,
        address borrower
    ) external view returns (bool canLiquidate, uint256 expectedProfit) {
        if (!authorizedVaults[vault] || emergencyStop) {
            return (false, 0);
        }

        ISafeLendVault vaultContract = ISafeLendVault(vault);
        uint256 healthFactor = vaultContract.getUserHealthFactor(borrower);

        if (healthFactor >= 1e18) {
            return (false, 0);
        }

        ISafeLendVault.Position memory position = vaultContract.getPosition(borrower);
        uint256 maxLiquidation = position.borrowedAmount / 2;

        expectedProfit = (maxLiquidation * 5) / 100;

        canLiquidate = expectedProfit >= minProfitThreshold;
    }

    function authorizeVault(address vault, bool authorized) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedVaults[vault] = authorized;
        emit VaultAuthorized(vault, authorized);
    }

    function toggleEmergencyStop() external onlyRole(EMERGENCY_ADMIN) {
        emergencyStop = !emergencyStop;
        emit EmergencyStopToggled(emergencyStop);
    }

    function updateMinProfitThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minProfitThreshold = newThreshold;
        emit MinProfitThresholdUpdated(newThreshold);
    }

    function getLiquidationHistory(address borrower) external view returns (LiquidationData[] memory) {
        return liquidationHistory[borrower];
    }

    function isPublicLiquidation() internal view returns (bool) {
        return true;
    }

    function withdrawToken(address token, uint256 amount) external onlyRole(EMERGENCY_ADMIN) {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}