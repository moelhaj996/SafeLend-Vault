const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("SafeLendVault", function () {
  async function deployVaultFixture() {
    const [owner, alice, bob, charlie, liquidator] = await ethers.getSigners();

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

    const mintAmount = ethers.parseEther("1000000");
    await asset.mint(owner.address, mintAmount);
    await asset.mint(alice.address, mintAmount);
    await asset.mint(bob.address, mintAmount);
    await asset.mint(charlie.address, mintAmount);
    await asset.mint(liquidator.address, mintAmount);

    return { vault, asset, interestModel, owner, alice, bob, charlie, liquidator };
  }

  describe("Deployment", function () {
    it("Should set the correct asset token", async function () {
      const { vault, asset } = await loadFixture(deployVaultFixture);
      expect(await vault.asset()).to.equal(await asset.getAddress());
    });

    it("Should set correct roles", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      const ADMIN_ROLE = await vault.ADMIN_ROLE();
      expect(await vault.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should initialize with correct config", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      const config = await vault.config();
      expect(config.collateralFactor).to.equal(ethers.parseEther("0.75"));
      expect(config.liquidationThreshold).to.equal(ethers.parseEther("0.8"));
      expect(config.liquidationBonus).to.equal(ethers.parseEther("0.05"));
    });
  });

  describe("Deposit", function () {
    it("Should allow deposits and mint shares", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await expect(vault.connect(alice).deposit(depositAmount))
        .to.emit(vault, "Deposit")
        .withArgs(alice.address, depositAmount, depositAmount);

      expect(await vault.balanceOf(alice.address)).to.equal(depositAmount);
    });

    it("Should revert on zero deposit", async function () {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(alice).deposit(0))
        .to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should calculate shares correctly for subsequent deposits", async function () {
      const { vault, asset, alice, bob } = await loadFixture(deployVaultFixture);
      const firstDeposit = ethers.parseEther("100");
      const secondDeposit = ethers.parseEther("50");

      await asset.connect(alice).approve(await vault.getAddress(), firstDeposit);
      await vault.connect(alice).deposit(firstDeposit);

      await asset.connect(bob).approve(await vault.getAddress(), secondDeposit);
      await vault.connect(bob).deposit(secondDeposit);

      expect(await vault.balanceOf(bob.address)).to.equal(secondDeposit);
    });
  });

  describe("Withdraw", function () {
    it("Should allow withdrawals and burn shares", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);

      const shares = await vault.balanceOf(alice.address);
      await expect(vault.connect(alice).withdraw(shares))
        .to.emit(vault, "Withdraw")
        .withArgs(alice.address, depositAmount, shares);

      expect(await vault.balanceOf(alice.address)).to.equal(0);
    });

    it("Should revert on insufficient shares", async function () {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(alice).withdraw(ethers.parseEther("100")))
        .to.be.revertedWith("Insufficient shares");
    });

    it("Should prevent withdrawal that makes position undercollateralized", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("50");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      const shares = await vault.balanceOf(alice.address);
      await expect(vault.connect(alice).withdraw(shares))
        .to.be.revertedWith("Withdrawal would make position undercollateralized");
    });
  });

  describe("Borrow", function () {
    it("Should allow borrowing within collateral limits", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("50");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);

      await expect(vault.connect(alice).borrow(borrowAmount))
        .to.emit(vault, "Borrow")
        .withArgs(alice.address, borrowAmount);

      const position = await vault.getPosition(alice.address);
      expect(position.borrowedAmount).to.equal(borrowAmount);
    });

    it("Should revert on exceeding borrow limit", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("80");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);

      await expect(vault.connect(alice).borrow(borrowAmount))
        .to.be.revertedWith("Borrow amount exceeds allowed");
    });

    it("Should revert on insufficient liquidity", async function () {
      const { vault, asset, alice, bob } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(ethers.parseEther("70"));

      await asset.connect(bob).approve(await vault.getAddress(), depositAmount);
      await vault.connect(bob).deposit(depositAmount);

      await expect(vault.connect(bob).borrow(ethers.parseEther("50")))
        .to.be.revertedWith("Insufficient liquidity");
    });
  });

  describe("Repay", function () {
    it("Should allow repaying borrowed amount", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("50");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      await asset.connect(alice).approve(await vault.getAddress(), borrowAmount);
      await expect(vault.connect(alice).repay(borrowAmount))
        .to.emit(vault, "Repay")
        .withArgs(alice.address, borrowAmount);

      const position = await vault.getPosition(alice.address);
      expect(position.borrowedAmount).to.equal(0);
    });

    it("Should handle partial repayments", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("50");
      const repayAmount = ethers.parseEther("20");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      await asset.connect(alice).approve(await vault.getAddress(), repayAmount);
      await vault.connect(alice).repay(repayAmount);

      const position = await vault.getPosition(alice.address);
      expect(position.borrowedAmount).to.equal(borrowAmount - repayAmount);
    });

    it("Should revert on zero repayment", async function () {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(alice).repay(0))
        .to.be.revertedWith("Amount must be greater than 0");
    });
  });

  describe("Liquidation", function () {
    it("Should liquidate undercollateralized positions", async function () {
      const { vault, asset, alice, liquidator } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("75");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      const config = await vault.config();
      const newConfig = {
        ...config,
        liquidationThreshold: ethers.parseEther("0.7")
      };
      const ADMIN_ROLE = await vault.ADMIN_ROLE();
      await vault.grantRole(ADMIN_ROLE, alice.address);
      await vault.connect(alice).updateConfig(newConfig);

      const halfDebt = borrowAmount / 2n;
      await asset.connect(liquidator).approve(await vault.getAddress(), halfDebt);

      await expect(vault.connect(liquidator).liquidate(alice.address))
        .to.emit(vault, "Liquidation");
    });

    it("Should revert liquidation of healthy positions", async function () {
      const { vault, asset, alice, liquidator } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("50");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      await expect(vault.connect(liquidator).liquidate(alice.address))
        .to.be.revertedWith("Position is not liquidatable");
    });
  });

  describe("Interest Accrual", function () {
    it("Should accrue interest over time", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("50");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);
      await vault.connect(alice).borrow(borrowAmount);

      const totalBorrowsBefore = await vault.getTotalBorrows();

      await ethers.provider.send("hardhat_mine", ["0x100"]);
      await vault.accrueInterest();

      const totalBorrowsAfter = await vault.getTotalBorrows();
      expect(totalBorrowsAfter).to.be.gt(totalBorrowsBefore);
    });
  });

  describe("Pause Mechanism", function () {
    it("Should pause and unpause the vault", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");

      await vault.pause();

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await expect(vault.connect(alice).deposit(depositAmount))
        .to.be.revertedWith("Pausable: paused");

      await vault.unpause();
      await vault.connect(alice).deposit(depositAmount);
      expect(await vault.balanceOf(alice.address)).to.equal(depositAmount);
    });

    it("Should only allow admin to pause", async function () {
      const { vault, alice } = await loadFixture(deployVaultFixture);
      const ADMIN_ROLE = await vault.ADMIN_ROLE();

      await expect(vault.connect(alice).pause())
        .to.be.reverted;
    });
  });

  describe("Health Factor", function () {
    it("Should calculate correct health factor", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("50");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);

      let healthFactor = await vault.getUserHealthFactor(alice.address);
      expect(healthFactor).to.equal(ethers.MaxUint256);

      await vault.connect(alice).borrow(borrowAmount);
      healthFactor = await vault.getUserHealthFactor(alice.address);
      expect(healthFactor).to.be.gt(ethers.parseEther("1"));
    });
  });

  describe("Utilization Rate", function () {
    it("Should calculate correct utilization rate", async function () {
      const { vault, asset, alice } = await loadFixture(deployVaultFixture);
      const depositAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("50");

      await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);

      let utilRate = await vault.getUtilizationRate();
      expect(utilRate).to.equal(0);

      await vault.connect(alice).borrow(borrowAmount);
      utilRate = await vault.getUtilizationRate();
      expect(utilRate).to.be.gt(0);
      expect(utilRate).to.equal(ethers.parseEther("0.5"));
    });
  });
});