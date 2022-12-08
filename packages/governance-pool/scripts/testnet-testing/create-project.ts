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

    const softCap: BigNumber = ethers.utils.parseEther("0.001");
    const hardCap: BigNumber = ethers.utils.parseEther("0.002");
    const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
    const campaignStartDate: number = Math.round(new Date().getTime() / 1000) + 5 * 60; // current time + 5 minutes
    const campaignEndDate: number = campaignStartDate + 15 * 60; // campaignStartDate + 15 minutes
    const milestone1StartDate: number = campaignEndDate; // = campaignStartDate
    const milestone1EndDate: number = milestone1StartDate + 60 * 60 * 2; // milestone1StartDate + 2 hours
    const milestone2StartDate: number = milestone1EndDate; // = milestone1EndDate
    const milestone2EndDate: number = milestone2StartDate + 60 * 60 * 2; // milestone2StartDate + 2 hours
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
        "InvestmentPoolFactoryTestMock",
        "<address>",
        softCap,
        hardCap,
        campaignStartDate,
        campaignEndDate,
        milestones,
        gelatoFeeAllocation
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
