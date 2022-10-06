import {ethers, network} from "hardhat";
import {availableTestnetChains, networkConfig} from "../hardhat-helper-config";
import {BigNumber} from "ethers";
import {InvestmentPoolFactory} from "../typechain-types";

let investmentPoolFactory: InvestmentPoolFactory;
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
    const softCap: BigNumber = ethers.utils.parseEther("1500");
    const hardCap: BigNumber = ethers.utils.parseEther("5000");
    const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
    const campaignStartDate: number = Math.round(new Date().getTime() / 1000) + 10 * 60; // current time + 5 minutes
    const campaignEndDate: number = campaignStartDate + 60 * 60 * 24 * 30 * 2; // campaignStartDate + 2 months
    const milestone1StartDate: number = campaignEndDate; // = campaignStartDate
    const milestone1EndDate: number = milestone1StartDate + 60 * 60 * 24 * 30 * 2; // milestone1StartDate + 2 months
    const milestone2StartDate: number = milestone1EndDate; // = milestone1EndDate
    const milestone2EndDate: number = milestone2StartDate + 60 * 60 * 24 * 30 * 2; // milestone2StartDate + 2 months

    investmentPoolFactory = await ethers.getContractAt(
        "InvestmentPoolFactory",
        "0x47ef9A3C419d345C13049f8F809A046aa4c39E4D"
    );

    const creationTx = await investmentPoolFactory.connect(deployer).createInvestmentPool(
        wrappedEther,
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
    const poolAddress = receipt.events?.find((e) => e.event === "Created")?.args?.pool;

    console.log("Created Investment Pool at address: ", poolAddress);
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
