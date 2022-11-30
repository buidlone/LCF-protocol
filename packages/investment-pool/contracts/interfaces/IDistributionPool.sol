// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

interface IDistributionPool {
    // Functions only for creator
    function lockProjectTokens(address _token, uint256 _amount) external;

    function withdrawAllTokens() external;

    // Functions only for investors
    function allocateTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _investmentWeight
    ) external;

    function removeTokensAllocation(uint256 _milestoneId, address _investor) external;

    function openTokensStream(uint256 _milestoneId, address _investor) external;

    function terminateTokensStream(uint256 _milestoneId, address _investor) external;

    function openNextMilestoneTokensStreamOrEndProject(
        uint256 _milestoneId,
        address _investor
    ) external;

    function getProjectTokensSupplyCap() external view returns (uint256);

    function getExpectedProjectTokensAllocation(
        uint256 _investedAmount
    ) external view returns (uint256);

    function getInvestmentWeightMaximum() external view returns (uint256);

    function getInvestmentWeight(
        uint256 _milestoneId,
        address _investor
    ) external view returns (uint256);

    function getTotalInvestmentWeight(uint256 _milestoneId) external view returns (uint256);

    function getAllocatedProjectTokensAmount(
        uint256 _milestoneId,
        address _investor
    ) external view returns (uint256);

    function getTotalAllocatedProjectTokensAmount(
        address _investor
    ) external view returns (uint256);

    function getProjectToken() external pure returns (address);

    function getProjectTokensBalance() external view returns (uint256);
}
