import {ethers, network} from "hardhat";
import {availableTestnetChains} from "../../hardhat-helper-config";
import {BigNumber} from "ethers";
import {deployPools} from "../deployment-outlines/deploy-pools";

const percentageDivider: number = 10 ** 6;

const percentToIpBigNumber = (percent: number): number => {
    return (percentageDivider * percent) / 100;
};

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        console.log("Network is not available for deployment.");
        return;
    }

    const softCap: BigNumber = ethers.utils.parseEther("0.01");
    const hardCap: BigNumber = ethers.utils.parseEther("0.02");
    const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
    const tokenRewards: BigNumber = ethers.utils.parseEther("0.001");
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

    await deployPools(
        "InvestmentPoolFactoryMock",
        "<address>",
        "DistributionPoolMock",
        softCap,
        hardCap,
        campaignStartDate,
        campaignEndDate,
        milestones,
        gelatoFeeAllocation,
        tokenRewards
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
