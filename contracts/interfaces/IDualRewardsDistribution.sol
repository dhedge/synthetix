pragma solidity >=0.4.24;


// https://docs.synthetix.io/contracts/source/interfaces/irewardsdistribution
interface IDualRewardsDistribution {
    // Structs
    struct DualRewardsDistributionData {
        address destination;
        uint amount;
    }

    // Views
    function authority() external view returns (address);

    function distributions(uint index) external view returns (address destination, uint amount); // DistributionData

    function distributionsLength() external view returns (uint);

    // Mutative Functions
    function distributeRewards(uint amount) external returns (bool);
}
