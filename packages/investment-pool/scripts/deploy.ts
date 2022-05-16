// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";

async function main() {

  // Get the contract to deploy
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // ERC20 token for Investment Pool
  const ERC20 = await ethers.getContractFactory("DPatron");
  const deployedERC20 = await ERC20.deploy();
  await deployedERC20.deployed();

  console.log("ERC20 deployed to:", deployedERC20.address);


  // Investment Pool deployment
  const InvestmentContract = await ethers.getContractFactory("Investment");
  const deployedInvestment = await InvestmentContract.deploy(deployedERC20.address);
  await deployedInvestment.deployed();

  console.log("Investment pool deployed to:", deployedInvestment.address);

}


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
