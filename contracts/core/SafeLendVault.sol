// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/ISafeLendVault.sol";
import "../interfaces/IInterestRateModel.sol";
import "../libraries/LiquidationMath.sol";

contract SafeLendVault is ISafeLendVault, ERC20, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using LiquidationMath for uint256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");

    IERC20 public immutable asset;
    IInterestRateModel public interestRateModel;

    mapping(address => Position) private positions;

    uint256 public totalBorrows;
    uint256 public totalReserves;
    uint256 public lastAccrualBlock;

    VaultConfig public config;

    uint256 private constant FACTOR_PRECISION = 1e18;
    uint256 private constant BLOCKS_PER_YEAR = 2628000;

    constructor(
        address _asset,
        address _interestRateModel,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        asset = IERC20(_asset);
        interestRateModel = IInterestRateModel(_interestRateModel);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(LIQUIDATOR_ROLE, msg.sender);

        config = VaultConfig({
            collateralFactor: 0.75e18,
            liquidationThreshold: 0.8e18,
            liquidationBonus: 0.05e18,
            reserveFactor: 0.1e18,
            interestRateModel: _interestRateModel,
            isPaused: false
        });

        lastAccrualBlock = block.number;
    }

    function deposit(uint256 amount) external override nonReentrant whenNotPaused returns (uint256 shares) {
        require(amount > 0, "Amount must be greater than 0");

        accrueInterest();

        uint256 totalAssets = getTotalSupply();
        uint256 totalShares = totalSupply();

        if (totalShares == 0) {
            shares = amount;
        } else {
            shares = (amount * totalShares) / totalAssets;
        }

        asset.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, shares);

        positions[msg.sender].collateralAmount += amount;

        emit Deposit(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external override nonReentrant returns (uint256 amount) {
        require(shares > 0, "Shares must be greater than 0");
        require(balanceOf(msg.sender) >= shares, "Insufficient shares");

        accrueInterest();

        uint256 totalAssets = getTotalSupply();
        uint256 totalShares = totalSupply();

        amount = (shares * totalAssets) / totalShares;

        require(amount <= positions[msg.sender].collateralAmount, "Insufficient collateral");

        uint256 healthFactorAfter = calculateHealthFactorAfterWithdraw(msg.sender, amount);
        require(healthFactorAfter >= FACTOR_PRECISION, "Withdrawal would make position undercollateralized");

        _burn(msg.sender, shares);
        positions[msg.sender].collateralAmount -= amount;

        asset.safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, amount, shares);
    }

    function borrow(uint256 amount) external override nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be greater than 0");

        accrueInterest();
        updateUserInterest(msg.sender);

        uint256 availableLiquidity = asset.balanceOf(address(this));
        require(amount <= availableLiquidity, "Insufficient liquidity");

        Position storage position = positions[msg.sender];

        uint256 maxBorrow = LiquidationMath.calculateMaxBorrow(
            position.collateralAmount,
            config.collateralFactor,
            position.borrowedAmount + position.accumulatedInterest
        );

        require(amount <= maxBorrow, "Borrow amount exceeds allowed");

        position.borrowedAmount += amount;
        position.lastInterestUpdate = block.number;
        totalBorrows += amount;

        asset.safeTransfer(msg.sender, amount);

        emit Borrow(msg.sender, amount);
    }

    function repay(uint256 amount) external override nonReentrant {
        require(amount > 0, "Amount must be greater than 0");

        accrueInterest();
        updateUserInterest(msg.sender);

        Position storage position = positions[msg.sender];
        uint256 totalDebt = position.borrowedAmount + position.accumulatedInterest;

        require(totalDebt > 0, "No debt to repay");

        uint256 repayAmount = amount > totalDebt ? totalDebt : amount;

        asset.safeTransferFrom(msg.sender, address(this), repayAmount);

        if (repayAmount >= position.accumulatedInterest) {
            uint256 principalRepay = repayAmount - position.accumulatedInterest;
            position.accumulatedInterest = 0;
            position.borrowedAmount -= principalRepay;
            totalBorrows -= principalRepay;
        } else {
            position.accumulatedInterest -= repayAmount;
        }

        position.lastInterestUpdate = block.number;

        emit Repay(msg.sender, repayAmount);
    }

    function liquidate(address borrower) external override nonReentrant returns (uint256) {
        require(hasRole(LIQUIDATOR_ROLE, msg.sender) || isPublicLiquidation(), "Not authorized");

        accrueInterest();
        updateUserInterest(borrower);

        Position storage position = positions[borrower];
        uint256 healthFactor = getUserHealthFactor(borrower);

        require(LiquidationMath.isLiquidatable(healthFactor), "Position is not liquidatable");

        uint256 totalDebt = position.borrowedAmount + position.accumulatedInterest;
        uint256 halfDebt = totalDebt / 2;

        (uint256 collateralToLiquidate, uint256 actualDebtCovered) =
            LiquidationMath.calculateLiquidationAmounts(
                halfDebt,
                totalDebt,
                position.collateralAmount,
                config.liquidationBonus
            );

        asset.safeTransferFrom(msg.sender, address(this), actualDebtCovered);

        position.borrowedAmount -= actualDebtCovered;
        position.collateralAmount -= collateralToLiquidate;
        totalBorrows -= actualDebtCovered;

        asset.safeTransfer(msg.sender, collateralToLiquidate);

        emit Liquidation(msg.sender, borrower, actualDebtCovered, collateralToLiquidate);

        return collateralToLiquidate;
    }

    function accrueInterest() public {
        uint256 blockDelta = block.number - lastAccrualBlock;
        if (blockDelta == 0) {
            return;
        }

        uint256 cash = asset.balanceOf(address(this));
        uint256 borrowRatePerBlock = interestRateModel.getBorrowRate(cash, totalBorrows, totalReserves) / BLOCKS_PER_YEAR;
        uint256 interestAccumulated = (borrowRatePerBlock * totalBorrows * blockDelta) / FACTOR_PRECISION;

        uint256 reservesFee = (interestAccumulated * config.reserveFactor) / FACTOR_PRECISION;

        totalBorrows += interestAccumulated;
        totalReserves += reservesFee;
        lastAccrualBlock = block.number;
    }

    function updateUserInterest(address user) internal {
        Position storage position = positions[user];

        if (position.borrowedAmount == 0) {
            return;
        }

        uint256 blockDelta = block.number - position.lastInterestUpdate;
        if (blockDelta == 0) {
            return;
        }

        uint256 cash = asset.balanceOf(address(this));
        uint256 borrowRatePerBlock = interestRateModel.getBorrowRate(cash, totalBorrows, totalReserves) / BLOCKS_PER_YEAR;
        uint256 interestAccumulated = (borrowRatePerBlock * position.borrowedAmount * blockDelta) / FACTOR_PRECISION;

        position.accumulatedInterest += interestAccumulated;
        position.lastInterestUpdate = block.number;
    }

    function calculateHealthFactorAfterWithdraw(address user, uint256 withdrawAmount) internal view returns (uint256) {
        Position memory position = positions[user];
        uint256 collateralAfter = position.collateralAmount - withdrawAmount;
        uint256 totalDebt = position.borrowedAmount + position.accumulatedInterest;

        return LiquidationMath.calculateHealthFactor(
            collateralAfter,
            totalDebt,
            config.liquidationThreshold
        );
    }

    function isPublicLiquidation() internal view returns (bool) {
        return true;
    }

    function getPosition(address user) external view override returns (Position memory) {
        return positions[user];
    }

    function getTotalSupply() public view override returns (uint256) {
        return asset.balanceOf(address(this)) + totalBorrows - totalReserves;
    }

    function getTotalBorrows() external view override returns (uint256) {
        return totalBorrows;
    }

    function getUtilizationRate() external view override returns (uint256) {
        uint256 cash = asset.balanceOf(address(this));
        return interestRateModel.utilizationRate(cash, totalBorrows, totalReserves);
    }

    function getUserHealthFactor(address user) public view override returns (uint256) {
        Position memory position = positions[user];
        uint256 totalDebt = position.borrowedAmount + position.accumulatedInterest;

        return LiquidationMath.calculateHealthFactor(
            position.collateralAmount,
            totalDebt,
            config.liquidationThreshold
        );
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function updateConfig(VaultConfig calldata newConfig) external onlyRole(ADMIN_ROLE) {
        config = newConfig;
        interestRateModel = IInterestRateModel(newConfig.interestRateModel);
    }
}