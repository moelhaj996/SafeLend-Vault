const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("InterestRateModel", function () {
  async function deployInterestModelFixture() {
    const InterestRateModel = await ethers.getContractFactory("InterestRateModel");
    const model = await InterestRateModel.deploy();
    return { model };
  }

  describe("Utilization Rate", function () {
    it("Should return 0 when no borrows", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("1000");
      const borrows = 0;
      const reserves = 0;

      const utilRate = await model.utilizationRate(cash, borrows, reserves);
      expect(utilRate).to.equal(0);
    });

    it("Should calculate correct utilization rate", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("500");
      const borrows = ethers.parseEther("500");
      const reserves = 0;

      const utilRate = await model.utilizationRate(cash, borrows, reserves);
      expect(utilRate).to.equal(ethers.parseEther("0.5"));
    });

    it("Should handle 100% utilization", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = 0;
      const borrows = ethers.parseEther("1000");
      const reserves = 0;

      const utilRate = await model.utilizationRate(cash, borrows, reserves);
      expect(utilRate).to.equal(ethers.parseEther("1"));
    });

    it("Should account for reserves", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("400");
      const borrows = ethers.parseEther("500");
      const reserves = ethers.parseEther("100");

      const utilRate = await model.utilizationRate(cash, borrows, reserves);
      const expected = (borrows * ethers.parseEther("1")) / (cash + borrows - reserves);
      expect(utilRate).to.equal(expected);
    });
  });

  describe("Borrow Rate", function () {
    it("Should return base rate at 0% utilization", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("1000");
      const borrows = 0;
      const reserves = 0;

      const borrowRate = await model.getBorrowRate(cash, borrows, reserves);
      const baseRate = await model.BASE_RATE_PER_YEAR();
      expect(borrowRate).to.equal(baseRate);
    });

    it("Should apply normal rate below kink", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("500");
      const borrows = ethers.parseEther("500");
      const reserves = 0;

      const borrowRate = await model.getBorrowRate(cash, borrows, reserves);
      const baseRate = await model.BASE_RATE_PER_YEAR();
      const multiplier = await model.MULTIPLIER_PER_YEAR();

      const utilRate = ethers.parseEther("0.5");
      const expected = (utilRate * multiplier) / ethers.parseEther("1") + baseRate;
      expect(borrowRate).to.equal(expected);
    });

    it("Should apply jump rate above kink", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("100");
      const borrows = ethers.parseEther("900");
      const reserves = 0;

      const borrowRate = await model.getBorrowRate(cash, borrows, reserves);
      const baseRate = await model.BASE_RATE_PER_YEAR();
      const multiplier = await model.MULTIPLIER_PER_YEAR();
      const jumpMultiplier = await model.JUMP_MULTIPLIER_PER_YEAR();
      const kink = await model.KINK();

      const utilRate = ethers.parseEther("0.9");
      const normalRate = (kink * multiplier) / ethers.parseEther("1") + baseRate;
      const excessUtil = utilRate - kink;
      const expected = (excessUtil * jumpMultiplier) / ethers.parseEther("1") + normalRate;

      expect(borrowRate).to.equal(expected);
    });

    it("Should handle exactly at kink utilization", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("200");
      const borrows = ethers.parseEther("800");
      const reserves = 0;

      const borrowRate = await model.getBorrowRate(cash, borrows, reserves);
      const baseRate = await model.BASE_RATE_PER_YEAR();
      const multiplier = await model.MULTIPLIER_PER_YEAR();
      const kink = await model.KINK();

      const expected = (kink * multiplier) / ethers.parseEther("1") + baseRate;
      expect(borrowRate).to.equal(expected);
    });
  });

  describe("Supply Rate", function () {
    it("Should return 0 at 0% utilization", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("1000");
      const borrows = 0;
      const reserves = 0;
      const reserveFactor = ethers.parseEther("0.1");

      const supplyRate = await model.getSupplyRate(cash, borrows, reserves, reserveFactor);
      expect(supplyRate).to.equal(0);
    });

    it("Should calculate correct supply rate", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("500");
      const borrows = ethers.parseEther("500");
      const reserves = 0;
      const reserveFactor = ethers.parseEther("0.1");

      const supplyRate = await model.getSupplyRate(cash, borrows, reserves, reserveFactor);
      const borrowRate = await model.getBorrowRate(cash, borrows, reserves);
      const utilRate = await model.utilizationRate(cash, borrows, reserves);

      const oneMinusReserveFactor = ethers.parseEther("1") - reserveFactor;
      const rateToPool = (borrowRate * oneMinusReserveFactor) / ethers.parseEther("1");
      const expected = (utilRate * rateToPool) / ethers.parseEther("1");

      expect(supplyRate).to.equal(expected);
    });

    it("Should decrease with higher reserve factor", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("500");
      const borrows = ethers.parseEther("500");
      const reserves = 0;

      const supplyRate1 = await model.getSupplyRate(cash, borrows, reserves, ethers.parseEther("0.1"));
      const supplyRate2 = await model.getSupplyRate(cash, borrows, reserves, ethers.parseEther("0.2"));

      expect(supplyRate1).to.be.gt(supplyRate2);
    });

    it("Should handle 0 reserve factor", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("500");
      const borrows = ethers.parseEther("500");
      const reserves = 0;
      const reserveFactor = 0;

      const supplyRate = await model.getSupplyRate(cash, borrows, reserves, reserveFactor);
      const borrowRate = await model.getBorrowRate(cash, borrows, reserves);
      const utilRate = await model.utilizationRate(cash, borrows, reserves);

      const expected = (utilRate * borrowRate) / ethers.parseEther("1");
      expect(supplyRate).to.equal(expected);
    });
  });

  describe("Per Block Rates", function () {
    it("Should convert annual rate to per block", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("500");
      const borrows = ethers.parseEther("500");
      const reserves = 0;

      const annualRate = await model.getBorrowRate(cash, borrows, reserves);
      const perBlockRate = await model.getBorrowRatePerBlock(cash, borrows, reserves);

      const secondsPerYear = 365 * 24 * 60 * 60;
      const blocksPerYear = secondsPerYear / 12;
      const expectedPerBlock = annualRate / BigInt(blocksPerYear);

      expect(perBlockRate).to.equal(expectedPerBlock);
    });

    it("Should calculate supply rate per block", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("500");
      const borrows = ethers.parseEther("500");
      const reserves = 0;
      const reserveFactor = ethers.parseEther("0.1");

      const annualRate = await model.getSupplyRate(cash, borrows, reserves, reserveFactor);
      const perBlockRate = await model.getSupplyRatePerBlock(cash, borrows, reserves, reserveFactor);

      const secondsPerYear = 365 * 24 * 60 * 60;
      const blocksPerYear = secondsPerYear / 12;
      const expectedPerBlock = annualRate / BigInt(blocksPerYear);

      expect(perBlockRate).to.equal(expectedPerBlock);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle very small amounts", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = 1;
      const borrows = 1;
      const reserves = 0;

      const utilRate = await model.utilizationRate(cash, borrows, reserves);
      const borrowRate = await model.getBorrowRate(cash, borrows, reserves);

      expect(utilRate).to.equal(ethers.parseEther("0.5"));
      expect(borrowRate).to.be.gt(0);
    });

    it("Should handle very large amounts", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = ethers.parseEther("1000000000");
      const borrows = ethers.parseEther("500000000");
      const reserves = 0;

      const utilRate = await model.utilizationRate(cash, borrows, reserves);
      const borrowRate = await model.getBorrowRate(cash, borrows, reserves);

      expect(utilRate).to.be.lte(ethers.parseEther("1"));
      expect(borrowRate).to.be.gt(0);
    });

    it("Should handle max utilization", async function () {
      const { model } = await loadFixture(deployInterestModelFixture);
      const cash = 0;
      const borrows = ethers.MaxUint256 / 2n;
      const reserves = 0;

      await expect(model.utilizationRate(cash, borrows, reserves))
        .to.be.revertedWith("Calculation overflow");
    });
  });
});