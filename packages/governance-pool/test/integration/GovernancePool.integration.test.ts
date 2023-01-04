import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Framework, WrapperSuperToken} from "@superfluid-finance/sdk-core";
import {BigNumber, ContractTransaction, constants, BigNumberish} from "ethers";
import {ethers, web3, network} from "hardhat";
import {assert, expect} from "chai";

import {
    GelatoOpsMock,
    VotingToken,
    InvestmentPoolFactoryMock,
    InvestmentPoolMock,
    GovernancePoolMock,
    DistributionPoolMock,
    Buidl1,
} from "../../typechain-types";

const fTokenAbi = require("../abis/fTokenAbi");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");

const INVESTOR_INITIAL_FUNDS = ethers.utils.parseEther("50000000000");

const provider = web3;

let fUSDT: InstanceType<typeof fTokenAbi>;
let fUSDTx: WrapperSuperToken;

let accounts: SignerWithAddress[];
let investors: SignerWithAddress[];
let superfluidAdmin: SignerWithAddress;
let buidl1Admin: SignerWithAddress;
let creator: SignerWithAddress;
let foreignActor: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;

let sf: Framework;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let investmentPool: InvestmentPoolMock;
let governancePool: GovernancePoolMock;
let distributionPool: DistributionPoolMock;
let gelatoOpsMock: GelatoOpsMock;
let votingToken: VotingToken;

let snapshotId: string;
let gelatoFeeAllocation: BigNumber;

let softCap: BigNumber;
let hardCap: BigNumber;
let milestone0StartDate: number;
let milestone0EndDate: number;
let milestone1StartDate: number;
let milestone1EndDate: number;
let fundraiserStartDate: number;
let fundraiserEndDate: number;
let tokenRewards: BigNumber;
let adminRole: string;

let creationRes: ContractTransaction;

// Percentages (in divider format)
let percentageDivider: BigNumber = BigNumber.from(0);
let formated5Percent: BigNumber;
let formated20Percent: BigNumber;
let formated70Percent: BigNumber;

const formatPercentage = (percent: BigNumberish): BigNumber => {
    return percentageDivider.mul(percent).div(100);
};

const dateToSeconds = (date: string): number => {
    return new Date(date).getTime() / 1000;
};

const errorHandler = (err: any) => {
    if (err) throw err;
};

const investMoney = async (
    fUSDTxToken: WrapperSuperToken,
    investmentPool: InvestmentPoolMock,
    investorObj: SignerWithAddress,
    investedMoney: BigNumber
) => {
    // Give token approval
    await fUSDTxToken
        .approve({
            receiver: investmentPool.address,
            amount: investedMoney.toString(),
        })
        .exec(investorObj);

    // Invest money
    await investmentPool.connect(investorObj).invest(investedMoney, false);
};

const getContractsFromTx = async (
    tx: ContractTransaction
): Promise<[InvestmentPoolMock, GovernancePoolMock, DistributionPoolMock]> => {
    const creationEvent = (await tx.wait(1)).events?.find((e) => e.event === "Created");
    assert.isDefined(creationEvent, "Didn't emit creation event");

    const ipAddress = creationEvent?.args?.ipContract;
    const ipContractFactory = await ethers.getContractFactory("InvestmentPoolMock", buidl1Admin);
    const ipContract = ipContractFactory.attach(ipAddress);

    const gpAddress = creationEvent?.args?.gpContract;
    const gpContractFactory = await ethers.getContractFactory("GovernancePoolMock", buidl1Admin);
    const gpContract = gpContractFactory.attach(gpAddress);

    const dpAddress = creationEvent?.args?.dpContract;
    const dpContractFactory = await ethers.getContractFactory("DistributionPoolMock", buidl1Admin);
    const dpContract = dpContractFactory.attach(dpAddress);

    return [ipContract, gpContract, dpContract];
};

const createInvestmentWithTwoMilestones = async (feeAmount: BigNumber = gelatoFeeAllocation) => {
    hardCap = ethers.utils.parseEther("15000");
    softCap = ethers.utils.parseEther("1500");
    fundraiserStartDate = dateToSeconds("2100/07/01");
    fundraiserEndDate = dateToSeconds("2100/08/01");
    milestone0StartDate = dateToSeconds("2100/09/01");
    milestone0EndDate = dateToSeconds("2100/10/01");
    milestone1StartDate = dateToSeconds("2100/10/01");
    milestone1EndDate = dateToSeconds("2100/12/01");
    tokenRewards = ethers.utils.parseEther("15000000");

    const buidl1Token = await deployBuidl1Token();

    creationRes = await investmentPoolFactory.connect(creator).createProjectPools(
        {
            softCap: softCap,
            hardCap: hardCap,
            fundraiserStartAt: fundraiserStartDate,
            fundraiserEndAt: fundraiserEndDate,
            acceptedToken: fUSDTx.address,
            projectToken: buidl1Token.address,
            tokenRewards: tokenRewards,
        },
        0, // CLONE-PROXY
        [
            {
                startDate: milestone0StartDate,
                endDate: milestone0EndDate,
                intervalSeedPortion: formated5Percent,
                intervalStreamingPortion: formated70Percent,
            },
            {
                startDate: milestone1StartDate,
                endDate: milestone1EndDate,
                intervalSeedPortion: formated5Percent,
                intervalStreamingPortion: formated20Percent,
            },
        ],
        {value: feeAmount}
    );

    [investmentPool, governancePool, distributionPool] = await getContractsFromTx(creationRes);

    await buidl1Token.connect(creator).approve(distributionPool.address, tokenRewards);
    await distributionPool.connect(creator).lockTokens();
};

const deployBuidl1Token = async (): Promise<Buidl1> => {
    const buidl1TokenDep = await ethers.getContractFactory("Buidl1", creator);
    const buidl1Token = await buidl1TokenDep.deploy();
    await buidl1Token.deployed();

    return buidl1Token;
};

const deployLogicContracts = async (): Promise<
    [InvestmentPoolMock, GovernancePoolMock, DistributionPoolMock]
> => {
    const investmentPoolLogicDep = await ethers.getContractFactory(
        "InvestmentPoolMock",
        buidl1Admin
    );
    const investmentPoolLogic = await investmentPoolLogicDep.deploy();
    await investmentPoolLogic.deployed();

    const governancePoolLogicDep = await ethers.getContractFactory(
        "GovernancePoolMock",
        buidl1Admin
    );
    const governancePoolLogic = await governancePoolLogicDep.deploy();
    await governancePoolLogic.deployed();

    const distributionPoolLogicDep = await ethers.getContractFactory(
        "DistributionPoolMock",
        buidl1Admin
    );
    const distributionPoolLogic = await distributionPoolLogicDep.deploy();
    await distributionPoolLogic.deployed();

    return [investmentPoolLogic, governancePoolLogic, distributionPoolLogic];
};

const getConstantVariablesFromContract = async () => {
    await deployInvestmentPoolFactory();

    gelatoFeeAllocation = await investmentPoolFactory.getGelatoFee();
    percentageDivider = await investmentPoolFactory.getPercentageDivider();
    formated5Percent = formatPercentage(5);
    formated20Percent = formatPercentage(20);
    formated70Percent = formatPercentage(70);
};

const deployInvestmentPoolFactory = async () => {
    const [investmentPoolLogic, governancePoolLogic, distributionPoolLogic] =
        await deployLogicContracts();

    const gelatoOpsMockDep = await ethers.getContractFactory("GelatoOpsMock", buidl1Admin);
    gelatoOpsMock = await gelatoOpsMockDep.deploy();
    await gelatoOpsMock.deployed();

    const votingTokenDep = await ethers.getContractFactory("VotingToken", buidl1Admin);
    votingToken = await votingTokenDep.deploy();
    await votingToken.deployed();

    const investmentPoolFactoryDep = await ethers.getContractFactory(
        "InvestmentPoolFactoryMock",
        buidl1Admin
    );
    investmentPoolFactory = await investmentPoolFactoryDep.deploy(
        sf.settings.config.hostAddress,
        gelatoOpsMock.address,
        investmentPoolLogic.address,
        governancePoolLogic.address,
        distributionPoolLogic.address,
        votingToken.address
    );
    await investmentPoolFactory.deployed();

    // Assign admin role to IPF, so it can later assign governance pool role for new GP contracts automatically on project creation
    adminRole = await votingToken.DEFAULT_ADMIN_ROLE();
    await votingToken.connect(buidl1Admin).grantRole(adminRole, investmentPoolFactory.address);

    // Enforce a starting timestamp to avoid time based bugs
    await investmentPoolFactory.setTimestamp(dateToSeconds("2100/06/01"));
};

const deploySuperfluidToken = async () => {
    // deploy the framework
    await deployFramework(errorHandler, {
        web3,
        from: superfluidAdmin.address,
    });

    // deploy a fake erc20 token
    await deployTestToken(errorHandler, [":", "fUSDT"], {
        web3,
        from: superfluidAdmin.address,
    });

    // deploy a fake erc20 wrapper super token around the fUSDT token
    await deploySuperToken(errorHandler, [":", "fUSDT"], {
        web3,
        from: superfluidAdmin.address,
    });

    sf = await Framework.create({
        resolverAddress: process.env.RESOLVER_ADDRESS,
        chainId: 31337,
        provider,
        protocolReleaseVersion: "test",
    });

    fUSDTx = await sf.loadWrapperSuperToken("fUSDTx");
    fUSDT = new ethers.Contract(fUSDTx.underlyingToken.address, fTokenAbi, superfluidAdmin);
};

const transferSuperTokens = async () => {
    const totalAmount = INVESTOR_INITIAL_FUNDS.mul(investors.length);

    // Fund investors
    await fUSDT.connect(superfluidAdmin).mint(superfluidAdmin.address, totalAmount);
    await fUSDT.connect(superfluidAdmin).approve(fUSDTx.address, totalAmount);

    const upgradeOperation = fUSDTx.upgrade({
        amount: totalAmount.toString(),
    });
    const operations = [upgradeOperation];

    // Transfer upgraded tokens to investors
    for (let i = 0; i < investors.length; i++) {
        const operation = fUSDTx.transferFrom({
            sender: superfluidAdmin.address,
            amount: INVESTOR_INITIAL_FUNDS.toString(),
            receiver: investors[i].address,
        });
        operations.push(operation);
    }

    await sf.batchCall(operations).exec(superfluidAdmin);
};

describe("Investment Pool integration with Governance Pool and Distribution Pool", async () => {
    before(async () => {
        accounts = await ethers.getSigners();
        superfluidAdmin = accounts[0];
        buidl1Admin = accounts[1];
        creator = accounts[2];
        foreignActor = accounts[3];
        investorA = accounts[4];
        investorB = accounts[5];
        investors = [investorA, investorB];

        await deploySuperfluidToken();
        await transferSuperTokens();
        await getConstantVariablesFromContract();
    });

    beforeEach(async () => {
        await deployInvestmentPoolFactory();
        await createInvestmentWithTwoMilestones();
    });

    describe("1. IPF request to activate investmentPool pool (in GP)", () => {
        it("[IPF-GP][1.1] On CLONE_PROXY investmentPool pool creation, governance pool links with invemstment pool", async () => {
            assert.equal(await investmentPool.getGovernancePool(), governancePool.address);
            assert.equal(await governancePool.getInvestmentPool(), investmentPool.address);
        });
    });

    describe("3. IP request to invest", () => {
        it("[IP-GP][3.1] Governance pool should mint voting tokens on investmentPool.", async () => {
            const investedAmount: BigNumber = ethers.utils.parseEther("100");

            await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
            await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

            const softCapMultiplier = await investmentPool.getSoftCapMultiplier();
            const totalSupply = await governancePool.getVotingTokensSupply();

            assert.equal(investedAmount.mul(softCapMultiplier).toString(), totalSupply.toString());
        });

        it("[IP-DP][3.2] Distribution pool should allocate tokens.", async () => {
            const investedAmount: BigNumber = ethers.utils.parseEther("100");
            const investmentWeight = await investmentPool.getInvestmentWeight(investedAmount);

            await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
            await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

            const allocatedTokens = await distributionPool.getAllocatedTokens(investorA.address);
            const lockedTokens = await distributionPool.getLockedTokens();
            const maximumWeightDivisor = await investmentPool.getMaximumWeightDivisor();
            const predictedAllocation = lockedTokens
                .mul(investmentWeight)
                .div(maximumWeightDivisor);

            assert.equal(allocatedTokens.toString(), predictedAllocation.toString());
        });

        it("[IP-GP][3.3] Governance pool should mint voting tokens several times on investment into same milestone.", async () => {
            const investedAmount: BigNumber = ethers.utils.parseEther("750");

            await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
            await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
            await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

            const softCapMultiplier = await investmentPool.getSoftCapMultiplier();
            const totalSupply = await governancePool.getVotingTokensSupply();

            await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
            const activeVotingTokens = await governancePool.getActiveVotes(0, investorA.address);

            assert.equal(
                totalSupply.toString(),
                investedAmount.mul(2).mul(softCapMultiplier).toString()
            );
            assert.equal(
                activeVotingTokens.toString(),
                investedAmount.mul(2).mul(softCapMultiplier).toString()
            );
        });
    });

    describe("4. GP request to terminate project (in IP)", () => {
        it("[GP-IP][4.1] If threshold was reached, should call investmentPool pool and cancel the project", async () => {
            const investedAmount: BigNumber = ethers.utils.parseEther("1500");

            await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
            await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

            await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
            const softCapMultiplier = await investmentPool.getSoftCapMultiplier();
            const votesAgainst = softCapMultiplier.mul(investedAmount).mul(2).div(3);

            await votingToken.connect(investorA).setApprovalForAll(governancePool.address, true);
            await expect(governancePool.connect(investorA).voteAgainst(votesAgainst)).to.emit(
                investmentPool,
                "Cancel"
            );
        });
    });

    describe("5. IP request to undpledge investmentPool", () => {
        it("[IP-GP][5.1] Should call governance pool and burn voting tokens.", async () => {
            const investedAmount: BigNumber = ethers.utils.parseEther("2000");

            await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
            await investMoney(fUSDTx, investmentPool, investorB, investedAmount.mul(2));

            await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
            await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

            await votingToken.connect(investorA).setApprovalForAll(governancePool.address, true);
            await investmentPool.connect(investorA).unpledge();

            const totalSupply = await governancePool.getVotingTokensSupply();
            const amountLeft = await governancePool.getTokensMinted(investorB.address, 0);

            assert.equal(totalSupply.toString(), amountLeft.toString());
        });

        it("[IP-DP][5.2] Should call governance pool and burn voting tokens + remove project tokens allocation in distribution pool", async () => {
            const investedAmount: BigNumber = ethers.utils.parseEther("2000");

            await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
            await investMoney(fUSDTx, investmentPool, investorB, investedAmount.mul(2));

            await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
            await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

            const priorAllocation = await distributionPool.getAllocatedTokens(investorA.address);
            const proirTotalAllocation = await distributionPool.getTotalAllocatedTokens();

            await votingToken.connect(investorA).setApprovalForAll(governancePool.address, true);
            await investmentPool.connect(investorA).unpledge();

            const allocation = await distributionPool.getAllocatedTokens(investorA.address);
            const totalAllocation = await distributionPool.getTotalAllocatedTokens();

            assert.equal(
                totalAllocation.toString(),
                proirTotalAllocation.sub(priorAllocation).toString()
            );
            assert.equal(allocation.toString(), "0");
        });
    });
});
