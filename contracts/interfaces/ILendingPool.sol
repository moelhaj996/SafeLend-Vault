// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILendingPool {
    struct ReserveData {
        uint256 totalSupply;
        uint256 totalBorrows;
        uint256 availableLiquidity;
        uint256 utilizationRate;
        uint256 borrowRate;
        uint256 supplyRate;
        uint256 lastUpdateTimestamp;
        address interestRateModel;
        bool isActive;
    }

    event ReserveDataUpdated(
        uint256 totalSupply,
        uint256 totalBorrows,
        uint256 utilizationRate,
        uint256 borrowRate,
        uint256 supplyRate
    );

    function updateReserveData() external;
    function calculateInterest(address user) external view returns (uint256);
    function getReserveData() external view returns (ReserveData memory);
    function accrueInterest() external;
}