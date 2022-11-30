import {ethers, network} from "hardhat";
import {availableTestnetChains, networkConfig} from "../../hardhat-helper-config";
import {verify} from "../verify";
import {
    VotingToken,
    GovernancePool,
    InvestmentPoolFactory,
    InvestmentPool,
} from "../../typechain-types";

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        console.log("Network is not available for deployment.");
        return;
    }

    console.log("-----Deploying contracts-----");
    const accounts = await ethers.getSigners();
    const deployer = accounts[0];
    const chainId = network.config.chainId as number;
    const gelatoOpsAddress: string = networkConfig[chainId].gelatoOps;
    const superfluidHostAddress: string = networkConfig[chainId].superfluidHost;
    const blockConfirmations: number = networkConfig[chainId].blockConfirmations;

    /******************************************
     * 1. Deploy investment pool logic contract
     *****************************************/
    console.log("Deploying investment pool logic...");
    const investmentPoolDep = await ethers.getContractFactory("InvestmentPool", deployer);
    const investmentPool: InvestmentPool = await investmentPoolDep.deploy();
    await investmentPool.deployed();
    console.log("Investment pool logic address: ", investmentPool.address);
    // Verify
    await investmentPool.deployTransaction.wait(blockConfirmations);
    await verify(investmentPool.address, []);

    /******************************************
     * 2. Deploy governance pool logic contract
     *****************************************/
    console.log("Deploying governance pool logic...");
    const governancePoolDep = await ethers.getContractFactory("GovernancePool", deployer);
    const governancePool: GovernancePool = await governancePoolDep.deploy();
    await governancePool.deployed();
    console.log("Governance pool logic address: ", governancePool.address);
    // Verify
    await governancePool.deployTransaction.wait(blockConfirmations);
    await verify(governancePool.address, []);

    /******************************************
     * 3. Deploy voting token
     *****************************************/
    console.log("Deploying voting token contract...");
    const votingTokensDep = await ethers.getContractFactory("VotingToken", deployer);
    const votingToken: VotingToken = await votingTokensDep.deploy();
    await votingToken.deployed();
    console.log("Voting token address: ", votingToken.address);
    // Verify
    await votingToken.deployTransaction.wait(blockConfirmations);
    await verify(votingToken.address, []);

    /******************************************
     * 4. Deploy investment pool factory contract
     *****************************************/
    console.log("Deploying investment pool factory...");
    const investmentPoolFactoryDep = await ethers.getContractFactory(
        "InvestmentPoolFactory",
        deployer
    );
    const investmentPoolFactory: InvestmentPoolFactory = await investmentPoolFactoryDep.deploy(
        superfluidHostAddress,
        gelatoOpsAddress,
        investmentPool.address,
        governancePool.address,
        votingToken.address
    );
    await investmentPoolFactory.deployed();
    console.log("Investment pool factory address: ", investmentPoolFactory.address);
    // Verify
    await investmentPoolFactory.deployTransaction.wait(blockConfirmations);
    await verify(investmentPoolFactory.address, [
        superfluidHostAddress,
        gelatoOpsAddress,
        investmentPool.address,
        governancePool.address,
        votingToken.address,
    ]);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
