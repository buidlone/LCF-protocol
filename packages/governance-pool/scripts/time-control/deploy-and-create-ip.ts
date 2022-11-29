import {ethers, network} from "hardhat";
import {BigNumber} from "ethers";
import {availableTestnetChains, networkConfig} from "../../hardhat-helper-config";
import {verify} from "../verify";
import {
    VotingToken,
    GovernancePoolMock,
    InvestmentPoolFactoryMock,
    InvestmentPoolMock,
} from "../../typechain-types";

let nativeSuperToken: string;
let gelatoOpsAddress: string;
let superfluidHostAddress: string;
let blockConfirmations: number;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let investmentPool: InvestmentPoolMock;
let governancePool: GovernancePoolMock;
let votingToken: VotingToken;
const percentageDivider: number = 10 ** 6;

const percentToIpBigNumber = (percent: number): number => {
    return (percentageDivider * percent) / 100;
};

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
    nativeSuperToken = networkConfig[chainId].nativeSuperToken;
    blockConfirmations = networkConfig[chainId].blockConfirmations;

    // Deploy investment pool logic contract
    console.log("Deploying investment pool logic...");
    const investmentPoolDep = await ethers.getContractFactory("InvestmentPoolMock", deployer);
    investmentPool = await investmentPoolDep.deploy();
    await investmentPool.deployed();
    console.log("Investment pool logic address: ", investmentPool.address);
    await investmentPool.deployTransaction.wait(blockConfirmations);
    await verify(investmentPool.address, []);

    // Deploy investment pool factory contract
    console.log("Deploying investment pool factory...");
    const investmentPoolFactoryDep = await ethers.getContractFactory(
        "InvestmentPoolFactoryMock",
        deployer
    );
    investmentPoolFactory = await investmentPoolFactoryDep.deploy(
        superfluidHostAddress,
        gelatoOpsAddress,
        investmentPool.address
    );
    await investmentPoolFactory.deployed();
    console.log("Investment pool factory address: ", investmentPoolFactory.address);
    await investmentPoolFactory.deployTransaction.wait(blockConfirmations);
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
    await votingToken.deployTransaction.wait(blockConfirmations);
    await verify(votingToken.address, []);

    // Deploy governance pool
    console.log("Deploying governance pool...");
    const governancePoolDep = await ethers.getContractFactory("GovernancePoolMock", deployer);
    governancePool = await governancePoolDep.deploy(
        votingToken.address,
        investmentPoolFactory.address,
        51, // Votes threshold
        1 // 1% Votes withdraw fee
    );
    await governancePool.deployed();
    console.log("Governance pool address: ", governancePool.address);
    await governancePool.deployTransaction.wait(blockConfirmations);
    await verify(governancePool.address, [
        votingToken.address,
        investmentPoolFactory.address,
        51,
        1,
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

    console.log("-----Creating Investment Pool contract-----");

    const softCap: BigNumber = ethers.utils.parseEther("0.01");
    const hardCap: BigNumber = ethers.utils.parseEther("0.02");
    const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");

    const twoMonthsInSeconds: number = 60 * 60 * 24 * 30 * 2;
    const campaignStartDate: number = Math.round(new Date().getTime() / 1000) + 10 * 60; // current time + 5 minutes
    const campaignEndDate: number = campaignStartDate + twoMonthsInSeconds; // campaignStartDate + 2 months
    const percentagePart1: number = percentToIpBigNumber(0.5);
    const percentagePart2: number = percentToIpBigNumber(9.5);

    let milestones = [];

    for (let i = 0; i < 10; i++) {
        milestones.push({
            startDate: campaignEndDate + i * twoMonthsInSeconds,
            endDate: campaignEndDate + twoMonthsInSeconds + i * twoMonthsInSeconds,
            intervalSeedPortion: percentagePart1,
            intervalStreamingPortion: percentagePart2,
        });
    }

    const creationTx = await investmentPoolFactory.connect(deployer).createInvestmentPool(
        nativeSuperToken,
        softCap,
        hardCap,
        campaignStartDate,
        campaignEndDate,
        0, // CLONE-PROXY
        milestones,
        {value: gelatoFeeAllocation}
    );

    const receipt = await creationTx.wait(1);
    const poolAddress = receipt.events?.find((e) => e.event === "Created")?.args?.pool;

    console.log("Created Investment Pool at address: ", poolAddress);
    console.log("---Timeline---");
    console.log("Fundraiser start date: ", new Date(campaignStartDate * 1000));
    console.log("Fundraiser end date: ", new Date(campaignEndDate * 1000));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
