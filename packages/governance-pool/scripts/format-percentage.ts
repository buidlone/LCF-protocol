const percentageDivider: number = 10 ** 6;

export const formatPercentage = (percent: number): number => {
    return (percentageDivider * percent) / 100;
};
