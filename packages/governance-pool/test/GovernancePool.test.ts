import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";

describe("Governance Pool", async () => {
    let accounts: SignerWithAddress[];
    let deployer: SignerWithAddress;
    let fakeInvestmentPool: SignerWithAddress;

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        fakeInvestmentPool = accounts[1];
    });
    beforeEach(async () => {});
    afterEach(async () => {});

    describe("1. Tokens Minting Process", () => {
        describe("1.1. Interactions", () => {
            it("[GP][1.1.1] Should update balance of sender", async () => {});
        });
    });
});
