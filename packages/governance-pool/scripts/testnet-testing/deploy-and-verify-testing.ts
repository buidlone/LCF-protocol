import {network} from "hardhat";
import {availableTestnetChains} from "../../hardhat-helper-config";
import {deployFactory} from "../deployment-outlines/deploy-factory";

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        throw "ERROR: Network is not available for deployment.";
    }

    await deployFactory(
        true,
        "InvestmentPoolFactoryTestMock",
        "InvestmentPool",
        "GovernancePool",
        "DistributionPool",
        "VotingToken"
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
