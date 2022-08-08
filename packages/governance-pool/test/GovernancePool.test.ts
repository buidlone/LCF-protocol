import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers, network} from "hardhat";
import {assert, expect} from "chai";
import {VotingToken, GovernancePoolMock} from "../typechain";
import traveler from "ganache-time-traveler";

describe("Governance Pool", async () => {
    let accounts: SignerWithAddress[];
    let deployer: SignerWithAddress;
    let fakeInvestmentPool1: SignerWithAddress;
    let fakeInvestmentPool2: SignerWithAddress;
    let investorA: SignerWithAddress;
    let investorB: SignerWithAddress;
    let fakeInvestmentPoolFactory: SignerWithAddress;
    let foreignActor: SignerWithAddress;

    let votingToken: VotingToken;
    let governancePool: GovernancePoolMock;

    const getInvestmentPoolStatus = async (address: string): Promise<number> => {
        const investmentPoolId = await governancePool.getInvestmentPoolId(address);
        const investmentPoolStatus = await governancePool.investmentPoolStatus(investmentPoolId);
        return investmentPoolStatus;
    };

    const deployContracts = async () => {
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
            fakeInvestmentPoolFactory.address
        );
        await governancePool.deployed();

        // Transfer ownership to governance pool
        await votingToken.transferOwnership(governancePool.address);
    };

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        fakeInvestmentPool1 = accounts[1];
        fakeInvestmentPool2 = accounts[2];
        investorA = accounts[3];
        investorB = accounts[4];
        fakeInvestmentPoolFactory = accounts[5];
        foreignActor = accounts[6];
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
                    fakeInvestmentPoolFactory.address
                );
                await governancePool.deployed();

                const VT = await governancePool.VOTING_TOKEN();
                const IPF = await governancePool.INVESTMENT_POOL_FACTORY_ADDRESS();

                assert.equal(VT, votingToken.address);
                assert.equal(IPF, fakeInvestmentPoolFactory.address);
            });
        });
    });

    describe("2. Giving access for investment pools to mint tokens", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("2.1 Public state", () => {
            it("[GP][2.1.1] Investment pool should be in unavailable status by default", async () => {
                const status = await getInvestmentPoolStatus(fakeInvestmentPool1.address);
                assert.equal(status, 0);
            });

            it("[GP][2.1.2] Should update status for investment pool state after giving access for minting", async () => {
                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                const status = await getInvestmentPoolStatus(fakeInvestmentPool1.address);
                assert.equal(status, 1);
            });
        });

        describe("2.2 Interactions", () => {
            it("[GP][2.2.1] IPF should be able to give access for minting", async () => {
                await expect(
                    governancePool
                        .connect(fakeInvestmentPoolFactory)
                        .activateInvestmentPool(fakeInvestmentPool1.address)
                )
                    .to.emit(governancePool, "ActivateVoting")
                    .withArgs(fakeInvestmentPool1.address);
            });

            it("[GP][2.2.2] Not everyone should be able to give access for minting", async () => {
                await expect(
                    governancePool
                        .connect(foreignActor)
                        .activateInvestmentPool(fakeInvestmentPool1.address)
                ).to.be.revertedWith("[GP]: not an investment pool factory");
            });

            it("[GP][2.2.3] Only unavailable investment pools should be able to get access for minting", async () => {
                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await expect(
                    governancePool
                        .connect(fakeInvestmentPoolFactory)
                        .activateInvestmentPool(fakeInvestmentPool1.address)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than unavailable"
                );
            });
        });
    });

    describe("3. Helper functions", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("3.1 Public state", () => {
            it("[GP][3.1.1] Initial supply should be 0", async () => {
                let totalSupply = await governancePool.getVotingTokensSupply(
                    fakeInvestmentPool1.address
                );

                assert.equal(totalSupply.toString(), "0");
            });

            it("[GP][3.1.2] Initial investor balance should be 0", async () => {
                let initialBalance = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    investorA.address
                );

                assert.equal(initialBalance.toString(), "0");
            });
        });

        describe("3.2 Interactions", () => {
            it("[GP][3.2.1] Should get the correct id from given address", async () => {
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    fakeInvestmentPool1.address
                );

                const wrongInvestmentPoolId = await governancePool.getInvestmentPoolId(
                    fakeInvestmentPool2.address
                );

                const expectedId = ethers.BigNumber.from(fakeInvestmentPool1.address);

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
            it("[GP][4.1.1] Should update tokens supply", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorB.address, tokensToMint, 0);

                const totalSupply = await governancePool.getVotingTokensSupply(
                    fakeInvestmentPool1.address
                );

                const expectedTotalSupply = ethers.utils.parseEther("2");
                assert.equal(expectedTotalSupply.toString(), totalSupply.toString());
            });

            it("[GP][4.1.2] Should update governance pool balances", async () => {
                const tokensToMintA = ethers.utils.parseEther("1");
                const tokensToMintB = ethers.utils.parseEther("2");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMintA, 0);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorB.address, tokensToMintB, 0);

                const governancePoolBalance = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    governancePool.address
                );

                assert.equal(
                    governancePoolBalance.toString(),
                    tokensToMintA.add(tokensToMintB).toString()
                );
            });

            it("[GP][4.1.3] Should not update investors balances", async () => {
                const tokensToMintA = ethers.utils.parseEther("1");
                const tokensToMintB = ethers.utils.parseEther("2");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMintA, 0);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorB.address, tokensToMintB, 0);

                const balanceOfinvestorA = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    investorA.address
                );

                const balanceOfinvestorB = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    investorB.address
                );

                assert.equal(balanceOfinvestorA.toString(), "0");
                assert.equal(balanceOfinvestorB.toString(), "0");
            });

            it("[GP][4.1.4] Should update mapping for tracking locked tokens", async () => {
                const tokensToMintA = ethers.utils.parseEther("1");
                const tokensToMintB = ethers.utils.parseEther("2");
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    fakeInvestmentPool1.address
                );
                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMintA, 0);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMintB, 0);

                const lockedTokens1 = await governancePool.tokensLocked(
                    investorA.address,
                    investmentPoolId,
                    0
                );
                const lockedTokens2 = await governancePool.tokensLocked(
                    investorA.address,
                    investmentPoolId,
                    1
                );
                assert.equal(lockedTokens1.unlockTime.toString(), "0");
                assert.equal(lockedTokens1.amount.toString(), tokensToMintA.toString());
                assert.equal(lockedTokens1.claimed, false);
                assert.equal(lockedTokens2.unlockTime.toString(), "0");
                assert.equal(lockedTokens2.amount.toString(), tokensToMintB.toString());
                assert.equal(lockedTokens2.claimed, false);
            });
        });

        describe("4.2 Interactions", () => {
            it("[GP][4.2.1] Investment pools with active voting status should be able to mint tokens", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await expect(
                    governancePool
                        .connect(fakeInvestmentPool1)
                        .mintVotingTokens(investorA.address, tokensToMint, 0)
                ).to.emit(votingToken, "TransferSingle");
            });

            it("[GP][4.2.2] Investment pools with unavailable status should not be able to mint tokens", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                await expect(
                    governancePool
                        .connect(fakeInvestmentPool1)
                        .mintVotingTokens(investorA.address, tokensToMint, 0)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than active voting"
                );
            });

            it("[GP][4.2.3] Investment pools with voted against status should not be able to mint tokens", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToVotedAgainst(
                    fakeInvestmentPool1.address
                );

                await expect(
                    governancePool
                        .connect(fakeInvestmentPool1)
                        .mintVotingTokens(investorA.address, tokensToMint, 0)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than active voting"
                );
            });

            it("[GP][4.2.4] Investor should not be able to mint tokens", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToActiveVoting(
                    fakeInvestmentPool1.address
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .mintVotingTokens(investorA.address, tokensToMint, 0)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than active voting"
                );
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
                        fakeInvestmentPool1.address,
                        tokensToMint
                    )
                ).to.be.revertedWith("[GP]: total tokens supply is zero");
            });

            it("[GP][5.1.2] Should revert if amount for votes against are higher than total supply", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("1.5");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await expect(
                    governancePool.votesAgainstPercentageCount(
                        fakeInvestmentPool1.address,
                        votesAgainst
                    )
                ).to.be.revertedWith(
                    "[GP]: total supply of tokens needs to be higher than votes against"
                );
            });

            it("[GP][5.1.3] Should correctly calculate the percentage", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainstA = ethers.utils.parseEther("0.44444");
                const votesAgainstB = ethers.utils.parseEther("0.70999");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                const percentageA = await governancePool.votesAgainstPercentageCount(
                    fakeInvestmentPool1.address,
                    votesAgainstA
                );
                const percentageB = await governancePool.votesAgainstPercentageCount(
                    fakeInvestmentPool1.address,
                    votesAgainstB
                );

                assert.equal(percentageA, 44);
                assert.equal(percentageB, 70);
            });
        });
    });

    describe("6. Treshold checking", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("6.1 Interactions", () => {
            it("[GP][6.1.1] Should reach a treshold", async () => {
                const tokensToMint = ethers.utils.parseEther("2");
                const tresholdAmount = ethers.utils.parseEther("1.1");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                const tresholdReached = await governancePool.willInvestorReachTreshold(
                    fakeInvestmentPool1.address,
                    tresholdAmount
                );
                assert.equal(tresholdReached, true);
            });

            it("[GP][6.1.2] Should not reach a treshold", async () => {
                const tokensToMint = ethers.utils.parseEther("2");
                const notTresholdAmount = ethers.utils.parseEther("1");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                const tresholdReached = await governancePool.willInvestorReachTreshold(
                    fakeInvestmentPool1.address,
                    notTresholdAmount
                );

                assert.equal(tresholdReached, false);
            });
        });
    });

    describe("7. Unlock voting tokens", () => {
        let snapshotId: string;

        beforeEach(async () => {
            await deployContracts();

            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });
        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("7.1 Public state", () => {
            it("[GP][7.1.1] Should update locked tokens status", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    fakeInvestmentPool1.address
                );

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                )
                    .to.emit(governancePool, "UnlockVotingTokens")
                    .withArgs(fakeInvestmentPool1.address, investorA.address, 0, tokensToMint);

                const lockedTokensClaimed = await governancePool.tokensLocked(
                    investorA.address,
                    investmentPoolId,
                    0
                );

                assert.equal(lockedTokensClaimed.claimed, true);
            });
        });
        describe("7.2 Interactions", () => {
            it("[GP][7.2.1] Should be able to unlock tokens for investment pool with active voting", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                ).not.to.be.reverted;
            });

            it("[GP][7.2.2] Should not be able to unlock tokens for unavailable investment pool", async () => {
                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than active voting"
                );
            });

            it("[GP][7.2.3] Should not be able to unlock tokens for investment pool which reached votes treshold", async () => {
                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToVotedAgainst(
                    fakeInvestmentPool1.address
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than active voting"
                );
            });

            it("[GP][7.2.4] Should not be able to unlock project tokens if investor has not invested in it", async () => {
                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                ).to.be.revertedWith("[GP]: haven't invested in this project");
            });

            it("[GP][7.2.5] Should transfer locked tokens to the investor", async () => {
                const tokensToMint = ethers.utils.parseEther("1");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                ).to.emit(votingToken, "TransferSingle");

                const governancePoolBalance = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    governancePool.address
                );

                const investorBalance = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    investorA.address
                );

                assert.equal(governancePoolBalance.toString(), "0");
                assert.equal(investorBalance.toString(), tokensToMint.toString());
            });

            it("[GP][7.2.6] Should only transfer tokens which reached unlock time", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const date = new Date();
                const futureTime = Math.floor(date.setDate(date.getDate() + 1) / 1000);
                const twoDays = 60 * 60 * 24 * 2;

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);
                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, futureTime);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                )
                    .to.emit(governancePool, "UnlockVotingTokens")
                    .withArgs(fakeInvestmentPool1.address, investorA.address, 0, tokensToMint);

                // Time travel 2 day to the future
                await traveler.advanceTimeAndBlock(twoDays);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                )
                    .to.emit(governancePool, "UnlockVotingTokens")
                    .withArgs(fakeInvestmentPool1.address, investorA.address, 1, tokensToMint);
            });

            it("[GP][7.2.7] Should only transfer tokens which are not claimed yet", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    fakeInvestmentPool1.address
                );

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                // Simulate that part of the total investment has already been claimed
                await governancePool
                    .connect(investorA)
                    .setTokensClaimedStatus(fakeInvestmentPool1.address, 0, true);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                )
                    .to.emit(governancePool, "UnlockVotingTokens")
                    .withArgs(fakeInvestmentPool1.address, investorA.address, 1, tokensToMint);

                // Simulate that part of the total investment hasn't been claimed
                await governancePool
                    .connect(investorA)
                    .setTokensClaimedStatus(fakeInvestmentPool1.address, 0, false);

                await expect(
                    governancePool
                        .connect(investorA)
                        .unlockVotingTokens(fakeInvestmentPool1.address)
                )
                    .to.emit(governancePool, "UnlockVotingTokens")
                    .withArgs(fakeInvestmentPool1.address, investorA.address, 0, tokensToMint);
            });
        });
    });

    describe("8. Voting process", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("8.1 Public state", () => {
            it("[GP][8.1.1] Should update votes amount for investor", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    fakeInvestmentPool1.address
                );

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(fakeInvestmentPool1.address, votesAgainst);

                const votesAmount = await governancePool.votesAmount(
                    investorA.address,
                    investmentPoolId
                );

                assert.equal(votesAgainst.toString(), votesAmount.toString());
            });

            it("[GP][8.1.2] Should update total votes amount for investment pool", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    fakeInvestmentPool1.address
                );

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(fakeInvestmentPool1.address, votesAgainst);

                const totalVotesAmount = await governancePool.totalVotesAmount(investmentPoolId);

                assert.equal(totalVotesAmount.toString(), votesAgainst.toString());
            });

            it("[GP][8.1.3] Should update investment pool status if treshold was reached", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.6");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(fakeInvestmentPool1.address, votesAgainst)
                )
                    .to.emit(governancePool, "FinishVoting")
                    .withArgs(fakeInvestmentPool1.address)
                    .to.emit(governancePool, "VoteAgainstProject")
                    .withArgs(fakeInvestmentPool1.address, investorA.address, votesAgainst);

                const status = await getInvestmentPoolStatus(fakeInvestmentPool1.address);

                assert.equal(status, 2); // Voted Against
            });

            it("[GP][8.1.4] Should not update investment pool status if treshold was not reached", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(fakeInvestmentPool1.address, votesAgainst)
                )
                    .to.emit(governancePool, "VoteAgainstProject")
                    .withArgs(fakeInvestmentPool1.address, investorA.address, votesAgainst)
                    .not.to.emit(governancePool, "FinishVoting");

                const status = await getInvestmentPoolStatus(fakeInvestmentPool1.address);

                assert.equal(status, 1); // Voting Active
            });
        });

        describe("8.2 Interactions", () => {
            it("[GP][8.2.1] Should be able to vote for investment pool with active voting", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(fakeInvestmentPool1.address, votesAgainst)
                ).not.to.be.reverted;
            });

            it("[GP][8.2.2] Should not be able to vote for unavailable investment pool", async () => {
                const votesAgainst = ethers.utils.parseEther("1");

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(fakeInvestmentPool1.address, votesAgainst)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than active voting"
                );
            });

            it("[GP][8.2.3] Should not be able to vote for investment pool which reached votes treshold", async () => {
                const votesAgainst = ethers.utils.parseEther("1");

                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToVotedAgainst(
                    fakeInvestmentPool1.address
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(fakeInvestmentPool1.address, votesAgainst)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than active voting"
                );
            });

            it("[GP][8.2.4] Voting with 0 amount should revert", async () => {
                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await expect(
                    governancePool.connect(investorA).voteAgainst(fakeInvestmentPool1.address, 0)
                ).to.be.revertedWith("[GP]: amount needs to be greater than 0");
            });

            it("[GP][8.2.5] Should revert if investor does not have any voting tokens", async () => {
                const votesAgainst = ethers.utils.parseEther("1");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(fakeInvestmentPool1.address, votesAgainst)
                ).to.be.revertedWith("[GP]: don't have any voting tokens");
            });

            it("[GP][8.2.6] Should not be able to vote with more tokens than investor has", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("1.5");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(fakeInvestmentPool1.address, votesAgainst)
                ).to.be.revertedWith("[GP]: amount can't be greater than voting tokens balance");
            });

            it("[GP][8.2.7] Should transfer voting tokens from investor to governance pool", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const votesLeft = tokensToMint.sub(votesAgainst);

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(fakeInvestmentPool1.address, votesAgainst)
                ).to.emit(votingToken, "TransferSingle");

                const governancePoolBalance = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    governancePool.address
                );

                const investorBalance = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    investorA.address
                );

                assert.equal(governancePoolBalance.toString(), votesAgainst.toString());
                assert.equal(investorBalance.toString(), votesLeft.toString());
            });

            it("[GP][8.2.8] Should not be able to vote if governance pool is not approved to spend tokens", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                await expect(
                    governancePool
                        .connect(investorA)
                        .voteAgainst(fakeInvestmentPool1.address, votesAgainst)
                ).to.be.revertedWith("ERC1155: caller is not owner nor approved");
            });
        });
    });

    describe("9. Retracting votes", () => {
        beforeEach(async () => {
            await deployContracts();
        });

        describe("9.1 Public state", () => {
            it("[GP][9.1.1] Should update votes amount for investor", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const votesToRetract = ethers.utils.parseEther("0.1");
                const votesLeft = votesAgainst.sub(votesToRetract);

                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    fakeInvestmentPool1.address
                );

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(fakeInvestmentPool1.address, votesAgainst);

                await governancePool
                    .connect(investorA)
                    .retractVotes(fakeInvestmentPool1.address, votesToRetract);

                const votesAmount = await governancePool.votesAmount(
                    investorA.address,
                    investmentPoolId
                );

                assert.equal(votesLeft.toString(), votesAmount.toString());
            });
            it("[GP][9.1.2] Should update total votes amount for investment pool", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const votesToRetract = ethers.utils.parseEther("0.1");
                const votesLeft = votesAgainst.sub(votesToRetract);

                const investmentPoolId = await governancePool.getInvestmentPoolId(
                    fakeInvestmentPool1.address
                );

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(fakeInvestmentPool1.address, votesAgainst);

                await governancePool
                    .connect(investorA)
                    .retractVotes(fakeInvestmentPool1.address, votesToRetract);

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
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(fakeInvestmentPool1.address, votesAgainst);

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(fakeInvestmentPool1.address, votesToRetract)
                )
                    .to.emit(governancePool, "RetractVotes")
                    .withArgs(fakeInvestmentPool1.address, investorA.address, votesToRetract);
            });

            it("[GP][9.2.2] Should not be able to retract votes from unavailable investment pool", async () => {
                const votesToRetract = ethers.utils.parseEther("1");

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(fakeInvestmentPool1.address, votesToRetract)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than active voting"
                );
            });

            it("[GP][9.2.3] Should not be able to retract votes from investment pool which reached votes treshold", async () => {
                const votesToRetract = ethers.utils.parseEther("1");

                // Simulate the state with mock function
                await governancePool.updateInvestmentPoolStatusToVotedAgainst(
                    fakeInvestmentPool1.address
                );

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(fakeInvestmentPool1.address, votesToRetract)
                ).to.be.revertedWith(
                    "[GP]: investment pool is assigned with another status than active voting"
                );
            });

            it("[GP][9.2.4] Retracting 0 amount of votes should revert", async () => {
                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await expect(
                    governancePool.connect(investorA).retractVotes(fakeInvestmentPool1.address, 0)
                ).to.be.revertedWith("[GP]: retract amount neeeds to be greater than 0");
            });

            it("[GP][9.2.5] Should revert if investor did not vote against the project", async () => {
                const votesToRetract = ethers.utils.parseEther("1");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(fakeInvestmentPool1.address, votesToRetract)
                ).to.be.revertedWith("[GP]: did't vote against the project");
            });

            it("[GP][9.2.6] Should not be able to retract more voting tokens than investor has delegated for voting", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const votesToRetract = ethers.utils.parseEther("0.5");

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(fakeInvestmentPool1.address, votesAgainst);

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(fakeInvestmentPool1.address, votesToRetract)
                ).to.be.revertedWith(
                    "[GP]: retract amount can't be greater than delegated for voting"
                );
            });

            it("[GP][9.2.7] Should transfer voting tokens from governance pool to investor", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const votesAgainst = ethers.utils.parseEther("0.4");
                const votesToRetract = ethers.utils.parseEther("0.1");
                const votesLeftInPool = votesAgainst.sub(votesToRetract);
                const votesLeftForInvestor = tokensToMint.sub(votesAgainst).add(votesToRetract);

                await governancePool
                    .connect(fakeInvestmentPoolFactory)
                    .activateInvestmentPool(fakeInvestmentPool1.address);

                await governancePool
                    .connect(fakeInvestmentPool1)
                    .mintVotingTokens(investorA.address, tokensToMint, 0);

                await governancePool
                    .connect(investorA)
                    .unlockVotingTokens(fakeInvestmentPool1.address);

                // Approve the governance pool contract to spend investor's tokens
                await votingToken
                    .connect(investorA)
                    .setApprovalForAll(governancePool.address, true);

                await governancePool
                    .connect(investorA)
                    .voteAgainst(fakeInvestmentPool1.address, votesAgainst);

                await expect(
                    governancePool
                        .connect(investorA)
                        .retractVotes(fakeInvestmentPool1.address, votesToRetract)
                ).to.emit(votingToken, "TransferSingle");

                const governancePoolBalance = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    governancePool.address
                );

                const investorBalance = await governancePool.getVotingTokenBalance(
                    fakeInvestmentPool1.address,
                    investorA.address
                );

                assert.equal(governancePoolBalance.toString(), votesLeftInPool.toString());
                assert.equal(investorBalance.toString(), votesLeftForInvestor.toString());
            });
        });
    });
});
