import {network} from "hardhat";
import {availableTestnetChains, networkConfig} from "../../hardhat-helper-config";
import {deployFactory} from "./deploy-factory";

async function main() {
    if (!availableTestnetChains.includes(network.name)) {
        console.log("Network is not available for deployment.");
        return;
    }

    await deployFactory(true);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
