import {ethers} from "hardhat";
import {BigNumber} from "ethers";

async function main() {
    // Get the contract to deploy
    const [deployer, randomSigner] = await ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    // ERC1155 token for Governance Pool
    const votingTokensFactory = await ethers.getContractFactory(
        "VotingToken",
        deployer
    );
    const votingToken = await votingTokensFactory.deploy();
    await votingToken.deployed();

    console.log("ERC115 deployed to:", votingToken.address);

    // Investment Pool deployment
    const governancePoolFactory = await ethers.getContractFactory(
        "GovernacePool",
        deployer
    );
    const governancePool = await governancePoolFactory.deploy(
        votingToken.address
    );
    await governancePool.deployed();

    console.log("Investment pool deployed to:", governancePool.address);

    const investmentPoolAddress = randomSigner.address;
    await votingToken.transferOwnership(governancePool.address);
    await governancePool.mintVotingTokens(investmentPoolAddress, 100);

    await votingToken
        .connect(deployer)
        .setApprovalForAll(governancePool.address, true);

    const investmentPoolId = await governancePool.getInvestmentPoolId(
        investmentPoolAddress
    );

    await votingToken.safeTransferFrom(
        deployer.address,
        governancePool.address,
        investmentPoolId,
        80,
        "0x"
    );

    console.log(
        await governancePool.getVotingTokenBalance(
            investmentPoolAddress,
            governancePool.address
        )
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
