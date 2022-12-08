import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Framework, WrapperSuperToken} from "@superfluid-finance/sdk-core";
import {BigNumber, constants} from "ethers";
import {ethers, web3} from "hardhat";
import {assert, expect} from "chai";
import {
    InvestmentPoolFactoryMock,
    InvestmentPoolMock,
    GelatoOpsMock,
    GovernancePoolMockForIntegration,
    VotingTokenMock,
} from "../typechain-types";

const fTokenAbi = require("./abis/fTokenAbi");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");

const provider = web3;

// eslint-disable-next-line no-unused-vars
let fUSDT: InstanceType<typeof fTokenAbi>;
let fUSDTx: WrapperSuperToken;

let accounts: SignerWithAddress[];
let admin: SignerWithAddress;
let buidl1Admin: SignerWithAddress;
let creator: SignerWithAddress;
let foreignActor: SignerWithAddress;

let sf: Framework;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let investmentPoolLogic: InvestmentPoolMock;
let gelatoOpsMock: GelatoOpsMock;
let governancePoolLogic: GovernancePoolMockForIntegration;
let votingToken: VotingTokenMock;

let gelatoFeeAllocation: BigNumber;
let percentageDivider = BigNumber.from(0);
let percent5InIpBigNumber: BigNumber;
let percent6InIpBigNumber: BigNumber;
let percent10InIpBigNumber: BigNumber;
let percent40InIpBigNumber: BigNumber;
let percent44InIpBigNumber: BigNumber;
let percent49InIpBigNumber: BigNumber;
let percent51InIpBigNumber: BigNumber;
let percent90InIpBigNumber: BigNumber;
let percent95InIpBigNumber: BigNumber;

const generateGaplessMilestones = (
    startTimeStamp: BigNumber,
    duration: BigNumber,
    amount: number
): {
    startDate: BigNumber;
    endDate: BigNumber;
    intervalSeedPortion: BigNumber;
    intervalStreamingPortion: BigNumber;
}[] => {
    const arr = [];
    let prevTimestamp = startTimeStamp;

    for (let i = 0; i < amount; i++) {
        const endDate = prevTimestamp.add(duration);
        arr.push({
            startDate: prevTimestamp,
            endDate: endDate,
            intervalSeedPortion: percent10InIpBigNumber.div(amount),
            intervalStreamingPortion: percent90InIpBigNumber.div(amount),
        });
        prevTimestamp = endDate;
    }

    return arr;
};

const percentToIpBigNumber = (percent: number): BigNumber => {
    return percentageDivider.mul(percent).div(100);
};

const dateToSeconds = (date: string): BigNumber => {
    const convertedDate = new Date(date).getTime() / 1000;
    return BigNumber.from(convertedDate);
};

const errorHandler = (err: any) => {
    if (err) throw err;
};

const deployLogicContracts = async () => {
    const investmentPoolDep = await ethers.getContractFactory("InvestmentPoolMock", buidl1Admin);
    investmentPoolLogic = await investmentPoolDep.deploy();
    await investmentPoolLogic.deployed();

    const governancePoolDep = await ethers.getContractFactory(
        "GovernancePoolMockForIntegration",
        buidl1Admin
    );
    governancePoolLogic = await governancePoolDep.deploy();
    await governancePoolLogic.deployed();
};

const getConstantVariablesFromContract = async () => {
    const investmentPoolDepFactory = await ethers.getContractFactory(
        "InvestmentPoolFactoryMock",
        buidl1Admin
    );
    investmentPoolFactory = await investmentPoolDepFactory.deploy(
        sf.settings.config.hostAddress,
        gelatoOpsMock.address,
        investmentPoolLogic.address,
        governancePoolLogic.address,
        votingToken.address
    );
    await investmentPoolFactory.deployed();

    await definePercentageDivider(investmentPoolFactory);
    await defineGelatoFeeAllocation(investmentPoolFactory);
};

const definePercentageDivider = async (investmentPoolFactory: InvestmentPoolFactoryMock) => {
    percentageDivider = await investmentPoolFactory.getPercentageDivider();
    percent5InIpBigNumber = percentToIpBigNumber(5);
    percent6InIpBigNumber = percentToIpBigNumber(6);
    percent10InIpBigNumber = percentToIpBigNumber(10);
    percent40InIpBigNumber = percentToIpBigNumber(40);
    percent44InIpBigNumber = percentToIpBigNumber(44);
    percent49InIpBigNumber = percentToIpBigNumber(49);
    percent51InIpBigNumber = percentToIpBigNumber(51);
    percent90InIpBigNumber = percentToIpBigNumber(90);
    percent95InIpBigNumber = percentToIpBigNumber(95);
};

const defineGelatoFeeAllocation = async (investmentPoolFactory: InvestmentPoolFactoryMock) => {
    gelatoFeeAllocation = await investmentPoolFactory.getGelatoFeeAllocationForProject();
};

describe("Investment Pool Factory", async () => {
    before(async () => {
        // get accounts from hardhat
        accounts = await ethers.getSigners();

        admin = accounts[0];
        buidl1Admin = accounts[1];
        creator = accounts[2];
        foreignActor = accounts[3];

        // deploy the framework
        await deployFramework(errorHandler, {
            web3,
            from: admin.address,
        });

        // deploy a fake erc20 token
        const fUSDTAddress = await deployTestToken(errorHandler, [":", "fUSDT"], {
            web3,
            from: admin.address,
        });

        // deploy a fake erc20 wrapper super token around the fUSDT token
        const fUSDTxAddress = await deploySuperToken(errorHandler, [":", "fUSDT"], {
            web3,
            from: admin.address,
        });

        console.log("fUSDT  Address: ", fUSDTAddress);
        console.log("fUSDTx Address: ", fUSDTxAddress);

        // initialize the superfluid framework...put custom and web3 only bc we are using hardhat locally
        sf = await Framework.create({
            resolverAddress: process.env.RESOLVER_ADDRESS,
            chainId: 31337,
            provider,
            protocolReleaseVersion: "test",
        });

        // Create and deploy Gelato Ops contract mock
        const GelatoOpsMock = await ethers.getContractFactory("GelatoOpsMock", buidl1Admin);
        gelatoOpsMock = await GelatoOpsMock.deploy();
        await gelatoOpsMock.deployed();

        fUSDTx = await sf.loadWrapperSuperToken("fUSDTx");

        const underlyingAddr = fUSDTx.underlyingToken.address;

        fUSDT = new ethers.Contract(underlyingAddr, fTokenAbi, admin);

        // Create voting token
        const votingTokenDep = await ethers.getContractFactory("VotingTokenMock", buidl1Admin);
        votingToken = await votingTokenDep.deploy();
        await votingToken.deployed();

        await deployLogicContracts();
        // It just deploys the factory contract and gets the percentage divider value for other tests
        await getConstantVariablesFromContract();
    });

    describe("1. Investment pool factory creation", () => {
        beforeEach(async () => {
            await deployLogicContracts();
        });

        describe("1.1 State variables", () => {
            it("[IPF][1.1.1] Constructor should set state variables correctly", async () => {
                // Create investment pool factory contract
                const investmentPoolDepFactory = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );
                investmentPoolFactory = await investmentPoolDepFactory.deploy(
                    sf.settings.config.hostAddress,
                    gelatoOpsMock.address,
                    investmentPoolLogic.address,
                    governancePoolLogic.address,
                    votingToken.address
                );
                await investmentPoolFactory.deployed();

                const contractHost = await investmentPoolFactory.getSuperfluidHost();
                const contractGelatoOps = await investmentPoolFactory.getGelatoOps();
                const ipContractAddress =
                    await investmentPoolFactory.getInvestmentPoolImplementation();
                const gpContractAddress =
                    await investmentPoolFactory.getGovernancePoolImplementation();
                const votingTokenAddress = await investmentPoolFactory.getVotingToken();

                assert.equal(contractHost, sf.settings.config.hostAddress);
                assert.equal(contractGelatoOps, gelatoOpsMock.address);
                assert.equal(ipContractAddress, investmentPoolLogic.address);
                assert.equal(gpContractAddress, governancePoolLogic.address);
                assert.equal(votingTokenAddress, votingToken.address);
            });
        });

        describe("1.2 Interactions", () => {
            it("[IPF][1.2.1] Should revert if host address is zero", async () => {
                // Create investment pool factory contract
                const investmentPoolDepFactory = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );

                await expect(
                    investmentPoolDepFactory.deploy(
                        constants.AddressZero,
                        gelatoOpsMock.address,
                        investmentPoolLogic.address,
                        governancePoolLogic.address,
                        votingToken.address
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolDepFactory,
                    "InvestmentPoolFactory__HostAddressIsZero"
                );
            });

            it("[IPF][1.2.2] Should revert if gelato ops address is zero", async () => {
                // Create investment pool factory contract
                const investmentPoolDepFactory = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );

                await expect(
                    investmentPoolDepFactory.deploy(
                        sf.settings.config.hostAddress,
                        constants.AddressZero,
                        investmentPoolLogic.address,
                        governancePoolLogic.address,
                        votingToken.address
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolDepFactory,
                    "InvestmentPoolFactory__GelatoOpsAddressIsZero"
                );
            });

            it("[IPF][1.2.3] Should revert if implementation contract address is zero", async () => {
                // Create investment pool factory contract
                const investmentPoolDepFactory = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );

                await expect(
                    investmentPoolDepFactory.deploy(
                        sf.settings.config.hostAddress,
                        gelatoOpsMock.address,
                        constants.AddressZero,
                        governancePoolLogic.address,
                        votingToken.address
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolDepFactory,
                    "InvestmentPoolFactory__ImplementationContractAddressIsZero"
                );
            });

            it("[IPF][1.2.4] Should successfully create a clone contract", async () => {
                // Create investment pool factory contract
                const investmentPoolDepFactory = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );
                investmentPoolFactory = await investmentPoolDepFactory.deploy(
                    sf.settings.config.hostAddress,
                    gelatoOpsMock.address,
                    investmentPoolLogic.address,
                    governancePoolLogic.address,
                    votingToken.address
                );
                await investmentPoolFactory.deployed();

                const investmentPoolClone =
                    await investmentPoolFactory.callStatic.deployInvestmentPoolClone();

                // New address was created
                assert.isTrue(ethers.utils.isAddress(investmentPoolClone));
            });

            it("[IPF][1.2.5] Should be able to receive ETH", async () => {
                const ethAmountToReceive = ethers.utils.parseEther("1");

                // Create investment pool factory contract
                const investmentPoolDepFactory = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );
                investmentPoolFactory = await investmentPoolDepFactory.deploy(
                    sf.settings.config.hostAddress,
                    gelatoOpsMock.address,
                    investmentPoolLogic.address,
                    governancePoolLogic.address,
                    votingToken.address
                );
                await investmentPoolFactory.deployed();

                await buidl1Admin.sendTransaction({
                    to: investmentPoolFactory.address,
                    value: ethAmountToReceive,
                });

                const contractBalance = await ethers.provider.getBalance(
                    investmentPoolFactory.address
                );

                assert.deepEqual(ethAmountToReceive, contractBalance);
            });

            it("[IPF][1.2.6] Deployer should be able to update gelato fee allocation value", async () => {
                const newEthFee = ethers.utils.parseEther("0.321");

                // Create investment pool factory contract
                const investmentPoolDepFactory = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );
                investmentPoolFactory = await investmentPoolDepFactory.deploy(
                    sf.settings.config.hostAddress,
                    gelatoOpsMock.address,
                    investmentPoolLogic.address,
                    governancePoolLogic.address,
                    votingToken.address
                );
                await investmentPoolFactory.deployed();

                await expect(
                    investmentPoolFactory.connect(buidl1Admin).setGelatoFeeAllocation(newEthFee)
                ).not.to.be.reverted;

                const gelatoFee = await investmentPoolFactory.getGelatoFeeAllocationForProject();
                assert.deepEqual(newEthFee, gelatoFee);
            });

            it("[IPF][1.2.7] Bad actor shouldn't be able to update gelato fee allocation value", async () => {
                const newEthFee = ethers.utils.parseEther("0.321");

                // Create investment pool factory contract
                const investmentPoolDepFactory = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );
                investmentPoolFactory = await investmentPoolDepFactory.deploy(
                    sf.settings.config.hostAddress,
                    gelatoOpsMock.address,
                    investmentPoolLogic.address,
                    governancePoolLogic.address,
                    votingToken.address
                );
                await investmentPoolFactory.deployed();

                await expect(
                    investmentPoolFactory.connect(foreignActor).setGelatoFeeAllocation(newEthFee)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                const gelatoFee = await investmentPoolFactory.getGelatoFeeAllocationForProject();
                assert.deepEqual(gelatoFee, gelatoFeeAllocation);
            });
        });
    });

    describe("2. Investment creation", () => {
        beforeEach(async () => {
            // Create investment pool implementation contract
            const investmentPoolDep = await ethers.getContractFactory(
                "InvestmentPoolMock",
                buidl1Admin
            );
            investmentPoolLogic = await investmentPoolDep.deploy();
            await investmentPoolLogic.deployed();

            // Create governance pool mock
            const governancePoolDep = await ethers.getContractFactory(
                "GovernancePoolMockForIntegration",
                buidl1Admin
            );
            governancePoolLogic = await governancePoolDep.deploy();
            await governancePoolLogic.deployed();

            // Create investment pool factory contract
            const investmentPoolDepFactory = await ethers.getContractFactory(
                "InvestmentPoolFactoryMock",
                buidl1Admin
            );
            investmentPoolFactory = await investmentPoolDepFactory.deploy(
                sf.settings.config.hostAddress,
                gelatoOpsMock.address,
                investmentPoolLogic.address,
                governancePoolLogic.address,
                votingToken.address
            );
            await investmentPoolFactory.deployed();

            // Enforce a starting timestamp to avoid time based bugs
            const time = dateToSeconds("2100/06/01");
            await investmentPoolFactory.connect(buidl1Admin).setTimestamp(time);
        });

        describe("2.1 Interactions", () => {
            it("[IPF][2.1.1] On CLONE_PROXY investment pool creation events are emited", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                const creationRes = await investmentPoolFactory
                    .connect(creator)
                    .createProjectPools(
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

                const creationEvent = (await creationRes.wait()).events?.find(
                    (e) => e.event === "Created"
                );

                assert.isDefined(creationEvent, "Didn't emit creation event");
                await expect(creationRes).to.emit(gelatoOpsMock, "RegisterGelatoTask");
            });

            it("[IPF][2.1.2] On CLONE_PROXY investment pool creation variables are set correctly", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                const creationRes = await investmentPoolFactory
                    .connect(creator)
                    .createProjectPools(
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

                const poolAddress = (await creationRes.wait()).events?.find(
                    (e) => e.event === "Created"
                )?.args?.ipContract;

                const contractFactory = await ethers.getContractFactory(
                    "InvestmentPoolMock",
                    buidl1Admin
                );

                const pool = contractFactory.attach(poolAddress);

                const creatorAddress = await pool.getCreator();
                const invested = await pool.getTotalInvestedAmount();
                const fundraiserStartAt = await pool.getFundraiserStartTime();
                const fundraiserEndAt = await pool.getFundraiserEndTime();
                const poolSoftCap = await pool.getSoftCap();
                const poolHardCap = await pool.getHardCap();
                const milestoneCount = await pool.getMilestonesCount();
                const milestone = await pool.getMilestone(0);
                const gelatoOpsAddress = await pool.getGelatoOps();

                // Verify the campaign variables
                assert.deepEqual(poolSoftCap, softCap, "Wrong soft cap");
                assert.deepEqual(poolHardCap, hardCap, "Wrong hard cap");
                assert.equal(creatorAddress, creator.address, "Wrong creator address");
                assert.equal(gelatoOpsAddress, gelatoOpsMock.address);
                assert.deepEqual(
                    invested,
                    BigNumber.from(0),
                    "Should not have any investments yet"
                );
                assert.deepEqual(
                    BigNumber.from(fundraiserStartAt),
                    campaignStartDate,
                    "Wrong campaign start date"
                );
                assert.deepEqual(
                    BigNumber.from(fundraiserEndAt),
                    campaignEndDate,
                    "Wrong campaign end date"
                );
                assert.deepEqual(
                    milestoneCount,
                    BigNumber.from(1),
                    "Should have a single milestone"
                );
                assert.deepEqual(
                    BigNumber.from(milestone.startDate),
                    milestoneStartDate,
                    "Wrong milestone start date"
                );
                assert.deepEqual(
                    BigNumber.from(milestone.endDate),
                    milestoneEndDate,
                    "Wrong milestone end date"
                );
                assert.equal(milestone.paid, false, "Milestone should not be paid initially");
                assert.equal(
                    milestone.seedAmountPaid,
                    false,
                    "Seed funds should not be paid initially"
                );
                assert.equal(
                    milestone.streamOngoing,
                    false,
                    "Stream should not be ongoing from the start"
                );
                assert.deepEqual(
                    milestone.paidAmount,
                    BigNumber.from(0),
                    "Should have paid 0 in funds upon creation"
                );
            });

            it("[IPF][2.1.3] Reverts creation if accepted token address is zero", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        constants.AddressZero,
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
                    "InvestmentPoolFactory__AcceptedTokenAddressIsZero"
                );
            });

            it("[IPF][2.1.4] Reverts creation if soft cap is greater than hard cap", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("1000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                )
                    .to.be.revertedWithCustomError(
                        investmentPoolFactory,
                        "InvestmentPoolFactory__SoftCapIsGreaterThanHardCap"
                    )
                    .withArgs(softCap, hardCap);
            });

            it("[IPF][2.1.5] Fundraiser interval cannot be retrospective", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                // Move forward in time to simulate retrospective creation for fundraiser
                const time = dateToSeconds("2100/07/15");
                await investmentPoolFactory.connect(buidl1Admin).setTimestamp(time);

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                    "InvestmentPoolFactory__FundraiserStartIsInPast"
                );
            });

            it("[IPF][2.1.6] Reverts creation if fundraiser campaign ends before it starts", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                // Campaign ends before it starts
                const campaignStartDate = dateToSeconds("2100/08/01");
                const campaignEndDate = dateToSeconds("2100/07/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                    "InvestmentPoolFactory__FundraiserStartTimeIsGreaterThanEndTime"
                );
            });

            it("[IPF][2.1.7] Reverts creation if fundraiser period is longer than MAX duration (90 days)", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/11/01");
                const milestoneEndDate = dateToSeconds("2100/12/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/10/10");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                    "InvestmentPoolFactory__FundraiserExceedsMaxDuration"
                );
            });

            it("[IPF][2.1.8] Reverts creation if fundraiser period is shorter than MIN duration (30 days)", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/08/01");
                const milestoneEndDate = dateToSeconds("2100/09/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/07/10");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                    "InvestmentPoolFactory__FundraiserDurationIsTooShort"
                );
            });

            it("[IPF][2.1.9] Reverts creation if milestones list is empty", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/10");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        fUSDTx.address,
                        softCap,
                        hardCap,
                        campaignStartDate,
                        campaignEndDate,
                        0, // CLONE-PROXY
                        [],
                        {value: gelatoFeeAllocation}
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactory,
                    "InvestmentPoolFactory__NoMilestonesAdded"
                );
            });

            it("[IPF][2.1.10] Reverts creation if exceeds MAX milestones count", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                // 30 days
                const milestoneDuration = BigNumber.from(30 * 24 * 60 * 60);
                const maxMilestones = await investmentPoolFactory.getMaxMilestoneCount();

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        fUSDTx.address,
                        softCap,
                        hardCap,
                        campaignStartDate,
                        campaignEndDate,
                        0, // CLONE-PROXY
                        generateGaplessMilestones(
                            milestoneStartDate,
                            milestoneDuration,
                            maxMilestones + 1 // Intentionally provoke reverting
                        ),
                        {value: gelatoFeeAllocation}
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactory,
                    "InvestmentPoolFactory__MilestonesCountExceedsMaxCount"
                );
            });

            it("[IPF][2.1.11] Can create multiple milestones", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                // 30 days
                const milestoneDuration = BigNumber.from(30 * 24 * 60 * 60);

                const maxMilestones = await investmentPoolFactory.getMaxMilestoneCount();

                const milestones = generateGaplessMilestones(
                    milestoneStartDate,
                    milestoneDuration,
                    maxMilestones // Let's create as many as it's allowed
                );

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        fUSDTx.address,
                        softCap,
                        hardCap,
                        campaignStartDate,
                        campaignEndDate,
                        0, // CLONE-PROXY
                        milestones,
                        {value: gelatoFeeAllocation}
                    )
                ).not.to.be.reverted;
            });

            it("[IPF][2.1.12] Reverts creation if first milestone starts before fundraiser ends", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                // Milestone ends before it starts
                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/11/01");
                const campaignStartDate = dateToSeconds("2100/08/01");
                const campaignEndDate = dateToSeconds("2100/10/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                    "InvestmentPoolFactory__MilestoneStartsBeforeFundraiserEnds"
                );
            });

            it("[IPF][2.1.13] Reverts creation if milestone ends before it starts", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                // Milestone ends before it starts
                const milestoneStartDate = dateToSeconds("2100/10/01");
                const milestoneEndDate = dateToSeconds("2100/09/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                    "InvestmentPoolFactory__InvalidMilestoneInverval"
                );
            });

            it("[IPF][2.1.14] Reverts creation if milestone is shorter than MIN duration (30days)", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/9/10");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                    "InvestmentPoolFactory__InvalidMilestoneInverval"
                );
            });

            it("[IPF][2.1.15] Reverts creation if milestone is longer than MAX duration (90 days)", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/12/10");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                    "InvestmentPoolFactory__InvalidMilestoneInverval"
                );
            });

            it("[IPF][2.1.16] Reverts creation if milestone are not adjacent in time", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const milestoneStartDate2 = dateToSeconds("2100/11/01");
                const milestoneEndDate2 = dateToSeconds("2100/12/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                            {
                                startDate: milestoneStartDate2,
                                endDate: milestoneEndDate2,
                                intervalSeedPortion: percent10InIpBigNumber,
                                intervalStreamingPortion: percent90InIpBigNumber,
                            },
                        ],
                        {value: gelatoFeeAllocation}
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactory,
                    "InvestmentPoolFactory__MilestonesAreNotAdjacentInTime"
                );
            });

            it("[IPF][2.1.17] Reverts creation if milestone percentages are not adding up", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                                intervalStreamingPortion: percent90InIpBigNumber,
                            },
                        ],
                        {value: gelatoFeeAllocation}
                    )
                )
                    .to.be.revertedWithCustomError(
                        investmentPoolFactory,
                        "InvestmentPoolFactory__PercentagesAreNotAddingUp"
                    )
                    .withArgs(percent95InIpBigNumber, percentageDivider);
            });

            it("[IPF][2.1.18] Shouldn't be able to create other type of contract than CLONE_PROXY", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        fUSDTx.address,
                        softCap,
                        hardCap,
                        campaignStartDate,
                        campaignEndDate,
                        1, // CLONE-PROXY
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
                ).to.be.revertedWith("[IPF]: only CLONE_PROXY is supported");
            });

            it("[IPF][2.1.19] Shouldn't be able to create CLONE_PROXY if not enough value for gelato fee is sent", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                        {value: gelatoFeeAllocation.sub(1)}
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactory,
                    "InvestmentPoolFactory__NotEnoughEthValue"
                );
            });

            it("[IPF][2.1.21] Reverts creation if first milestone's seed funds allocation is greater than 50%", async () => {
                const softCap = ethers.utils.parseEther("1000");
                const hardCap = ethers.utils.parseEther("1500");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                                intervalSeedPortion: percent51InIpBigNumber,
                                intervalStreamingPortion: percent49InIpBigNumber,
                            },
                        ],
                        {value: gelatoFeeAllocation}
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactory,
                    "InvestmentPoolFactory__SeedFundsAllocationExceedsMax"
                );
            });

            it("[IPF][2.1.22] Reverts creation if second milestone's seed funds allocation is greater than 10%", async () => {
                const softCap = ethers.utils.parseEther("1000");
                const hardCap = ethers.utils.parseEther("1500");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const milestoneStartDate2 = dateToSeconds("2100/10/01");
                const milestoneEndDate2 = dateToSeconds("2100/11/01");
                const campaignStartDate = dateToSeconds("2100/07/01");
                const campaignEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
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
                                intervalStreamingPortion: percent40InIpBigNumber,
                            },
                            {
                                startDate: milestoneStartDate2,
                                endDate: milestoneEndDate2,
                                intervalSeedPortion: percent6InIpBigNumber,
                                intervalStreamingPortion: percent44InIpBigNumber,
                            },
                        ],
                        {value: gelatoFeeAllocation}
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactory,
                    "InvestmentPoolFactory__SeedFundsAllocationExceedsMax"
                );
            });
        });
    });
});
