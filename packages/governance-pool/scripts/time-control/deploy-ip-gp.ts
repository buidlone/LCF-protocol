import {ethers, network} from "hardhat";
import {networkConfig} from "../../hardhat-helper-config";
import {BigNumber} from "ethers";
import {InvestmentPoolFactoryMock, VotingToken} from "../../typechain-types";

export const deployProject = async (
    votingToken: VotingToken,
    investmentPoolFactory: InvestmentPoolFactoryMock,
    softCap: BigNumber,
    hardCap: BigNumber,
    campaignStartDate: number,
    campaignEndDate: number,
    milestones: any,
    gelatoFeeAllocation: BigNumber
) => {
    console.log("-----Creating Investment Pool contract-----");
    const accounts = await ethers.getSigners();
    const deployer = accounts[0];
    const chainId = network.config.chainId as number;
    const nativeSuperToken = networkConfig[chainId].nativeSuperToken;

    /******************************************
     * 1. Create project pools
     *****************************************/
    const creationTx = await investmentPoolFactory.connect(deployer).createProjectPools(
        nativeSuperToken,
        softCap,
        hardCap,
        campaignStartDate,
        campaignEndDate,
        0, // CLONE-PROXY
        milestones,
        {value: gelatoFeeAllocation}
    );

    const receipt = await creationTx.wait(1);
    const creationEvent = receipt.events?.find((e) => e.event === "Created");
    const ipAddress = creationEvent?.args?.ipContract;
    const gpAddress = creationEvent?.args?.gpContract;

    /******************************************
     * 2. Assign governance pool role to allow minting
     *****************************************/
    const governancePoolRole: string = await votingToken.GOVERNANCE_POOL_ROLE();
    await votingToken.connect(deployer).grantRole(governancePoolRole, gpAddress);

    console.log("Created Investment Pool at address: ", ipAddress);
    console.log("Created Governance Pool at address: ", gpAddress);
    console.log("---Timeline---");
    console.log("Fundraiser start date: ", new Date(campaignStartDate * 1000));
    console.log("Fundraiser end date: ", new Date(campaignEndDate * 1000));
};
