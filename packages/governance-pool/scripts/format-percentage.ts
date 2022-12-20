import {run, network} from "hardhat";
import {availableTestnetChains} from "../hardhat-helper-config";

const percentageDivider: number = 10 ** 6;

export const formatPercentage = (percent: number): number => {
    return (percentageDivider * percent) / 100;
};
