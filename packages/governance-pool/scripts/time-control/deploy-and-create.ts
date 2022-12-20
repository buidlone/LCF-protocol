import {network} from "hardhat";
import {availableTestnetChains} from "../../hardhat-helper-config";
import {deployFactory} from "../deployment-outlines/deploy-factory";
import {deployPools} from "../deployment-outlines/deploy-pools";
import {deployBuidl1Token} from "../deployment-outlines/deploy-token";
import {testProjectDetails} from "../deployment-outlines/details/test-project-details";

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        throw "ERROR: Network is not available for deployment.";
    }

    // 1. Deploy logic and factory contracts
    const investmentPoolFactoryAddress = await deployFactory(
        true,
        "InvestmentPoolFactoryMock",
        "InvestmentPoolMock",
        "GovernancePoolMock",
        "DistributionPoolMock",
        "VotingToken"
    );

    // 2. Deploy Buidl1 token
    const buidl1TokenAddress = await deployBuidl1Token(true);

    // 3. Get project details
    const [
        softCap,
        hardCap,
        gelatoFeeAllocation,
        tokenRewards,
        fundraiserStartDate,
        fundraiserEndDate,
        milestones,
        acceptedSuperToken,
    ] = await testProjectDetails();

    // 4. Deploy project contracts
    await deployPools(
        "InvestmentPoolFactoryMock",
        investmentPoolFactoryAddress,
        "DistributionPoolMock",
        softCap,
        hardCap,
        fundraiserStartDate,
        fundraiserEndDate,
        milestones,
        gelatoFeeAllocation,
        tokenRewards,
        acceptedSuperToken,
        buidl1TokenAddress
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
