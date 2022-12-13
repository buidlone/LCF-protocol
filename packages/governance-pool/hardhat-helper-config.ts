import {BigNumber} from "ethers";

export interface networkConfigItem {
    name: string;
    blockConfirmations: number;
    gelatoOps: string;
    superfluidHost: string;
    nativeSuperToken: string;
    nativeProjectToken: string;
}
export interface networkConfigInfo {
    [key: number]: networkConfigItem;
}

export const networkConfig: networkConfigInfo = {
    5: {
        name: "goerli",
        blockConfirmations: 6,
        gelatoOps: "0xc1C6805B857Bef1f412519C4A842522431aFed39",
        superfluidHost: "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9",
        nativeSuperToken: "0x5943F705aBb6834Cad767e6E4bB258Bc48D9C947",
        nativeProjectToken: "0x88271d333C72e51516B67f5567c728E702b3eeE8",
    },
    80001: {
        name: "mumbai",
        blockConfirmations: 6,
        gelatoOps: "0xB3f5503f93d5Ef84b06993a1975B9D21B962892F",
        superfluidHost: "0xEB796bdb90fFA0f28255275e16936D25d3418603",
        nativeSuperToken: "0x96B82B65ACF7072eFEb00502F45757F254c2a0D4",
        nativeProjectToken: "0x15F0Ca26781C3852f8166eD2ebce5D18265cceb7",
    },
    31337: {
        name: "hardhat",
        blockConfirmations: 1,
        gelatoOps: "0xc1C6805B857Bef1f412519C4A842522431aFed39", // goerli
        superfluidHost: "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9", // goerli
        nativeSuperToken: "0x5943F705aBb6834Cad767e6E4bB258Bc48D9C947", // goerli
        nativeProjectToken: "0x88271d333C72e51516B67f5567c728E702b3eeE8", // goerli
    },
};

export const developmentChains = ["hardhat", "localhost"];
export const availableTestnetChains = ["goerli", "mumbai"];
