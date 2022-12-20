import {network} from "hardhat";
import {availableTestnetChains} from "../../hardhat-helper-config";
import {deployPools} from "../deployment-outlines/deploy-pools";
import {deployBuidl1Token} from "../deployment-outlines/deploy-token";
import {buidl1Details} from "../deployment-outlines/details/buidl1-details";

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        throw "ERROR: Network is not available for deployment.";
    }

    // 1. Deploy Buidl1 token
    const buidl1TokenAddress = await deployBuidl1Token(true);

    // 2. Get project details
    const [
        softCap,
        hardCap,
        gelatoFeeAllocation,
        tokenRewards,
        fundraiserStartDate,
        fundraiserEndDate,
        milestones,
        acceptedSuperToken,
    ] = await buidl1Details();

    // 3. Deploy project contracts
    await deployPools(
        "InvestmentPoolFactory",
        "0xcf93603D869BA422269B7db6D1942ca76390fe99",
        "DistributionPool",
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
