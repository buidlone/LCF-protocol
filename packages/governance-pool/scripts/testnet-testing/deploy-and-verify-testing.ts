import {network} from "hardhat";
import {availableTestnetChains} from "../../hardhat-helper-config";
import {deployFactory} from "../deployment-outlines/deploy-factory";

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        console.log("Network is not available for deployment.");
        return;
    }

    await deployFactory(
        true,
        "InvestmentPoolFactoryTestMock",
        "InvestmentPool",
        "GovernancePool",
        "VotingToken"
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
