import {ethers, network} from "hardhat";
import {BigNumber} from "ethers";
import {formatPercentage} from "../../format-percentage";

export const buidl1Details = async (): Promise<
    [BigNumber, BigNumber, BigNumber, BigNumber, number, number, any, string]
> => {
    if (network.name != "goerli") {
        throw "Network is not goerli!";
    } else {
        const acceptedSuperToken = "0x8aE68021f6170E5a766bE613cEA0d75236ECCa9a"; // fUSDCx
        const softCap: BigNumber = ethers.utils.parseEther("135000");
        const hardCap: BigNumber = ethers.utils.parseEther("565000");
        const gelatoFeeAllocation: BigNumber = ethers.utils.parseEther("0.1");
        const tokenRewards: BigNumber = ethers.utils.parseEther("15000000");
        const fundraiserStartDate: number = 1671616800; // Dec 21, 2022 12:00
        const fundraiserEndDate: number = 1677578400; // Feb 28, 2023 12:00

        const milestones = [
            {
                startDate: 1677664800, //  March 1, 2023 12:00:00 PM GMT+02:00
                endDate: 1682931600, // May 1, 2023 12:00:00 PM GMT+03:00
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(6.5),
            },
            {
                startDate: 1682931600, // May 1, 2023 12:00:00 PM GMT+03:00
                endDate: 1688202000, // July 1, 2023 12:00:00 PM GMT+03:00
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(7),
            },
            {
                startDate: 1688202000, // July 1, 2023 12:00:00 PM GMT+03:00
                endDate: 1693558800, // September 1, 2023 12:00:00 PM GMT+03:00
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(7),
            },
            {
                startDate: 1693558800, // September 1, 2023 12:00:00 PM GMT+03:00
                endDate: 1698832800, // November 1, 2023 12:00:00 PM GMT+02:00
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(8),
            },
            {
                startDate: 1698832800, // November 1, 2023 12:00:00 PM GMT+02:00
                endDate: 1704103200, // January 1, 2024 12:00:00 PM GMT+02:00
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(8.5),
            },
            {
                startDate: 1704103200, // January 1, 2024 12:00:00 PM GMT+02:00
                endDate: 1709287200, // March 1, 2024 12:00:00 PM GMT+02:00
                intervalSeedPortion: formatPercentage(1),
                intervalStreamingPortion: formatPercentage(9),
            },
            {
                startDate: 1709287200, // March 1, 2024 12:00:00 PM GMT+02:00
                endDate: 1714554000, // May 1, 2024 12:00:00 PM GMT+03:00
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(9.5),
            },
            {
                startDate: 1714554000, // May 1, 2024 12:00:00 PM GMT+03:00
                endDate: 1719824400, // July 1, 2024 12:00:00 PM GMT+03:00
                intervalSeedPortion: formatPercentage(0.5),
                intervalStreamingPortion: formatPercentage(10),
            },
            {
                startDate: 1719824400, // July 1, 2024 12:00:00 PM GMT+03:00
                endDate: 1725181200, // September 1, 2024 12:00:00 PM GMT+03:00
                intervalSeedPortion: formatPercentage(1),
                intervalStreamingPortion: formatPercentage(13),
            },
            {
                startDate: 1725181200, // September 1, 2024 12:00:00 PM GMT+03:00
                endDate: 1730455200, // November 1, 2024 12:00:00 PM GMT+02:00
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
