import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Framework, WrapperSuperToken} from "@superfluid-finance/sdk-core";
import {BigNumber, BigNumberish, constants} from "ethers";
import {ethers, web3} from "hardhat";
import {assert, expect} from "chai";
import {
    InvestmentPoolFactoryMock,
    InvestmentPoolMock,
    GovernancePoolMockForIntegration,
    DistributionPoolMockForIntegration,
    GelatoOpsMock,
    VotingTokenMock,
    Buidl1,
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
let superfluidAdmin: SignerWithAddress;
let buidl1Admin: SignerWithAddress;
let creator: SignerWithAddress;
let foreignActor: SignerWithAddress;

let sf: Framework;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let investmentPoolLogic: InvestmentPoolMock;
let governancePoolLogic: GovernancePoolMockForIntegration;
let distributionPoolLogic: DistributionPoolMockForIntegration;
let gelatoOpsMock: GelatoOpsMock;
let votingToken: VotingTokenMock;

let gelatoFeeAllocation: BigNumber;
let percentageDivider = BigNumber.from(0);
let formated5Percent: BigNumber;
let formated6Percent: BigNumber;
let formated10Percent: BigNumber;
let formated40Percent: BigNumber;
let formated44Percent: BigNumber;
let formated49Percent: BigNumber;
let formated51Percent: BigNumber;
let formated90Percent: BigNumber;
let formated95Percent: BigNumber;

const generateGaplessMilestones = (
    startTimeStamp: number,
    duration: number,
    amount: number
): {
    startDate: number;
    endDate: number;
    intervalSeedPortion: BigNumber;
    intervalStreamingPortion: BigNumber;
}[] => {
    const arr = [];
    let prevTimestamp = startTimeStamp;

    for (let i = 0; i < amount; i++) {
        arr.push({
            startDate: prevTimestamp,
            endDate: prevTimestamp + duration,
            intervalSeedPortion: formated10Percent.div(amount),
            intervalStreamingPortion: formated90Percent.div(amount),
        });
        prevTimestamp += duration;
    }

    return arr;
};

const formatPercentage = (percent: BigNumberish): BigNumber => {
    return percentageDivider.mul(percent).div(100);
};

const dateToSeconds = (date: string): number => {
    return new Date(date).getTime() / 1000;
};

const errorHandler = (err: any) => {
    if (err) throw err;
};

const deployLogicContracts = async () => {
    const investmentPoolLogicDep = await ethers.getContractFactory(
        "InvestmentPoolMock",
        buidl1Admin
    );
    investmentPoolLogic = await investmentPoolLogicDep.deploy();
    await investmentPoolLogic.deployed();

    const governancePoolLogicDep = await ethers.getContractFactory(
        "GovernancePoolMockForIntegration",
        buidl1Admin
    );
    governancePoolLogic = await governancePoolLogicDep.deploy();
    await governancePoolLogic.deployed();

    const distributionPoolLogicDep = await ethers.getContractFactory(
        "DistributionPoolMockForIntegration",
        buidl1Admin
    );
    distributionPoolLogic = await distributionPoolLogicDep.deploy();
    await distributionPoolLogic.deployed();
};

const deployInvestmentPoolFactory = async () => {
    // Deploy Gelato Ops contract mock
    const gelatoOpsMockDep = await ethers.getContractFactory("GelatoOpsMock", buidl1Admin);
    gelatoOpsMock = await gelatoOpsMockDep.deploy();
    await gelatoOpsMock.deployed();

    // Deploy Voting Token
    const votingTokenDep = await ethers.getContractFactory("VotingTokenMock", buidl1Admin);
    votingToken = await votingTokenDep.deploy();
    await votingToken.deployed();

    // Deploy Investment Pool Factory contract
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
};

const getConstantVariablesFromContract = async () => {
    await deployLogicContracts();
    await deployInvestmentPoolFactory();

    percentageDivider = await investmentPoolFactory.getPercentageDivider();
    formated5Percent = formatPercentage(5);
    formated6Percent = formatPercentage(6);
    formated10Percent = formatPercentage(10);
    formated40Percent = formatPercentage(40);
    formated44Percent = formatPercentage(44);
    formated49Percent = formatPercentage(49);
    formated51Percent = formatPercentage(51);
    formated90Percent = formatPercentage(90);
    formated95Percent = formatPercentage(95);

    gelatoFeeAllocation = await investmentPoolFactory.getGelatoFeeAllocationForProject();
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

    // initialize the superfluid framework...put custom and web3 only bc we are using hardhat locally
    sf = await Framework.create({
        resolverAddress: process.env.RESOLVER_ADDRESS,
        chainId: 31337,
        provider,
        protocolReleaseVersion: "test",
    });

    fUSDTx = await sf.loadWrapperSuperToken("fUSDTx");
    fUSDT = new ethers.Contract(fUSDTx.underlyingToken.address, fTokenAbi, superfluidAdmin);
};

describe("Investment Pool Factory", async () => {
    before(async () => {
        // get accounts from hardhat
        accounts = await ethers.getSigners();
        superfluidAdmin = accounts[0];
        buidl1Admin = accounts[1];
        creator = accounts[2];
        foreignActor = accounts[3];

        await deploySuperfluidToken();
        await getConstantVariablesFromContract();
    });

    describe("1. Investment pool factory creation", () => {
        beforeEach(async () => {
            await deployLogicContracts();
        });

        describe("1.1 State variables", () => {
            it("[IPF][1.1.1] Constructor should set state variables correctly", async () => {
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
                const investmentPoolFactoryDep = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );

                await expect(
                    investmentPoolFactoryDep.deploy(
                        constants.AddressZero,
                        gelatoOpsMock.address,
                        investmentPoolLogic.address,
                        governancePoolLogic.address,
                        distributionPoolLogic.address,
                        votingToken.address
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactoryDep,
                    "InvestmentPoolFactory__HostAddressIsZero"
                );
            });

            it("[IPF][1.2.2] Should revert if gelato ops address is zero", async () => {
                const investmentPoolFactoryDep = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );

                await expect(
                    investmentPoolFactoryDep.deploy(
                        sf.settings.config.hostAddress,
                        constants.AddressZero,
                        investmentPoolLogic.address,
                        governancePoolLogic.address,
                        distributionPoolLogic.address,
                        votingToken.address
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactoryDep,
                    "InvestmentPoolFactory__GelatoOpsAddressIsZero"
                );
            });

            it("[IPF][1.2.3] Should revert if implementation contract address is zero", async () => {
                const investmentPoolFactoryDep = await ethers.getContractFactory(
                    "InvestmentPoolFactoryMock",
                    buidl1Admin
                );

                await expect(
                    investmentPoolFactoryDep.deploy(
                        sf.settings.config.hostAddress,
                        gelatoOpsMock.address,
                        constants.AddressZero,
                        governancePoolLogic.address,
                        distributionPoolLogic.address,
                        votingToken.address
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactoryDep,
                    "InvestmentPoolFactory__ImplementationContractAddressIsZero"
                );
            });

            it("[IPF][1.2.4] Should successfully create a clone contract", async () => {
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

                const investmentPoolClone =
                    await investmentPoolFactory.callStatic.deployInvestmentPoolClone();

                // New address was created
                assert.isTrue(ethers.utils.isAddress(investmentPoolClone));
            });

            it("[IPF][1.2.5] Should be able to receive ETH", async () => {
                const ethAmountToReceive = ethers.utils.parseEther("1");

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

                await buidl1Admin.sendTransaction({
                    to: investmentPoolFactory.address,
                    value: ethAmountToReceive,
                });

                const contractBalance = await ethers.provider.getBalance(
                    investmentPoolFactory.address
                );
                assert.equal(ethAmountToReceive.toString(), contractBalance.toString());
            });

            it("[IPF][1.2.6] Deployer should be able to update gelato fee allocation value", async () => {
                const newEthFee = ethers.utils.parseEther("0.321");

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

                await expect(
                    investmentPoolFactory.connect(buidl1Admin).setGelatoFeeAllocation(newEthFee)
                ).not.to.be.reverted;

                const gelatoFee = await investmentPoolFactory.getGelatoFeeAllocationForProject();
                assert.equal(gelatoFee.toString(), newEthFee.toString());
            });

            it("[IPF][1.2.7] Bad actor shouldn't be able to update gelato fee allocation value", async () => {
                const newEthFee = ethers.utils.parseEther("0.321");

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

                await expect(
                    investmentPoolFactory.connect(foreignActor).setGelatoFeeAllocation(newEthFee)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                const gelatoFee = await investmentPoolFactory.getGelatoFeeAllocationForProject();
                assert.equal(gelatoFee.toString(), gelatoFeeAllocation.toString());
            });
        });
    });

    describe("2. createProjectPools() function", () => {
        beforeEach(async () => {
            await deployLogicContracts();
            await deployInvestmentPoolFactory();

            await investmentPoolFactory.setTimestamp(dateToSeconds("2100/06/01"));
        });

        describe("2.1 Interactions", () => {
            it("[IPF][2.1.1] On CLONE_PROXY investment pool creation events are emited", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                const creationRes = await investmentPoolFactory
                    .connect(creator)
                    .createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                const creationRes = await investmentPoolFactory
                    .connect(creator)
                    .createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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

                // Verify the fundraiser variables
                assert.equal(poolSoftCap.toString(), softCap.toString(), "Wrong soft cap");
                assert.equal(poolHardCap.toString(), hardCap.toString(), "Wrong hard cap");
                assert.equal(creatorAddress, creator.address, "Wrong creator address");
                assert.equal(gelatoOpsAddress, gelatoOpsMock.address, "Wrong gelato ops address");
                assert.equal(invested.toString(), "0", "Wrong invested amount");
                assert.equal(
                    fundraiserStartAt,
                    fundraiserStartDate,
                    "Wrong fundraiser start date"
                );
                assert.equal(fundraiserEndAt, fundraiserEndDate, "Wrong fundraiser end date");
                assert.equal(milestoneCount.toString(), "1", "Wrong milestones amount");
                assert.equal(
                    milestone.startDate,
                    milestoneStartDate,
                    "Wrong milestone start date"
                );
                assert.equal(milestone.endDate, milestoneEndDate, "Wrong milestone end date");
                assert.isFalse(milestone.paid, "Wrong paid status");
                assert.isFalse(milestone.seedAmountPaid, "Wrong seed amount paid status");
                assert.isFalse(milestone.streamOngoing, "Wrong stream ongoing status");
                assert.equal(milestone.paidAmount.toString(), "0", "Wrong paid amount");
            });

            it("[IPF][2.1.3] Reverts creation if accepted token address is zero", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: constants.AddressZero,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                // Move forward in time to simulate retrospective creation for fundraiser
                await investmentPoolFactory.setTimestamp(dateToSeconds("2100/07/15"));

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
                            },
                        ],
                        {value: gelatoFeeAllocation}
                    )
                ).to.be.revertedWithCustomError(
                    investmentPoolFactory,
                    "InvestmentPoolFactory__FundraiserStartIsInPast"
                );
            });

            it("[IPF][2.1.6] Reverts creation if fundraiser fundraiser ends before it starts", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                // Fundraiser ends before it starts
                const fundraiserStartDate = dateToSeconds("2100/08/01");
                const fundraiserEndDate = dateToSeconds("2100/07/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/10/10");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/07/10");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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

                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/10");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                // 30 days
                const milestoneDuration = 30 * 24 * 60 * 60;
                const maxMilestones = await investmentPoolFactory.getMaxMilestoneCount();
                const milestones = generateGaplessMilestones(
                    milestoneStartDate,
                    milestoneDuration,
                    maxMilestones + 1 // Intentionally provoke reverting
                );

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        milestones,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                // 30 days
                const milestoneDuration = 30 * 24 * 60 * 60;
                const maxMilestones = await investmentPoolFactory.getMaxMilestoneCount();
                const milestones = generateGaplessMilestones(
                    milestoneStartDate,
                    milestoneDuration,
                    maxMilestones // Let's create as many as it's allowed
                );

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
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
                const fundraiserStartDate = dateToSeconds("2100/08/01");
                const fundraiserEndDate = dateToSeconds("2100/10/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
                            },
                            {
                                startDate: milestoneStartDate2,
                                endDate: milestoneEndDate2,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated5Percent,
                                intervalStreamingPortion: formated90Percent,
                            },
                        ],
                        {value: gelatoFeeAllocation}
                    )
                )
                    .to.be.revertedWithCustomError(
                        investmentPoolFactory,
                        "InvestmentPoolFactory__PercentagesAreNotAddingUp"
                    )
                    .withArgs(formated95Percent, percentageDivider);
            });

            it("[IPF][2.1.18] Shouldn't be able to create other type of contract than CLONE_PROXY", async () => {
                const softCap = ethers.utils.parseEther("1500");
                const hardCap = ethers.utils.parseEther("15000");

                const milestoneStartDate = dateToSeconds("2100/09/01");
                const milestoneEndDate = dateToSeconds("2100/10/01");
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        1, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated90Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated51Percent,
                                intervalStreamingPortion: formated49Percent,
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
                const fundraiserStartDate = dateToSeconds("2100/07/01");
                const fundraiserEndDate = dateToSeconds("2100/08/01");

                await expect(
                    investmentPoolFactory.connect(creator).createProjectPools(
                        {
                            softCap: softCap,
                            hardCap: hardCap,
                            fundraiserStartAt: fundraiserStartDate,
                            fundraiserEndAt: fundraiserEndDate,
                            acceptedToken: fUSDTx.address,
                            projectToken: fUSDT.address,
                            tokenRewards: ethers.utils.parseEther("100"),
                        },
                        0, // CLONE-PROXY
                        [
                            {
                                startDate: milestoneStartDate,
                                endDate: milestoneEndDate,
                                intervalSeedPortion: formated10Percent,
                                intervalStreamingPortion: formated40Percent,
                            },
                            {
                                startDate: milestoneStartDate2,
                                endDate: milestoneEndDate2,
                                intervalSeedPortion: formated6Percent,
                                intervalStreamingPortion: formated44Percent,
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
