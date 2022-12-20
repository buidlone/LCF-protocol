import {ethers, network} from "hardhat";
import {BigNumber} from "ethers";
import {formatPercentage} from "../../format-percentage";

const getTimestamp = (time: string): number => {
    return new Date(time).getTime() / 1000;
};

export const buidl1Details = async (): Promise<
    [BigNumber, BigNumber, BigNumber, BigNumber, number, number, any, string]
> => {
    if (network.name != "goerli") {
        throw "Network is not goerli!";
    } else {
        const acceptedSuperToken = "0x5943F705aBb6834Cad767e6E4bB258Bc48D9C947"; // ETHx
        const softCap: BigNumber = ethers.utils.parseEther("25");
        const hardCap: BigNumber = ethers.utils.parseEther("65");
        const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
        const tokenRewards: BigNumber = ethers.utils.parseEther("15000000");
        const fundraiserStartDate: number = getTimestamp("2022-12-21T14:00:00");
        const fundraiserEndDate: number = getTimestamp("2023-02-28T12:00:00");

        const milestones = [
            {
                startDate: getTimestamp("2023-03-01T12:00:00"),
                endDate: getTimestamp("2023-05-01T12:00:00"),
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(6.5),
            },
            {
                startDate: getTimestamp("2023-05-01T12:00:00"),
                endDate: getTimestamp("2023-07-01T12:00:00"),
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(7),
            },
            {
                startDate: getTimestamp("2023-07-01T12:00:00"),
                endDate: getTimestamp("2023-09-01T12:00:00"),
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(7),
            },
            {
                startDate: getTimestamp("2023-09-01T12:00:00"),
                endDate: getTimestamp("2023-11-01T12:00:00"),
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(8),
            },
            {
                startDate: getTimestamp("2023-11-01T12:00:00"),
                endDate: getTimestamp("2024-01-01T12:00:00"),
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(8.5),
            },
            {
                startDate: getTimestamp("2024-01-01T12:00:00"),
                endDate: getTimestamp("2024-03-01T12:00:00"),
                intervalSeedPortion: formatPercentage(1),
                intervalStreamingPortion: formatPercentage(9),
            },
            {
                startDate: getTimestamp("2024-03-01T12:00:00"),
                endDate: getTimestamp("2024-05-01T12:00:00"),
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(9.5),
            },
            {
                startDate: getTimestamp("2024-05-01T12:00:00"),
                endDate: getTimestamp("2024-07-01T12:00:00"),
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(10),
            },
            {
                startDate: getTimestamp("2024-07-01T12:00:00"),
                endDate: getTimestamp("2024-09-01T12:00:00"),
                intervalSeedPortion: formatPercentage(1),
                intervalStreamingPortion: formatPercentage(13),
            },
            {
                startDate: getTimestamp("2024-09-01T12:00:00"),
                endDate: getTimestamp("2024-11-01T12:00:00"),
                intervalSeedPortion: formatPercentage(0),
                intervalStreamingPortion: formatPercentage(16),
            },
        ];

        return [
            softCap,
            hardCap,
            gelatoFeeAllocation,
            tokenRewards,
            fundraiserStartDate,
            fundraiserEndDate,
            milestones,
            acceptedSuperToken,
        ];
    }
};
