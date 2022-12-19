import {ethers, network} from "hardhat";
import {availableTestnetChains} from "../../hardhat-helper-config";
import {BigNumber} from "ethers";
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

    // 1. Deploy Buidl1 token
    const buidl1TokenAddress = await deployBuidl1Token(true);

    const softCap: BigNumber = ethers.utils.parseEther("1500");
    const hardCap: BigNumber = ethers.utils.parseEther("5000");
    const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
    const tokenRewards: BigNumber = ethers.utils.parseEther("15000000");
    const campaignStartDate: number = Math.round(new Date().getTime() / 1000) + 10 * 60; // current time + 5 minutes
    const campaignEndDate: number = campaignStartDate + 60 * 60 * 24 * 30 * 2; // campaignStartDate + 2 months
    const milestone1StartDate: number = campaignEndDate; // = campaignStartDate
    const milestone1EndDate: number = milestone1StartDate + 60 * 60 * 24 * 30 * 2; // milestone1StartDate + 2 months
    const milestone2StartDate: number = milestone1EndDate; // = milestone1EndDate
    const milestone2EndDate: number = milestone2StartDate + 60 * 60 * 24 * 30 * 2; // milestone2StartDate + 2 months
    const milestones = [
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
    ];

    await deployPools(
        "InvestmentPoolFactory",
        "<address>",
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
