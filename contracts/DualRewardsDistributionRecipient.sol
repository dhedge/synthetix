pragma solidity ^0.5.16;

// Inheritance
import "./Owned.sol";


contract DualRewardsDistributionRecipient is Owned {
    address public dualRewardsDistribution;

    function notifyRewardAmount(uint256 rewardA, uint256 rewardB) external;

    modifier onlyDualRewardsDistribution() {
        require(msg.sender == dualRewardsDistribution, "Caller is not DualRewardsDistribution contract");
        _;
    }

    function setDualRewardsDistribution(address _dualRewardsDistribution) external onlyOwner {
        dualRewardsDistribution = _dualRewardsDistribution;
    }
}
