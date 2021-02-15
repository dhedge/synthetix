const { contract } = require('hardhat');
const { toBN } = require('web3-utils');

const { toBytes32 } = require('../..');
const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');
const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');
const { mockToken, setupAllContracts, setupContract } = require('./setup');
const { currentTime, toUnit, fastForward } = require('../utils')();

contract('StakingDualRewards', accounts => {
	const [
		,
		owner,
		oracle,
		authority,
		rewardEscrowAddress,
		stakingAccount1,
		mockDualRewardsDistributionAddress,
	] = accounts;

	// Synthetix is the rewardsTokenA
	let rewardsTokenA,
		rewardsTokenB,
		stakingToken,
		externalRewardsToken,
		exchangeRates,
		stakingDualRewards,
		dualRewardsDistribution,
		systemSettings,
		feePool;

	const DAY = 86400;
	const ZERO_BN = toBN(0);

	const setRewardsTokenExchangeRate = async ({ rateStaleDays } = { rateStaleDays: 7 }) => {
		const rewardsTokenAIdentifier = await rewardsTokenA.symbol();

		await systemSettings.setRateStalePeriod(DAY * rateStaleDays, { from: owner });
		const updatedTime = await currentTime();
		await exchangeRates.updateRates(
			[toBytes32(rewardsTokenAIdentifier)],
			[toUnit('2')],
			updatedTime,
			{
				from: oracle,
			}
		);
		assert.equal(await exchangeRates.rateIsStale(toBytes32(rewardsTokenAIdentifier)), false);
	};

	addSnapshotBeforeRestoreAfterEach();

	before(async () => {
		({ token: stakingToken } = await mockToken({
			accounts,
			name: 'Staking Token',
			symbol: 'STKN',
		}));

		({ token: rewardsTokenB } = await mockToken({
			accounts,
			name: 'dHEDGE DAO',
			symbol: 'DHT',
		}));

		({ token: externalRewardsToken } = await mockToken({
			accounts,
			name: 'External Rewards Token',
			symbol: 'MOAR',
		}));

		({
			DualRewardsDistribution: dualRewardsDistribution,
			FeePool: feePool,
			Synthetix: rewardsTokenA,
			ExchangeRates: exchangeRates,
			SystemSettings: systemSettings,
		} = await setupAllContracts({
			accounts,
			contracts: ['DualRewardsDistribution', 'Synthetix', 'FeePool', 'SystemSettings'],
		}));

		console.log(`stakingAccount1 is: ${stakingAccount1}`);
		console.log('stakingToken address: ', stakingToken.address);
		console.log(`rewardsTokenA is: SNX with address: ${rewardsTokenA.address} `);
		console.log(`rewardsTokenB is: DHT with address: ${rewardsTokenB.address} `);
		console.log(`externalRewardsToken is: MOAR with address: ${externalRewardsToken.address} `);
		console.log('dualRewardsDistribution contract Address is: ', dualRewardsDistribution.address);

		stakingDualRewards = await setupContract({
			accounts,
			contract: 'StakingDualRewards',
			args: [
				owner,
				dualRewardsDistribution.address,
				rewardsTokenA.address,
				rewardsTokenB.address,
				stakingToken.address,
			],
		});

		await Promise.all([
			dualRewardsDistribution.setAuthority(authority, { from: owner }),
			dualRewardsDistribution.setRewardEscrow(rewardEscrowAddress, { from: owner }),
			dualRewardsDistribution.setSynthetixProxy(rewardsTokenA.address, { from: owner }),
			dualRewardsDistribution.setRewardTokenProxy(rewardsTokenB.address, { from: owner }),
			dualRewardsDistribution.setFeePoolProxy(feePool.address, { from: owner }),
		]);

		await stakingDualRewards.setDualRewardsDistribution(mockDualRewardsDistributionAddress, {
			from: owner,
		});
		await setRewardsTokenExchangeRate();
	});

	it('ensure only known functions are mutative', (done) => {
		ensureOnlyExpectedMutativeFunctions({
			abi: stakingDualRewards.abi,
			ignoreParents: ['ReentrancyGuard', 'Owned'],
			expected: [
				'stake',
				'withdraw',
				'exit',
				'getReward',
				'notifyRewardAmount',
				'setPaused',
				'setDualRewardsDistribution',
				'setRewardsDuration',
				'recoverERC20',
				'updatePeriodFinish',
			],
		});
		done();
	});

	describe('Integration Tests', () => {
		before(async () => {
			// Set rewardDistribution address
			await stakingDualRewards.setDualRewardsDistribution(dualRewardsDistribution.address, {
				from: owner,
			});
			assert.equal(await stakingDualRewards.dualRewardsDistribution(), dualRewardsDistribution.address);

			await setRewardsTokenExchangeRate();
		});

		it('stake and claim with identical dual-reward amounts', async () => {

			//staking-Token balance of investor before getting funded with Staking-Token 
			const stakingBalanceOfInvestorBefFunding = await stakingToken.balanceOf(stakingAccount1);
			assert.bnEqual(stakingBalanceOfInvestorBefFunding, 0);

			// Transfer some LP Tokens to user
			const totalToStake = toUnit('500');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });

			//staking-Token balance of investor before Staking
			const stakingBalanceOfInvestorBefStake = await stakingToken.balanceOf(stakingAccount1);
			assert.bnEqual(stakingBalanceOfInvestorBefStake, totalToStake);

			// Stake LP Tokens
			await stakingToken.approve(stakingDualRewards.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewards.stake(totalToStake, { from: stakingAccount1 });

			//staking-Token balance of investor After Staking
			const stakingBalanceOfInvestorAftStake = await stakingToken.balanceOf(stakingAccount1);
			assert.bnEqual(stakingBalanceOfInvestorAftStake, 0);

			// Distribute some rewards
			const totalToDistribute_rewardTokenA = toUnit('35000');
			const totalToDistribute_rewardTokenB = toUnit('35000');

			assert.equal(await dualRewardsDistribution.distributionsLength(), 0);
			await dualRewardsDistribution.addDualRewardsDistribution(
				totalToDistribute_rewardTokenA,
				totalToDistribute_rewardTokenB,
				stakingDualRewards.address,
				{
					from: owner,
				}
			);
			assert.equal(await dualRewardsDistribution.distributionsLength(), 1);

			// Transfer Reward-TokenA to the RewardsDistribution contract address
			await rewardsTokenA.transfer(dualRewardsDistribution.address, totalToDistribute_rewardTokenA, { from: owner });

			// Transfer Reward-TokenB to the RewardsDistribution contract address
			await rewardsTokenB.transfer(dualRewardsDistribution.address, totalToDistribute_rewardTokenB, { from: owner });

			const rewardTokenA_Balance_Of_DualRewardsDistributionAddress_Bef_Dist = 
			 await rewardsTokenA.balanceOf(dualRewardsDistribution.address);
			 assert.bnEqual(rewardTokenA_Balance_Of_DualRewardsDistributionAddress_Bef_Dist, toUnit(35000));

			 const rewardTokenB_Balance_Of_DualRewardsDistributionAddress_Bef_Dist = 
			 await rewardsTokenB.balanceOf(dualRewardsDistribution.address);
			 assert.bnEqual(rewardTokenB_Balance_Of_DualRewardsDistributionAddress_Bef_Dist, toUnit(35000));

			// Distribute Rewards called from Synthetix contract as the authority to distribute
			await dualRewardsDistribution.distributeRewards(totalToDistribute_rewardTokenA,
				 totalToDistribute_rewardTokenB, {
				from: authority,
			});

			const rewardTokenA_Balance_Of_DualRewardsDistributionAddress_After_Dist = 
			 await rewardsTokenA.balanceOf(dualRewardsDistribution.address);
			 assert.bnEqual(rewardTokenA_Balance_Of_DualRewardsDistributionAddress_After_Dist, 0);

			 const rewardTokenB_Balance_Of_DualRewardsDistributionAddress_After_Dist = 
			 await rewardsTokenB.balanceOf(dualRewardsDistribution.address);
			 assert.bnEqual(rewardTokenB_Balance_Of_DualRewardsDistributionAddress_After_Dist, 0);

			// Period finish should be ~7 days from now
			const periodFinish = await stakingDualRewards.periodFinish();
			const curTimestamp = await currentTime();

			assert.equal(parseInt(periodFinish.toString(), 10), curTimestamp + DAY * 7);

			// Reward duration is 7 days, so we'll
			// Fastforward time by 6 days to prevent expiration
			await fastForward(DAY * 6);

			// Make sure we earned RewardToken-A in proportion to reward per token

			// RewardRateA and reward per token
			const rewardRateA = await stakingDualRewards.rewardRateA();
			assert.bnGt(rewardRateA, ZERO_BN);
			
			const rewardPerTokenA = await stakingDualRewards.rewardPerTokenA();
			assert.bnGt(rewardPerTokenA, ZERO_BN);

			const rewardTokenAEarned = await stakingDualRewards.earnedA(stakingAccount1);
			assert.bnEqual(rewardTokenAEarned, rewardPerTokenA.mul(totalToStake).div(toUnit(1)));


			// Make sure we earned RewardToken-B in proportion to reward per token

			// RewardRateB and reward per token
			const rewardRateB = await stakingDualRewards.rewardRateB();
			assert.bnGt(rewardRateB, ZERO_BN);


			const rewardPerTokenB = await stakingDualRewards.rewardPerTokenB();
			assert.bnGt(rewardPerTokenB, ZERO_BN);

			const rewardTokenBEarned = await stakingDualRewards.earnedB(stakingAccount1);
			assert.bnEqual(rewardTokenBEarned, rewardPerTokenB.mul(totalToStake).div(toUnit(1)));

			// Make sure after withdrawing, we still have the ~amount of rewardRewards
			// The two values will be a bit different as time has "passed"

			//staked LP-Tokens of investor before withdrawal
			const stakedLPTokensOfInvestorBefWdrl = await stakingDualRewards.balanceOf(stakingAccount1);
			assert.bnEqual(stakedLPTokensOfInvestorBefWdrl, toUnit(500));

			//staking-Token balance of investor of  before withdrawal
			const stakingTokenBalanceOfInvestorBefWdrl = await stakingToken.balanceOf(stakingAccount1);
			assert.bnEqual(stakingTokenBalanceOfInvestorBefWdrl, 0);

			//investor to withdraw staked LP Tokens 
			const initialWithdraw = toUnit('100');
			await stakingDualRewards.withdraw(initialWithdraw, { from: stakingAccount1 });

			//staked balance of investor of  after withdrawal
			const stakingTokenBalanceOfInvestorAftWdrl = await stakingToken.balanceOf(stakingAccount1);
			assert.bnEqual(stakingTokenBalanceOfInvestorAftWdrl, toUnit(100));

			assert.bnEqual(initialWithdraw, await stakingToken.balanceOf(stakingAccount1));

			//staked balance of investor before withdrawal
			const stakedLPTokensOfInvestorAfterWdrl = await stakingDualRewards.balanceOf(stakingAccount1);
			assert.bnEqual(stakedLPTokensOfInvestorAfterWdrl, toUnit(400));

			const rewardTokenAEarnedPostWithdraw = await stakingDualRewards.earnedA(stakingAccount1);
			assert.bnClose(rewardTokenAEarned, rewardTokenAEarnedPostWithdraw, toUnit('0.1'));

			const rewardTokenBEarnedPostWithdraw = await stakingDualRewards.earnedA(stakingAccount1);
			assert.bnClose(rewardTokenBEarned, rewardTokenBEarnedPostWithdraw, toUnit('0.1'));

			// Get rewards
			const initialRewardBal = await rewardsTokenA.balanceOf(stakingAccount1);
			await stakingDualRewards.getReward({ from: stakingAccount1 });
			const postRewardRewardBal = await rewardsTokenA.balanceOf(stakingAccount1);
			assert.bnGt(postRewardRewardBal, initialRewardBal);

			// Exit
			const preExitLPBal = await stakingToken.balanceOf(stakingAccount1);
			await stakingDualRewards.exit({ from: stakingAccount1 });
			const postExitLPBal = await stakingToken.balanceOf(stakingAccount1);
			assert.bnGt(postExitLPBal, preExitLPBal);
		});
	});
});
