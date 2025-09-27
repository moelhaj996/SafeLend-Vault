// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISafeLendVault {
    struct Position {
        uint256 collateralAmount;
        uint256 borrowedAmount;
        uint256 lastInterestUpdate;
        uint256 accumulatedInterest;
    }

    struct VaultConfig {
        uint256 collateralFactor;
        uint256 liquidationThreshold;
        uint256 liquidationBonus;
        uint256 reserveFactor;
        address interestRateModel;
        address oracle;
        bool isPaused;
        bool liquidationEnabled;
    }

    event Deposit(address indexed user, uint256 amount, uint256 shares);
    event Withdraw(address indexed user, uint256 amount, uint256 shares);
    event Borrow(address indexed user, uint256 amount);
    event Repay(address indexed user, uint256 amount);
    event Liquidation(
        address indexed liquidator,
        address indexed borrower,
        uint256 debtCovered,
        uint256 collateralLiquidated
    );

    function deposit(uint256 amount) external returns (uint256 shares);
    function withdraw(uint256 shares) external returns (uint256 amount);
    function borrow(uint256 amount) external;
    function repay(uint256 amount) external;
    function liquidate(address borrower) external returns (uint256);

    function getPosition(address user) external view returns (Position memory);
    function getTotalSupply() external view returns (uint256);
    function getTotalBorrows() external view returns (uint256);
    function getUtilizationRate() external view returns (uint256);
    function getUserHealthFactor(address user) external view returns (uint256);
}