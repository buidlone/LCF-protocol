// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

contract FakeInvestmentPoolMock {
    function invest(uint256 _amount, bool _strict) external {}

    function unpledge(uint256 _amount) external {}

    function refund() external {}

    function claim(uint256 _milestoneId) external {}

    function cancelBeforeFundraiserStart() external {}

    function cancelDuringMilestones() external {}

    function milestoneJumpOrFinalProjectTermination() external {}

    function isFundraiserOngoingNow() external view returns (bool) {}

    function isMilestoneOngoingNow(uint _id) external view returns (bool) {}

    function isSoftCapReached() external view returns (bool) {}

    function didFundraiserPeriodEnd() external view returns (bool) {}

    function isFailedFundraiser() external view returns (bool) {}

    function canTerminateMilestoneStreamFinal(uint256 _milestoneId) external view returns (bool) {}

    function canGelatoTerminateMilestoneStreamFinal(uint256 _milestoneId)
        external
        view
        returns (bool)
    {}

    function gelatoChecker() external view returns (bool canExec, bytes memory execPayload) {}

    function startGelatoTask() external {}

    function gelatoTerminateMilestoneStreamFinal(uint256 _milestoneId) external {}
}
