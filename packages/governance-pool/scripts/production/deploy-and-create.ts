import {ethers, network} from "hardhat";
import {BigNumber} from "ethers";
import {availableTestnetChains} from "../../hardhat-helper-config";
import {deployFactory} from "../deployment-outlines/deploy-factory";
import {deployPools} from "../deployment-outlines/deploy-pools";
import {deployBuidl1Token} from "../deployment-outlines/deploy-token";

const percentageDivider: number = 10 ** 6;
const percentToIpBigNumber = (percent: number): number => {
    return (percentageDivider * percent) / 100;
};

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        console.log("Network is not available for deployment.");
        return;
    }

    // 1. Deploy logic and factory contracts
    const investmentPoolFactoryAddress = await deployFactory(
        true,
        "InvestmentPoolFactory",
        "InvestmentPool",
        "GovernancePool",
        "DistributionPool",
        "VotingToken"
    );

    // 2. Deploy Buidl1 token
    const buidl1TokenAddress = await deployBuidl1Token(true);

    const softCap: BigNumber = ethers.utils.parseEther("0.01");
    const hardCap: BigNumber = ethers.utils.parseEther("0.02");
    const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
    const tokenRewards: BigNumber = ethers.utils.parseEther("15000000");
    const twoMonthsInSeconds: number = 60 * 60 * 24 * 30 * 2;
    const campaignStartDate: number = Math.round(new Date().getTime() / 1000) + 10 * 60; // current time + 5 minutes
    const campaignEndDate: number = campaignStartDate + twoMonthsInSeconds; // campaignStartDate + 2 months
    const milestonesCount: number = 10;
    const seedPercentage: number = percentToIpBigNumber(10) / milestonesCount;
    const streamPercentage: number = percentToIpBigNumber(90) / milestonesCount;

    let milestones = [];
    for (let i = 0; i < milestonesCount; i++) {
        milestones.push({
            startDate: campaignEndDate + i * twoMonthsInSeconds,
            endDate: campaignEndDate + twoMonthsInSeconds + i * twoMonthsInSeconds,
            intervalSeedPortion: seedPercentage,
            intervalStreamingPortion: streamPercentage,
        });
    }

    await deployPools(
        "InvestmentPoolFactory",
        investmentPoolFactoryAddress,
        "DistributionPool",
        softCap,
        hardCap,
        campaignStartDate,
        campaignEndDate,
        milestones,
        gelatoFeeAllocation,
        tokenRewards,
        null,
        buidl1TokenAddress
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
