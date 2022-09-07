import {run, network} from "hardhat";
import {availableTestnetChains} from "../hardhat-helper-config";

export const verify = async (contractAddress: string, args: any[]) => {
    if (process.env.ETHERSCAN_API_KEY && availableTestnetChains.includes(network.name)) {
        console.log("Verifying contract...");
        try {
            await run("verify:verify", {
                address: contractAddress,
                constructorArguments: args,
            });
        } catch (e: any) {
            if (e.message.toLowerCase().includes("already verified")) {
                console.log("Already verified!");
            } else {
                console.log(e);
            }
        }
    }
};
