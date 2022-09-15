import {ethers, network} from "hardhat";
import {availableTestnetChains, networkConfig} from "../hardhat-helper-config";
import {BigNumber} from "ethers";
import {InvestmentPoolFactoryTestMock} from "../typechain-types";

let investmentPoolFactory: InvestmentPoolFactoryTestMock;
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
    const softCap: BigNumber = ethers.utils.parseEther("0.001");
    const hardCap: BigNumber = ethers.utils.parseEther("0.002");
    const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
    const campaignStartDate: number = Math.round(new Date().getTime() / 1000) + 5 * 60; // current time + 5 minutes
    const campaignEndDate: number = campaignStartDate + 10 * 60; // campaignStartDate + 10 minutes
    const milestone1StartDate: number = campaignEndDate; // = campaignStartDate
    const milestone1EndDate: number = milestone1StartDate + 15 * 60; // milestone1StartDate + 15 minutes
    const milestone2StartDate: number = milestone1EndDate; // = milestone1EndDate
    const milestone2EndDate: number = milestone2StartDate + 15 * 60; // milestone2StartDate + 15 minutes

    investmentPoolFactory = await ethers.getContractAt(
        "InvestmentPoolFactoryTestMock",
        "0x241F31c2E6E8e540DE7B2a10345b2F3e2aD1D1B2"
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
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
