import {HardhatUserConfig, task} from "hardhat/config";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-web3";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-deploy";
import "hardhat-docgen";
import "./tasks/create-ip-testing";
import "./tasks/create-ip";
// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.14",
        settings: {
            optimizer: {
                enabled: true,
            },
        },
    },
    defaultNetwork: "hardhat",
    networks: {
        hardhat: {},
        goerli: {
            url: process.env.GOERLI_URL || "",
            accounts:
                process.env.PRIVATE_KEY !== undefined && process.env.PRIVATE_KEY_2 !== undefined
                    ? [process.env.PRIVATE_KEY, process.env.PRIVATE_KEY_2]
                    : process.env.PRIVATE_KEY !== undefined
                    ? [process.env.PRIVATE_KEY]
                    : [],
            chainId: 5,
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS !== undefined,
        currency: "EUR",
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    docgen: {
        path: "./docs",
        clear: true,
        runOnCompile: false,
        only: ["contracts/GovernancePool.sol", "contracts/VotingToken.sol"],
    },
    mocha: {
        timeout: 200000,
    },
};

export default config;
