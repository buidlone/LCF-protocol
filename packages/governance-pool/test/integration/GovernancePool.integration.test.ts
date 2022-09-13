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

    const investmentPoolDepFactory = await ethers.getContractFactory(
        "InvestmentPoolFactoryMock",
        deployer
    );
    const invPoolFactory = await investmentPoolDepFactory.deploy(
        sf.settings.config.hostAddress,
        gelatoOpsMock.address,
        invPool.address
    );
    await invPoolFactory.deployed();

    await definePercentageDivider(invPoolFactory);
    await defineGelatoFeeAllocation(invPoolFactory);
};

const definePercentageDivider = async (invPoolFactory: InvestmentPoolFactoryMock) => {
    percentageDivider = await invPoolFactory.PERCENTAGE_DIVIDER();
    percent5InIpBigNumber = percentToIpBigNumber(5);
    percent10InIpBigNumber = percentToIpBigNumber(10);
    percent20InIpBigNumber = percentToIpBigNumber(20);
    percent70InIpBigNumber = percentToIpBigNumber(70);
    percent90InIpBigNumber = percentToIpBigNumber(90);
    percent95InIpBigNumber = percentToIpBigNumber(95);
};

const defineGelatoFeeAllocation = async (invPoolFactory: InvestmentPoolFactoryMock) => {
    gelatoFeeAllocation = await invPoolFactory.GELATO_FEE_ALLOCATION_PER_PROJECT();
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

const getInvestmentFromTx = async (tx: ContractTransaction): Promise<InvestmentPoolMock> => {
    const creationEvent = (await tx.wait(1)).events?.find((e) => e.event === "Created");
    assert.isDefined(creationEvent, "Didn't emit creation event");

    const poolAddress = creationEvent?.args?.pool;
    const contractFactory = await ethers.getContractFactory("InvestmentPoolMock", deployer);
    const pool = contractFactory.attach(poolAddress);
    return pool;
};

const createInvestmentWithTwoMilestones = async (feeAmount: BigNumber = gelatoFeeAllocation) => {
    creationRes = await investmentPoolFactory.connect(creator).createInvestmentPool(
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

    investment = await getInvestmentFromTx(creationRes);
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
        beforeEach(async () => {
            // Create investment pool implementation contract
            const investmentPoolDep = await ethers.getContractFactory(
                "InvestmentPoolMock",
                deployer
            );
            investment = await investmentPoolDep.deploy();
            await investment.deployed();

            // Create investment pool factory contract
            const investmentPoolDepFactory = await ethers.getContractFactory(
                "InvestmentPoolFactoryMock",
                deployer
            );
            investmentPoolFactory = await investmentPoolDepFactory.deploy(
                sf.settings.config.hostAddress,
                gelatoOpsMock.address,
                investment.address
            );
            await investmentPoolFactory.deployed();

            // Enforce a starting timestamp to avoid time based bugs
            const time = dateToSeconds("2100/06/01");
            await investmentPoolFactory.connect(deployer).setTimestamp(time);
        });

        it("[IPF-GP][1.1] On CLONE_PROXY investment pool creation, governance pool adds it to active list", async () => {
            const softCap = ethers.utils.parseEther("1500");
            const hardCap = ethers.utils.parseEther("15000");

            // Deploy voting token
            const votingTokensFactory = await ethers.getContractFactory("VotingToken", deployer);
            votingToken = await votingTokensFactory.deploy();
            await votingToken.deployed();

            // Governance Pool deployment
            const governancePoolFactory = await ethers.getContractFactory(
                "GovernancePoolMock",
                deployer
            );
            governancePool = await governancePoolFactory.deploy(
                votingToken.address,
                investmentPoolFactory.address,
                51 // Votes threshold
            );
            await governancePool.deployed();

            // Transfer ownership to governance pool
            await votingToken.transferOwnership(governancePool.address);

            // Assign governance pool to the IPF
            await investmentPoolFactory
                .connect(deployer)
                .setGovernancePool(governancePool.address);

            const creationRes = await investmentPoolFactory.connect(creator).createInvestmentPool(
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
                        intervalSeedPortion: percent10InIpBigNumber,
                        intervalStreamingPortion: percent90InIpBigNumber,
                    },
                ],
                {value: gelatoFeeAllocation}
            );

            const poolAddress = (await creationRes.wait(1)).events?.find(
                (e) => e.event === "Created"
            )?.args?.pool;

            assert.isTrue(await governancePool.isInvestmentPoolVotingActive(poolAddress));
        });

        it("[IPF-GP][1.2] Reverts creation if governance pool is not defined", async () => {
            const softCap = ethers.utils.parseEther("1500");
            const hardCap = ethers.utils.parseEther("15000");

            await expect(
                investmentPoolFactory.connect(creator).createInvestmentPool(
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
                            intervalSeedPortion: percent10InIpBigNumber,
                            intervalStreamingPortion: percent90InIpBigNumber,
                        },
                    ],
                    {value: gelatoFeeAllocation}
                )
            ).to.be.revertedWithCustomError(
                investmentPoolFactory,
                "InvestmentPoolFactory__GovernancePoolNotDefined"
            );
        });
    });

    describe("2. IPF request to set governance pool state variable", () => {
        beforeEach(async () => {
            // Create investment pool implementation contract
            const investmentPoolDep = await ethers.getContractFactory(
                "InvestmentPoolMock",
                deployer
            );

            investment = await investmentPoolDep.deploy();
            await investment.deployed();

            // Create investment pool factory contract
            const investmentPoolDepFactory = await ethers.getContractFactory(
                "InvestmentPoolFactoryMock",
                deployer
            );

            investmentPoolFactory = await investmentPoolDepFactory.deploy(
                sf.settings.config.hostAddress,
                gelatoOpsMock.address,
                investment.address
            );
            await investmentPoolFactory.deployed();

            // Enforce a starting timestamp to avoid time based bugs
            const time = dateToSeconds("2100/06/01");
            await investmentPoolFactory.connect(deployer).setTimestamp(time);

            const votingTokensFactory = await ethers.getContractFactory("VotingToken", deployer);
            votingToken = await votingTokensFactory.deploy();
            await votingToken.deployed();

            // Governance Pool deployment
            const governancePoolFactory = await ethers.getContractFactory(
                "GovernancePoolMock",
                deployer
            );
            governancePool = await governancePoolFactory.deploy(
                votingToken.address,
                investmentPoolFactory.address,
                51 // Votes threshold
            );
            await governancePool.deployed();
        });

        it("[GP-IPF][2.1] Should set governance pool variable correctly", async () => {
            await expect(
                investmentPoolFactory.connect(deployer).setGovernancePool(governancePool.address)
            ).not.to.be.reverted;

            const definedGovernancePool = await investmentPoolFactory.governancePool();
            assert.equal(governancePool.address, definedGovernancePool);
        });

        it("[GP-IPF][2.2] Shouldn't be able to set governance pool if not the owner", async () => {
            await expect(
                investmentPoolFactory
                    .connect(foreignActor)
                    .setGovernancePool(governancePool.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("[GP-IPF][2.3] Shouldn't be able to set governance pool if it's already defined", async () => {
            await investmentPoolFactory
                .connect(deployer)
                .setGovernancePool(governancePool.address);

            await expect(
                investmentPoolFactory.connect(deployer).setGovernancePool(governancePool.address)
            ).to.be.revertedWithCustomError(
                investmentPoolFactory,
                "InvestmentPoolFactory__GovernancePoolAlreadyDefined"
            );
        });
    });

    describe("3. IP request to mint voting tokens (in GP)", () => {
        it("[IP-GP][3.1] Governance pool should mint voting tokens on investment", async () => {
            // Create investment pool implementation contract
            const investmentPoolDep = await ethers.getContractFactory(
                "InvestmentPoolMock",
                deployer
            );
            investment = await investmentPoolDep.deploy();
            await investment.deployed();

            // Create investment pool factory contract
            const investmentPoolDepFactory = await ethers.getContractFactory(
                "InvestmentPoolFactoryMock",
                deployer
            );
            investmentPoolFactory = await investmentPoolDepFactory.deploy(
                sf.settings.config.hostAddress,
                gelatoOpsMock.address,
                investment.address
            );
            await investmentPoolFactory.deployed();

            // Deploy voting token
            const votingTokensFactory = await ethers.getContractFactory("VotingToken", deployer);
            votingToken = await votingTokensFactory.deploy();
            await votingToken.deployed();

            // Governance Pool deployment
            const governancePoolFactory = await ethers.getContractFactory(
                "GovernancePoolMock",
                deployer
            );
            governancePool = await governancePoolFactory.deploy(
                votingToken.address,
                investmentPoolFactory.address,
                51 // Votes threshold
            );
            await governancePool.deployed();

            // Transfer ownership to governance pool
            await votingToken.transferOwnership(governancePool.address);

            // Assign governance pool to the IPF
            await investmentPoolFactory
                .connect(deployer)
                .setGovernancePool(governancePool.address);

            // Enforce a starting timestamp to avoid time based bugs
            const time = dateToSeconds("2100/06/01");
            await investmentPoolFactory.connect(deployer).setTimestamp(time);

            await createInvestmentWithTwoMilestones();

            const investedAmount: BigNumber = ethers.utils.parseEther("100");
            const timeStamp = dateToSeconds("2100/07/15");
            await investment.setTimestamp(timeStamp);

            // Approve and invest money
            await investMoney(fUSDTx, investment, investorA, investedAmount);

            const investmentPoolId = await governancePool.getInvestmentPoolId(investment.address);
            const lockedTokens = await governancePool.tokensLocked(
                investorA.address,
                investmentPoolId,
                0
            );
            const unlockTime = (await investment.milestones(0)).startDate;

            assert.equal(lockedTokens.unlockTime, unlockTime);
            assert.deepEqual(lockedTokens.amount, investedAmount);
            assert.isFalse(lockedTokens.claimed);
        });
    });

    describe("4. GP request to terminate project (in IP)", () => {
        it("[GP-IP][4.1] If threshold was reached, should call investment pool and cancel the project", async () => {
            // Create investment pool implementation contract
            const investmentPoolDep = await ethers.getContractFactory(
                "InvestmentPoolMock",
                deployer
            );
            investment = await investmentPoolDep.deploy();
            await investment.deployed();

            // Create investment pool factory contract
            const investmentPoolDepFactory = await ethers.getContractFactory(
                "InvestmentPoolFactoryMock",
                deployer
            );
            investmentPoolFactory = await investmentPoolDepFactory.deploy(
                sf.settings.config.hostAddress,
                gelatoOpsMock.address,
                investment.address
            );
            await investmentPoolFactory.deployed();

            // Deploy voting token
            const votingTokensFactory = await ethers.getContractFactory("VotingToken", deployer);
            votingToken = await votingTokensFactory.deploy();
            await votingToken.deployed();

            // Governance Pool deployment
            const governancePoolFactory = await ethers.getContractFactory(
                "GovernancePoolMock",
                deployer
            );
            governancePool = await governancePoolFactory.deploy(
                votingToken.address,
                investmentPoolFactory.address,
                51 // Votes threshold
            );
            await governancePool.deployed();

            // Transfer ownership to governance pool
            await votingToken.transferOwnership(governancePool.address);

            // Assign governance pool to the IPF
            await investmentPoolFactory
                .connect(deployer)
                .setGovernancePool(governancePool.address);

            // Enforce a starting timestamp to avoid time based bugs
            const time = dateToSeconds("2100/06/01");
            await investmentPoolFactory.connect(deployer).setTimestamp(time);

            await createInvestmentWithTwoMilestones();

            const investedAmount: BigNumber = ethers.utils.parseEther("2000");
            const votesAgainst = ethers.utils.parseEther("1200");

            let timeStamp = dateToSeconds("2100/07/15");
            await investment.setTimestamp(timeStamp);
            await governancePool.setTimestamp(timeStamp);

            // Approve and invest money
            await investMoney(fUSDTx, investment, investorA, investedAmount);

            const investmentPoolId = await governancePool.getInvestmentPoolId(investment.address);

            timeStamp = dateToSeconds("2100/09/15");
            await investment.setTimestamp(timeStamp);
            await governancePool.setTimestamp(timeStamp);
            await governancePool.connect(investorA).unlockVotingTokens(investment.address, 0);

            // Approve the governance pool contract to spend investor's tokens
            await votingToken.connect(investorA).setApprovalForAll(governancePool.address, true);

            await expect(
                governancePool.connect(investorA).voteAgainst(investment.address, votesAgainst)
            ).to.emit(investment, "Cancel");
        });
    });
});
