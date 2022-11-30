import {ethers, network} from "hardhat";
import {BigNumber} from "ethers";
import {availableTestnetChains} from "../../hardhat-helper-config";
import {deployFactory} from "./deploy-factory";
import {deployProject} from "./deploy-ip-gp";

const percentageDivider: number = 10 ** 6;
const percentToIpBigNumber = (percent: number): number => {
    return (percentageDivider * percent) / 100;
};

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        console.log("Network is not available for deployment.");
        return;
    }

    // 1. Deploy logic and factory
    const [votingToken, investmentPoolFactory] = await deployFactory(true);

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

    // 1. Deploy project contracts
    await deployProject(
        votingToken,
        investmentPoolFactory,
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
