import {ethers, network} from "hardhat";
import {availableTestnetChains, networkConfig} from "../../hardhat-helper-config";
import {BigNumber} from "ethers";
import {InvestmentPoolFactory, VotingToken} from "../../typechain-types";

const percentageDivider: number = 10 ** 6;

const percentToIpBigNumber = (percent: number): number => {
    return (percentageDivider * percent) / 100;
};

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        console.log("Network is not available for deployment.");
        return;
    }
    console.log("-----Creating Investment Pool contract-----");

    const accounts = await ethers.getSigners();
    const deployer = accounts[0];
    const chainId = network.config.chainId as number;
    const nativeSuperToken: string = networkConfig[chainId].nativeSuperToken;

    const softCap: BigNumber = ethers.utils.parseEther("1500");
    const hardCap: BigNumber = ethers.utils.parseEther("5000");
    const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
    const campaignStartDate: number = Math.round(new Date().getTime() / 1000) + 10 * 60; // current time + 5 minutes
    const campaignEndDate: number = campaignStartDate + 60 * 60 * 24 * 30 * 2; // campaignStartDate + 2 months
    const milestone1StartDate: number = campaignEndDate; // = campaignStartDate
    const milestone1EndDate: number = milestone1StartDate + 60 * 60 * 24 * 30 * 2; // milestone1StartDate + 2 months
    const milestone2StartDate: number = milestone1EndDate; // = milestone1EndDate
    const milestone2EndDate: number = milestone2StartDate + 60 * 60 * 24 * 30 * 2; // milestone2StartDate + 2 months

    const investmentPoolFactory: InvestmentPoolFactory = await ethers.getContractAt(
        "InvestmentPoolFactory",
        "<address>"
    );

    /******************************************
     * 1. Create project pools
     *****************************************/
    const creationTx = await investmentPoolFactory.connect(deployer).createProjectPools(
        nativeSuperToken,
        softCap,
        hardCap,
        campaignStartDate,
        campaignEndDate,
        0, // CLONE-PROXY
        [
            {
                startDate: milestone1StartDate,
                endDate: milestone1EndDate,
                intervalSeedPortion: percentToIpBigNumber(5),
                intervalStreamingPortion: percentToIpBigNumber(70),
            },
            {
                startDate: milestone2StartDate,
                endDate: milestone2EndDate,
                intervalSeedPortion: percentToIpBigNumber(5),
                intervalStreamingPortion: percentToIpBigNumber(20),
            },
        ],
        {value: gelatoFeeAllocation}
    );

    const receipt = await creationTx.wait(1);
    const creationEvent = receipt.events?.find((e) => e.event === "Created");
    const ipAddress = creationEvent?.args?.ipContract;
    const gpAddress = creationEvent?.args?.gpContract;

    /******************************************
     * 2. Assign governance pool role to allow minting
     *****************************************/
    const votingTokenAddress = await investmentPoolFactory.getVotingToken();
    const votingToken: VotingToken = await ethers.getContractAt("VotingToken", votingTokenAddress);
    const governancePoolRole: string = await votingToken.GOVERNANCE_POOL_ROLE();
    await votingToken.connect(deployer).grantRole(governancePoolRole, gpAddress);

    console.log("Created Investment Pool at address: ", ipAddress);
    console.log("Created Governance Pool at address: ", gpAddress);
    console.log("---Timeline---");
    console.log("Fundraiser start date: ", new Date(campaignStartDate * 1000));
    console.log("Fundraiser end date: ", new Date(campaignEndDate * 1000));
    console.log("Milestone (id 0) start date: ", new Date(milestone1StartDate * 1000));
    console.log("Milestone (id 0) end date: ", new Date(milestone1EndDate * 1000));
    console.log("Milestone (id 1) start date: ", new Date(milestone2StartDate * 1000));
    console.log("Milestone (id 1) end date: ", new Date(milestone2EndDate * 1000));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
