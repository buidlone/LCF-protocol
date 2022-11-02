import {ethers, network} from "hardhat";
import {availableTestnetChains} from "../../hardhat-helper-config";
import {BigNumber} from "ethers";
import {InvestmentPoolFactoryMock} from "../../typechain-types";

let investmentPoolFactory: InvestmentPoolFactoryMock;
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

    const wrappedEther = "0x5943f705abb6834cad767e6e4bb258bc48d9c947";
    const seedFundingLimit: BigNumber = ethers.utils.parseEther("0.001");
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

    investmentPoolFactory = await ethers.getContractAt(
        "InvestmentPoolFactoryMock",
        "0xC87A724d82ED5b7D6530c5Ed8392C74Dc49D234b"
    );

    const creationTx = await investmentPoolFactory.connect(deployer).createInvestmentPool(
        wrappedEther,
        seedFundingLimit,
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
