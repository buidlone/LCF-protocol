import {BigNumber} from "ethers";

export interface networkConfigItem {
    name: string;
    blockConfirmations: number;
    gelatoOps: string;
    superfluidHost: string;
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
    },
    31337: {
        name: "hardhat",
        blockConfirmations: 1,
        gelatoOps: "0xc1C6805B857Bef1f412519C4A842522431aFed39", // goerli
        superfluidHost: "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9", // goerli
    },
};

export const developmentChains = ["hardhat", "localhost"];
export const availableTestnetChains = ["goerli"];
