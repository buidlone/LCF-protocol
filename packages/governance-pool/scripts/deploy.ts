import {ethers, network} from "hardhat";
import {availableTestnetChains, networkConfig} from "../hardhat-helper-config";
import {verify} from "./verify";
import {
    VotingToken,
    GovernancePool,
    InvestmentPoolFactory,
    InvestmentPool,
} from "../typechain-types";

let gelatoOpsAddress: string;
let superfluidHostAddress: string;
let investmentPoolFactory: InvestmentPoolFactory;
let investmentPool: InvestmentPool;
let governancePool: GovernancePool;
let votingToken: VotingToken;

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        console.log("Network is not available for deployment.");
        return;
    }

    console.log("-----Deploying contracts-----");
    const accounts = await ethers.getSigners();
    const deployer = accounts[0];
    const chainId = network.config.chainId as number;
    gelatoOpsAddress = networkConfig[chainId].gelatoOps;
    superfluidHostAddress = networkConfig[chainId].superfluidHost;

    // Deploy investment pool logic contract
    console.log("Deploying investment pool logic...");
    const investmentPoolDep = await ethers.getContractFactory("InvestmentPool", deployer);
    investmentPool = await investmentPoolDep.deploy();
    await investmentPool.deployed();
    console.log("Investment pool logic address: ", investmentPool.address);
    await investmentPool.deployTransaction.wait(6);
    await verify(investmentPool.address, []);

    // Deploy investment pool factory contract
    console.log("Deploying investment pool factory...");
    const investmentPoolFactoryDep = await ethers.getContractFactory(
        "InvestmentPoolFactory",
        deployer
    );
    investmentPoolFactory = await investmentPoolFactoryDep.deploy(
        superfluidHostAddress,
        gelatoOpsAddress,
        investmentPool.address
    );
    await investmentPoolFactory.deployed();
    console.log("Investment pool factory address: ", investmentPoolFactory.address);
    await investmentPoolFactory.deployTransaction.wait(6);
    await verify(investmentPoolFactory.address, [
        superfluidHostAddress,
        gelatoOpsAddress,
        investmentPool.address,
    ]);

    // Deploy voting token
    console.log("Deploying voting token contract...");
    const votingTokensDep = await ethers.getContractFactory("VotingToken", deployer);
    votingToken = await votingTokensDep.deploy();
    await votingToken.deployed();
    console.log("Voting token address: ", votingToken.address);

    // Deploy governance pool
    console.log("Deploying governance pool...");
    const governancePoolDep = await ethers.getContractFactory("GovernancePool", deployer);
    governancePool = await governancePoolDep.deploy(
        votingToken.address,
        investmentPoolFactory.address,
        51, // Votes threshold
        10 // Max investments for investor per investmentPool pool
    );
    await governancePool.deployed();
    console.log("Governance pool address: ", governancePool.address);
    await governancePool.deployTransaction.wait(6);
    await verify(governancePool.address, [
        votingToken.address,
        investmentPoolFactory.address,
        51,
        10,
    ]);

    // Transfer ownership to governance pool
    console.log("Transfering voting token ownership to governance pool...");
    const tokenTx = await votingToken.connect(deployer).transferOwnership(governancePool.address);
    await tokenTx.wait();

    // Assign governance pool to the IPF
    console.log("Setting governance pool address in investment pool factory...");
    const ipFactoryTx = await investmentPoolFactory
        .connect(deployer)
        .setGovernancePool(governancePool.address);
    await ipFactoryTx.wait();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
