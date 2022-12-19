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
    tokenRewards: BigNumber,
    acceptedSuperTokenAddress: string | null,
    projectTokenAddress: string
) => {
    console.log("-----Creating project contracts-----");
    const accounts = await ethers.getSigners();
    const deployer = accounts[0];
    const chainId = network.config.chainId as number;
    const blockConfirmations: number = networkConfig[chainId].blockConfirmations;

    acceptedSuperTokenAddress = !acceptedSuperTokenAddress
        ? networkConfig[chainId].nativeSuperToken
        : acceptedSuperTokenAddress;

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
            acceptedToken: acceptedSuperTokenAddress,
            projectToken: projectTokenAddress,
            tokenRewards: tokenRewards,
        },
        0, // CLONE-PROXY
        milestones,
        {value: gelatoFeeAllocation}
    );

    const receipt = await creationTx.wait(blockConfirmations);
    const creationEvent = receipt.events?.find((e: any) => e.event === "Created");
    const ipAddress = creationEvent?.args?.ipContract;
    const gpAddress = creationEvent?.args?.gpContract;
    const dpAddress = creationEvent?.args?.dpContract;

    console.log("Created Investment Pool at address: ", ipAddress);
    console.log("Created Governance Pool at address: ", gpAddress);
    console.log("Created Distribution Pool at address: ", dpAddress);

    /******************************************
     * 2. Lock project tokens
     *****************************************/
    const distributionPool = await ethers.getContractAt(distributionPoolType, dpAddress);
    const projectToken = await ethers.getContractAt("IERC20", projectTokenAddress);
    const approveTx = await projectToken.approve(dpAddress, tokenRewards, {
        from: deployer.address,
    });
    approveTx.wait(blockConfirmations);
    await distributionPool.connect(deployer).lockTokens();

    console.log("---Timeline---");
    console.log("Fundraiser start date: ", new Date(campaignStartDate * 1000));
    console.log("Fundraiser end date: ", new Date(campaignEndDate * 1000));
};
