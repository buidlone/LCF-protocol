import {HardhatUserConfig, task} from "hardhat/config";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-web3";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-deploy";
import "hardhat-docgen";
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
        hardhat: {
            chainId: 31337,
        },
        goerli: {
            url: process.env.GOERLI_URL || "",
            accounts:
                process.env.DEPLOYER_PRIVATE_KEY !== undefined
                    ? [process.env.DEPLOYER_PRIVATE_KEY]
                    : [],
            chainId: 5,
        },
        mumbai: {
            url: process.env.MUMBAI_URL || "",
            accounts:
                process.env.DEPLOYER_PRIVATE_KEY !== undefined
                    ? [process.env.DEPLOYER_PRIVATE_KEY]
                    : [],
            chainId: 80001,
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS !== undefined,
        currency: "EUR",
    },
    etherscan: {
        apiKey: {
            goerli: process.env.ETHERSCAN_API_KEY || "",
            polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
        },
    },
    docgen: {
        path: "./docs",
        clear: true,
        runOnCompile: false,
    },
    mocha: {
        timeout: 200000,
    },
};

export default config;
