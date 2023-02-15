import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {assert, expect} from "chai";
import {
    VotingToken,
    GovernancePoolMock,
    InvestmentPoolMockForIntegration,
} from "../../typechain-types";
import {BigNumber} from "ethers";

let accounts: SignerWithAddress[];
let buidl1Admin: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;
let investmentPoolFactoryAsUser: SignerWithAddress;
let foreignActor: SignerWithAddress;

let votingToken: VotingToken;
let governancePool: GovernancePoolMock;
let investmentPool: InvestmentPoolMockForIntegration;

let votesWithdrawFee: number;
let governancePoolRole: string;

let fundraiserOngoingStateValue: number;
let anyMilestoneOngoingStateValue: number;
let milestonesOngoingBeforeLastStateValue: number;
let lastMilestoneOngoingStateValue: number;

const defineStateValues = async (ip: InvestmentPoolMockForIntegration) => {
    fundraiserOngoingStateValue = await ip.getFundraiserOngoingStateValue();
    anyMilestoneOngoingStateValue = await ip.getAnyMilestoneOngoingStateValue();
    milestonesOngoingBeforeLastStateValue = await ip.getMilestonesOngoingBeforeLastStateValue();
    lastMilestoneOngoingStateValue = await ip.getLastMilestoneOngoingStateValue();
};

const getConstantVariablesFromContract = async () => {
    await deployContracts();

    votesWithdrawFee = await governancePool.getVotesWithdrawPercentageFee();
    await defineStateValues(investmentPool);
};

const deployContracts = async () => {
    // Voting Token deployment
    const votingTokenDep = await ethers.getContractFactory("VotingToken", buidl1Admin);
    votingToken = await votingTokenDep.deploy();
    await votingToken.deployed();

    // Governance Pool deployment
    const governancePoolDep = await ethers.getContractFactory("GovernancePoolMock", buidl1Admin);
    governancePool = await governancePoolDep.deploy();
    await governancePool.deployed();

    // Assigning governance pool role manually because we create governace pool not from investment pool factory
    governancePoolRole = await votingToken.GOVERNANCE_POOL_ROLE();
    await votingToken.connect(buidl1Admin).grantRole(governancePoolRole, governancePool.address);

    // Deploy Fake governance pool mock which can mint tokens
    const investmentPoolDep = await ethers.getContractFactory(
        "InvestmentPoolMockForIntegration",
        buidl1Admin
    );
    investmentPool = await investmentPoolDep.deploy(governancePool.address);
    await investmentPool.deployed();

    // Initializer
    governancePool.initialize(votingToken.address, investmentPool.address, 51, 1);
};

describe("Governance Pool", async () => {
    before(async () => {
        accounts = await ethers.getSigners();
        buidl1Admin = accounts[0];
        foreignActor = accounts[2];
        investorA = accounts[3];
        investorB = accounts[4];
        investmentPoolFactoryAsUser = accounts[5];

        // Deploy before defining contract variables
        await getConstantVariablesFromContract();
    });

    beforeEach(async () => {
        await deployContracts();
    });

    describe("Functions", () => {
        describe("1. initialize() function", () => {
            describe("1.1 Public state", () => {
                it("[GP][1.1.1] Constructor should assign values to the storage variables", async () => {
                    const VT = await governancePool.getVotingTokenAddress();
                    const VPT = await governancePool.getVotesPercentageThreshold();
                    const VWF = await governancePool.getVotesWithdrawPercentageFee();

                    assert.equal(VT, votingToken.address);
                    assert.equal(VPT, 51);
                    assert.equal(VWF.toString(), "1");
                });

                it("[GP][1.1.2] Initial governance pool ether balance should be 0", async () => {
                    const initialBalance = await governancePool.provider.getBalance(
                        governancePool.address
                    );
                    assert.equal(initialBalance.toString(), "0");
                });

                it("[GP][1.1.3] Investment pool should be assigned after initialization", async () => {
                    const ipAddress = await governancePool.getInvestmentPool();
                    assert.equal(ipAddress, investmentPool.address);
                });

                it("[GP][1.1.4] Initial tokens supply should be 0", async () => {
                    const totalSupply = await governancePool.getVotingTokensSupply();
                    assert.equal(totalSupply.toString(), "0");
                });

                it("[GP][1.1.5] Initial investor token balance should be 0", async () => {
                    const initialBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    assert.equal(initialBalance.toString(), "0");
                });

                it("[GP][1.1.6] Initial governance pool token balance should be 0", async () => {
                    const initialBalance = await governancePool.getVotingTokenBalance(
                        governancePool.address
                    );
                    assert.equal(initialBalance.toString(), "0");
                });

                it("[GP][1.1.7] Should get the correct id from given address", async () => {
                    const investmentPoolId = await governancePool.getInvestmentPoolId();
                    const expectedId = BigNumber.from(investmentPool.address);

                    assert.equal(investmentPoolId.toString(), expectedId.toString());
                });
            });
        });

        describe("3. getActiveVotes() function", () => {
            describe("3.1 Interactions", () => {
                it("[GP][3.1.1] Should return 0 amount as active votes if no investments were made", async () => {
                    const activeTokensForVoting = await governancePool.getActiveVotes(
                        0,
                        investorA.address
                    );

                    assert.equal(activeTokensForVoting.toString(), "0");
                });

                it("[GP][3.1.2] Should return value straight from mapping if milestone id is 0", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const activeTokensForVoting = await governancePool.getActiveVotes(
                        0,
                        investorA.address
                    );

                    assert.equal(activeTokensForVoting.toString(), tokensToMint.toString());
                });

                it("[GP][3.1.3] Should return value straight from mapping if value in memActiveTokens is not 0", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(1, investorA.address, tokensToMint);

                    const activeTokensForVoting = await governancePool.getActiveVotes(
                        1,
                        investorA.address
                    );

                    assert.equal(activeTokensForVoting.toString(), tokensToMint.toString());
                });

                it("[GP][3.1.4] Should return value from last milestone in which investor invested if no mints were made after the current milestone", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const activeTokensForVoting = await governancePool.getActiveVotes(
                        2,
                        investorA.address
                    );

                    assert.equal(activeTokensForVoting.toString(), tokensToMint.toString());
                });

                it("[GP][3.1.5] Should return 0 if no investments (mints) were made before the provided milestone", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(2, investorA.address, tokensToMint);

                    const activeTokensForVoting = await governancePool.getActiveVotes(
                        1,
                        investorA.address
                    );

                    assert.equal(activeTokensForVoting.toString(), "0");
                });

                it("[GP][3.1.6] Should return 0 if all voting tokens were transfered or locked", async () => {
                    const tokensToMintA: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMintA);
                    await investmentPool.increaseMilestone();

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorA)
                        .safeTransferFrom(
                            investorA.address,
                            investorB.address,
                            governancePool.getInvestmentPoolId(),
                            tokensToMintA,
                            "0x"
                        );
                    const activeTokensForVoting = await governancePool.getActiveVotes(
                        2,
                        investorA.address
                    );

                    assert.equal(activeTokensForVoting.toString(), "0");
                });

                it("[GP][3.1.7] Should return value from previous milestone if investments were made only before and after the provided milestone", async () => {
                    const tokensToMintA: BigNumber = ethers.utils.parseEther("1");
                    const tokensToMintB: BigNumber = ethers.utils.parseEther("2");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMintA);
                    await investmentPool.mintVotingTokens(2, investorA.address, tokensToMintB);

                    const activeTokensForVoting = await governancePool.getActiveVotes(
                        1,
                        investorA.address
                    );

                    assert.equal(activeTokensForVoting.toString(), tokensToMintA.toString());
                });

                it("[GP][3.1.8] Should return 0 if milestones aren't active", async () => {
                    const tokensToMintA: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMintA);

                    const activeTokensForVoting = await governancePool.getActiveVotes(
                        0,
                        investorA.address
                    );

                    assert.equal(activeTokensForVoting.toString(), "0");
                });
            });
        });

        describe("4. mintVotingTokens() function", () => {
            describe("4.1 Public state", () => {
                it("[GP][4.1.1] Should update tokens supply", async () => {
                    const tokensToMintA: BigNumber = ethers.utils.parseEther("1");
                    const tokensToMintB: BigNumber = ethers.utils.parseEther("2");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMintA);
                    await investmentPool.mintVotingTokens(0, investorB.address, tokensToMintB);

                    const totalSupply = await governancePool.getVotingTokensSupply();
                    const expectedTotalSupply = tokensToMintA.add(tokensToMintB);
                    assert.equal(totalSupply.toString(), expectedTotalSupply.toString());
                });

                it("[GP][4.1.2] Should update investors balances", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");

                    const priorInvestorBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const investorBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    assert.equal(
                        investorBalance.toString(),
                        priorInvestorBalance.add(tokensToMint).toString()
                    );
                });

                it("[GP][4.1.3] Should not update governance pool balances", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const governancePoolBalance = await governancePool.getVotingTokenBalance(
                        governancePool.address
                    );
                    assert.equal(governancePoolBalance.toString(), "0");
                });

                it("[GP][4.1.4] Should update memActiveTokens on first mint", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const activeTokens = await governancePool.getMemActiveTokens(
                        investorA.address,
                        0
                    );
                    assert.equal(activeTokens.toString(), tokensToMint.toString());
                });

                it("[GP][4.1.5] Should update milestonesWithVotes on first mint", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const firstMilestoneId = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );
                    assert.equal(firstMilestoneId[0].toString(), "0");
                });

                it("[GP][4.1.6] Should update memActiveTokens on second and other mints", async () => {
                    const tokensToMintA: BigNumber = ethers.utils.parseEther("1");
                    const tokensToMintB: BigNumber = ethers.utils.parseEther("2");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMintA);
                    // Skip milestone 1 to see if contract gets value correctly
                    await investmentPool.mintVotingTokens(2, investorA.address, tokensToMintB);

                    const activeTokens = await governancePool.getMemActiveTokens(
                        investorA.address,
                        2
                    );
                    assert.equal(
                        activeTokens.toString(),
                        tokensToMintA.add(tokensToMintB).toString()
                    );
                });

                it("[GP][4.1.7] Should update milestonesWithVotes on second and other mints", async () => {
                    const tokensToMintA: BigNumber = ethers.utils.parseEther("1");
                    const tokensToMintB: BigNumber = ethers.utils.parseEther("2");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMintA);
                    // Skip milestone 1 to see if contract gets value correctly
                    await investmentPool.mintVotingTokens(2, investorA.address, tokensToMintB);

                    const secondMilestoneId = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );
                    assert.equal(secondMilestoneId[1].toString(), "2");
                });

                it("[GP][4.1.8] Should not update milestonesWithVotes if milestone has already been pushed", async () => {
                    const tokensToMintA: BigNumber = ethers.utils.parseEther("1");
                    const tokensToMintB: BigNumber = ethers.utils.parseEther("2");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMintA);
                    // Skip milestone 1 to see if contract gets value correctly
                    await investmentPool.mintVotingTokens(2, investorA.address, tokensToMintB);
                    await investmentPool.mintVotingTokens(2, investorA.address, tokensToMintB);

                    const list = await governancePool.getMilestonesWithVotes(investorA.address);
                    assert.equal(list.length, 2);
                });
            });

            describe("4.2 Interactions", () => {
                it("[GP][4.2.1] Investment pools, which exists should be able to mint tokens", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await expect(
                        investmentPool.mintVotingTokens(0, investorA.address, tokensToMint)
                    ).to.emit(votingToken, "TransferSingle");
                });

                it("[GP][4.2.3] Investment pools, which doesn't exist shouldn't be able to mint tokens", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await expect(
                        governancePool
                            .connect(investorA)
                            .mintVotingTokens(0, investorA.address, tokensToMint)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__NotInvestmentPool"
                    );
                });

                it("[GP][4.2.4] Investor should not be able to mint tokens", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await expect(
                        governancePool
                            .connect(investorA)
                            .mintVotingTokens(0, investorA.address, tokensToMint)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__NotInvestmentPool"
                    );
                });

                it("[GP][4.2.5] Should revert if minting 0 tokens", async () => {
                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);

                    await expect(
                        investmentPool.mintVotingTokens(0, investorA.address, 0)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__AmountIsZero"
                    );
                });

                it("[GP][4.2.6] Should be able to mint 1mln tokens in one mint", async () => {
                    const tokensToMint = ethers.utils.parseEther("1000000");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const totalSupply = await governancePool.getVotingTokensSupply();
                    assert.equal(tokensToMint.toString(), totalSupply.toString());
                });

                it("[GP][4.2.7] Should be able to mint 1mln tokens in 2 mints", async () => {
                    const tokensToMint = ethers.utils.parseEther("500000");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.mintVotingTokens(0, investorB.address, tokensToMint);

                    const totalSupply = await governancePool.getVotingTokensSupply();
                    const expectedTotalSupply = tokensToMint.mul(2);
                    assert.equal(expectedTotalSupply.toString(), totalSupply.toString());
                });

                it("[GP][4.2.8] Should be able to mint tokens if IP fundraiser is ongoing", async () => {
                    const tokensToMint = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await expect(
                        investmentPool.mintVotingTokens(0, investorA.address, tokensToMint)
                    ).not.to.be.reverted;
                });

                it("[GP][4.2.9] Should be able to mint tokens if IP milestone before last is ongoing", async () => {
                    const tokensToMint = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await expect(
                        investmentPool.mintVotingTokens(0, investorA.address, tokensToMint)
                    ).not.to.be.reverted;
                });

                it("[GP][4.2.10] Shouldn't be able to mint tokens if last milestone is ongoing", async () => {
                    const tokensToMint = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(lastMilestoneOngoingStateValue);
                    await expect(
                        investmentPool.mintVotingTokens(0, investorA.address, tokensToMint)
                    )
                        .to.be.revertedWithCustomError(
                            governancePool,
                            "GovernancePool__InvestmentPoolStateNotAllowed"
                        )
                        .withArgs(lastMilestoneOngoingStateValue);
                });
            });
        });

        describe("5. percentageAgainst() function", () => {
            describe("5.1 Interactions", () => {
                it("[GP][5.1.1] Initial calculation with zeros should revert", async () => {
                    const tokensToMint = ethers.utils.parseEther("0");
                    const percentage = await governancePool.percentageAgainst(tokensToMint);

                    assert.equal(percentage, 0);
                });

                it("[GP][5.1.2] Should revert if amount for votes against are higher than total supply", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("1.5");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const totalSupply = await governancePool.getVotingTokensSupply();

                    await expect(governancePool.percentageAgainst(votesAgainst))
                        .to.be.revertedWithCustomError(
                            governancePool,
                            "GovernancePool__TotalSupplyIsSmallerThanVotesAgainst"
                        )
                        .withArgs(totalSupply, votesAgainst);
                });

                it("[GP][5.1.3] Should correctly calculate the percentage", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainstA = ethers.utils.parseEther("0.44444");
                    const votesAgainstB = ethers.utils.parseEther("0.70999");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const percentageA = await governancePool.percentageAgainst(votesAgainstA);
                    const percentageB = await governancePool.percentageAgainst(votesAgainstB);

                    assert.equal(percentageA, 44);
                    assert.equal(percentageB, 70);
                });
            });
        });

        describe("6. thresholdReached() function", () => {
            describe("6.1 Interactions", () => {
                it("[GP][6.1.1] Should reach a threshold", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("2");
                    const thresholdAmount: BigNumber = ethers.utils.parseEther("1.1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const thresholdReached = await governancePool.thresholdReached(
                        thresholdAmount
                    );
                    assert.isTrue(thresholdReached);
                });

                it("[GP][6.1.2] Should not reach a threshold", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("2");
                    const notThresholdAmount: BigNumber = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const thresholdReached = await governancePool.thresholdReached(
                        notThresholdAmount
                    );

                    assert.isFalse(thresholdReached);
                });
            });
        });

        describe("7. burnVotes() function", () => {
            describe("7.1 Interactions", () => {
                it("[GP][7.1.1] Foreign actor shouldn't be able to burn voting tokens", async () => {
                    await expect(
                        governancePool.connect(foreignActor).burnVotes(0, investorB.address)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__NotInvestmentPool"
                    );
                });

                it("[GP][7.1.2] Investment pool should be able to burn voting tokens", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(investmentPool.burnVotes(0, investorA.address)).not.to.be
                        .reverted;
                });

                it("[GP][7.1.3] Shouldn't be able to burn 0 amount", async () => {
                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await expect(
                        investmentPool.burnVotes(0, investorA.address)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__NoVotingTokensMintedDuringCurrentMilestone"
                    );
                });

                it("[GP][7.1.5] Should update tokensMinted mapping", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const initiallyMinted = await governancePool.getTokensMinted(
                        investorA.address,
                        0
                    );
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await investmentPool.burnVotes(0, investorA.address);

                    const minted = await governancePool.getTokensMinted(investorA.address, 0);
                    assert.equal(minted.toString(), initiallyMinted.sub(tokensToMint).toString());
                    assert.equal(minted.toString(), "0");
                });

                it("[GP][7.1.6] Should update milestonesWithVotes mapping", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.mintVotingTokens(1, investorA.address, tokensToMint);

                    const initialMilestonesIds = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await investmentPool.burnVotes(1, investorA.address);

                    const milestonesIdsAfterBurn = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );

                    assert.deepEqual(initialMilestonesIds, [0, 1]);
                    assert.deepEqual(milestonesIdsAfterBurn, [0]);
                });

                it("[GP][7.1.7] Should update memActiveTokens mapping", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);

                    const priorActiveTokensBalance = await governancePool.getMemActiveTokens(
                        investorA.address,
                        0
                    );
                    await investmentPool.burnVotes(0, investorA.address);

                    const activeTokensBalance = await governancePool.getMemActiveTokens(
                        investorA.address,
                        0
                    );

                    assert.equal(
                        activeTokensBalance.toString(),
                        priorActiveTokensBalance.sub(tokensToMint).toString()
                    );
                    assert.equal(activeTokensBalance.toString(), "0");
                });

                it("[GP][7.1.8] Should update tokens balance for investor", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await investmentPool.burnVotes(0, investorA.address);

                    const tokensBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    assert.equal(tokensBalance.toString(), "0");
                });

                it("[GP][7.1.9] Should update voting token total supply", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.mintVotingTokens(0, investorB.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await investmentPool.burnVotes(0, investorA.address);

                    const totalSupply = await governancePool.getVotingTokensSupply();
                    assert.equal(totalSupply.toString(), tokensToMint.toString());
                });

                it("[GP][7.1.10] Shouldn't be able to burn voting tokens if not approved", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await expect(
                        investmentPool.burnVotes(0, investorA.address)
                    ).to.be.revertedWith("ERC1155: caller is not token owner nor approved");
                });

                it("[GP][7.1.11] Should be able to burn tokens if milestone is ongoing", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(investmentPool.burnVotes(0, investorA.address)).not.to.be
                        .reverted;
                });

                it("[GP][7.1.12] Should be able to burn tokens if fundraiser is ongoing", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(investmentPool.burnVotes(0, investorA.address)).not.to.be
                        .reverted;
                });

                it("[GP][7.1.13] Shouldn't be able to burn tokens if fundraiser and milestones isn't ongoing", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setProjectState(0);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(investmentPool.burnVotes(0, investorA.address))
                        .to.be.revertedWithCustomError(
                            governancePool,
                            "GovernancePool__InvestmentPoolStateNotAllowed"
                        )
                        .withArgs(0);
                });
            });
        });

        describe("8. voteAgainst() function", () => {
            describe("8.1 Public state", () => {
                it("[GP][8.1.1] Should update votes amount for investor", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(votesAgainst);

                    const votesAmount = await governancePool.getVotesAmount(investorA.address);
                    assert.equal(votesAgainst.toString(), votesAmount.toString());
                });

                it("[GP][8.1.2] Should update total votes amount for investment pool", async () => {
                    const tokensToMintA: BigNumber = ethers.utils.parseEther("1");
                    const tokensToMintB: BigNumber = ethers.utils.parseEther("2");
                    const votesAgainst = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMintA);
                    await investmentPool.mintVotingTokens(0, investorB.address, tokensToMintB);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorB)
                        .setApprovalForAll(governancePool.address, true);

                    await governancePool.connect(investorA).voteAgainst(votesAgainst);
                    await governancePool.connect(investorB).voteAgainst(votesAgainst);

                    const totalVotesAmount = await governancePool.getTotalVotesAmount();
                    assert.equal(totalVotesAmount.toString(), votesAgainst.mul(2).toString());
                });

                it("[GP][8.1.3] Should emit finish even if threshold was reached", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.6");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);

                    await expect(governancePool.connect(investorA).voteAgainst(votesAgainst))
                        .to.emit(governancePool, "FinishVoting")
                        .withArgs()
                        .to.emit(governancePool, "VoteAgainstProject")
                        .withArgs(investorA.address, 0, votesAgainst);
                });

                it("[GP][8.1.4] Shouldn't emit finish event if threshold was not reached", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(governancePool.connect(investorA).voteAgainst(votesAgainst))
                        .to.emit(governancePool, "VoteAgainstProject")
                        .withArgs(investorA.address, 0, votesAgainst);
                });
            });

            describe("8.2 Interactions", () => {
                it("[GP][8.2.1] Should be able to vote for investment pool with active voting tokens", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(governancePool.connect(investorA).voteAgainst(votesAgainst)).not
                        .to.be.reverted;
                });

                it("[GP][8.2.4] Voting with 0 amount should revert", async () => {
                    await expect(
                        governancePool.connect(investorA).voteAgainst(0)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__AmountIsZero"
                    );
                });

                it("[GP][8.2.5] Should revert if investor does not have any voting tokens", async () => {
                    const votesAgainst = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);

                    await expect(
                        governancePool.connect(investorA).voteAgainst(votesAgainst)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__NoActiveVotingTokensOwned"
                    );
                });

                it("[GP][8.2.6] Should not be able to vote with more tokens than investor has", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("1.5");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    const tokenBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(governancePool.connect(investorA).voteAgainst(votesAgainst))
                        .to.be.revertedWithCustomError(
                            governancePool,
                            "GovernancePool__AmountIsGreaterThanVotingTokensBalance"
                        )
                        .withArgs(votesAgainst, tokenBalance);
                });

                it("[GP][8.2.7] Should transfer voting tokens from investor to governance pool", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);

                    const priorGovernancePoolBalance = await governancePool.getVotingTokenBalance(
                        governancePool.address
                    );
                    const priorInvestorBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    await expect(
                        governancePool.connect(investorA).voteAgainst(votesAgainst)
                    ).to.emit(votingToken, "TransferSingle");

                    const governancePoolBalance = await governancePool.getVotingTokenBalance(
                        governancePool.address
                    );
                    const investorBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    assert.equal(
                        governancePoolBalance.toString(),
                        priorGovernancePoolBalance.add(votesAgainst).toString()
                    );
                    assert.equal(
                        investorBalance.toString(),
                        priorInvestorBalance.sub(votesAgainst).toString()
                    );
                });

                it("[GP][8.2.8] Shouldn't be able to vote if governance pool is not approved to spend tokens", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await expect(
                        governancePool.connect(investorA).voteAgainst(votesAgainst)
                    ).to.be.revertedWith("ERC1155: caller is not token owner nor approved");
                });

                it("[GP][8.2.9] Should be able to vote with all of the tokens", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(governancePool.connect(investorA).voteAgainst(tokensToMint)).not
                        .to.be.reverted;
                });

                it("[GP][8.2.10] Shouldn't be able to vote if fundraiser is ongoing (state is not milestones ongoing)", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(
                        governancePool.connect(investorA).voteAgainst(tokensToMint)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__InvestmentPoolStateNotAllowed"
                    );
                });

                it("[GP][8.2.11] Should revert if investor has used all of the active voting tokens", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.mintVotingTokens(0, investorB.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(tokensToMint);

                    await expect(
                        governancePool.connect(investorA).voteAgainst(tokensToMint)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__NoActiveVotingTokensOwned"
                    );
                });

                it("[GP][8.2.12] Should be able to vote if any milestone is ongoing", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(governancePool.connect(investorA).voteAgainst(tokensToMint)).not
                        .to.be.reverted;
                });
            });
        });

        describe("9. retractVotes() function", () => {
            describe("9.1 Public state", () => {
                it("[GP][9.1.1] Should update votes amount for investor ", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");
                    const votesAgainst: BigNumber = ethers.utils.parseEther("0.4");
                    const votesToRetract: BigNumber = ethers.utils.parseEther("0.1");
                    const votesLeft: BigNumber = votesAgainst.sub(votesToRetract);

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(votesAgainst);

                    await expect(governancePool.connect(investorA).retractVotes(votesToRetract))
                        .not.to.be.reverted;

                    const votesAmount = await governancePool.getVotesAmount(investorA.address);
                    assert.equal(votesAmount.toString(), votesLeft.toString());
                });
                it("[GP][9.1.2] Should update total votes amount for investment pool", async () => {
                    const tokensToMint: BigNumber = ethers.utils.parseEther("1");
                    const votesAgainst: BigNumber = ethers.utils.parseEther("0.4");
                    const votesToRetract: BigNumber = ethers.utils.parseEther("0.1");
                    const votesLeft: BigNumber = votesAgainst.sub(votesToRetract);

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(votesAgainst);

                    await expect(governancePool.connect(investorA).retractVotes(votesToRetract))
                        .not.to.be.reverted;

                    const totalVotesAmount = await governancePool.getTotalVotesAmount();
                    assert.equal(totalVotesAmount.toString(), votesLeft.toString());
                });
            });

            describe("9.2 Interactions", () => {
                it("[GP][9.2.1] Should be able to retract votes from investment pool with ongoing milestone", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");
                    const votesToRetract = ethers.utils.parseEther("0.1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(votesAgainst);

                    await expect(governancePool.connect(investorA).retractVotes(votesToRetract))
                        .to.emit(governancePool, "RetractVotes")
                        .withArgs(investorA.address, 0, votesToRetract);
                });

                it("[GP][9.2.4] Retracting 0 amount of votes should revert", async () => {
                    await expect(
                        governancePool.connect(investorA).retractVotes(0)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__AmountIsZero"
                    );
                });

                it("[GP][9.2.5] Should revert if investor did not vote against the project", async () => {
                    const votesToRetract = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);

                    await expect(
                        governancePool.connect(investorA).retractVotes(votesToRetract)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__NoVotesAgainstProject"
                    );
                });

                it("[GP][9.2.6] Should not be able to retract more voting tokens than investor has delegated for voting", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");
                    const votesToRetract = ethers.utils.parseEther("0.5");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(votesAgainst);

                    const delegatedVotes = await governancePool.getVotesAmount(investorA.address);

                    await expect(governancePool.connect(investorA).retractVotes(votesToRetract))
                        .to.be.revertedWithCustomError(
                            governancePool,
                            "GovernancePool__AmountIsGreaterThanDelegatedVotes"
                        )
                        .withArgs(votesToRetract, delegatedVotes);
                });

                it("[GP][9.2.7] Should transfer voting tokens from governance pool to investor", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");
                    const votesToRetract = ethers.utils.parseEther("0.1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);

                    const priorGovernancePoolBalance = await governancePool.getVotingTokenBalance(
                        governancePool.address
                    );
                    const priorInvestorBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    await governancePool.connect(investorA).voteAgainst(votesAgainst);

                    await expect(
                        governancePool.connect(investorA).retractVotes(votesToRetract)
                    ).to.emit(votingToken, "TransferSingle");

                    const governancePoolBalance = await governancePool.getVotingTokenBalance(
                        governancePool.address
                    );
                    const investorBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    const feeAmount: BigNumber = votesToRetract.mul(votesWithdrawFee).div(100);

                    assert.equal(
                        governancePoolBalance.toString(),
                        priorGovernancePoolBalance
                            .add(votesAgainst)
                            .sub(votesToRetract)
                            .add(feeAmount)
                            .toString()
                    );
                    assert.equal(
                        investorBalance.toString(),
                        priorInvestorBalance
                            .sub(votesAgainst)
                            .add(votesToRetract)
                            .sub(feeAmount)
                            .toString()
                    );
                });

                it("[GP][9.2.8] Should be able to retract all of the votes", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(votesAgainst);

                    await expect(governancePool.connect(investorA).retractVotes(votesAgainst)).not
                        .to.be.reverted;
                });

                it("[GP][9.2.9] Shouldn't be able to retract votes if fundraiser is ongoing (state is not milestones ongoing)", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const votesAgainst = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(votesAgainst);

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await expect(governancePool.connect(investorA).retractVotes(votesAgainst))
                        .to.be.revertedWithCustomError(
                            governancePool,
                            "GovernancePool__InvestmentPoolStateNotAllowed"
                        )
                        .withArgs(fundraiserOngoingStateValue);
                });
            });
        });

        describe("10. transferVotes() function", () => {
            describe("10.1 Public state", () => {
                it("[GP][10.1.1] Should update milestonesWithVotes for sender", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const transferAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setMilestoneId(1);

                    const currentMilestoneId = await investmentPool.getCurrentMilestoneId();
                    const priorSenderMilestonesIds = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );
                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorA)
                        .safeTransferFrom(
                            investorA.address,
                            investorB.address,
                            governancePool.getInvestmentPoolId(),
                            transferAmount,
                            "0x"
                        );

                    const endingSenderMilestonesIds = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );

                    const expectedIds = [...priorSenderMilestonesIds, currentMilestoneId];
                    assert.deepEqual(endingSenderMilestonesIds, expectedIds);
                });

                it("[GP][10.1.2] Should update milestonesWithVotes for recipient", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const transferAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setMilestoneId(1);

                    const currentMilestoneId = await investmentPool.getCurrentMilestoneId();
                    const priorRecipientMilestonesIds =
                        await governancePool.getMilestonesWithVotes(investorB.address);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorA)
                        .safeTransferFrom(
                            investorA.address,
                            investorB.address,
                            governancePool.getInvestmentPoolId(),
                            transferAmount,
                            "0x"
                        );

                    const endingRecipientMilestonesIds =
                        await governancePool.getMilestonesWithVotes(investorB.address);

                    const expectedIds = [...priorRecipientMilestonesIds, currentMilestoneId];
                    assert.deepEqual(endingRecipientMilestonesIds, expectedIds);
                });

                it("[GP][10.1.3] Shouldn't update milestonesWithVotes for sender if it current milestone already exists", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const transferAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const priorSenderMilestonesIds = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorA)
                        .safeTransferFrom(
                            investorA.address,
                            investorB.address,
                            governancePool.getInvestmentPoolId(),
                            transferAmount,
                            "0x"
                        );

                    const endingSenderMilestonesIds = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );

                    assert.deepEqual(endingSenderMilestonesIds, priorSenderMilestonesIds);
                });

                it("[GP][10.1.4] Shouldn't update milestonesWithVotes for recipient if it current milestone already exists", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const transferAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorA)
                        .safeTransferFrom(
                            investorA.address,
                            investorB.address,
                            governancePool.getInvestmentPoolId(),
                            transferAmount,
                            "0x"
                        );

                    const priorRecipientMilestonesIds =
                        await governancePool.getMilestonesWithVotes(investorB.address);

                    await votingToken
                        .connect(investorA)
                        .safeTransferFrom(
                            investorA.address,
                            investorB.address,
                            governancePool.getInvestmentPoolId(),
                            transferAmount,
                            "0x"
                        );
                    const endingRecipientMilestonesIds =
                        await governancePool.getMilestonesWithVotes(investorB.address);

                    assert.deepEqual(endingRecipientMilestonesIds, priorRecipientMilestonesIds);
                });

                it("[GP][10.1.5] Should update memActiveTokens for sender", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const transferAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setMilestoneId(1);

                    const currentMilestoneId = await investmentPool.getCurrentMilestoneId();
                    const priorSenderBalance = await governancePool.getMemActiveTokens(
                        investorA.address,
                        currentMilestoneId
                    );

                    const priorSenderActiveBalance = await governancePool.getActiveVotes(
                        currentMilestoneId,
                        investorA.address
                    );

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorA)
                        .safeTransferFrom(
                            investorA.address,
                            investorB.address,
                            governancePool.getInvestmentPoolId(),
                            transferAmount,
                            "0x"
                        );

                    const endingSenderBalance = await governancePool.getMemActiveTokens(
                        investorA.address,
                        currentMilestoneId
                    );

                    assert.equal(priorSenderBalance.toString(), "0");
                    assert.equal(
                        endingSenderBalance.toString(),
                        priorSenderActiveBalance.sub(transferAmount).toString()
                    );
                });

                it("[GP][10.1.6] Should update memActiveTokens for recipient", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const transferAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setMilestoneId(1);

                    const currentMilestoneId = await investmentPool.getCurrentMilestoneId();
                    const priorRecipientBalance = await governancePool.getMemActiveTokens(
                        investorB.address,
                        currentMilestoneId
                    );

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorA)
                        .safeTransferFrom(
                            investorA.address,
                            investorB.address,
                            governancePool.getInvestmentPoolId(),
                            transferAmount,
                            "0x"
                        );

                    const endingRecipientBalance = await governancePool.getMemActiveTokens(
                        investorB.address,
                        currentMilestoneId
                    );

                    assert.equal(
                        endingRecipientBalance.toString(),
                        priorRecipientBalance.add(transferAmount).toString()
                    );
                });
            });

            describe("10.2 Interactions", () => {
                it("[GP][10.2.1] Shouldn't be able to transfer 0 votes", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await expect(
                        votingToken
                            .connect(investorA)
                            .safeTransferFrom(
                                investorA.address,
                                investorB.address,
                                governancePool.getInvestmentPoolId(),
                                0,
                                "0x"
                            )
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__AmountIsZero"
                    );
                });

                it("[GP][10.2.2] Shouldn't be able to transfer more votes than in balance", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await expect(
                        votingToken
                            .connect(investorA)
                            .safeTransferFrom(
                                investorA.address,
                                investorB.address,
                                governancePool.getInvestmentPoolId(),
                                tokensToMint.add(100),
                                "0x"
                            )
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__CannotTransferMoreThanUnlockedTokens"
                    );
                });

                it("[GP][10.2.3] Should be able to transfer full voting tokens amount", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(
                        votingToken
                            .connect(investorA)
                            .safeTransferFrom(
                                investorA.address,
                                investorB.address,
                                governancePool.getInvestmentPoolId(),
                                tokensToMint,
                                "0x"
                            )
                    ).to.emit(votingToken, "TransferSingle");
                });

                it("[GP][10.2.4] Should be able to transfer part of voting tokens", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const transferAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await expect(
                        votingToken
                            .connect(investorA)
                            .safeTransferFrom(
                                investorA.address,
                                investorB.address,
                                governancePool.getInvestmentPoolId(),
                                transferAmount,
                                "0x"
                            )
                    ).to.emit(votingToken, "TransferSingle");
                });

                it("[GP][10.2.5] Should update sender's and recipient's balances", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const transferAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const priorSenderBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    const priorRecipientBalance = await governancePool.getVotingTokenBalance(
                        investorB.address
                    );

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorA)
                        .safeTransferFrom(
                            investorA.address,
                            investorB.address,
                            governancePool.getInvestmentPoolId(),
                            transferAmount,
                            "0x"
                        );

                    const senderBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    const recipientBalance = await governancePool.getVotingTokenBalance(
                        investorB.address
                    );

                    assert.equal(
                        senderBalance.toString(),
                        priorSenderBalance.sub(transferAmount).toString()
                    );
                    assert.equal(
                        recipientBalance.toString(),
                        priorRecipientBalance.add(transferAmount).toString()
                    );
                });

                it("[GP][10.2.7] Shouldn't be able to transfer votes if no milestone is ongoing", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await expect(
                        votingToken
                            .connect(investorA)
                            .safeTransferFrom(
                                investorA.address,
                                investorB.address,
                                governancePool.getInvestmentPoolId(),
                                tokensToMint,
                                "0x"
                            )
                    )
                        .to.be.revertedWithCustomError(
                            governancePool,
                            "GovernancePool__InvestmentPoolStateNotAllowed"
                        )
                        .withArgs(fundraiserOngoingStateValue);
                });

                it("[GP][10.2.8] Should be able to transfer votes if any milestone is ongoing", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);

                    await expect(
                        votingToken
                            .connect(investorA)
                            .safeTransferFrom(
                                investorA.address,
                                investorB.address,
                                governancePool.getInvestmentPoolId(),
                                tokensToMint,
                                "0x"
                            )
                    ).not.to.be.reverted;
                });
            });
        });

        describe("11. getUnusedVotes() function", () => {
            describe("11.1 Interactions", () => {
                it("[GP][11.1.1] Should return full active voting tokens amount when no votes were used", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const votesAmount = await governancePool.getUnusedVotes(investorA.address);

                    assert.equal(votesAmount.toString(), tokensToMint.toString());
                });

                it("[GP][11.1.2] Should return full active voting tokens amount for later milestones when no votes were used", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setMilestoneId(1);

                    const votesAmount = await governancePool.getUnusedVotes(investorA.address);

                    assert.equal(votesAmount.toString(), tokensToMint.toString());
                });

                it("[GP][11.1.3] Should return zero if all of the votes were used already", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(tokensToMint);

                    const votesAmount = await governancePool.getUnusedVotes(investorA.address);

                    assert.equal(votesAmount.toString(), "0");
                });

                it("[GP][11.1.4] Should return only unused votes if part of them were used", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const voteAgainstTokens = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).voteAgainst(voteAgainstTokens);

                    const votesAmount = await governancePool.getUnusedVotes(investorA.address);

                    assert.equal(
                        votesAmount.toString(),
                        tokensToMint.sub(voteAgainstTokens).toString()
                    );
                });
            });
        });

        describe("12. permanentlyLockVotes() function", () => {
            describe("12.1 Public state", () => {
                it("[GP][12.1.1] Should update milestonesWithVotes for sender", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const lockAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setMilestoneId(1);

                    const currentMilestoneId = await investmentPool.getCurrentMilestoneId();
                    const priorSenderMilestonesIds = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).permanentlyLockVotes(lockAmount);

                    const endingSenderMilestonesIds = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );

                    const expectedIds = [...priorSenderMilestonesIds, currentMilestoneId];
                    assert.deepEqual(endingSenderMilestonesIds, expectedIds);
                });

                it("[GP][12.1.2] Shouldn't update milestonesWithVotes for sender if current milestone already exists", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const lockAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const priorSenderMilestonesIds = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);

                    await governancePool.connect(investorA).permanentlyLockVotes(lockAmount);

                    const endingSenderMilestonesIds = await governancePool.getMilestonesWithVotes(
                        investorA.address
                    );

                    assert.deepEqual(endingSenderMilestonesIds, priorSenderMilestonesIds);
                });

                it("[GP][12.1.3] Should update memActiveTokens for sender", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const lockAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(anyMilestoneOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setMilestoneId(1);

                    const currentMilestoneId = await investmentPool.getCurrentMilestoneId();
                    const priorSenderBalance = await governancePool.getMemActiveTokens(
                        investorA.address,
                        currentMilestoneId
                    );
                    const priorSenderActiveBalance = await governancePool.getActiveVotes(
                        currentMilestoneId,
                        investorA.address
                    );

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).permanentlyLockVotes(lockAmount);

                    const endingSenderBalance = await governancePool.getMemActiveTokens(
                        investorA.address,
                        currentMilestoneId
                    );

                    assert.equal(priorSenderBalance.toString(), "0");
                    assert.equal(
                        endingSenderBalance.toString(),
                        priorSenderActiveBalance.sub(lockAmount).toString()
                    );
                });

                it("[GP][12.1.4] Should update lockedAmount value", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const lockAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setMilestoneId(1);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).permanentlyLockVotes(lockAmount);

                    const lockedAmountInContract = await governancePool.getLockedAmount(
                        investorA.address
                    );

                    assert.equal(lockedAmountInContract.toString(), lockAmount.toString());
                });

                it("[GP][12.1.5] Should update totalLockedAmount value", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const lockAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.mintVotingTokens(0, investorB.address, tokensToMint);
                    await investmentPool.setMilestoneId(1);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);

                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await votingToken
                        .connect(investorB)
                        .setApprovalForAll(governancePool.address, true);

                    await governancePool.connect(investorA).permanentlyLockVotes(lockAmount);
                    await governancePool.connect(investorB).permanentlyLockVotes(lockAmount);

                    const lockedAmountInContract = await governancePool.getTotalLockedAmount();

                    assert.equal(lockedAmountInContract.toString(), lockAmount.mul(2).toString());
                });
            });

            describe("12.2 Interactions", () => {
                it("[GP][12.2.1] Shouldn't be able to transfer 0 votes", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);

                    await expect(
                        governancePool.connect(investorA).permanentlyLockVotes(0)
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__AmountIsZero"
                    );
                });

                it("[GP][12.2.2] Shouldn't be able to transfer more votes than in balance", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);
                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);

                    await expect(
                        governancePool
                            .connect(investorA)
                            .permanentlyLockVotes(tokensToMint.add(100))
                    ).to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__CannotTransferMoreThanUnlockedTokens"
                    );
                });

                it("[GP][12.2.3] Should be able to lock full voting tokens amount", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);

                    await expect(
                        governancePool.connect(investorA).permanentlyLockVotes(tokensToMint)
                    ).to.emit(votingToken, "TransferSingle");
                });

                it("[GP][12.2.4] Should be able to lock part of voting tokens", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const lockAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);

                    await expect(
                        governancePool.connect(investorA).permanentlyLockVotes(lockAmount)
                    ).to.emit(votingToken, "TransferSingle");
                });

                it("[GP][12.2.5] Should update sender's and contract's balances", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");
                    const lockAmount = ethers.utils.parseEther("0.4");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    const priorSenderBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    const priorContractBalance = await governancePool.getVotingTokenBalance(
                        governancePool.address
                    );

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);
                    await governancePool.connect(investorA).permanentlyLockVotes(lockAmount);

                    const senderBalance = await governancePool.getVotingTokenBalance(
                        investorA.address
                    );
                    const contractBalance = await governancePool.getVotingTokenBalance(
                        governancePool.address
                    );

                    assert.equal(
                        senderBalance.toString(),
                        priorSenderBalance.sub(lockAmount).toString()
                    );
                    assert.equal(
                        contractBalance.toString(),
                        priorContractBalance.add(lockAmount).toString()
                    );
                });

                it("[GP][12.2.7] Shouldn't be able to lock votes if no milestone is ongoing", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await expect(
                        governancePool.connect(investorA).permanentlyLockVotes(tokensToMint)
                    )
                        .to.be.revertedWithCustomError(
                            governancePool,
                            "GovernancePool__InvestmentPoolStateNotAllowed"
                        )
                        .withArgs(fundraiserOngoingStateValue);
                });

                it("[GP][12.2.8] Should be able to lock votes if any milestone is ongoing", async () => {
                    const tokensToMint = ethers.utils.parseEther("1");

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await investmentPool.mintVotingTokens(0, investorA.address, tokensToMint);

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    await votingToken
                        .connect(investorA)
                        .setApprovalForAll(governancePool.address, true);

                    await expect(
                        governancePool.connect(investorA).permanentlyLockVotes(tokensToMint)
                    ).not.to.be.reverted;
                });
            });
        });
    });
});
