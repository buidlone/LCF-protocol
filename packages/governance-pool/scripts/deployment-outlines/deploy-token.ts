import {ethers, network} from "hardhat";
import {networkConfig} from "../../hardhat-helper-config";
import {verify} from "../verify";

export const deployBuidl1Token = async (verification: boolean): Promise<string> => {
    console.log("-----Deploying token-----");
    const accounts = await ethers.getSigners();
    const deployer = accounts[0];
    const chainId = network.config.chainId as number;
    const blockConfirmations: number = networkConfig[chainId].blockConfirmations;

    /******************************************
     * 1. Deploy buidl1 token
     *****************************************/
    console.log("Deploying Buidl1 token...");
    const buidl1TokenDep = await ethers.getContractFactory("Buidl1", deployer);
    const buidl1Token = await buidl1TokenDep.deploy();
    await buidl1Token.deployed();
    console.log("Buidl1 token address: ", buidl1Token.address);

    // Verify
    if (verification) {
        await verify(buidl1Token.address, []);
    }

    return buidl1Token.address;
};
