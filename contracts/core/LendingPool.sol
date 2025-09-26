// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../interfaces/ILendingPool.sol";
import "../interfaces/IInterestRateModel.sol";

contract LendingPool is ILendingPool, Ownable, ReentrancyGuard {
    ReserveData public reserveData;
    IInterestRateModel public interestRateModel;

    uint256 private constant SECONDS_PER_YEAR = 365 days;

    constructor(address _interestRateModel) {
        interestRateModel = IInterestRateModel(_interestRateModel);
        reserveData.isActive = true;
        reserveData.lastUpdateTimestamp = block.timestamp;
        reserveData.interestRateModel = _interestRateModel;
    }

    function updateReserveData() external override {
        accrueInterest();

        uint256 cash = reserveData.availableLiquidity;
        uint256 borrows = reserveData.totalBorrows;
        uint256 reserves = 0;

        reserveData.utilizationRate = interestRateModel.utilizationRate(cash, borrows, reserves);
        reserveData.borrowRate = interestRateModel.getBorrowRate(cash, borrows, reserves);
        reserveData.supplyRate = interestRateModel.getSupplyRate(cash, borrows, reserves, 1e17);

        reserveData.lastUpdateTimestamp = block.timestamp;

        emit ReserveDataUpdated(
            reserveData.totalSupply,
            reserveData.totalBorrows,
            reserveData.utilizationRate,
            reserveData.borrowRate,
            reserveData.supplyRate
        );
    }

    function accrueInterest() public override {
        if (block.timestamp == reserveData.lastUpdateTimestamp) {
            return;
        }

        uint256 timeDelta = block.timestamp - reserveData.lastUpdateTimestamp;
        uint256 borrowInterest = calculateCompoundInterest(reserveData.borrowRate, timeDelta);
        uint256 totalBorrowsNew = (reserveData.totalBorrows * borrowInterest) / 1e18;

        uint256 interestAccumulated = totalBorrowsNew - reserveData.totalBorrows;

        reserveData.totalBorrows = totalBorrowsNew;
        reserveData.totalSupply += interestAccumulated;

        reserveData.lastUpdateTimestamp = block.timestamp;
    }

    function calculateInterest(address user) external view override returns (uint256) {
        uint256 timeDelta = block.timestamp - reserveData.lastUpdateTimestamp;
        uint256 borrowInterest = calculateCompoundInterest(reserveData.borrowRate, timeDelta);
        return borrowInterest;
    }

    function calculateCompoundInterest(uint256 rate, uint256 timeDelta) internal pure returns (uint256) {
        uint256 ratePerSecond = rate / SECONDS_PER_YEAR;
        uint256 compound = 1e18 + (ratePerSecond * timeDelta);

        for (uint256 i = 0; i < 3; i++) {
            compound = (compound * compound) / 1e18;
            if (compound <= 1e18) break;
        }

        return compound;
    }

    function getReserveData() external view override returns (ReserveData memory) {
        return reserveData;
    }

    function updateInterestRateModel(address newModel) external onlyOwner {
        interestRateModel = IInterestRateModel(newModel);
        reserveData.interestRateModel = newModel;
    }

    function setReserveActive(bool active) external onlyOwner {
        reserveData.isActive = active;
    }

    function addLiquidity(uint256 amount) external nonReentrant {
        require(reserveData.isActive, "Reserve is not active");
        reserveData.availableLiquidity += amount;
        reserveData.totalSupply += amount;
    }

    function removeLiquidity(uint256 amount) external nonReentrant {
        require(reserveData.isActive, "Reserve is not active");
        require(amount <= reserveData.availableLiquidity, "Insufficient liquidity");
        reserveData.availableLiquidity -= amount;
        reserveData.totalSupply -= amount;
    }

    function addBorrow(uint256 amount) external nonReentrant {
        require(reserveData.isActive, "Reserve is not active");
        require(amount <= reserveData.availableLiquidity, "Insufficient liquidity");
        reserveData.availableLiquidity -= amount;
        reserveData.totalBorrows += amount;
    }

    function repayBorrow(uint256 amount) external nonReentrant {
        require(reserveData.isActive, "Reserve is not active");
        reserveData.availableLiquidity += amount;
        reserveData.totalBorrows = reserveData.totalBorrows > amount ?
            reserveData.totalBorrows - amount : 0;
    }
}