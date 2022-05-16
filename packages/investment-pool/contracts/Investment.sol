// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";

interface IERC20 {
    function transfer(address, uint256) external returns (bool);

    function transferFrom(
        address,
        address,
        uint256
    ) external returns (bool);
}

contract Investment {
    
    using CFAv1Library for CFAv1Library.InitData;
    CFAv1Library.InitData public cfaV1;

    // Events
    event Launch(
        uint256 id,
        address indexed creator,
        uint256 softCap,
        uint32 startAt,
        uint32 endAt
    );
    event Cancel(uint256 id);
    event Invest(uint256 indexed id, address indexed caller, uint256 amount);
    event Unpledge(uint256 indexed id, address indexed caller, uint256 amount);
    event Claim(uint256 id);
    event Refund(uint256 id, address indexed caller, uint256 amount);

    struct Campaign {
        // Creator of campaign
        address creator;
        // Amount of tokens to raise (wei)
        uint96 softCap;
        // Total amount invested
        uint256 invested;
        // Milestone start date
        uint96 milestoneStartDate;
        // Milestone end date
        uint96 milestoneEndDate;
        // Timestamp of start of campaign
        uint32 startAt;
        // Timestamp of end of campaign
        uint32 endAt;
        // True if softCap was reached and creator has claimed the tokens.
        bool claimed;
    }

    ISuperfluid private host;
    IConstantFlowAgreementV1 private cfa;
    ISuperToken private acceptedToken;

    // Total count of campaigns created.
    // It is also used to generate id for new campaigns.
    uint256 public count;
    // Mapping from id to Campaign
    mapping(uint256 => Campaign) public campaigns;
    // Mapping from campaign id => pledger => amount invested
    mapping(uint256 => mapping(address => uint256)) public investedAmount;

    constructor(
        ISuperfluid _host,
        IConstantFlowAgreementV1 _cfa,
        ISuperToken _acceptedToken
    ) {
        assert(address(_host) != address(0));
        assert(address(_cfa) != address(0));
        assert(address(_acceptedToken) != address(0));

        host = _host;
        cfa = _cfa;
        acceptedToken = _acceptedToken;

        //initialize InitData struct, and set equal to cfaV1
        cfa = IConstantFlowAgreementV1(
            address(
                host.getAgreementClass(
                    keccak256(
                        "org.superfluid-finance.agreements.ConstantFlowAgreement.v1"
                    )
                )
            )
        );

        cfaV1 = CFAv1Library.InitData(host, cfa);
    }

    function launch(
        uint96 _softCap,
        uint96 _milestoneStartDate,
        uint96 _milestoneEndDate,
        uint32 _startAt,
        uint32 _endAt
    ) external {
        require(_startAt >= block.timestamp, "start at < now");
        require(_endAt >= _startAt, "end at < start at");
        require(_endAt <= block.timestamp + 90 days, "end at > max duration");
        require(
            _endAt <= _milestoneStartDate,
            "milestone start date cannot start before campain ends"
        );
        require(
            _milestoneStartDate < _milestoneEndDate,
            "milestone start date > milestone end date "
        );
        require(
            _milestoneEndDate - _milestoneStartDate >= 30 days,
            "milestone lenght must be at least 1 month "
        );

        count += 1;
        campaigns[count] = Campaign({
            creator: msg.sender,
            softCap: _softCap,
            milestoneStartDate: _milestoneStartDate,
            milestoneEndDate: _milestoneEndDate,
            invested: 0,
            startAt: _startAt,
            endAt: _endAt,
            claimed: false
        });

        emit Launch(count, msg.sender, _softCap, _startAt, _endAt);
    }

    function cancel(uint256 _id) external {
        Campaign memory campaign = campaigns[_id];
        require(campaign.creator == msg.sender, "not creator");
        require(block.timestamp < campaign.startAt, "started");

        delete campaigns[_id];
        emit Cancel(_id);
    }

    function invest(uint256 _id, uint256 _amount) external {
        Campaign storage campaign = campaigns[_id];
        require(block.timestamp >= campaign.startAt, "not started");
        require(block.timestamp <= campaign.endAt, "ended");

        campaign.invested += _amount;
        investedAmount[_id][msg.sender] += _amount;
        acceptedToken.transferFrom(msg.sender, address(this), _amount);

        emit Invest(_id, msg.sender, _amount);
    }

    function unpledge(uint256 _id, uint256 _amount) external {
        Campaign storage campaign = campaigns[_id];
        require(block.timestamp <= campaign.endAt, "ended");

        campaign.invested -= _amount;
        investedAmount[_id][msg.sender] -= _amount;
        acceptedToken.transfer(msg.sender, _amount);

        emit Unpledge(_id, msg.sender, _amount);
    }

    function claim(uint256 _id) external {
        Campaign storage campaign = campaigns[_id];
        require(campaign.creator == msg.sender, "not creator");
        require(
            block.timestamp >= campaign.milestoneStartDate,
            "milestone starting date not started"
        );
        require(campaign.invested >= campaign.softCap, "invested < softCap");
        require(!campaign.claimed, "claimed");

        campaign.claimed = true;

        uint96 milestonePeriod = campaign.milestoneEndDate -
            campaign.milestoneStartDate;

        // Creates flowRate with 7 days delay
        int96 flowRate = int96(campaign.softCap) /
            int96(milestonePeriod + 7 days);

        (, int96 currentFlowRate, , ) = cfa.getFlow(
            acceptedToken,
            address(this),
            campaign.creator
        );

        // Create Linear Cash Flow to project account
        cfaV1.createFlow(
            campaign.creator,
            acceptedToken,
            currentFlowRate + flowRate
        );

        emit Claim(_id);
    }

    function refund(uint256 _id) external {
        Campaign memory campaign = campaigns[_id];
        require(block.timestamp > campaign.endAt, "not ended");
        require(campaign.invested < campaign.softCap, "invested >= softCap");

        uint256 bal = investedAmount[_id][msg.sender];
        investedAmount[_id][msg.sender] = 0;
        acceptedToken.transfer(msg.sender, bal);

        emit Refund(_id, msg.sender, bal);
    }
}
