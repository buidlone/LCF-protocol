import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {assert, expect} from "chai";
import {VotingToken, GovernancePool} from "../typechain";

describe("Governance Pool", async () => {
    let accounts: SignerWithAddress[];
    let deployer: SignerWithAddress;
    let fakeInvestmentPool1: SignerWithAddress;
    let fakeInvestmentPool2: SignerWithAddress;
    let investorA: SignerWithAddress;
    let investorB: SignerWithAddress;
    let investorC: SignerWithAddress;

    let votingToken: VotingToken;
    let governancePool: GovernancePool;

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        fakeInvestmentPool1 = accounts[1];
        fakeInvestmentPool2 = accounts[2];
        investorA = accounts[3];
        investorB = accounts[4];
        investorC = accounts[5];
    });
    beforeEach(async () => {
        // ERC1155 voting token for Governance Pool deployment
        const votingTokensFactory = await ethers.getContractFactory("VotingToken", deployer);
        votingToken = await votingTokensFactory.deploy();
        await votingToken.deployed();

        // Governance Pool deployment
        const governancePoolFactory = await ethers.getContractFactory("GovernancePool", deployer);
        governancePool = await governancePoolFactory.deploy(votingToken.address);
        await governancePool.deployed();

        // Transfer ownership to governance pool
        await votingToken.transferOwnership(governancePool.address);
    });
    afterEach(async () => {});

    describe("1. Single functions", () => {
        describe("1.1. Interactions", () => {
            it("[GP][1.1.1] Should get the correct id from given address", async () => {
                const investmentPoolId = await governancePool
                    .connect(investorA)
                    .getInvestmentPoolId(fakeInvestmentPool1.address);

                const wrongInvestmentPoolId = await governancePool
                    .connect(investorA)
                    .getInvestmentPoolId(fakeInvestmentPool2.address);

                const expectedId = ethers.BigNumber.from(fakeInvestmentPool1.address);

                assert.notEqual(expectedId.toString(), wrongInvestmentPoolId.toString());
                assert.equal(expectedId.toString(), investmentPoolId.toString());
            });
            it("[GP][1.1.2] Should get correct tokens supply", async () => {
                let totalSupply = await governancePool
                    .connect(investorA)
                    .getVotingTokensSupply(fakeInvestmentPool1.address);

                assert.equal(totalSupply.toString(), "0");

                const tokensToMint = ethers.utils.parseEther("1");

                await expect(
                    governancePool
                        .connect(investorA)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorA.address,
                            tokensToMint
                        )
                ).to.not.be.reverted;

                await expect(
                    governancePool
                        .connect(investorB)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorB.address,
                            tokensToMint
                        )
                ).to.not.be.reverted;

                totalSupply = await governancePool
                    .connect(investorA)
                    .getVotingTokensSupply(fakeInvestmentPool1.address);

                const expectedTotalSupply = ethers.utils.parseEther("2");

                assert.equal(expectedTotalSupply.toString(), totalSupply.toString());
            });
            it("[GP][1.1.3] Should get correct balance after minting", async () => {
                let balanceOfinvestorA = await governancePool
                    .connect(investorA)
                    .getVotingTokenBalance(fakeInvestmentPool1.address, investorA.address);
                let balanceOfinvestorB = await governancePool
                    .connect(investorB)
                    .getVotingTokenBalance(fakeInvestmentPool1.address, investorB.address);

                assert.equal(balanceOfinvestorA.toString(), "0");
                assert.equal(balanceOfinvestorB.toString(), "0");

                const tokensToMintA = ethers.utils.parseEther("1");
                const tokensToMintB = ethers.utils.parseEther("2");

                await expect(
                    governancePool
                        .connect(investorA)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorA.address,
                            tokensToMintA
                        )
                ).to.not.be.reverted;

                await expect(
                    governancePool
                        .connect(investorB)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorB.address,
                            tokensToMintB
                        )
                ).to.not.be.reverted;

                balanceOfinvestorA = await governancePool
                    .connect(investorA)
                    .getVotingTokenBalance(fakeInvestmentPool1.address, investorA.address);
                balanceOfinvestorB = await governancePool
                    .connect(investorB)
                    .getVotingTokenBalance(fakeInvestmentPool1.address, investorB.address);

                assert.equal(balanceOfinvestorA.toString(), tokensToMintA.toString());
                assert.equal(balanceOfinvestorB.toString(), tokensToMintB.toString());
            });
            it("[GP][1.1.4] Should correctly calculate percentage of votes against the project", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const fakeVotesAgainst = ethers.utils.parseEther("2");
                const tokensToVoteWith = ethers.utils.parseEther("0.4");

                await expect(
                    governancePool
                        .connect(investorA)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorA.address,
                            tokensToMint
                        )
                ).to.not.be.reverted;

                await expect(
                    governancePool
                        .connect(investorA)
                        .votesAgainstPercentageCount(fakeInvestmentPool1.address, fakeVotesAgainst)
                ).to.be.revertedWith(
                    "[GP]: total supply of tokens needs to be higher than votes against"
                );

                const percentage = await governancePool
                    .connect(investorA)
                    .votesAgainstPercentageCount(fakeInvestmentPool1.address, tokensToVoteWith);

                const expectedPercentage = "40";

                assert.equal(percentage.toString(), expectedPercentage);
            });
            it("[GP][1.1.5] Should correctly calculate if investor balance will reach a treshold", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const tresholdAmount = ethers.utils.parseEther("2");

                await expect(
                    governancePool
                        .connect(investorA)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorA.address,
                            tokensToMint
                        )
                ).to.not.be.reverted;

                await expect(
                    governancePool
                        .connect(investorB)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorB.address,
                            tokensToMint
                        )
                ).to.not.be.reverted;

                await expect(
                    governancePool
                        .connect(investorC)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorC.address,
                            tokensToMint
                        )
                ).to.not.be.reverted;

                let tresholdReached = await governancePool
                    .connect(investorA)
                    .willInvestorReachTreshold(fakeInvestmentPool1.address, tokensToMint);

                assert.equal(tresholdReached, false);

                tresholdReached = await governancePool
                    .connect(investorA)
                    .willInvestorReachTreshold(fakeInvestmentPool1.address, tresholdAmount);

                assert.equal(tresholdReached, true);
            });
            it("[GP][1.1.6] Only the investment pool should be able to mint tokens", async () => {});
            it("[GP][1.1.7] Should mint tokens successfully", async () => {
                const tokensToMint = ethers.utils.parseEther("1");
                const tresholdAmount = ethers.utils.parseEther("2");

                await expect(
                    governancePool
                        .connect(investorA)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorA.address,
                            tokensToMint
                        )
                ).to.not.be.reverted;

                await expect(
                    governancePool
                        .connect(investorB)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorB.address,
                            tokensToMint
                        )
                ).to.not.be.reverted;

                await expect(
                    governancePool
                        .connect(investorC)
                        .mintVotingTokens(
                            fakeInvestmentPool1.address,
                            investorC.address,
                            tokensToMint
                        )
                ).to.not.be.reverted;

                let tresholdReached = await governancePool
                    .connect(investorA)
                    .willInvestorReachTreshold(fakeInvestmentPool1.address, tokensToMint);

                assert.equal(tresholdReached, false);

                tresholdReached = await governancePool
                    .connect(investorA)
                    .willInvestorReachTreshold(fakeInvestmentPool1.address, tresholdAmount);

                assert.equal(tresholdReached, true);
            });
        });
        describe("1.2 Public state", () => {
            it("[GP][1.2.] Should have assigned the correct voting token contract", async () => {
                const getAssignedVotingToken = await governancePool.votingToken();

                assert.equal(getAssignedVotingToken, votingToken.address);
            });
        });
    });
});
