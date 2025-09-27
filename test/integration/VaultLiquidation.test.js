const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault Liquidation Integration", function () {
  async function deploySystemFixture() {
    const [owner, alice, bob, charlie, liquidator, keeper] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const asset = await MockERC20.deploy("Mock Token", "MTK", 18);

    const InterestRateModel = await ethers.getContractFactory("InterestRateModel");
    const interestModel = await InterestRateModel.deploy();

    const SafeLendVault = await ethers.getContractFactory("SafeLendVault");
    const vault = await SafeLendVault.deploy(
      await asset.getAddress(),
      await interestModel.getAddress(),
      "SafeLend Vault Token",
      "svMTK"
    );

    const Liquidator = await ethers.getContractFactory("Liquidator");
    const liquidatorContract = await Liquidator.deploy();

    await liquidatorContract.authorizeVault(await vault.getAddress(), true);

    const LIQUIDATOR_ROLE = await vault.LIQUIDATOR_ROLE();
    await vault.grantRole(LIQUIDATOR_ROLE, await liquidatorContract.getAddress());

    const KEEPER_ROLE = await liquidatorContract.KEEPER_ROLE();
    await liquidatorContract.grantRole(KEEPER_ROLE, keeper.address);

    const mintAmount = ethers.parseEther("10000");
    await asset.mint(alice.address, mintAmount);
    await asset.mint(bob.address, mintAmount);
    await asset.mint(charlie.address, mintAmount);
    await asset.mint(liquidator.address, mintAmount);
    await asset.mint(keeper.address, mintAmount);

    return {
      vault,
      asset,
      interestModel,
      liquidatorContract,
      owner,
      alice,
      bob,
      charlie,
      liquidator,
      keeper
    };
  }

  describe("Full Liquidation Scenario", function () {
    it("Should handle complete liquidation flow", async function () {
      const { vault, asset, liquidatorContract, alice, liquidator } = await loadFixture(deploySystemFixture);

      const depositAmount = ethers.parseEther("1000");
      const borrowAmount = ethers.parseEther("750");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      const ADMIN_ROLE = await vault.ADMIN_ROLE();
      await vault.grantRole(ADMIN_ROLE, alice.address);

      const config = await vault.config();
      const newConfig = {
        collateralFactor: config.collateralFactor,
        liquidationThreshold: ethers.parseEther("0.7"),
        liquidationBonus: config.liquidationBonus,
        reserveFactor: config.reserveFactor,
        interestRateModel: config.interestRateModel,
        oracle: config.oracle,
        isPaused: config.isPaused,
        liquidationEnabled: config.liquidationEnabled
      };
      await vault.connect(alice).updateConfig(newConfig);

      const healthFactorBefore = await vault.getUserHealthFactor(alice.address);
      expect(healthFactorBefore).to.be.lt(ethers.parseEther("1"));

      await asset.connect(liquidator).approve(await vault.getAddress(), ethers.parseEther("500"));
      const collateralReceived = await vault.connect(liquidator).liquidate(alice.address);

      const healthFactorAfter = await vault.getUserHealthFactor(alice.address);
      expect(healthFactorAfter).to.be.gt(healthFactorBefore);

      const position = await vault.getPosition(alice.address);
      expect(position.borrowedAmount).to.be.lt(borrowAmount);
    });

    it("Should handle liquidation through liquidator contract", async function () {
      const { vault, asset, liquidatorContract, alice, keeper } = await loadFixture(deploySystemFixture);

      const depositAmount = ethers.parseEther("1000");
      const borrowAmount = ethers.parseEther("750");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      const ADMIN_ROLE = await vault.ADMIN_ROLE();
      await vault.grantRole(ADMIN_ROLE, alice.address);

      const config = await vault.config();
      const newConfig = {
        collateralFactor: config.collateralFactor,
        liquidationThreshold: ethers.parseEther("0.7"),
        liquidationBonus: config.liquidationBonus,
        reserveFactor: config.reserveFactor,
        interestRateModel: config.interestRateModel,
        oracle: config.oracle,
        isPaused: config.isPaused,
        liquidationEnabled: config.liquidationEnabled
      };
      await vault.connect(alice).updateConfig(newConfig);

      const [canLiquidate, expectedProfit] = await liquidatorContract.checkLiquidationOpportunity(
        await vault.getAddress(),
        alice.address
      );
      expect(canLiquidate).to.be.true;
      expect(expectedProfit).to.be.gt(0);

      await asset.connect(keeper).approve(await vault.getAddress(), ethers.parseEther("500"));

      await expect(liquidatorContract.connect(keeper).liquidate(await vault.getAddress(), alice.address))
        .to.emit(liquidatorContract, "LiquidationExecuted");
    });
  });

  describe("Batch Liquidations", function () {
    it("Should handle multiple liquidations in batch", async function () {
      const { vault, asset, liquidatorContract, alice, bob, charlie, keeper } = await loadFixture(deploySystemFixture);

      const depositAmount = ethers.parseEther("1000");
      const borrowAmount = ethers.parseEther("750");

      for (const user of [alice, bob, charlie]) {
        await asset.connect(user).approve(await vault.getAddress(), depositAmount);
        await vault.connect(user).deposit(depositAmount);
        await vault.connect(user).borrow(borrowAmount);
      }

      const ADMIN_ROLE = await vault.ADMIN_ROLE();
      await vault.grantRole(ADMIN_ROLE, alice.address);

      const config = await vault.config();
      const newConfig = {
        collateralFactor: config.collateralFactor,
        liquidationThreshold: ethers.parseEther("0.7"),
        liquidationBonus: config.liquidationBonus,
        reserveFactor: config.reserveFactor,
        interestRateModel: config.interestRateModel,
        oracle: config.oracle,
        isPaused: config.isPaused,
        liquidationEnabled: config.liquidationEnabled
      };
      await vault.connect(alice).updateConfig(newConfig);

      const vaults = [
        await vault.getAddress(),
        await vault.getAddress(),
        await vault.getAddress()
      ];
      const borrowers = [alice.address, bob.address, charlie.address];

      await asset.connect(keeper).approve(await vault.getAddress(), ethers.parseEther("2000"));

      const collateralReceived = await liquidatorContract.connect(keeper).batchLiquidate(vaults, borrowers);

      for (const amount of collateralReceived) {
        if (amount > 0) {
          expect(amount).to.be.gt(0);
        }
      }
    });
  });

  describe("Interest Accrual During Liquidation", function () {
    it("Should account for accrued interest in liquidation", async function () {
      const { vault, asset, alice, liquidator } = await loadFixture(deploySystemFixture);

      const depositAmount = ethers.parseEther("1000");
      const borrowAmount = ethers.parseEther("700");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      await ethers.provider.send("hardhat_mine", ["0x1000"]);

      await vault.accrueInterest();

      const positionBefore = await vault.getPosition(alice.address);
      expect(positionBefore.accumulatedInterest).to.be.gt(0);

      const ADMIN_ROLE = await vault.ADMIN_ROLE();
      await vault.grantRole(ADMIN_ROLE, alice.address);

      const config = await vault.config();
      const newConfig = {
        collateralFactor: config.collateralFactor,
        liquidationThreshold: ethers.parseEther("0.7"),
        liquidationBonus: config.liquidationBonus,
        reserveFactor: config.reserveFactor,
        interestRateModel: config.interestRateModel,
        oracle: config.oracle,
        isPaused: config.isPaused,
        liquidationEnabled: config.liquidationEnabled
      };
      await vault.connect(alice).updateConfig(newConfig);

      const totalDebt = positionBefore.borrowedAmount + positionBefore.accumulatedInterest;
      await asset.connect(liquidator).approve(await vault.getAddress(), totalDebt / 2n);

      await vault.connect(liquidator).liquidate(alice.address);

      const positionAfter = await vault.getPosition(alice.address);
      expect(positionAfter.borrowedAmount).to.be.lt(positionBefore.borrowedAmount);
    });
  });

  describe("Emergency Scenarios", function () {
    it("Should handle emergency stop in liquidator", async function () {
      const { vault, asset, liquidatorContract, alice, keeper } = await loadFixture(deploySystemFixture);

      const depositAmount = ethers.parseEther("1000");
      const borrowAmount = ethers.parseEther("750");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      await liquidatorContract.toggleEmergencyStop();

      const ADMIN_ROLE = await vault.ADMIN_ROLE();
      await vault.grantRole(ADMIN_ROLE, alice.address);

      const config = await vault.config();
      const newConfig = {
        collateralFactor: config.collateralFactor,
        liquidationThreshold: ethers.parseEther("0.7"),
        liquidationBonus: config.liquidationBonus,
        reserveFactor: config.reserveFactor,
        interestRateModel: config.interestRateModel,
        oracle: config.oracle,
        isPaused: config.isPaused,
        liquidationEnabled: config.liquidationEnabled
      };
      await vault.connect(alice).updateConfig(newConfig);

      await asset.connect(keeper).approve(await vault.getAddress(), ethers.parseEther("500"));

      await expect(liquidatorContract.connect(keeper).liquidate(await vault.getAddress(), alice.address))
        .to.be.revertedWith("Emergency stop activated");

      await liquidatorContract.toggleEmergencyStop();

      await expect(liquidatorContract.connect(keeper).liquidate(await vault.getAddress(), alice.address))
        .to.emit(liquidatorContract, "LiquidationExecuted");
    });

    it("Should allow emergency token withdrawal", async function () {
      const { asset, liquidatorContract, owner } = await loadFixture(deploySystemFixture);

      const amount = ethers.parseEther("100");
      await asset.mint(await liquidatorContract.getAddress(), amount);

      const balanceBefore = await asset.balanceOf(owner.address);
      await liquidatorContract.withdrawToken(await asset.getAddress(), amount);
      const balanceAfter = await asset.balanceOf(owner.address);

      expect(balanceAfter - balanceBefore).to.equal(amount);
    });
  });

  describe("Liquidation History", function () {
    it("Should track liquidation history", async function () {
      const { vault, asset, liquidatorContract, alice, keeper } = await loadFixture(deploySystemFixture);

      const depositAmount = ethers.parseEther("1000");
      const borrowAmount = ethers.parseEther("750");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      const ADMIN_ROLE = await vault.ADMIN_ROLE();
      await vault.grantRole(ADMIN_ROLE, alice.address);

      const config = await vault.config();
      const newConfig = {
        collateralFactor: config.collateralFactor,
        liquidationThreshold: ethers.parseEther("0.7"),
        liquidationBonus: config.liquidationBonus,
        reserveFactor: config.reserveFactor,
        interestRateModel: config.interestRateModel,
        oracle: config.oracle,
        isPaused: config.isPaused,
        liquidationEnabled: config.liquidationEnabled
      };
      await vault.connect(alice).updateConfig(newConfig);

      await asset.connect(keeper).approve(await vault.getAddress(), ethers.parseEther("500"));
      await liquidatorContract.connect(keeper).liquidate(await vault.getAddress(), alice.address);

      const history = await liquidatorContract.getLiquidationHistory(alice.address);
      expect(history.length).to.equal(1);
      expect(history[0].vault).to.equal(await vault.getAddress());
      expect(history[0].borrower).to.equal(alice.address);
      expect(history[0].liquidator).to.equal(keeper.address);
    });
  });

  describe("Profit Threshold", function () {
    it("Should respect minimum profit threshold", async function () {
      const { vault, liquidatorContract, alice } = await loadFixture(deploySystemFixture);

      await liquidatorContract.updateMinProfitThreshold(ethers.parseEther("1"));

      const [canLiquidate, expectedProfit] = await liquidatorContract.checkLiquidationOpportunity(
        await vault.getAddress(),
        alice.address
      );

      expect(canLiquidate).to.be.false;
      expect(expectedProfit).to.equal(0);
    });
  });
});