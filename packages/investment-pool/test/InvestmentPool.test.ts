import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Framework, WrapperSuperToken} from "@superfluid-finance/sdk-core";
import {BigNumber, ContractTransaction, constants} from "ethers";
import {ethers, web3} from "hardhat";
import {assert, expect} from "chai";
import {
    InvestmentPoolFactoryMock,
    InvestmentPoolMock,
    GelatoOpsMock,
} from "../typechain-types";
import traveler from "ganache-time-traveler";
import {notDeepEqual} from "assert";

// const { toWad } = require("@decentral.ee/web3-helpers");
// const { assert, should, expect } = require("chai");
const fTokenAbi = require("./abis/fTokenAbi");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");

// Corresponds to each investor having N fUSDTx (fake USDT wrapped into a SuperToken, hence x suffix)
// Should be enough for all of the tests, in order to not perform funding before each
const INVESTOR_INITIAL_FUNDS = ethers.utils.parseEther("50000000000");

const UINT256_MAX = constants.MaxUint256;

const provider = web3;

let fUSDT: InstanceType<typeof fTokenAbi>;
let fUSDTx: WrapperSuperToken;

let accounts: SignerWithAddress[];
let admin: SignerWithAddress;
let buidl1Admin: SignerWithAddress;
let creator: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;

let investors: SignerWithAddress[];

let foreignActor: SignerWithAddress;

let sf: Framework;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let investment: InvestmentPoolMock;

let snapshotId: string;

let softCap: BigNumber;
let hardCap: BigNumber;
let milestoneStartDate: BigNumber;
let milestoneEndDate: BigNumber;
let milestoneStartDate2: BigNumber;
let milestoneEndDate2: BigNumber;
let campaignStartDate: BigNumber;
let campaignEndDate: BigNumber;

let creationRes: ContractTransaction;
let gelatoOpsMock: GelatoOpsMock;

let percentageDivider: BigNumber = BigNumber.from(0);
let percent5InIpBigNumber: BigNumber;
let percent20InIpBigNumber: BigNumber;
let percent25InIpBigNumber: BigNumber;
let percent70InIpBigNumber: BigNumber;
let percent95InIpBigNumber: BigNumber;

const percentToIpBigNumber = (percent: number): BigNumber => {
    return percentageDivider.mul(percent).div(100);
};

const errorHandler = (err: any) => {
    if (err) throw err;
};

const getInvestmentFromTx = async (
    tx: ContractTransaction
): Promise<InvestmentPoolMock> => {
    const creationEvent = (await tx.wait(1)).events?.find(
        (e) => e.event === "Created"
    );

    assert.isDefined(creationEvent, "Didn't emit creation event");

    const poolAddress = creationEvent?.args?.pool;

    const contractFactory = await ethers.getContractFactory(
        "InvestmentPoolMock",
        buidl1Admin
    );

    const pool = contractFactory.attach(poolAddress);

    return pool;
};

const dateToSeconds = (
    date: string,
    isBigNumber: boolean = true
): BigNumber | number => {
    const convertedDate = new Date(date).getTime() / 1000;
    if (isBigNumber) {
        return BigNumber.from(convertedDate);
    } else {
        return convertedDate;
    }
};

const definePercentageDivider = async (
    investmentPoolFactory: InvestmentPoolFactoryMock
) => {
    percentageDivider = await investmentPoolFactory.PERCENTAGE_DIVIDER();
    percent5InIpBigNumber = percentToIpBigNumber(5);
    percent20InIpBigNumber = percentToIpBigNumber(20);
    percent25InIpBigNumber = percentToIpBigNumber(25);
    percent70InIpBigNumber = percentToIpBigNumber(70);
    percent95InIpBigNumber = percentToIpBigNumber(95);
};

const createInvestmentWithOneMilestone = async () => {
    hardCap = ethers.utils.parseEther("15000");
    softCap = ethers.utils.parseEther("1500");
    milestoneStartDate = dateToSeconds("2022/09/01") as BigNumber;
    milestoneEndDate = dateToSeconds("2022/10/01") as BigNumber;
    campaignStartDate = dateToSeconds("2022/07/01") as BigNumber;
    campaignEndDate = dateToSeconds("2022/08/01") as BigNumber;

    creationRes = await investmentPoolFactory
        .connect(creator)
        .createInvestmentPool(
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
                    intervalStreamingPortion: percent95InIpBigNumber,
                },
            ]
        );

    investment = await getInvestmentFromTx(creationRes);
};

const createInvestmentWithTwoMilestones = async () => {
    hardCap = ethers.utils.parseEther("15000");
    softCap = ethers.utils.parseEther("1500");
    milestoneStartDate = dateToSeconds("2022/09/01") as BigNumber;
    milestoneEndDate = dateToSeconds("2022/10/01") as BigNumber;
    milestoneStartDate2 = dateToSeconds("2022/10/01") as BigNumber;
    milestoneEndDate2 = dateToSeconds("2022/12/01") as BigNumber;
    campaignStartDate = dateToSeconds("2022/07/01") as BigNumber;
    campaignEndDate = dateToSeconds("2022/08/01") as BigNumber;

    creationRes = await investmentPoolFactory
        .connect(creator)
        .createInvestmentPool(
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
            ]
        );

    investment = await getInvestmentFromTx(creationRes);
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
            amount: UINT256_MAX.toString(),
        })
        .exec(investorObj);

    // Invest money
    await investmentPool.connect(investorObj).invest(investedMoney, false);
};

describe("Investment Pool", async () => {
    before(async () => {
        // get accounts from hardhat
        accounts = await ethers.getSigners();

        admin = accounts[0];
        buidl1Admin = accounts[1];
        creator = accounts[2];
        investorA = accounts[3];
        investorB = accounts[4];

        foreignActor = accounts[8];
        investors = [investorA, investorB];

        // deploy the framework
        await deployFramework(errorHandler, {
            web3,
            from: admin.address,
        });

        // deploy a fake erc20 token
        const fUSDTAddress = await deployTestToken(
            errorHandler,
            [":", "fUSDT"],
            {
                web3,
                from: admin.address,
            }
        );

        // deploy a fake erc20 wrapper super token around the fUSDT token
        const fUSDTxAddress = await deploySuperToken(
            errorHandler,
            [":", "fUSDT"],
            {
                web3,
                from: admin.address,
            }
        );

        console.log("fUSDT  Address: ", fUSDTAddress);
        console.log("fUSDTx Address: ", fUSDTxAddress);

        sf = await Framework.create({
            resolverAddress: process.env.RESOLVER_ADDRESS,
            chainId: 31337,
            provider,
            protocolReleaseVersion: "test",
        });

        // Create and deploy Gelato Ops contract mock
        const GelatoOpsMock = await ethers.getContractFactory(
            "GelatoOpsMock",
            buidl1Admin
        );
        gelatoOpsMock = await GelatoOpsMock.deploy();
        await gelatoOpsMock.deployed();

        fUSDTx = await sf.loadWrapperSuperToken("fUSDTx");

        const underlyingAddr = fUSDTx.underlyingToken.address;

        fUSDT = new ethers.Contract(underlyingAddr, fTokenAbi, admin);

        // Create investment pool implementation contract
        const investmentPoolDep = await ethers.getContractFactory(
            "InvestmentPoolMock",
            buidl1Admin
        );

        const investmentPool = await investmentPoolDep.deploy();
        await investmentPool.deployed();

        // Create investment pool factory contract
        const investmentPoolDepFactory = await ethers.getContractFactory(
            "InvestmentPoolFactoryMock",
            buidl1Admin
        );

        investmentPoolFactory = await investmentPoolDepFactory.deploy(
            sf.settings.config.hostAddress,
            gelatoOpsMock.address,
            investmentPool.address
        );
        await investmentPoolFactory.deployed();

        // Get percentage divider
        definePercentageDivider(investmentPoolFactory);

        // Enforce a starting timestamp to avoid time based bugs
        const time = dateToSeconds("2022/06/01");
        await investmentPoolFactory.connect(buidl1Admin).setTimestamp(time);

        const totalAmount = INVESTOR_INITIAL_FUNDS.mul(investors.length);

        // Fund investors
        await fUSDT.connect(admin).mint(admin.address, totalAmount);
        await fUSDT
            .connect(admin)
            .approve(
                fUSDTx.address,
                INVESTOR_INITIAL_FUNDS.mul(investors.length)
            );

        const upgradeOperation = fUSDTx.upgrade({
            amount: totalAmount.toString(),
        });
        const operations = [upgradeOperation];

        // Transfer upgraded tokens to investors
        for (let i = 0; i < investors.length; i++) {
            const operation = fUSDTx.transferFrom({
                sender: admin.address,
                amount: INVESTOR_INITIAL_FUNDS.toString(),
                receiver: investors[i].address,
            });
            operations.push(operation);
        }

        await sf.batchCall(operations).exec(admin);
    });

    beforeEach(async () => {
        await createInvestmentWithTwoMilestones();
    });

    afterEach(async () => {
        // If prior investment exists, check if it has an active money stream, terminate it
        if (investment) {
            const existingFlow = await sf.cfaV1.getFlow({
                superToken: fUSDTx.address,
                sender: investment.address,
                receiver: creator.address,
                providerOrSigner: creator,
            });

            // App is actively streaming money to our creator, terminate that stream
            if (BigNumber.from(existingFlow.flowRate).gt(0)) {
                console.log("TERMINATE FLOW");
                await sf.cfaV1
                    .deleteFlow({
                        sender: investment.address,
                        receiver: creator.address,
                        superToken: fUSDTx.address,
                    })
                    .exec(creator);
            }
        }
    });

    describe("1. Investment pool creation", () => {
        describe("1.1 Public state", () => {
            it("[IP][1.1.1] Should assign accepted token correctly", async () => {
                const acceptedToken = await investment.acceptedToken();
                assert.equal(
                    fUSDTx.address,
                    acceptedToken,
                    "Token addresses are not the same"
                );
            });

            it("[IP][1.1.2] Should assign creator correctly", async () => {
                const contractCreator = await investment.creator();
                assert.equal(creator.address, contractCreator);
            });

            it("[IP][1.1.3] Should assign gelato ops correctly", async () => {
                const contractGelatoOps = await investment.gelatoOps();
                assert.equal(gelatoOpsMock.address, contractGelatoOps);
            });

            it("[IP][1.1.4] Should assign soft cap correctly", async () => {
                const contractSoftCap = await investment.softCap();
                assert.deepEqual(softCap, contractSoftCap);
            });

            it("[IP][1.1.5] Should assign hard cap correctly", async () => {
                const contractHardCap = await investment.hardCap();
                assert.deepEqual(hardCap, contractHardCap);
            });

            it("[IP][1.1.6] Should assign fundraiser start time correctly", async () => {
                const contractFundraiserStart = BigNumber.from(
                    await investment.fundraiserStartAt()
                );
                assert.deepEqual(campaignStartDate, contractFundraiserStart);
            });

            it("[IP][1.1.7] Should assign fundraiser end time correctly", async () => {
                const contractFundraiserEnd = BigNumber.from(
                    await investment.fundraiserEndAt()
                );
                assert.deepEqual(campaignEndDate, contractFundraiserEnd);
            });

            it("[IP][1.1.8] Should assign termination window correctly", async () => {
                const contractTermination =
                    await investment.terminationWindow();
                const realTermination =
                    await investmentPoolFactory.TERMINATION_WINDOW();

                assert.deepEqual(realTermination, contractTermination);
            });

            it("[IP][1.1.9] Should assign automated termination window correctly", async () => {
                const contractTermination =
                    await investment.automatedTerminationWindow();
                const realTermination =
                    await investmentPoolFactory.AUTOMATED_TERMINATION_WINDOW();

                assert.equal(realTermination, contractTermination);
            });

            it("[IP][1.1.10] Should assign milestones count correctly", async () => {
                const contractCount = await investment.milestoneCount();
                const realCount = BigNumber.from(2);
                assert.deepEqual(contractCount, realCount);
            });

            it("[IP][1.1.11] Should assign current milestone to zero", async () => {
                const contractCurrentMilestone =
                    await investment.currentMilestone();
                const realMilestone = BigNumber.from(0);
                assert.deepEqual(contractCurrentMilestone, realMilestone);
            });

            it("[IP][1.1.12] Fundraiser shouldn't be terminated with emergency on a fresh campaign", async () => {
                const isEmergencyTerminated =
                    await investment.isEmergencyTerminated();
                assert.equal(isEmergencyTerminated, false);
            });

            it("[IP][1.1.13] Fundraiser shouldn't be ongoing on a fresh campaign if the start date is in the future", async () => {
                // NOTE: At this point we at 2022/06/01
                const isFundraiserOngoing =
                    await investment.isFundraiserOngoingNow();
                assert.equal(isFundraiserOngoing, false);
            });

            it("[IP][1.1.14] Fundraiser shouldn't have reached soft cap upon creation", async () => {
                const hasRaisedSoftCap = await investment.isSoftCapReached();
                assert.equal(hasRaisedSoftCap, false);
            });

            it("[IP][1.1.15] Fundraiser shouldn't have ended upon campaign creation", async () => {
                const hasFundraiserEnded =
                    await investment.didFundraiserPeriodEnd();
                assert.equal(hasFundraiserEnded, false);
            });

            it("[IP][1.1.16] Fundraiser shouldn't have a failed fundraiser state on creation", async () => {
                const isFailed = await investment.isFailedFundraiser();
                assert.equal(isFailed, false);
            });

            it("[IP][1.1.17] Fundraiser shouldn't have any investments yet", async () => {
                const invested = await investment.totalInvestedAmount();
                assert.deepEqual(invested, BigNumber.from(0));
            });

            it("[IP][1.1.18] Milestones should have a correct start date", async () => {
                const milestone1 = await investment.milestones(0);
                const milestone2 = await investment.milestones(1);
                assert.deepEqual(
                    BigNumber.from(milestone1.startDate),
                    milestoneStartDate
                );
                assert.deepEqual(
                    BigNumber.from(milestone2.startDate),
                    milestoneStartDate2
                );
            });

            it("[IP][1.1.19] Milestones should have a correct end date", async () => {
                const milestone1 = await investment.milestones(0);
                const milestone2 = await investment.milestones(1);
                assert.deepEqual(
                    BigNumber.from(milestone1.endDate),
                    milestoneEndDate
                );
                assert.deepEqual(
                    BigNumber.from(milestone2.endDate),
                    milestoneEndDate2
                );
            });

            it("[IP][1.1.20] Milestones should not be paid initially", async () => {
                const milestone1 = await investment.milestones(0);
                const milestone2 = await investment.milestones(1);
                assert.equal(milestone1.paid, false);
                assert.equal(milestone2.paid, false);
            });

            it("[IP][1.1.21] Milestones' seed amounts should not be paid initially", async () => {
                const milestone1 = await investment.milestones(0);
                const milestone2 = await investment.milestones(1);
                assert.equal(milestone1.seedAmountPaid, false);
                assert.equal(milestone2.seedAmountPaid, false);
            });

            it("[IP][1.1.22] Milestones' streams should not be ongoing from the start", async () => {
                const milestones1 = await investment.milestones(0);
                const milestones2 = await investment.milestones(1);
                assert.equal(milestones1.streamOngoing, false);
                assert.equal(milestones2.streamOngoing, false);
            });

            it("[IP][1.1.23] Should have paid 0 in funds upon creation", async () => {
                const milestone1 = await investment.milestones(0);
                const milestone2 = await investment.milestones(1);
                assert.deepEqual(milestone1.paidAmount, BigNumber.from(0));
                assert.deepEqual(milestone2.paidAmount, BigNumber.from(0));
            });

            it("[IP][1.1.24] Milestones should have a correct seed portions", async () => {
                const milestone1 = await investment.milestones(0);
                const milestone2 = await investment.milestones(1);
                assert.deepEqual(
                    milestone1.intervalSeedPortion,
                    percent5InIpBigNumber
                );
                assert.deepEqual(
                    milestone2.intervalSeedPortion,
                    percent5InIpBigNumber
                );
            });

            it("[IP][1.1.25] Milestones should have a correct stream portions", async () => {
                const milestone1 = await investment.milestones(0);
                const milestone2 = await investment.milestones(1);
                assert.deepEqual(
                    milestone1.intervalStreamingPortion,
                    percent70InIpBigNumber
                );
                assert.deepEqual(
                    milestone2.intervalStreamingPortion,
                    percent20InIpBigNumber
                );
            });

            it("[IP][1.1.26] Should assign milestones portions correctly", async () => {
                const milestone1 = await investment.getMemMilestonePortions(0);
                const milestone2 = await investment.getMemMilestonePortions(1);
                const lastItem = await investment.getMemMilestonePortions(2);
                assert.deepEqual(milestone1, percentageDivider);
                assert.deepEqual(milestone2, percent25InIpBigNumber);
                assert.deepEqual(lastItem, BigNumber.from(0));
            });

            it("[IP][1.1.27] Should assign total streaming duration correctly", async () => {
                const totalStreamingDuration =
                    await investment.totalStreamingDuration();
                const realDuration =
                    milestoneEndDate.toNumber() -
                    milestoneStartDate.toNumber() +
                    (milestoneEndDate2.toNumber() -
                        milestoneStartDate2.toNumber());
                assert.deepEqual(totalStreamingDuration, realDuration);
            });
        });
    });

    describe("2. Fundraiser cancelation and start", () => {
        describe("2.1 Public state", () => {
            it("[IP][2.1.1] Fundraiser should be ongoing if the starting date has passed", async () => {
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                const isFundraiserOngoing =
                    await investment.isFundraiserOngoingNow();
                assert.equal(isFundraiserOngoing, true);
            });

            it("[IP][2.1.2] Fundraiser shouldn't have a soft cap raised initially after the fundraiser start", async () => {
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                const isSoftCapReached = await investment.isSoftCapReached();
                assert.equal(isSoftCapReached, false);
            });

            it("[IP][2.1.3] Fundraiser period shouldn't have ended yet", async () => {
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                const hasFundraiserEnded =
                    await investment.didFundraiserPeriodEnd();
                assert.equal(hasFundraiserEnded, false);
            });

            it("[IP][2.1.4] Fundraiser shouldn't have a failed state during active fundraiser", async () => {
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                const isFailed = await investment.isFailedFundraiser();
                assert.equal(isFailed, false);
            });
        });

        describe("2.2 Interactions", () => {
            it("[IP][2.2.1] Fundraiser can be cancelled if it's not started yet", async () => {
                // Enforce a timestamp before campaign start
                const time = dateToSeconds("2022/06/15");
                await investment.connect(buidl1Admin).setTimestamp(time);

                await expect(investment.connect(creator).cancel()).to.emit(
                    investment,
                    "Cancel"
                );
                assert.notEqual(
                    await investment.emergencyTerminationTimestamp(),
                    0
                );
            });

            it("[IP][2.2.2] Fundraiser can't be cancelled by anyone, except creator", async () => {
                // Enforce a timestamp before campaign start
                const time = dateToSeconds("2022/06/15");
                await investment.connect(buidl1Admin).setTimestamp(time);

                await expect(
                    investment.connect(foreignActor).cancel()
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__NotCreator"
                );
            });

            it("[IP][2.2.3] Fundraiser can't be cancelled, if it's already started", async () => {
                // Fundraiser has already started by now
                const time = dateToSeconds("2022/07/15");
                await investment.connect(buidl1Admin).setTimestamp(time);

                await expect(
                    investment.connect(creator).cancel()
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__FundraiserAlreadyStarted"
                );
            });

            it("[IP][2.2.4] Fundraiser can't be cancelled, if it's already been canceled", async () => {
                // Enforce a timestamp before campaign start
                const time = dateToSeconds("2022/06/15");
                await investment.connect(buidl1Admin).setTimestamp(time);

                await investment.connect(creator).cancel();
                await expect(
                    investment.connect(creator).cancel()
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__CampaignCanceled"
                );
            });
        });
    });

    describe("3. Investing process", () => {
        describe("3.1 Public state", () => {
            it("[IP][3.1.1] On fundraising investors investment should update memMilestoneInvestments", async () => {
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorA,
                    investedAmount
                );

                const memMilestoneInvestments =
                    await investment.getMemMilestoneInvestments(0);

                assert.deepEqual(investedAmount, memMilestoneInvestments);
            });

            it("[IP][3.1.2] On fundraising investors investment should update investedAmount", async () => {
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorA,
                    investedAmount
                );

                const contractInvestedAmount = await investment.investedAmount(
                    investorA.address,
                    0
                );

                assert.deepEqual(investedAmount, contractInvestedAmount);
            });

            it("[IP][3.1.3] On fundraising investors investment should update totalInvestedAmount", async () => {
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorA,
                    investedAmount
                );

                const totalInvestedAmount =
                    await investment.totalInvestedAmount();

                assert.deepEqual(investedAmount, totalInvestedAmount);
            });

            it("[IP][3.1.4] On fundraising investors investment should update balance", async () => {
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("100");
                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorA,
                    investedAmount
                );

                const investorBalance = await fUSDTx.balanceOf({
                    account: investorA.address,
                    providerOrSigner: investorA,
                });

                const balanceDiff = investorPriorBalance.sub(investedAmount);
                assert.deepEqual(BigNumber.from(investorBalance), balanceDiff);
            });

            it("[IP][3.1.5] On fundraising investors investment should emit event", async () => {
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);
            });

            it("[IP][3.1.6] On milestone 0 investor investment should update memMilestoneInvestments", async () => {
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("100");
                const investedAmount2: BigNumber = ethers.utils.parseEther("5");

                // NOTE: Time traveling to 2022/07/15, when 1st milestone already started
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorA,
                    investedAmount
                );

                // NOTE: Time traveling to 2022/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2022/09/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorB,
                    investedAmount2
                );

                const memMilestoneInvestments =
                    await investment.getMemMilestoneInvestments(1);
                const memMilestonePortions =
                    await investment.getMemMilestonePortions(1);
                const expectedMemInvestment = investedAmount.add(
                    investedAmount2
                        .mul(percentageDivider)
                        .div(memMilestonePortions)
                );

                assert.deepEqual(
                    memMilestoneInvestments,
                    expectedMemInvestment
                );
            });

            it("[IP][3.1.7] On milestone 0 investor investment should update investedAmount", async () => {
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("100");
                const investedAmount2: BigNumber = ethers.utils.parseEther("5");

                // NOTE: Time traveling to 2022/07/15, when 1st milestone already started
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorA,
                    investedAmount
                );

                // NOTE: Time traveling to 2022/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2022/09/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorB,
                    investedAmount2
                );

                const amount = await investment.investedAmount(
                    investorB.address,
                    1
                );
                assert.deepEqual(investedAmount2, amount);
            });

            it("[IP][3.1.8] On milestone 0 investor investment should update totalInvestedAmount", async () => {
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("100");
                const investedAmount2: BigNumber = ethers.utils.parseEther("5");

                // NOTE: Time traveling to 2022/07/15, when 1st milestone already started
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorA,
                    investedAmount
                );

                // NOTE: Time traveling to 2022/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2022/09/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(
                    fUSDTx,
                    investment,
                    investorB,
                    investedAmount2
                );

                const amount = await investment.totalInvestedAmount();
                assert.deepEqual(investedAmount.add(investedAmount2), amount);
            });
        });

        describe("3.2 Interactions", () => {
            it("[IP][3.2.1] Investor shouldn't be able to invest if fundraiser has already been canceled", async () => {
                const amountToInvest: BigNumber = ethers.utils.parseEther("1");

                await investment.connect(creator).cancel();

                await expect(
                    investment.connect(investorA).invest(amountToInvest, false)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__CampaignCanceled"
                );
            });

            it("[IP][3.2.2] Investor shouldn't be able to invest if fundraiser hasn't been started", async () => {
                const amountToInvest: BigNumber = ethers.utils.parseEther("1");
                const time = dateToSeconds("2022/06/15");
                await investment.connect(buidl1Admin).setTimestamp(time);

                await expect(
                    investment.connect(investorA).invest(amountToInvest, false)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__FundraiserNotStartedYet"
                );
            });

            it("[IP][3.2.3] Investor shouldn't be able to invest more than a hard cap if stric mode is enabled", async () => {
                const amountToInvest: BigNumber = hardCap.add(1);
                const time = dateToSeconds("2022/07/15");
                await investment.connect(buidl1Admin).setTimestamp(time);

                await expect(
                    investment.connect(investorA).invest(amountToInvest, true)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__CannotInvestAboveHardCap"
                );
            });

            it("[IP][3.2.4] Investor shouldn't be able to invest more than a hard cap if hard cap is reached", async () => {
                const amountToInvest: BigNumber = ethers.utils.parseEther("1");
                const time = dateToSeconds("2022/07/15");
                await investment.connect(buidl1Admin).setTimestamp(time);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await investment.connect(investorA).invest(hardCap, false);

                await expect(
                    investment.connect(investorB).invest(amountToInvest, false)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__CannotInvestAboveHardCap"
                );
            });

            it("[IP][3.2.5] Investor shouldn't be able to invest more than a hard cap if hard cap is reached and stric mode is enabled", async () => {
                const amountToInvest: BigNumber = ethers.utils.parseEther("1");
                const time = dateToSeconds("2022/07/15");
                await investment.connect(buidl1Admin).setTimestamp(time);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await investment.connect(investorA).invest(hardCap, false);

                await expect(
                    investment.connect(investorB).invest(amountToInvest, true)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__CannotInvestAboveHardCap"
                );
            });

            it("[IP][3.2.6] Should allow a smaller investment to go through than a total amount", async () => {
                const amountToInvest: BigNumber = hardCap.add(10);
                const time = dateToSeconds("2022/07/15");
                await investment.connect(buidl1Admin).setTimestamp(time);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(amountToInvest, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, hardCap);
            });

            it("[IP][3.2.7] Shouldn't be able to invest in last milestone", async () => {
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                await investment.setCurrentMilestone(1);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__InLastMilestone"
                );
            });
            it("[IP][3.2.8] Shouldn't be able to invest zero amount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("0");

                // NOTE: Time traveling to 2022/07/15, when 1st milestone already started
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__ZeroAmountProvided"
                );
            });
        });
    });

    describe("4. Unpledge process", () => {
        describe("4.1 Public state", () => {
            it("[IP][4.1.1]", async () => {});
        });
        describe("4.2 Interactions", () => {
            it("[IP][4.2.1]", async () => {});
        });
    });
});
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/*
    describe("3. Fundraiser", () => {
        describe("3.2 Interactions", () => {
            it("[IP][2.2.3] Investor should be able to do a full unpledge", async () => {
                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);
                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);
                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);
                // Request them back
                await expect(
                    investment.connect(investorA).unpledge(0, investedAmount)
                )
                    .to.emit(investment, "Unpledge")
                    .withArgs(investorA.address, investedAmount);
                const investorsBalance = await fUSDTx.balanceOf({
                    account: investorA.address,
                    providerOrSigner: investorA,
                });
                assert.deepEqual(
                    BigNumber.from(investorsBalance),
                    investorPriorBalance,
                    "Investor's balance should be == initial, after full unpledge"
                );
            });
            it("[IP][2.2.4] Investor should be able to do a partial unpledge", async () => {
                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = "2022/07/15";
                await investment.setTimestamp(timeStamp);
                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);
                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);
                // Request half of the funds back
                await expect(
                    investment
                        .connect(investorA)
                        .unpledge(0, investedAmount.div(2))
                )
                    .to.emit(investment, "Unpledge")
                    .withArgs(investorA.address, investedAmount.div(2));
                const investorsBalance = await fUSDTx.balanceOf({
                    account: investorA.address,
                    providerOrSigner: investorA,
                });
                assert.deepEqual(
                    BigNumber.from(investorsBalance),
                    investorPriorBalance.sub(investedAmount.div(2)),
                    "Investor's balance should get half of invested funds back"
                );
                const investedLeft = await investment.investedAmount(
                    investorA.address,
                    0
                );
                assert.deepEqual(
                    investedLeft,
                    investedAmount.div(2),
                    "Half of invested funds should stay in contract"
                );
            });
            it("[IP][2.2.5] Investor shouldn't be able to unpledge more than invested", async () => {
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);
                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);
                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);
                // Request them back, but 1 wei more, should revert
                await expect(
                    investment
                        .connect(investorA)
                        .unpledge(0, investedAmount.add(1))
                ).to.be.revertedWith("[IP]: cannot unpledge this investment");
            });
            it("[IP][2.2.6] Investors should be able to collectively raise the soft cap", async () => {
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("750");
                // Give token approval Investor A
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);
                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);
                // Give token approval Investor B
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorB);
                // Invest money
                await expect(
                    investment.connect(investorB).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorB.address, investedAmount);
                const softCapRaised = await investment.isSoftCapReached();
                assert.isTrue(softCapRaised);
            });
            it("[IP][2.2.7] Non-investor shouldn't be able to unpledge", async () => {
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);
                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);
                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);
                // Note, the case testing unpledging more than investment is tested separately,
                // here we'll test that unpledging 0 does not change the balance
                await expect(
                    investment
                        .connect(foreignActor)
                        .unpledge(0, BigNumber.from(0))
                )
                    .to.emit(investment, "Unpledge")
                    .withArgs(foreignActor.address, BigNumber.from(0));
                const balance = await fUSDTx.balanceOf({
                    account: foreignActor.address,
                    providerOrSigner: foreignActor,
                });
                assert.deepEqual(
                    BigNumber.from(balance),
                    BigNumber.from(0),
                    "Balance was altered by unpledging 0. Foreign actor got funds"
                );
            });
            it("[IP][2.2.8] Refund should be inactive during the fundraiser period", async () => {
                // NOTE: Time traveling to 2022/07/15
                const timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);
                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);
                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);
                // Try to refund
                await expect(
                    investment.connect(investorA).refund()
                ).to.be.revertedWith("[IP]: refund is not available");
            });
        });
    });

    describe("3. Failed investment campaigns", () => {
        describe("3.1 Public state", () => {
            it("[IP][3.1.1] Campaign should have a failed campaign state for unsuccessful fundraiser", async () => {
                // No one invests, let the fundraiser expire

                // NOTE: Time traveling to 2022/08/15
                const timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                const isFailed = await investment.isFailedFundraiser();
                assert.equal(
                    isFailed,
                    true,
                    "Fundraiser expired, should have failed state"
                );
            });

            it("[IP][3.1.2] Soft cap shouldn't be raised for failed fundraisers", async () => {
                // No one invests, let the fundraiser expire

                // NOTE: Time traveling to 2022/08/15
                const timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                const hasRaisedSoftCap = await investment.isSoftCapReached();
                assert.equal(
                    hasRaisedSoftCap,
                    false,
                    "Fundraiser expired, isSoftCapReached() should be false"
                );
            });

            it("[IP][3.1.3] Fundraiser shouldn't be ongoing for a failed campaign", async () => {
                // No one invests, let the fundraiser expire

                // NOTE: Time traveling to 2022/08/15
                const timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                const isFundraiserOngoing =
                    await investment.isFundraiserOngoingNow();
                assert.equal(
                    isFundraiserOngoing,
                    false,
                    "Fundraiser shouldn't be ongoing, since it has failed already"
                );
            });

            it("[IP][3.1.4] Fundraiser should have ended for a failed campaign", async () => {
                // No one invests, let the fundraiser expire

                // NOTE: Time traveling to 2022/08/15
                const timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                const hasFundraiserEnded =
                    await investment.didFundraiserPeriodEnd();
                assert.equal(
                    hasFundraiserEnded,
                    true,
                    "Fundraiser period should have ended, since campaign has failed already"
                );
            });
        });

        describe("3.2 Interactions", () => {
            it("[IP][3.2.1] Should be able to refund assets from a failed campaign", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                // Try to refund
                await expect(investment.connect(investorA).refund())
                    .to.emit(investment, "Refund")
                    .withArgs(investorA.address, investedAmount);

                const balance = await fUSDTx.balanceOf({
                    account: investorA.address,
                    providerOrSigner: investorA,
                });

                assert.deepEqual(
                    BigNumber.from(balance),
                    investorPriorBalance,
                    "All of the funds from a failed campaign should have returned to the investor"
                );
            });

            it("[IP][3.2.2] Should not be able to get back anything if haven't invested", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                // Try to refund
                await expect(
                    investment.connect(foreignActor).refund()
                ).to.be.revertedWith("[IP]: no money invested");
            });

            it("[IP][3.2.3] Unpledge shouldn't work on a failed campaign", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                // Try to unpledge
                await expect(
                    investment.connect(investorA).unpledge(0, investedAmount)
                ).to.be.revertedWith("[IP]: not in fundraiser period");
            });
        });
    });

    describe("4. Successful fundraiser(Milestone period)", () => {
        describe("4.1 Public state", () => {
            it("[IP][4.1.1] Campaign shouldn't have a failed campaign state", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                const isFailed = await investment.isFailedFundraiser();
                assert.equal(
                    isFailed,
                    false,
                    "Successful fundraiser should not have a failed state"
                );
            });

            it("[IP][4.1.2] Successful campaign should have reached soft cap", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                const hasRaisedSoftCap = await investment.isSoftCapReached();
                assert.equal(
                    hasRaisedSoftCap,
                    true,
                    "Successful campaign should have reached a soft cap"
                );
            });

            it("[IP][4.1.3] Fundraiser shouldn't be ongoing", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                const isFundraiserOngoing =
                    await investment.isFundraiserOngoingNow();
                assert.equal(
                    isFundraiserOngoing,
                    false,
                    "Fundraiser shouldn't be ongoing for a successful campaign"
                );
            });

            it("[IP][4.1.4] Fundraiser period should have ended for a successful campaign", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                const hasFundraiserEnded =
                    await investment.didFundraiserPeriodEnd();
                assert.equal(
                    hasFundraiserEnded,
                    true,
                    "Fundraiser period should have ended for a successful campaign"
                );
            });
        });

        describe("4.2 Interactions", () => {
            beforeEach(async () => {
                let snapshot = await traveler.takeSnapshot();
                snapshotId = snapshot["result"];
            });

            afterEach(async () => {
                await traveler.revertToSnapshot(snapshotId);
            });
            it("[IP][4.2.1] Investors are unable to unpledge from successful campaign", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(
                    investment.unpledge(0, investedAmount)
                ).to.be.revertedWith("[IP]: cannot unpledge this investment");
            });

            it("[IP][4.2.2] Investors are unable to refund from successful campaign", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");

                await investment.setTimestamp(timeStamp);

                await expect(investment.refund()).to.be.revertedWith(
                    "[IP]: refund is not available"
                );
            });

            it("[IP][4.2.3] Creator should be able to start money streaming to their account", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);
            });

            it("[IP][4.2.4] Creator shouldn't be able to start money streaming to their account before milestone starts", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2022/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(
                    investment.connect(creator).claim(1)
                ).to.be.revertedWith("[IP]: milestone still locked");
            });

            it("[IP][4.2.5] Double claim is prevented", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                // Try to double claim
                await expect(
                    investment.connect(creator).claim(0)
                ).to.be.revertedWith(
                    "[IP]: already streaming for this milestone"
                );
            });

            it("[IP][4.2.6] Creates a stream of funds on claim", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15", false) as number;
                await investment.setTimestamp(timeStamp);

                await traveler.advanceBlockAndSetTime(timeStamp);
                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                // NOTE: even though we cannot get precise time with the traveler,
                // the investment contract itself creates flowrate, and uses the timestamp that was passed to it
                // So it's ok to make calculations using it
                // Calculate the desired flowrate, should match the one from contract
                const timeLeft = milestoneEndDate.sub(timeStamp);

                const milestoneInfo = await investment.milestones(0);

                const seedAmount = milestoneInfo.paidAmount;

                const flowRate = investedAmount.sub(seedAmount).div(timeLeft);

                const flowInfo = await sf.cfaV1.getFlow({
                    superToken: fUSDTx.address,
                    sender: investment.address,
                    receiver: creator.address,
                    providerOrSigner: creator,
                });

                assert.isDefined(flowInfo);

                assert.deepEqual(
                    BigNumber.from(flowInfo.flowRate),
                    flowRate,
                    "Flow Rate must match the predicted one"
                );
            });

            it("[IP][4.2.7] Storage variables are updated on claim", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                const milestone = await investment.milestones(0);

                assert.equal(
                    milestone.streamOngoing,
                    true,
                    "milestone's stream should be ongoing"
                );
            });

            it("[IP][4.2.8] Only the creator should be able to call claim function", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(
                    investment.connect(foreignActor).claim(0)
                ).to.be.revertedWith("[IP]: not creator");
                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);
            });

            // TODO: Test multiple milestones (distribution of funds)
        });
    });

    describe("5. Money streaming corner cases", () => {
        describe("5.1 Interactions", () => {
            beforeEach(async () => {
                let snapshot = await traveler.takeSnapshot();
                snapshotId = snapshot["result"];
            });

            afterEach(async () => {
                await traveler.revertToSnapshot(snapshotId);
            });

            it("[IP][5.1.1] Volunteer stopping of streamed funds updates records", async () => {
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15", false) as number;

                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                timeStamp = dateToSeconds("2022/09/16", false) as number;
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                // NOTE: we are implicitly testing the SuperApp callback here
                // we want to find out, what happens if the flow is voluntarily terminated by the creator
                await sf.cfaV1
                    .deleteFlow({
                        superToken: fUSDTx.address,
                        sender: investment.address,
                        receiver: creator.address,
                    })
                    .exec(creator);

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                const milestone = await investment.milestones(0);
                const paidAmount = milestone.paidAmount;

                assert.deepEqual(
                    paidAmount,
                    creatorBalance.sub(initialCreatorBalance),
                    "Streamed balance and stored record should match"
                );

                assert.equal(
                    milestone.paid,
                    false,
                    "Partial stream should not be paid yet"
                );
            });

            it("[IP][5.1.2] (Callback)Volunteer stopping during termination window instantly transfers the rest of funds", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15", false) as number;

                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                const terminationWindow = BigNumber.from(
                    await investment.terminationWindow()
                );

                // Let's make sure we are in the termination window
                timeStamp = milestoneEndDate
                    .sub(terminationWindow.div(2))
                    .toNumber();
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                // NOTE: we are implicitly testing the SuperApp callback here
                // we want to find out, what happens if the flow is voluntarily terminated by the creator
                await sf.cfaV1
                    .deleteFlow({
                        superToken: fUSDTx.address,
                        sender: investment.address,
                        receiver: creator.address,
                    })
                    .exec(creator);

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                const milestone = await investment.milestones(0);
                const paidAmount = milestone.paidAmount;

                assert.deepEqual(
                    paidAmount,
                    creatorBalance.sub(initialCreatorBalance),
                    "Streamed balance and stored record should match"
                );

                assert.equal(
                    milestone.paid,
                    true,
                    "Milestone should be fully paid by now"
                );

                assert.deepEqual(
                    creatorBalance.sub(initialCreatorBalance),
                    investedAmount,
                    "should transfer all of the funds during the termination"
                );
            });

            it("[IP][5.1.3] Should claim instantly after milestone end", async () => {
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/10/15 when the milestone has ended
                timeStamp = dateToSeconds("2022/10/15");

                // NOTE: testing with just contract timestamp is fine, cause it tests internal logic
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                const milestone = await investment.milestones(0);
                const paidAmount = milestone.paidAmount;

                assert.deepEqual(
                    paidAmount,
                    creatorBalance.sub(initialCreatorBalance),
                    "Streamed balance and stored record should match"
                );

                assert.deepEqual(
                    creatorBalance.sub(initialCreatorBalance),
                    investedAmount,
                    "Should transfer all of the funds to the creator"
                );

                assert.equal(
                    milestone.paid,
                    true,
                    "Should mark milestone as paid"
                );
            });

            it("[IP][5.1.4] Should be able to pause the stream and resume later", async () => {
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15", false) as number;

                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                // Advance in time a little
                timeStamp = dateToSeconds("2022/09/20", false) as number;

                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                // NOTE: we are implicitly testing the SuperApp callback here
                // we want to find out, what happens if the flow is voluntarily stopped by the creator
                await sf.cfaV1
                    .deleteFlow({
                        superToken: fUSDTx.address,
                        sender: investment.address,
                        receiver: creator.address,
                    })
                    .exec(creator);

                const streamedSoFar = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                ).sub(initialCreatorBalance);

                // Advance in time a little
                timeStamp = dateToSeconds("2022/09/25", false) as number;

                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                const flowInfo = await sf.cfaV1.getFlow({
                    superToken: fUSDTx.address,
                    sender: investment.address,
                    receiver: creator.address,
                    providerOrSigner: creator,
                });
                assert.isDefined(flowInfo);

                // Calculate the desired flowrate, should match the one from contract
                // Use the timestamp source from the flow info for precision
                const timeLeft = milestoneEndDate.sub(
                    BigNumber.from(flowInfo.timestamp.getTime() / 1000)
                );
                const flowRate = investedAmount
                    .sub(streamedSoFar)
                    .div(timeLeft);

                assert.deepEqual(
                    BigNumber.from(flowInfo.flowRate),
                    flowRate,
                    "Flow Rate must match the predicted one"
                );
            });

            it("[IP][5.1.5] Should be able to pause the stream, resume later, get terminated", async () => {
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15", false) as number;

                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                // Advance in time a little
                timeStamp = dateToSeconds("2022/09/20", false) as number;

                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                // NOTE: we are implicitly testing the SuperApp callback here
                // we want to find out, what happens if the flow is voluntarily stopped by the creator
                await sf.cfaV1
                    .deleteFlow({
                        superToken: fUSDTx.address,
                        sender: investment.address,
                        receiver: creator.address,
                    })
                    .exec(creator);

                // Advance in time a little
                timeStamp = dateToSeconds("2022/09/25", false) as number;

                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                const terminationWindow = BigNumber.from(
                    await investment.terminationWindow()
                );

                // Let's make sure we are in the termination window
                timeStamp = milestoneEndDate
                    .sub(terminationWindow.div(2))
                    .toNumber();

                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.terminateMilestoneStreamFinal(0)).not.to
                    .be.reverted;

                const milestone = await investment.milestones(0);

                const creatorBalance = await fUSDTx.balanceOf({
                    account: creator.address,
                    providerOrSigner: creator,
                });

                assert.deepEqual(
                    BigNumber.from(creatorBalance).sub(initialCreatorBalance),
                    investedAmount,
                    "Should transfer all of the funds to the creator"
                );

                assert.deepEqual(
                    milestone.paidAmount,
                    investedAmount,
                    "Paid amount should match the invested amount"
                );

                assert.equal(
                    milestone.paid,
                    true,
                    "Milestone should be marked as paid by now"
                );
            });

            it("[IP][5.1.6] (Callback)Should be able to pause the stream, resume later, get terminated", async () => {
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15", false) as number;

                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                // Advance in time a little
                timeStamp = dateToSeconds("2022/09/20", false) as number;

                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                // NOTE: we are implicitly testing the SuperApp callback here
                // we want to find out, what happens if the flow is voluntarily stopped by the creator
                await sf.cfaV1
                    .deleteFlow({
                        superToken: fUSDTx.address,
                        sender: investment.address,
                        receiver: creator.address,
                    })
                    .exec(creator);

                // Advance in time a little
                timeStamp = dateToSeconds("2022/09/25", false) as number;

                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                const terminationWindow = BigNumber.from(
                    await investment.terminationWindow()
                );

                // Let's make sure we are in the termination window
                timeStamp = milestoneEndDate
                    .sub(terminationWindow.div(2))
                    .toNumber();

                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await sf.cfaV1
                    .deleteFlow({
                        receiver: creator.address,
                        sender: investment.address,
                        superToken: fUSDTx.address,
                    })
                    .exec(creator);

                const milestone = await investment.milestones(0);

                const creatorBalance = await fUSDTx.balanceOf({
                    account: creator.address,
                    providerOrSigner: creator,
                });

                assert.deepEqual(
                    BigNumber.from(creatorBalance).sub(initialCreatorBalance),
                    investedAmount,
                    "Should transfer all of the funds to the creator"
                );

                assert.deepEqual(
                    milestone.paidAmount,
                    investedAmount,
                    "Paid amount should match the invested amount"
                );

                assert.equal(
                    milestone.paid,
                    true,
                    "Milestone should be marked as paid by now"
                );
            });

            // TODO: Test the ovestream case during a single milestone, probably results in internal contract undeflow, need to confirm
        });
    });

    describe("6. Money stream termination", () => {
        describe("6.1 Interactions", () => {
            beforeEach(async () => {
                let snapshot = await traveler.takeSnapshot();
                snapshotId = snapshot["result"];
            });

            afterEach(async () => {
                await traveler.revertToSnapshot(snapshotId);
            });
            it("[IP][6.1.1] Anyone can stop milestone during termination window, it instantly transfers the rest of funds", async () => {
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15", false) as number;

                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                const terminationWindow = BigNumber.from(
                    await investment.terminationWindow()
                );

                // Let's make sure we are in the termination window
                timeStamp = milestoneEndDate
                    .sub(terminationWindow.div(2))
                    .toNumber();
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await investment
                    .connect(foreignActor) // Anyone can terminate it, no access rights needed
                    .terminateMilestoneStreamFinal(0);

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                const milestone = await investment.milestones(0);
                const paidAmount = milestone.paidAmount;

                assert.deepEqual(
                    paidAmount,
                    creatorBalance.sub(initialCreatorBalance),
                    "Streamed balance and stored record should match"
                );

                assert.equal(
                    milestone.paid,
                    true,
                    "Milestone should be fully paid by now"
                );

                assert.deepEqual(
                    creatorBalance.sub(initialCreatorBalance),
                    investedAmount,
                    "Should transfer all of the funds during the termination"
                );
            });

            it("[IP][6.1.2] gelatoChecker should not pass if not in auto termination window", async () => {
                const {canExec} = await investment.callStatic.gelatoChecker();

                assert.equal(canExec, false);
            });

            it("[IP][6.1.3] gelatoChecker should pass if in auto termination window", async () => {
                // NOTE: Time traveling to 2022/07/15
                let timeStamp = dateToSeconds("2022/07/15");
                await investment.setTimestamp(timeStamp);

                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber =
                    ethers.utils.parseEther("2000");
                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        // Max value here to test if contract attempts something out of line
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                )
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);

                // NOTE: Time traveling to 2022/09/15 when the milestone is active
                timeStamp = dateToSeconds("2022/09/15", false) as number;

                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                await expect(investment.connect(creator).claim(0))
                    .to.emit(investment, "Claim")
                    .withArgs(0);

                const automatedTerminationWindow = BigNumber.from(
                    await investment.automatedTerminationWindow()
                );

                // Let's make sure we are in the automated termination window
                timeStamp = milestoneEndDate
                    .sub(automatedTerminationWindow.div(2))
                    .toNumber();

                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await traveler.advanceBlockAndSetTime(timeStamp);

                // Call gelatoChecker and return value (not the transaction)
                const {canExec} = await investment.callStatic.gelatoChecker();
                assert.equal(canExec, true);
            });
            it("[IP][6.1.4] Non gelato address should not be able to terminate stream", async () => {
                await expect(
                    investment
                        .connect(foreignActor)
                        .gelatoTerminateMilestoneStreamFinal(0)
                ).to.be.revertedWith("[IP]: not gelato ops");
            });
            //   it("[IP][6.1.5] Gelato should not be able to terminate stream if not in auto termination window", async () => {
            //     await expect(
            //       investment
            //         .connect(ethers.provider.getSigner(gelatoOpsMock.address))
            //         .gelatoTerminateMilestoneStreamFinal(0)
            //     ).to.be.revertedWith(
            //       "[IP]: gelato cannot terminate stream for this milestone"
            //     );
            //   });
        });

        // TODO: Test termination by 3P system (patricians, plebs, pirates) in case we wouldn't stop it in time, what happens then?
    });

    describe("7. Governance", () => {
        // TODO: Test milestone unlocking, once governance is in place
    });

    describe("8. Upgradeability", () => {
        // Validate that the storage slots for contract variables don't change their storage slot and offset
        // Validate that struct member order hasn't changed
        // it("8.1 Contract storage variables didn't shift during development", async () => {
        //   await investment.validateStorageLayout();
        // });
    });
});
*/
