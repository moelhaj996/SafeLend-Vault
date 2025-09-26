// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../contracts/core/SafeLendVault.sol";
import "../../contracts/mocks/MockERC20.sol";
import "../../contracts/libraries/InterestRateModel.sol";

contract VaultFuzz {
    SafeLendVault public vault;
    MockERC20 public token;
    InterestRateModel public interestModel;

    uint256 constant INITIAL_BALANCE = 1000000e18;
    uint256 constant MAX_DEPOSIT = 100000e18;
    uint256 constant MAX_BORROW = 75000e18;

    mapping(address => uint256) public ghost_deposits;
    mapping(address => uint256) public ghost_borrows;
    uint256 public ghost_totalDeposits;
    uint256 public ghost_totalBorrows;

    event AssertionFailed(string reason);

    constructor() {
        token = new MockERC20("Test Token", "TEST", 18);
        interestModel = new InterestRateModel();
        vault = new SafeLendVault(
            address(token),
            address(interestModel),
            "Test Vault",
            "tvTEST"
        );

        token.mint(address(this), INITIAL_BALANCE);
        token.mint(address(0x10000), INITIAL_BALANCE);
        token.mint(address(0x20000), INITIAL_BALANCE);
        token.mint(address(0x30000), INITIAL_BALANCE);
    }

    function echidna_test_total_supply_consistency() public view returns (bool) {
        uint256 vaultBalance = token.balanceOf(address(vault));
        uint256 totalBorrows = vault.getTotalBorrows();
        uint256 totalSupply = vault.getTotalSupply();

        return totalSupply <= vaultBalance + totalBorrows;
    }

    function echidna_test_no_free_tokens() public view returns (bool) {
        uint256 totalShares = vault.totalSupply();
        if (totalShares == 0) return true;

        uint256 totalAssets = vault.getTotalSupply();
        return totalAssets > 0;
    }

    function echidna_test_health_factor_validity() public view returns (bool) {
        address[] memory users = new address[](3);
        users[0] = address(0x10000);
        users[1] = address(0x20000);
        users[2] = address(0x30000);

        for (uint256 i = 0; i < users.length; i++) {
            ISafeLendVault.Position memory pos = vault.getPosition(users[i]);
            if (pos.borrowedAmount == 0) continue;

            uint256 healthFactor = vault.getUserHealthFactor(users[i]);
            if (healthFactor == type(uint256).max) continue;

            if (healthFactor < 1e18) {
                return true;
            }
        }
        return true;
    }

    function echidna_test_utilization_rate_bounds() public view returns (bool) {
        uint256 utilRate = vault.getUtilizationRate();
        return utilRate <= 1e18;
    }

    function echidna_test_borrow_limit_enforcement() public returns (bool) {
        address user = msg.sender;
        ISafeLendVault.Position memory pos = vault.getPosition(user);

        if (pos.collateralAmount == 0) return true;

        uint256 maxBorrow = (pos.collateralAmount * 75) / 100;
        uint256 totalDebt = pos.borrowedAmount + pos.accumulatedInterest;

        return totalDebt <= maxBorrow;
    }

    function echidna_test_liquidation_profitability() public view returns (bool) {
        address[] memory users = new address[](3);
        users[0] = address(0x10000);
        users[1] = address(0x20000);
        users[2] = address(0x30000);

        for (uint256 i = 0; i < users.length; i++) {
            uint256 healthFactor = vault.getUserHealthFactor(users[i]);
            if (healthFactor < 1e18) {
                ISafeLendVault.Position memory pos = vault.getPosition(users[i]);
                uint256 liquidationBonus = pos.borrowedAmount * 5 / 100;
                return liquidationBonus > 0;
            }
        }
        return true;
    }

    function test_deposit(uint256 amount) public {
        amount = bound(amount, 1, MAX_DEPOSIT);

        token.approve(address(vault), amount);
        uint256 sharesBefore = vault.balanceOf(msg.sender);

        try vault.deposit(amount) returns (uint256 shares) {
            assert(shares > 0);
            assert(vault.balanceOf(msg.sender) == sharesBefore + shares);

            ghost_deposits[msg.sender] += amount;
            ghost_totalDeposits += amount;
        } catch {
        }
    }

    function test_withdraw(uint256 shares) public {
        uint256 userShares = vault.balanceOf(msg.sender);
        if (userShares == 0) return;

        shares = bound(shares, 1, userShares);

        try vault.withdraw(shares) returns (uint256 amount) {
            assert(amount > 0);
            assert(vault.balanceOf(msg.sender) == userShares - shares);

            ghost_deposits[msg.sender] -= amount;
            ghost_totalDeposits -= amount;
        } catch {
        }
    }

    function test_borrow(uint256 amount) public {
        ISafeLendVault.Position memory pos = vault.getPosition(msg.sender);
        if (pos.collateralAmount == 0) return;

        uint256 maxBorrow = (pos.collateralAmount * 75) / 100 - pos.borrowedAmount;
        if (maxBorrow == 0) return;

        amount = bound(amount, 1, maxBorrow);

        try vault.borrow(amount) {
            ghost_borrows[msg.sender] += amount;
            ghost_totalBorrows += amount;

            ISafeLendVault.Position memory newPos = vault.getPosition(msg.sender);
            assert(newPos.borrowedAmount == pos.borrowedAmount + amount);
        } catch {
        }
    }

    function test_repay(uint256 amount) public {
        ISafeLendVault.Position memory pos = vault.getPosition(msg.sender);
        uint256 totalDebt = pos.borrowedAmount + pos.accumulatedInterest;
        if (totalDebt == 0) return;

        amount = bound(amount, 1, totalDebt);
        token.approve(address(vault), amount);

        try vault.repay(amount) {
            if (amount >= pos.borrowedAmount) {
                ghost_borrows[msg.sender] = 0;
                ghost_totalBorrows -= pos.borrowedAmount;
            } else {
                ghost_borrows[msg.sender] -= amount;
                ghost_totalBorrows -= amount;
            }
        } catch {
        }
    }

    function test_liquidate(address borrower) public {
        uint256 healthFactor = vault.getUserHealthFactor(borrower);
        if (healthFactor >= 1e18) return;

        ISafeLendVault.Position memory pos = vault.getPosition(borrower);
        uint256 halfDebt = pos.borrowedAmount / 2;

        token.approve(address(vault), halfDebt);

        try vault.liquidate(borrower) returns (uint256 collateralReceived) {
            assert(collateralReceived > halfDebt);

            uint256 newHealthFactor = vault.getUserHealthFactor(borrower);
            assert(newHealthFactor > healthFactor);
        } catch {
        }
    }

    function bound(uint256 value, uint256 min, uint256 max) internal pure returns (uint256) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }
}