// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library LiquidationMath {
    uint256 public constant PRECISION = 1e18;
    uint256 public constant LIQUIDATION_CLOSE_FACTOR = 0.5e18;

    function calculateHealthFactor(
        uint256 collateralValue,
        uint256 debtValue,
        uint256 liquidationThreshold
    ) internal pure returns (uint256) {
        if (debtValue == 0) return type(uint256).max;
        // Return health factor in 18 decimal precision
        return (collateralValue * liquidationThreshold) / debtValue;
    }

    function isLiquidatable(uint256 healthFactor) internal pure returns (bool) {
        return healthFactor < PRECISION;
    }

    function calculateLiquidationAmounts(
        uint256 debtToCover,
        uint256 totalDebt,
        uint256 totalCollateral,
        uint256 liquidationBonus
    ) internal pure returns (uint256 collateralToLiquidate, uint256 actualDebtCovered) {
        uint256 maxDebtToCover = (totalDebt * LIQUIDATION_CLOSE_FACTOR) / PRECISION;
        actualDebtCovered = debtToCover > maxDebtToCover ? maxDebtToCover : debtToCover;

        collateralToLiquidate = (actualDebtCovered * totalCollateral * (PRECISION + liquidationBonus)) /
            (totalDebt * PRECISION);
    }

    function calculateCollateralValue(
        uint256 collateralAmount,
        uint256 collateralPrice,
        uint256 collateralDecimals
    ) internal pure returns (uint256) {
        return (collateralAmount * collateralPrice) / (10 ** collateralDecimals);
    }

    function calculateDebtValue(
        uint256 debtAmount,
        uint256 debtPrice,
        uint256 debtDecimals
    ) internal pure returns (uint256) {
        return (debtAmount * debtPrice) / (10 ** debtDecimals);
    }

    function calculateMaxBorrow(
        uint256 collateralValue,
        uint256 collateralFactor,
        uint256 currentDebt
    ) internal pure returns (uint256) {
        uint256 maxBorrowValue = (collateralValue * collateralFactor) / PRECISION;
        return maxBorrowValue > currentDebt ? maxBorrowValue - currentDebt : 0;
    }
}