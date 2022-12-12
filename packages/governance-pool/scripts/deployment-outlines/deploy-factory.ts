import {ethers, network} from "hardhat";
import {networkConfig} from "../../hardhat-helper-config";
import {verify} from "../verify";

export const deployFactory = async (
    verification: boolean,
    investmentPoolFactoryType: string,
    investmentPoolType: string,
    governancePoolType: string,
    distributionPoolType: string,
    votingTokenType: string
): Promise<string> => {
    console.log("-----Deploying contracts-----");
    const accounts = await ethers.getSigners();
    const deployer = accounts[0];
    const chainId = network.config.chainId as number;
    const gelatoOpsAddress: string = networkConfig[chainId].gelatoOps;
    const superfluidHostAddress: string = networkConfig[chainId].superfluidHost;
    const blockConfirmations: number = networkConfig[chainId].blockConfirmations;

    /******************************************
     * 1. Deploy investment pool logic contract
     *****************************************/
    console.log("Deploying investment pool logic...");
    const investmentPoolLogicDep = await ethers.getContractFactory(investmentPoolType, deployer);
    const investmentPoolLogic = await investmentPoolLogicDep.deploy();
    await investmentPoolLogic.deployed();
    console.log("Investment pool logic address: ", investmentPoolLogic.address);

    /******************************************
     * 2. Deploy governance pool logic contract
     *****************************************/
    console.log("Deploying governance pool logic...");
    const governancePoolLogicDep = await ethers.getContractFactory(governancePoolType, deployer);
    const governancePoolLogic = await governancePoolLogicDep.deploy();
    await governancePoolLogic.deployed();
    console.log("Governance pool logic address: ", governancePoolLogic.address);

    /******************************************
     * 3. Deploy distribution pool logic contract
     *****************************************/
    console.log("Deploying distribution pool logic...");
    const distributionPoolLogicDep = await ethers.getContractFactory(
        distributionPoolType,
        deployer
    );
    const distributionPoolLogic = await distributionPoolLogicDep.deploy();
    await distributionPoolLogic.deployed();
    console.log("Distribution pool logic address: ", distributionPoolLogic.address);

    /******************************************
     * 4. Deploy voting token
     *****************************************/
    console.log("Deploying voting token contract...");
    const votingTokensDep = await ethers.getContractFactory(votingTokenType, deployer);
    const votingToken = await votingTokensDep.deploy();
    await votingToken.deployed();
    console.log("Voting token address: ", votingToken.address);

    /******************************************
     * 5. Deploy investment pool factory contract
     *****************************************/
    console.log("Deploying investment pool factory...");
    const investmentPoolFactoryDep = await ethers.getContractFactory(
        investmentPoolFactoryType,
        deployer
    );
    const investmentPoolFactory = await investmentPoolFactoryDep.deploy(
        superfluidHostAddress,
        gelatoOpsAddress,
        investmentPoolLogic.address,
        governancePoolLogic.address,
        distributionPoolLogic.address,
        votingToken.address
    );
    await investmentPoolFactory.deployed();
    console.log("Investment pool factory address: ", investmentPoolFactory.address);

    /******************************************
     * 6. Grant ADMIN role to the investment pool factory
     *****************************************/
    const adminRole: string = await votingToken.DEFAULT_ADMIN_ROLE();
    await votingToken.connect(deployer).grantRole(adminRole, investmentPoolFactory.address);

    // Verify
    if (verification) {
        await investmentPoolFactory.deployTransaction.wait(blockConfirmations);

        await verify(investmentPoolLogic.address, []);
        await verify(governancePoolLogic.address, []);
        await verify(distributionPoolLogic.address, []);
        await verify(votingToken.address, []);
        await verify(investmentPoolFactory.address, [
            superfluidHostAddress,
            gelatoOpsAddress,
            investmentPoolLogic.address,
            governancePoolLogic.address,
            distributionPoolLogic.address,
            votingToken.address,
        ]);
    }

    return investmentPoolFactory.address;
};
