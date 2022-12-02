// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

interface IDistributionPool {
    // Functions only for creator
    function lockTokens(address _token, uint256 _amount) external;

    function withdrawTokens() external;

    // Functions only for investors
    function allocateTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _investmentWeight
    ) external;

    function removeTokensAllocation(uint256 _milestoneId, address _investor) external;

    function openTokensStream(uint256 _milestoneId, address _investor) external;

    function terminateTokensStream(uint256 _milestoneId, address _investor) external;

    function milestoneJump(uint256 _milestoneId, address _investor) external;

    function getTokenProjectAllocation() external view returns (uint256);

    function getExpectedTokensAllocation(uint256 _investedAmount) external view returns (uint256);

    function getInvestmentWeightMaximum() external view returns (uint256);

    function getInvestmentWeight(
        uint256 _milestoneId,
        address _investor
    ) external view returns (uint256);

    function getTotalInvestmentWeight(uint256 _milestoneId) external view returns (uint256);

    function getAllocatedTokens(
        uint256 _milestoneId,
        address _investor
    ) external view returns (uint256);

    function getTotalAllocatedTokens(address _investor) external view returns (uint256);

    function getToken() external pure returns (address);

    function getTokensBalance() external view returns (uint256);
}
