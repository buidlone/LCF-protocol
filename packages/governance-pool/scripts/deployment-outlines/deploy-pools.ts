import {ethers, network} from "hardhat";
import {networkConfig} from "../../hardhat-helper-config";
import {BigNumber} from "ethers";

export const deployPools = async (
    investmentPoolFactoryType: string,
    investmentPoolFactoryAddress: string,
    distributionPoolType: string,
    softCap: BigNumber,
    hardCap: BigNumber,
    campaignStartDate: number,
    campaignEndDate: number,
    milestones: any,
    gelatoFeeAllocation: BigNumber,
    tokenRewards: BigNumber
) => {
    console.log("-----Creating project contracts-----");
    const accounts = await ethers.getSigners();
    const deployer = accounts[0];
    const chainId = network.config.chainId as number;
    const nativeSuperToken = networkConfig[chainId].nativeSuperToken;
    const nativeProjectToken = networkConfig[chainId].nativeProjectToken;

    const investmentPoolFactory = await ethers.getContractAt(
        investmentPoolFactoryType,
        investmentPoolFactoryAddress
    );

    /******************************************
     * 1. Create project pools
     *****************************************/
    const creationTx = await investmentPoolFactory.connect(deployer).createProjectPools(
        {
            softCap: softCap,
            hardCap: hardCap,
            fundraiserStartAt: campaignStartDate,
            fundraiserEndAt: campaignEndDate,
            acceptedToken: nativeSuperToken,
            projectToken: nativeProjectToken,
            tokenRewards: tokenRewards,
        },
        0, // CLONE-PROXY
        milestones,
        {value: gelatoFeeAllocation}
    );

    const receipt = await creationTx.wait(1);
    const creationEvent = receipt.events?.find((e: any) => e.event === "Created");
    const ipAddress = creationEvent?.args?.ipContract;
    const gpAddress = creationEvent?.args?.gpContract;
    const dpAddress = creationEvent?.args?.dpContract;

    console.log("Created Investment Pool at address: ", ipAddress);
    console.log("Created Governance Pool at address: ", gpAddress);
    console.log("Created Distribution Pool at address: ", dpAddress);

    const distributionPool = await ethers.getContractAt(distributionPoolType, dpAddress);
    const projectToken = await ethers.getContractAt("ERC20", nativeProjectToken);
    await projectToken.approve(dpAddress, tokenRewards);
    await distributionPool.lockTokens();

    console.log("---Timeline---");
    console.log("Fundraiser start date: ", new Date(campaignStartDate * 1000));
    console.log("Fundraiser end date: ", new Date(campaignEndDate * 1000));
};
