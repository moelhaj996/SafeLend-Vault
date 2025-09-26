const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());
  console.log("Network:", network);

  console.log("\n1. Deploying MockERC20 token...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("USDC Mock", "USDC", 6);
  await token.deployed();
  console.log("MockERC20 deployed to:", token.address);

  console.log("\n2. Deploying InterestRateModel...");
  const InterestRateModel = await ethers.getContractFactory("InterestRateModel");
  const interestModel = await InterestRateModel.deploy();
  await interestModel.deployed();
  console.log("InterestRateModel deployed to:", interestModel.address);

  console.log("\n3. Deploying SafeLendVault...");
  const SafeLendVault = await ethers.getContractFactory("SafeLendVault");
  const vault = await SafeLendVault.deploy(
    token.address,
    interestModel.address,
    "SafeLend USDC Vault",
    "svUSDC"
  );
  await vault.deployed();
  console.log("SafeLendVault deployed to:", vault.address);

  console.log("\n4. Deploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const lendingPool = await LendingPool.deploy(interestModel.address);
  await lendingPool.deployed();
  console.log("LendingPool deployed to:", lendingPool.address);

  console.log("\n5. Deploying Liquidator...");
  const Liquidator = await ethers.getContractFactory("Liquidator");
  const liquidator = await Liquidator.deploy();
  await liquidator.deployed();
  console.log("Liquidator deployed to:", liquidator.address);

  console.log("\n6. Configuring contracts...");

  console.log("   - Authorizing vault in liquidator...");
  await liquidator.authorizeVault(vault.address, true);

  console.log("   - Granting liquidator role in vault...");
  const LIQUIDATOR_ROLE = await vault.LIQUIDATOR_ROLE();
  await vault.grantRole(LIQUIDATOR_ROLE, liquidator.address);

  console.log("   - Minting initial tokens for testing...");
  const mintAmount = ethers.utils.parseUnits("1000000", 6);
  await token.mint(deployer.address, mintAmount);

  const deploymentData = {
    network: network,
    timestamp: new Date().toISOString(),
    contracts: {
      MockERC20: token.address,
      InterestRateModel: interestModel.address,
      SafeLendVault: vault.address,
      LendingPool: lendingPool.address,
      Liquidator: liquidator.address
    },
    deployer: deployer.address,
    blockNumber: await ethers.provider.getBlockNumber()
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const networkDir = path.join(deploymentsDir, network);
  if (!fs.existsSync(networkDir)) {
    fs.mkdirSync(networkDir);
  }

  const deploymentPath = path.join(networkDir, "deployment.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));

  console.log("\n✅ Deployment complete!");
  console.log("📄 Deployment data saved to:", deploymentPath);

  if (network !== "hardhat" && network !== "localhost") {
    console.log("\n7. Waiting for block confirmations...");
    await new Promise(resolve => setTimeout(resolve, 60000));

    console.log("\n8. Verifying contracts on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: token.address,
        constructorArguments: ["USDC Mock", "USDC", 6],
      });

      await hre.run("verify:verify", {
        address: interestModel.address,
        constructorArguments: [],
      });

      await hre.run("verify:verify", {
        address: vault.address,
        constructorArguments: [
          token.address,
          interestModel.address,
          "SafeLend USDC Vault",
          "svUSDC"
        ],
      });

      await hre.run("verify:verify", {
        address: lendingPool.address,
        constructorArguments: [interestModel.address],
      });

      await hre.run("verify:verify", {
        address: liquidator.address,
        constructorArguments: [],
      });

      console.log("✅ All contracts verified!");
    } catch (error) {
      console.error("❌ Verification failed:", error);
    }
  }

  return deploymentData;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });