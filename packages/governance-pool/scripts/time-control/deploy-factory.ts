import {ethers, network} from "hardhat";
import {networkConfig} from "../../hardhat-helper-config";
import {verify} from "../verify";
import {
    VotingToken,
    GovernancePoolMock,
    InvestmentPoolFactoryMock,
    InvestmentPoolMock,
} from "../../typechain-types";

export const deployFactory = async (
    verification: boolean
): Promise<[VotingToken, InvestmentPoolFactoryMock]> => {
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
    const investmentPoolDep = await ethers.getContractFactory("InvestmentPoolMock", deployer);
    const investmentPool: InvestmentPoolMock = await investmentPoolDep.deploy();
    await investmentPool.deployed();
    console.log("Investment pool logic address: ", investmentPool.address);
    // Verify
    if (verification) {
        await investmentPool.deployTransaction.wait(blockConfirmations);
        await verify(investmentPool.address, []);
    }

    /******************************************
     * 2. Deploy governance pool logic contract
     *****************************************/
    console.log("Deploying governance pool logic...");
    const governancePoolDep = await ethers.getContractFactory("GovernancePoolMock", deployer);
    const governancePool: GovernancePoolMock = await governancePoolDep.deploy();
    await governancePool.deployed();
    console.log("Governance pool logic address: ", governancePool.address);
    // Verify
    if (verification) {
        await governancePool.deployTransaction.wait(blockConfirmations);
        await verify(governancePool.address, []);
    }

    /******************************************
     * 3. Deploy voting token
     *****************************************/
    console.log("Deploying voting token contract...");
    const votingTokensDep = await ethers.getContractFactory("VotingToken", deployer);
    const votingToken: VotingToken = await votingTokensDep.deploy();
    await votingToken.deployed();
    console.log("Voting token address: ", votingToken.address);
    // Verify
    if (verification) {
        await votingToken.deployTransaction.wait(blockConfirmations);
        await verify(votingToken.address, []);
    }

    /******************************************
     * 4. Deploy investment pool factory contract
     *****************************************/
    console.log("Deploying investment pool factory...");
    const investmentPoolFactoryDep = await ethers.getContractFactory(
        "InvestmentPoolFactoryMock",
        deployer
    );
    const investmentPoolFactory: InvestmentPoolFactoryMock = await investmentPoolFactoryDep.deploy(
        superfluidHostAddress,
        gelatoOpsAddress,
        investmentPool.address,
        governancePool.address,
        votingToken.address
    );
    await investmentPoolFactory.deployed();
    console.log("Investment pool factory address: ", investmentPoolFactory.address);
    // Verify
    if (verification) {
        await investmentPoolFactory.deployTransaction.wait(blockConfirmations);
        await verify(investmentPoolFactory.address, [
            superfluidHostAddress,
            gelatoOpsAddress,
            investmentPool.address,
            governancePool.address,
            votingToken.address,
        ]);
    }
    return [votingToken, investmentPoolFactory];
};
