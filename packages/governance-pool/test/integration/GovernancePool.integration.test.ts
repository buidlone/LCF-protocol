import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Framework, WrapperSuperToken} from "@superfluid-finance/sdk-core";
import {BigNumber, ContractTransaction, constants} from "ethers";
import {ethers, web3, network} from "hardhat";
import {assert, expect} from "chai";

import {
    VotingToken,
    GovernancePoolMock,
    InvestmentPoolFactoryMock,
    InvestmentPoolMock,
    GelatoOpsMock,
} from "../../typechain-types";

const fTokenAbi = require("../abis/fTokenAbi");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");

const INVESTOR_INITIAL_FUNDS = ethers.utils.parseEther("50000000000");

const UINT256_MAX = constants.MaxUint256;

const provider = web3;

let fUSDT: InstanceType<typeof fTokenAbi>;
let fUSDTx: WrapperSuperToken;

let accounts: SignerWithAddress[];
let investors: SignerWithAddress[];
let deployer: SignerWithAddress;
let creator: SignerWithAddress;
let foreignActor: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;

let sf: Framework;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let investment: InvestmentPoolMock;
let gelatoOpsMock: GelatoOpsMock;
let governancePool: GovernancePoolMock;
let votingToken: VotingToken;

let snapshotId: string;
let gelatoFeeAllocation: BigNumber;

let softCap: BigNumber;
let hardCap: BigNumber;
let milestoneStartDate: BigNumber;
let milestoneEndDate: BigNumber;
let milestoneStartDate2: BigNumber;
let milestoneEndDate2: BigNumber;
let campaignStartDate: BigNumber;
let campaignEndDate: BigNumber;
let governancePoolRole: string;

let creationRes: ContractTransaction;

// Percentages (in divider format)
let percentageDivider: BigNumber = BigNumber.from(0);
let percent5InIpBigNumber: BigNumber;
let percent10InIpBigNumber: BigNumber;
let percent20InIpBigNumber: BigNumber;
let percent70InIpBigNumber: BigNumber;
let percent90InIpBigNumber: BigNumber;
let percent95InIpBigNumber: BigNumber;

const dateToSeconds = (date: string, isBigNumber: boolean = true): BigNumber | number => {
    const convertedDate = new Date(date).getTime() / 1000;
    if (isBigNumber) {
        return BigNumber.from(convertedDate);
    } else {
        return convertedDate;
    }
};

const errorHandler = (err: any) => {
    if (err) throw err;
};

const percentToIpBigNumber = (percent: number): BigNumber => {
    return percentageDivider.mul(percent).div(100);
};

const defineVariablesFromIPF = async () => {
    const investmentPoolDep = await ethers.getContractFactory("InvestmentPoolMock", deployer);
    const invPool = await investmentPoolDep.deploy();
    await invPool.deployed();
    const governancePoolDep = await ethers.getContractFactory("GovernancePoolMock", deployer);
    const govPool = await governancePoolDep.deploy();
    await govPool.deployed();
    const votingTokensFactory = await ethers.getContractFactory("VotingToken", deployer);
    const votingToken = await votingTokensFactory.deploy();
    await votingToken.deployed();

    const investmentPoolDepFactory = await ethers.getContractFactory(
        "InvestmentPoolFactoryMock",
        deployer
    );
    const invPoolFactory = await investmentPoolDepFactory.deploy(
        sf.settings.config.hostAddress,
        gelatoOpsMock.address,
        invPool.address,
        govPool.address,
        votingToken.address
    );
    await invPoolFactory.deployed();

    governancePoolRole = await votingToken.GOVERNANCE_POOL_ROLE();
    await definePercentageDivider(invPoolFactory);
    await defineGelatoFeeAllocation(invPoolFactory);
};

const definePercentageDivider = async (invPoolFactory: InvestmentPoolFactoryMock) => {
    percentageDivider = await invPoolFactory.getPercentageDivider();
    percent5InIpBigNumber = percentToIpBigNumber(5);
    percent10InIpBigNumber = percentToIpBigNumber(10);
    percent20InIpBigNumber = percentToIpBigNumber(20);
    percent70InIpBigNumber = percentToIpBigNumber(70);
    percent90InIpBigNumber = percentToIpBigNumber(90);
    percent95InIpBigNumber = percentToIpBigNumber(95);
};

const defineGelatoFeeAllocation = async (invPoolFactory: InvestmentPoolFactoryMock) => {
    gelatoFeeAllocation = await invPoolFactory.getGelatoFeeAllocationForProject();
};

const investMoney = async (
    fUSDTxToken: WrapperSuperToken,
    investment: InvestmentPoolMock,
    investorObj: SignerWithAddress,
    investedMoney: BigNumber
) => {
    // Give token approval
    await fUSDTxToken
        .approve({
            receiver: investment.address,
            amount: UINT256_MAX.toString(),
        })
        .exec(investorObj);

    // Invest money
    await investment.connect(investorObj).invest(investedMoney, false);
};

const getContractsFromTx = async (
    tx: ContractTransaction
): Promise<[InvestmentPoolMock, GovernancePoolMock]> => {
    const creationEvent = (await tx.wait(1)).events?.find((e) => e.event === "Created");
    assert.isDefined(creationEvent, "Didn't emit creation event");

    const ipAddress = creationEvent?.args?.ipContract;
    const ipContractFactory = await ethers.getContractFactory("InvestmentPoolMock", deployer);
    const ipContract = ipContractFactory.attach(ipAddress);

    const gpAddress = creationEvent?.args?.gpContract;
    const gpContractFactory = await ethers.getContractFactory("GovernancePoolMock", deployer);
    const gpContract = gpContractFactory.attach(gpAddress);

    return [ipContract, gpContract];
};
const createInvestmentWithTwoMilestones = async (feeAmount: BigNumber = gelatoFeeAllocation) => {
    creationRes = await investmentPoolFactory.connect(creator).createProjectPools(
        fUSDTx.address,
        softCap,
        hardCap,
        campaignStartDate,
        campaignEndDate,
        0, // CLONE-PROXY
        [
            {
                startDate: milestoneStartDate,
                endDate: milestoneEndDate,
                intervalSeedPortion: percent5InIpBigNumber,
                intervalStreamingPortion: percent70InIpBigNumber,
            },
            {
                startDate: milestoneStartDate2,
                endDate: milestoneEndDate2,
                intervalSeedPortion: percent5InIpBigNumber,
                intervalStreamingPortion: percent20InIpBigNumber,
            },
        ],
        {value: feeAmount}
    );

    [investment, governancePool] = await getContractsFromTx(creationRes);

    // Assign role to allow minting
    await votingToken.connect(deployer).grantRole(governancePoolRole, governancePool.address);
};

const deployInvestmentPoolFactory = async (): Promise<InvestmentPoolFactoryMock> => {
    const investmentPoolDep = await ethers.getContractFactory("InvestmentPoolMock", deployer);
    const ip = await investmentPoolDep.deploy();
    await ip.deployed();
    const governancePoolDep = await ethers.getContractFactory("GovernancePoolMock", deployer);
    const gp = await governancePoolDep.deploy();
    await gp.deployed();
    const votingTokensFactory = await ethers.getContractFactory("VotingToken", deployer);
    votingToken = await votingTokensFactory.deploy();
    await votingToken.deployed();

    const investmentPoolDepFactory = await ethers.getContractFactory(
        "InvestmentPoolFactoryMock",
        deployer
    );
    const investmentPoolFactory = await investmentPoolDepFactory.deploy(
        sf.settings.config.hostAddress,
        gelatoOpsMock.address,
        ip.address,
        gp.address,
        votingToken.address
    );
    await investmentPoolFactory.deployed();

    // Enforce a starting timestamp to avoid time based bugs
    const time = dateToSeconds("2100/06/01");
    await investmentPoolFactory.connect(deployer).setTimestamp(time);

    return investmentPoolFactory;
};

describe("Governance Pool integration with Investment Pool Factory and Investment Pool", async () => {
    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        creator = accounts[1];
        foreignActor = accounts[2];
        investorA = accounts[3];
        investorB = accounts[4];
        investors = [investorA, investorB];

        // deploy the framework
        await deployFramework(errorHandler, {
            web3,
            from: deployer.address,
        });

        // deploy a fake erc20 token
        const fUSDTAddress = await deployTestToken(errorHandler, [":", "fUSDT"], {
            web3,
            from: deployer.address,
        });

        // deploy a fake erc20 wrapper super token around the fUSDT token
        const fUSDTxAddress = await deploySuperToken(errorHandler, [":", "fUSDT"], {
            web3,
            from: deployer.address,
        });

        console.log("fUSDT  Address: ", fUSDTAddress);
        console.log("fUSDTx Address: ", fUSDTxAddress);

        sf = await Framework.create({
            resolverAddress: process.env.RESOLVER_ADDRESS,
            chainId: 31337,
            provider,
            protocolReleaseVersion: "test",
        });

        // Create and deploy Gelato Ops contract mock
        const GelatoOpsMock = await ethers.getContractFactory("GelatoOpsMock", deployer);
        gelatoOpsMock = await GelatoOpsMock.deploy();
        await gelatoOpsMock.deployed();

        fUSDTx = await sf.loadWrapperSuperToken("fUSDTx");
        const underlyingAddr = fUSDTx.underlyingToken.address;
        fUSDT = new ethers.Contract(underlyingAddr, fTokenAbi, deployer);

        const totalAmount = INVESTOR_INITIAL_FUNDS.mul(investors.length);

        // Fund investors
        await fUSDT.connect(deployer).mint(deployer.address, totalAmount);
        await fUSDT
            .connect(deployer)
            .approve(fUSDTx.address, INVESTOR_INITIAL_FUNDS.mul(investors.length));

        const upgradeOperation = fUSDTx.upgrade({
            amount: totalAmount.toString(),
        });
        const operations = [upgradeOperation];

        // Transfer upgraded tokens to investors
        for (let i = 0; i < investors.length; i++) {
            const operation = fUSDTx.transferFrom({
                sender: deployer.address,
                amount: INVESTOR_INITIAL_FUNDS.toString(),
                receiver: investors[i].address,
            });
            operations.push(operation);
        }

        await sf.batchCall(operations).exec(deployer);

        // It just deploys the factory contract and gets the variabe values that will be needed
        await defineVariablesFromIPF();

        milestoneStartDate = dateToSeconds("2100/09/01") as BigNumber;
        milestoneEndDate = dateToSeconds("2100/10/01") as BigNumber;
        milestoneStartDate2 = dateToSeconds("2100/10/01") as BigNumber;
        milestoneEndDate2 = dateToSeconds("2100/12/01") as BigNumber;
        campaignStartDate = dateToSeconds("2100/07/01") as BigNumber;
        campaignEndDate = dateToSeconds("2100/08/01") as BigNumber;
        hardCap = ethers.utils.parseEther("15000");
        softCap = ethers.utils.parseEther("1500");
    });

    describe("1. IPF request to activate investment pool (in GP)", () => {
        it("[IPF-GP][1.1] On CLONE_PROXY investment pool creation, governance pool links with invemstment pool", async () => {
            investmentPoolFactory = await deployInvestmentPoolFactory();
            await createInvestmentWithTwoMilestones();
            assert.equal(await investment.getGovernancePool(), governancePool.address);
            assert.equal(await governancePool.getInvestmentPool(), investment.address);
        });
    });

    describe("3. IP request to mint voting tokens (in GP)", () => {
        it("[IP-GP][3.1] Governance pool should mint voting tokens on investment", async () => {
            investmentPoolFactory = await deployInvestmentPoolFactory();
            await createInvestmentWithTwoMilestones();

            const investedAmount: BigNumber = ethers.utils.parseEther("100");
            const timeStamp = dateToSeconds("2100/07/15");
            await investment.setTimestamp(timeStamp);

            // Approve and invest money
            await investMoney(fUSDTx, investment, investorA, investedAmount);
            const softCapMultiplier = await investment.getSoftCapMultiplier();
            const totalSupply = await governancePool.getVotingTokensSupply();

            assert.equal(investedAmount.mul(softCapMultiplier).toString(), totalSupply.toString());
        });
    });

    describe("4. GP request to terminate project (in IP)", () => {
        it("[GP-IP][4.1] If threshold was reached, should call investment pool and cancel the project", async () => {
            investmentPoolFactory = await deployInvestmentPoolFactory();
            await createInvestmentWithTwoMilestones();

            const investedAmount: BigNumber = ethers.utils.parseEther("2000");

            let timeStamp = dateToSeconds("2100/07/15");
            await investment.setTimestamp(timeStamp);

            // Approve and invest money
            await investMoney(fUSDTx, investment, investorA, investedAmount);

            timeStamp = dateToSeconds("2100/09/15");
            await investment.setTimestamp(timeStamp);

            const softCapMultiplier = await investment.getSoftCapMultiplier();
            const votesAgainst = softCapMultiplier.mul(investedAmount).mul(2).div(3);

            // Approve the governance pool contract to spend investor's tokens
            await votingToken.connect(investorA).setApprovalForAll(governancePool.address, true);

            await expect(governancePool.connect(investorA).voteAgainst(votesAgainst)).to.emit(
                investment,
                "Cancel"
            );
        });
    });

    describe("5. IP request to burn voting tokens (in GP on unpledge)", () => {
        it("[IP-GP][5.1] Should call governance pool and burn voting tokens from total supply", async () => {
            investmentPoolFactory = await deployInvestmentPoolFactory();
            await createInvestmentWithTwoMilestones();

            const investedAmount: BigNumber = ethers.utils.parseEther("2000");

            let timeStamp = dateToSeconds("2100/07/15");
            await investment.setTimestamp(timeStamp);
            await investMoney(fUSDTx, investment, investorB, investedAmount.mul(2));

            timeStamp = dateToSeconds("2100/09/15");
            await investment.setTimestamp(timeStamp);
            await investMoney(fUSDTx, investment, investorA, investedAmount);

            // Unpledge functionality
            await votingToken.connect(investorA).setApprovalForAll(governancePool.address, true);
            await investment.connect(investorA).unpledge();

            const investmentPoolId = await governancePool.getInvestmentPoolId();
            const totalSupply = await governancePool.getVotingTokensSupply();
            const amountLeft = await governancePool.getTokensMinted(investorB.address, 0);

            assert.equal(totalSupply.toString(), amountLeft.toString());
        });
    });
});
