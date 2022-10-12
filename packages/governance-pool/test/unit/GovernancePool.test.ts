import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers, network} from "hardhat";
import {assert, expect} from "chai";
import {
    VotingToken,
    GovernancePoolMock,
    InvestmentPoolMockForIntegration,
} from "../../typechain-types";
import {BigNumber} from "ethers";

let accounts: SignerWithAddress[];
let deployer: SignerWithAddress;
let investmentPoolAsUser: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;
let investmentPoolFactoryAsUser: SignerWithAddress;
let foreignActor: SignerWithAddress;

let votingToken: VotingToken;
let governancePool: GovernancePoolMock;
let investmentPoolMock: InvestmentPoolMockForIntegration;

let votesWithdrawFee: BigNumber;

const getInvestmentPoolStatus = async (address: string): Promise<number> => {
    const investmentPoolId = await governancePool.getInvestmentPoolId(address);
    const investmentPoolStatus = await governancePool.investmentPoolStatus(investmentPoolId);
    return investmentPoolStatus;
};

const defineVotesWithdrawFee = async () => {
    await deployContracts();
    votesWithdrawFee = await governancePool.VOTES_WITHDRAW_FEE();
};

const deployContracts = async () => {
    const votingTokensFactory = await ethers.getContractFactory("VotingToken", deployer);
    votingToken = await votingTokensFactory.deploy();
    await votingToken.deployed();

    // Governance Pool deployment
    const governancePoolFactory = await ethers.getContractFactory("GovernancePoolMock", deployer);
    governancePool = await governancePoolFactory.deploy(
        votingToken.address,
        investmentPoolFactoryAsUser.address,
        51, // Votes threshold
        1 // 1% Votes withdraw fee
    );
    await governancePool.deployed();

    // Transfer ownership to governance pool
    await votingToken.transferOwnership(governancePool.address);
};

const dateToSeconds = (date: string, isBigNumber: boolean = true): BigNumber | number => {
    const convertedDate = new Date(date).getTime() / 1000;
    if (isBigNumber) {
        return BigNumber.from(convertedDate);
    } else {
        return convertedDate;
    }
};

describe("Governance Pool", async () => {
    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        investmentPoolAsUser = accounts[1];
        foreignActor = accounts[2];
        investorA = accounts[3];
        investorB = accounts[4];
        investmentPoolFactoryAsUser = accounts[5];

        await defineVotesWithdrawFee();
    });

    describe("1. Governance pool creation", () => {
        describe("1.1 Public state", () => {
            it("[GP][1.1.1] Constructor should assign values to the storage variables", async () => {
                // ERC1155 voting token for Governance Pool deployment
                const votingTokensFactory = await ethers.getContractFactory(
                    "VotingToken",
                    deployer
                );
                votingToken = await votingTokensFactory.deploy();
                await votingToken.deployed();

                // Governance Pool deployment
                const governancePoolFactory = await ethers.getContractFactory(
                    "GovernancePoolMock",
                    deployer
                );
                governancePool = await governancePoolFactory.deploy(
                    votingToken.address,
                    investmentPoolFactoryAsUser.address,
                    51, // Votes threshold
                    1 // 1% Votes withdraw fee
                );
                await governancePool.deployed();

                const VT = await governancePool.VOTING_TOKEN();
                const IPF = await governancePool.INVESTMENT_POOL_FACTORY_ADDRESS();

                assert.equal(VT, votingToken.address);
                assert.equal(IPF, investmentPoolFactoryAsUser.address);
            });
            it("[GP][1.1.2] Initial governance pool ether balance should be 0", async () => {
                const initialBalance = await governancePool.provider.getBalance(
                    governancePool.address
                );
                assert.equal(initialBalance.toString(), "0");
            });
        });
    });

    describe("2. Giving access for investment pools to mint tokens", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("2.1 Public state", () => {
            it("[GP][2.1.1] Investment pool should be in unavailable status by default", async () => {
                const status = await getInvestmentPoolStatus(investmentPoolAsUser.address);
                assert.equal(status, 0);
            });

            it("[GP][2.1.2] Should update status for investment pool state after giving access for minting", async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                const status = await getInvestmentPoolStatus(investmentPoolAsUser.address);
                assert.equal(status, 1);
            });
        });

        describe("2.2 Interactions", () => {
            it("[GP][2.2.1] IPF should be able to give access for minting", async () => {
                await expect(
                    governancePool
                        .connect(investmentPoolFactoryAsUser)
                        .activateInvestmentPool(investmentPoolAsUser.address)
                )
                    .to.emit(governancePool, "ActivateVoting")
                    .withArgs(investmentPoolAsUser.address);
            });

            it("[GP][2.2.2] Not everyone should be able to give access for minting", async () => {
                await expect(
                    governancePool
                        .connect(foreignActor)
                        .activateInvestmentPool(investmentPoolAsUser.address)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__notInvestmentPoolFactory"
                );
            });

            it("[GP][2.2.3] Only unavailable investment pools should be able to get access for minting", async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await expect(
                    governancePool
                        .connect(investmentPoolFactoryAsUser)
                        .activateInvestmentPool(investmentPoolAsUser.address)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotUnavailable"
                );
            });
        });
    });

    describe("3. Helper functions", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("3.1 Public state", () => {
            it("[GP][3.1.1] Initial tokens supply should be 0", async () => {
                const totalSupply = await governancePool.getVotingTokensSupply(
                    investmentPoolAsUser.address
                );
                assert.equal(totalSupply.toString(), "0");
            });

            it("[GP][3.1.2] Initial investor token balance should be 0", async () => {
                const initialBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    investorA.address
                );
                assert.equal(initialBalance.toString(), "0");
            });

            it("[GP][3.1.3] Initial governance pool token balance should be 0", async () => {
                const initialBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    governancePool.address
                );
                assert.equal(initialBalance.toString(), "0");
            });
        });

        describe("3.2 Interactions", () => {
            it("[GP][3.2.1] Should get the correct id from given address", async () => {
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    investmentPoolAsUser.address
                );

                const wrongInvestmentPoolId = await governancePool.getInvestmentPoolId(
                    foreignActor.address
                );

                const expectedId = ethers.BigNumber.from(investmentPoolAsUser.address);

                assert.notEqual(expectedId.toString(), wrongInvestmentPoolId.toString());
                assert.equal(expectedId.toString(), investmentPoolId.toString());
            });
        });
    });

    describe("4. Voting tokens minting", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("4.1 Public state", () => {
            const tokensToMintA: BigNumber = ethers.utils.parseEther("1");
            const tokensToMintB: BigNumber = ethers.utils.parseEther("2");

            beforeEach(async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);
            });

            it("[GP][4.1.1] Should update tokens supply", async () => {
                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMintA, 0);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorB.address, tokensToMintB, 0);

                const totalSupply = await governancePool.getVotingTokensSupply(
                    investmentPoolAsUser.address
                );

                const expectedTotalSupply = tokensToMintA.add(tokensToMintB);
                assert.equal(expectedTotalSupply.toString(), totalSupply.toString());
            });

            it("[GP][4.1.2] Should update governance pool balances", async () => {
                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMintA, 0);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorB.address, tokensToMintB, 0);

                const governancePoolBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    governancePool.address
                );

                assert.equal(
                    governancePoolBalance.toString(),
                    tokensToMintA.add(tokensToMintB).toString()
                );
            });

            it("[GP][4.1.3] Should not update investors balances", async () => {
                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMintA, 0);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorB.address, tokensToMintB, 0);

                const balanceOfinvestorA = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    investorA.address
                );

                const balanceOfinvestorB = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    investorB.address
                );

                assert.equal(balanceOfinvestorA.toString(), "0");
                assert.equal(balanceOfinvestorB.toString(), "0");
            });

            it("[GP][4.1.4] Should update mapping for tracking locked tokens", async () => {
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    investmentPoolAsUser.address
                );

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMintA, 0);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMintB, 0);

                const lockedTokens = await governancePool.tokensLocked(
                    investorA.address,
                    investmentPoolId,
                    0
                );

                assert.equal(lockedTokens.unlockTime.toString(), "0");
                assert.equal(
                    lockedTokens.amount.toString(),
                    tokensToMintA.add(tokensToMintB).toString()
                );
                assert.isFalse(lockedTokens.claimed);
            });
        });

        describe("4.2 Interactions", () => {
            let tokensToMint: BigNumber = ethers.utils.parseEther("1");

            it("[GP][4.2.1] Investment pools with active voting status should be able to mint tokens", async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await expect(
                    governancePool
                        .connect(investmentPoolAsUser)
                        .mintVotingTokens(0, investorA.address, tokensToMint, 0)
                ).to.emit(votingToken, "TransferSingle");
            });

            it("[GP][4.2.2] Investment pools with unavailable status should not be able to mint tokens", async () => {
                await expect(
                    governancePool
                        .connect(investmentPoolAsUser)
                        .mintVotingTokens(0, investorA.address, tokensToMint, 0)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotActiveVoting"
                );
            });

            it("[GP][4.2.3] Investment pools with voted against status should not be able to mint tokens", async () => {
                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToVotedAgainst(
                    investmentPoolAsUser.address
                );

                await expect(
                    governancePool
                        .connect(investmentPoolAsUser)
                        .mintVotingTokens(0, investorA.address, tokensToMint, 0)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotActiveVoting"
                );
            });

            it("[GP][4.2.4] Investor should not be able to mint tokens", async () => {
                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToActiveVoting(
                    investmentPoolAsUser.address
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .mintVotingTokens(0, investorA.address, tokensToMint, 0)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotActiveVoting"
                );
            });

            it("[GP][4.2.5] Should revert if minting 0 tokens", async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await expect(
                    governancePool
                        .connect(investmentPoolAsUser)
                        .mintVotingTokens(0, investorA.address, 0, 0)
                ).to.be.revertedWithCustomError(governancePool, "GovernancePool__amountIsZero");
            });

            it("[GP][4.2.6] Should be able to mint 1mln tokens in one mint", async () => {
                tokensToMint = ethers.utils.parseEther("1000000");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                const totalSupply = await governancePool.getVotingTokensSupply(
                    investmentPoolAsUser.address
                );
                assert.equal(tokensToMint.toString(), totalSupply.toString());
            });

            it("[GP][4.2.7] Should be able to mint 1mln tokens in 2 mints", async () => {
                tokensToMint = ethers.utils.parseEther("500000");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);
                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorB.address, tokensToMint, 0);

                const totalSupply = await governancePool.getVotingTokensSupply(
                    investmentPoolAsUser.address
                );

                const expectedTotalSupply = tokensToMint.mul(2);
                assert.equal(expectedTotalSupply.toString(), totalSupply.toString());
            });
        });
    });

    describe("5. Calculating percentage for votes against", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("5.1 Interactions", () => {
            it("[GP][5.1.1] Initial calculation with zeros should revert", async () => {
                const tokensToMint = ethers.utils.parseEther("0");

                await expect(
                    governancePool.votesAgainstPercentageCount(
                        investmentPoolAsUser.address,
                        tokensToMint
                    )
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__totalSupplyIsZero"
                );
            });

            it("[GP][5.1.2] Should revert if amount for votes against are higher than total supply", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("1.5");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                const totalSupply = await governancePool.getVotingTokensSupply(
                    investmentPoolAsUser.address
                );

                await expect(
                    governancePool.votesAgainstPercentageCount(
                        investmentPoolAsUser.address,
                        votesAgainst
                    )
                )
                    .to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__totalSupplyIsSmallerThanVotesAgainst"
                    )
                    .withArgs(totalSupply, votesAgainst);
            });

            it("[GP][5.1.3] Should correctly calculate the percentage", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainstA = ethers.utils.parseEther("0.44444");
                const votesAgainstB = ethers.utils.parseEther("0.70999");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                const percentageA = await governancePool.votesAgainstPercentageCount(
                    investmentPoolAsUser.address,
                    votesAgainstA
                );
                const percentageB = await governancePool.votesAgainstPercentageCount(
                    investmentPoolAsUser.address,
                    votesAgainstB
                );

                assert.equal(percentageA, 44);
                assert.equal(percentageB, 70);
            });
        });
    });

    describe("6. Threshold checking", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("6.1 Interactions", () => {
            const tokensToMint: BigNumber = ethers.utils.parseEther("2");
            beforeEach(async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);
            });

            it("[GP][6.1.1] Should reach a threshold", async () => {
                const thresholdAmount = ethers.utils.parseEther("1.1");

                const thresholdReached = await governancePool.willInvestorReachThreshold(
                    investmentPoolAsUser.address,
                    thresholdAmount
                );
                assert.isTrue(thresholdReached);
            });

            it("[GP][6.1.2] Should not reach a threshold", async () => {
                const notThresholdAmount = ethers.utils.parseEther("1");

                const thresholdReached = await governancePool.willInvestorReachThreshold(
                    investmentPoolAsUser.address,
                    notThresholdAmount
                );

                assert.isFalse(thresholdReached);
            });
        });
    });

    describe("7. Unlock voting tokens", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("7.1 Public state", () => {
            it("[GP][7.1.1] Should update locked tokens status to claimed", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    investmentPoolAsUser.address
                );

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(investmentPoolAsUser.address, 0)
                )
                    .to.emit(governancePool, "UnlockVotingTokens")
                    .withArgs(investmentPoolAsUser.address, investorA.address, 0, tokensToMint);

                const lockedTokensClaimed = await governancePool.tokensLocked(
                    investorA.address,
                    investmentPoolId,
                    0
                );

                assert.isTrue(lockedTokensClaimed.claimed);
            });
        });
        describe("7.2 Interactions", () => {
            it("[GP][7.2.1] Should be able to unlock tokens for investment pool with active voting", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(investmentPoolAsUser.address, 0)
                ).not.to.be.reverted;
            });

            it("[GP][7.2.2] Should not be able to unlock tokens for unavailable investment pool", async () => {
                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(investmentPoolAsUser.address, 0)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotActiveVoting"
                );
            });

            it("[GP][7.2.3] Should not be able to unlock tokens for investment pool which reached votes threshold", async () => {
                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToVotedAgainst(
                    investmentPoolAsUser.address
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(investmentPoolAsUser.address, 0)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotActiveVoting"
                );
            });

            it("[GP][7.2.4] Should not be able to unlock project tokens if investor has not invested in it", async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(investmentPoolAsUser.address, 0)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__noIvestmentsMade"
                );
            });

            it("[GP][7.2.5] Should transfer locked tokens to the investor", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(investmentPoolAsUser.address, 0)
                ).to.emit(votingToken, "TransferSingle");

                const governancePoolBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    governancePool.address
                );

                const investorBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    investorA.address
                );

                assert.equal(governancePoolBalance.toString(), "0");
                assert.equal(investorBalance.toString(), tokensToMint.toString());
            });

            it("[GP][7.2.6] If unlock time isn't reached, it should revert", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const futureDate = dateToSeconds("3000/01/01") as BigNumber;

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(1, investorA.address, tokensToMint, futureDate);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(investmentPoolAsUser.address, 1)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__noVotingTokensAvailableForClaim"
                );
            });

            it("[GP][7.2.7] Should revert if no tokens are available for claiming", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                // Simulate that part of the total investment has already been claimed
                await governancePool
                    .connect(investorA)
                    .setTokensClaimedStatus(investmentPoolAsUser.address, 0, true);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(investmentPoolAsUser.address, 0)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__noVotingTokensAvailableForClaim"
                );
            });

            it("[GP][7.2.8] Should only transfer tokens which are not claimed yet", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(investmentPoolAsUser.address, 0)
                )
                    .to.emit(governancePool, "UnlockVotingTokens")
                    .withArgs(
                        investmentPoolAsUser.address,
                        investorA.address,
                        0,
                        tokensToMint.mul(2)
                    );
            });
        });
    });

    describe("8. Voting process", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("8.1 Public state", () => {
            const tokensToMint: BigNumber = ethers.utils.parseEther("1");

            beforeEach(async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);
            });

            it("[GP][8.1.1] Should update votes amount for investor", async () => {
                const votesAgainst = ethers.utils.parseEther("0.4");
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    investmentPoolAsUser.address
                );

                await governancePool
                    .connect(investorA)
                    .voteAgainst(investmentPoolAsUser.address, votesAgainst);

                const votesAmount = await governancePool.votesAmount(
                    investorA.address,
                    investmentPoolId
                );

                assert.equal(votesAgainst.toString(), votesAmount.toString());
            });

            it("[GP][8.1.2] Should update total votes amount for investment pool", async () => {
                const votesAgainst = ethers.utils.parseEther("0.4");
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    investmentPoolAsUser.address
                );

                await governancePool
                    .connect(investorA)
                    .voteAgainst(investmentPoolAsUser.address, votesAgainst);

                const totalVotesAmount = await governancePool.totalVotesAmount(investmentPoolId);

                assert.equal(totalVotesAmount.toString(), votesAgainst.toString());
            });

            it("[GP][8.1.3] Should update investment pool status if threshold was reached", async () => {
                const votesAgainst = ethers.utils.parseEther("0.6");

                // Deploy Fake governance pool mock which can mint tokens
                const investmentPoolMockDep = await ethers.getContractFactory(
                    "InvestmentPoolMockForIntegration",
                    deployer
                );

                investmentPoolMock = await investmentPoolMockDep.deploy(governancePool.address);

                await investmentPoolMock.deployed();

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolMock.address);

                await investmentPoolMock.mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolMock.address, 0);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolMock.address, votesAgainst)
                )
                    .to.emit(governancePool, "FinishVoting")
                    .withArgs(investmentPoolMock.address)
                    .to.emit(governancePool, "VoteAgainstProject")
                    .withArgs(investmentPoolMock.address, investorA.address, votesAgainst);

                const status = await getInvestmentPoolStatus(investmentPoolMock.address);

                assert.equal(status, 2); // Voted Against
            });

            it("[GP][8.1.4] Should not update investment pool status if threshold was not reached", async () => {
                const votesAgainst = ethers.utils.parseEther("0.4");

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolAsUser.address, votesAgainst)
                )
                    .to.emit(governancePool, "VoteAgainstProject")
                    .withArgs(investmentPoolAsUser.address, investorA.address, votesAgainst);

                const status = await getInvestmentPoolStatus(investmentPoolAsUser.address);

                assert.equal(status, 1); // Voting Active
            });
        });

        describe("8.2 Interactions", () => {
            it("[GP][8.2.1] Should be able to vote for investment pool with active voting", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolAsUser.address, votesAgainst)
                ).not.to.be.reverted;
            });

            it("[GP][8.2.2] Should not be able to vote for unavailable investment pool", async () => {
                const votesAgainst = ethers.utils.parseEther("1");

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolAsUser.address, votesAgainst)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotActiveVoting"
                );
            });

            it("[GP][8.2.3] Should not be able to vote for investment pool which reached votes threshold", async () => {
                const votesAgainst = ethers.utils.parseEther("1");

                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToVotedAgainst(
                    investmentPoolAsUser.address
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolAsUser.address, votesAgainst)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotActiveVoting"
                );
            });

            it("[GP][8.2.4] Voting with 0 amount should revert", async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await expect(
                    governancePool.connect(investorA).voteAgainst(investmentPoolAsUser.address, 0)
                ).to.be.revertedWithCustomError(governancePool, "GovernancePool__amountIsZero");
            });

            it("[GP][8.2.5] Should revert if investor does not have any voting tokens", async () => {
                const votesAgainst = ethers.utils.parseEther("1");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolAsUser.address, votesAgainst)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__noVotingTokensOwned"
                );
            });

            it("[GP][8.2.6] Should not be able to vote with more tokens than investor has", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("1.5");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                const tokenBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    investorA.address
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolAsUser.address, votesAgainst)
                )
                    .to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__amountIsGreaterThanVotingTokensBalance"
                    )
                    .withArgs(votesAgainst, tokenBalance);
            });

            it("[GP][8.2.7] Should transfer voting tokens from investor to governance pool", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const votesLeft = tokensToMint.sub(votesAgainst);

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolAsUser.address, votesAgainst)
                ).to.emit(votingToken, "TransferSingle");

                const governancePoolBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    governancePool.address
                );

                const investorBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    investorA.address
                );

                assert.equal(governancePoolBalance.toString(), votesAgainst.toString());
                assert.equal(investorBalance.toString(), votesLeft.toString());
            });

            it("[GP][8.2.8] Should not be able to vote if governance pool is not approved to spend tokens", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolAsUser.address, votesAgainst)
                ).to.be.revertedWith("ERC1155: caller is not token owner nor approved");
            });

            it("[GP][8.2.9] Should be able to vote with all of the tokens", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                // Deploy Fake governance pool mock which can mint tokens
                const investmentPoolMockDep = await ethers.getContractFactory(
                    "InvestmentPoolMockForIntegration",
                    deployer
                );
                investmentPoolMock = await investmentPoolMockDep.deploy(governancePool.address);
                await investmentPoolMock.deployed();

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolMock.address);

                await investmentPoolMock.mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolMock.address, 0);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(investmentPoolMock.address, tokensToMint)
                ).not.to.be.reverted;
            });
        });
    });

    describe("9. Retracting votes", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("9.1 Public state", () => {
            const tokensToMint: BigNumber = ethers.utils.parseEther("1");
            const votesAgainst: BigNumber = ethers.utils.parseEther("0.4");
            const votesToRetract: BigNumber = ethers.utils.parseEther("0.1");
            const votesLeft: BigNumber = votesAgainst.sub(votesToRetract);

            beforeEach(async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(investmentPoolAsUser.address, votesAgainst);

                await governancePool
                    .connect(investorA)
                    .retractVotes(investmentPoolAsUser.address, votesToRetract);
            });

            it("[GP][9.1.1] Should update votes amount for investor", async () => {
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    investmentPoolAsUser.address
                );

                const votesAmount = await governancePool.votesAmount(
                    investorA.address,
                    investmentPoolId
                );

                assert.equal(votesLeft.toString(), votesAmount.toString());
            });
            it("[GP][9.1.2] Should update total votes amount for investment pool", async () => {
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    investmentPoolAsUser.address
                );

                const totalVotesAmount = await governancePool.totalVotesAmount(investmentPoolId);

                assert.equal(totalVotesAmount.toString(), votesLeft.toString());
            });
        });

        describe("9.2 Interactions", () => {
            it("[GP][9.2.1] Should be able to retract votes from investment pool with active voting", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const votesToRetract = ethers.utils.parseEther("0.1");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(investmentPoolAsUser.address, votesAgainst);

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(investmentPoolAsUser.address, votesToRetract)
                )
                    .to.emit(governancePool, "RetractVotes")
                    .withArgs(investmentPoolAsUser.address, investorA.address, votesToRetract);
            });

            it("[GP][9.2.2] Should not be able to retract votes from unavailable investment pool", async () => {
                const votesToRetract = ethers.utils.parseEther("1");

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(investmentPoolAsUser.address, votesToRetract)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotActiveVoting"
                );
            });

            it("[GP][9.2.3] Should not be able to retract votes from investment pool which reached votes threshold", async () => {
                const votesToRetract = ethers.utils.parseEther("1");

                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToVotedAgainst(
                    investmentPoolAsUser.address
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(investmentPoolAsUser.address, votesToRetract)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__statusIsNotActiveVoting"
                );
            });

            it("[GP][9.2.4] Retracting 0 amount of votes should revert", async () => {
                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await expect(
                    governancePool.connect(investorA).retractVotes(investmentPoolAsUser.address, 0)
                ).to.be.revertedWithCustomError(governancePool, "GovernancePool__amountIsZero");
            });

            it("[GP][9.2.5] Should revert if investor did not vote against the project", async () => {
                const votesToRetract = ethers.utils.parseEther("1");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(investmentPoolAsUser.address, votesToRetract)
                ).to.be.revertedWithCustomError(
                    governancePool,
                    "GovernancePool__noVotesAgainstProject"
                );
            });

            it("[GP][9.2.6] Should not be able to retract more voting tokens than investor has delegated for voting", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const votesToRetract = ethers.utils.parseEther("0.5");
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    investmentPoolAsUser.address
                );

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(investmentPoolAsUser.address, votesAgainst);

                const delegatedVotes = await governancePool.votesAmount(
                    investorA.address,
                    investmentPoolId
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(investmentPoolAsUser.address, votesToRetract)
                )
                    .to.be.revertedWithCustomError(
                        governancePool,
                        "GovernancePool__amountIsGreaterThanDelegatedVotes"
                    )
                    .withArgs(votesToRetract, delegatedVotes);
            });

            it("[GP][9.2.7] Should transfer voting tokens from governance pool to investor", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const votesToRetract = ethers.utils.parseEther("0.1");
                const votesLeftInPool = votesAgainst.sub(votesToRetract);
                const votesLeftForInvestor = tokensToMint.sub(votesAgainst).add(votesToRetract);

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(investmentPoolAsUser.address, votesAgainst);

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(investmentPoolAsUser.address, votesToRetract)
                ).to.emit(votingToken, "TransferSingle");

                const governancePoolBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    governancePool.address
                );

                const investorBalance = await governancePool.getVotingTokenBalance(
                    investmentPoolAsUser.address,
                    investorA.address
                );

                const feeAmount: BigNumber = votesToRetract
                    .mul(votesWithdrawFee)
                    .div(BigNumber.from(100));

                assert.equal(
                    governancePoolBalance.toString(),
                    votesLeftInPool.add(feeAmount).toString()
                );
                assert.equal(
                    investorBalance.toString(),
                    votesLeftForInvestor.sub(feeAmount).toString()
                );
            });

            it("[GP][9.2.8] Should be able to retract all of the votes", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");

                await governancePool
                    .connect(investmentPoolFactoryAsUser)
                    .activateInvestmentPool(investmentPoolAsUser.address);

                await governancePool
                    .connect(investmentPoolAsUser)
                    .mintVotingTokens(0, investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(investmentPoolAsUser.address, 0);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(investmentPoolAsUser.address, votesAgainst);

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(investmentPoolAsUser.address, votesAgainst)
                ).not.to.be.reverted;
            });
        });
    });
});
