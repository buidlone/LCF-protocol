import {ethers, network} from "hardhat";
import {BigNumber} from "ethers";
import {networkConfig} from "../../../hardhat-helper-config";
import {formatPercentage} from "../../format-percentage";

export const testProjectDetails = async (): Promise<
    [BigNumber, BigNumber, BigNumber, BigNumber, number, number, any, string]
> => {
    const chainId = network.config.chainId as number;
    const acceptedSuperToken = networkConfig[chainId].nativeSuperToken;

    const softCap: BigNumber = ethers.utils.parseEther("0.01");
    const hardCap: BigNumber = ethers.utils.parseEther("0.02");
    const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
    const tokenRewards: BigNumber = ethers.utils.parseEther("15000000");
    const twoMonthsInSeconds: number = 60 * 60 * 24 * 30 * 2;
    const fundraiserStartDate: number = Math.round(new Date().getTime() / 1000) + 10 * 60; // current time + 5 minutes
    const fundraiserEndDate: number = fundraiserStartDate + twoMonthsInSeconds; // campaignStartDate + 2 months
    const milestonesCount: number = 10;
    const seedPercentage: number = formatPercentage(10) / milestonesCount;
    const streamPercentage: number = formatPercentage(90) / milestonesCount;

    let milestones = [];
    for (let i = 0; i < milestonesCount; i++) {
        milestones.push({
            startDate: fundraiserEndDate + i * twoMonthsInSeconds,
            endDate: fundraiserEndDate + (i + 1) * twoMonthsInSeconds,
            intervalSeedPortion: seedPercentage,
            intervalStreamingPortion: streamPercentage,
        });
    }

    return [
        softCap,
        hardCap,
        gelatoFeeAllocation,
        tokenRewards,
        fundraiserStartDate,
        fundraiserEndDate,
        milestones,
        acceptedSuperToken,
    ];
};
