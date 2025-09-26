// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IInterestRateModel.sol";

contract InterestRateModel is IInterestRateModel {
    uint256 public constant BASE_RATE_PER_YEAR = 0.02e18;
    uint256 public constant MULTIPLIER_PER_YEAR = 0.1e18;
    uint256 public constant JUMP_MULTIPLIER_PER_YEAR = 0.5e18;
    uint256 public constant KINK = 0.8e18;
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    function utilizationRate(
        uint256 cash,
        uint256 borrows,
        uint256 reserves
    ) public pure override returns (uint256) {
        if (borrows == 0) {
            return 0;
        }

        uint256 totalSupply = cash + borrows - reserves;
        if (totalSupply == 0) {
            return 0;
        }

        // Prevent overflow in multiplication
        require(borrows <= type(uint256).max / 1e18, "Calculation overflow");

        return (borrows * 1e18) / totalSupply;
    }

    function getBorrowRate(
        uint256 cash,
        uint256 borrows,
        uint256 reserves
    ) public view override returns (uint256) {
        uint256 util = utilizationRate(cash, borrows, reserves);

        if (util <= KINK) {
            return (util * MULTIPLIER_PER_YEAR) / 1e18 + BASE_RATE_PER_YEAR;
        } else {
            uint256 normalRate = (KINK * MULTIPLIER_PER_YEAR) / 1e18 + BASE_RATE_PER_YEAR;
            uint256 excessUtil = util - KINK;
            return (excessUtil * JUMP_MULTIPLIER_PER_YEAR) / 1e18 + normalRate;
        }
    }

    function getSupplyRate(
        uint256 cash,
        uint256 borrows,
        uint256 reserves,
        uint256 reserveFactor
    ) public view override returns (uint256) {
        uint256 oneMinusReserveFactor = 1e18 - reserveFactor;
        uint256 borrowRate = getBorrowRate(cash, borrows, reserves);
        uint256 rateToPool = (borrowRate * oneMinusReserveFactor) / 1e18;
        return (utilizationRate(cash, borrows, reserves) * rateToPool) / 1e18;
    }

    function getBorrowRatePerBlock(
        uint256 cash,
        uint256 borrows,
        uint256 reserves
    ) external view returns (uint256) {
        return getBorrowRate(cash, borrows, reserves) / (SECONDS_PER_YEAR / 12);
    }

    function getSupplyRatePerBlock(
        uint256 cash,
        uint256 borrows,
        uint256 reserves,
        uint256 reserveFactor
    ) external view returns (uint256) {
        return getSupplyRate(cash, borrows, reserves, reserveFactor) / (SECONDS_PER_YEAR / 12);
    }
}