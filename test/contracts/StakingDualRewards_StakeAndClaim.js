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
			dualRewardsDistribution.setFeePoolProxy(feePool.address, { from: owner }),
		]);

		await stakingDualRewards.setDualRewardsDistribution(mockDualRewardsDistributionAddress, {
			from: owner,
		});
		await setRewardsTokenExchangeRate();
	});

	it('ensure only known functions are mutative', () => {
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
		//done();
	});

	describe('Constructor & Settings', () => {
		it('should set rewards token on constructor', async () => {
			console.log('running should set rewards token on constructor');
			assert.equal(await stakingDualRewards.rewardsTokenA(), rewardsTokenA.address);
		});

		it('should staking token on constructor', async () => {
			console.log('running should staking token on constructor');
			assert.equal(await stakingDualRewards.stakingToken(), stakingToken.address);
		});

		it('should set owner on constructor', async () => {
			console.log('running should set owner on constructor');
			const ownerAddress = await stakingDualRewards.owner();
			assert.equal(ownerAddress, owner);
		});
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

		it('stake and claim', async () => {

			//staking-Token balance of investor before getting funded with Staking-Token 
			const stakingBalanceOfInvestorBefFunding = await stakingToken.balanceOf(stakingAccount1);
			console.log(`staking-Token balance of investor before getting funded with Staking-Token: ${stakingBalanceOfInvestorBefFunding}`);

			// Transfer some LP Tokens to user
			const totalToStake = toUnit('500');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });

			//staking-Token balance of investor before Staking
			const stakingBalanceOfInvestorBefStake = await stakingToken.balanceOf(stakingAccount1);
			console.log(`stakingToken Balance Of Investor Before Staking: ${stakingBalanceOfInvestorBefStake}`);

			// Stake LP Tokens
			await stakingToken.approve(stakingDualRewards.address, totalToStake, { from: stakingAccount1 });
			await stakingDualRewards.stake(totalToStake, { from: stakingAccount1 });

			//staking-Token balance of investor After Staking
			const stakingBalanceOfInvestorAftStake = await stakingToken.balanceOf(stakingAccount1);
			console.log(`stakingToken Balance Of Investor After Staking: ${stakingBalanceOfInvestorAftStake}`);

			// Distribute some rewards
			const totalToDistribute = toUnit('35000');
			assert.equal(await dualRewardsDistribution.distributionsLength(), 0);
			await dualRewardsDistribution.addRewardDistribution(stakingDualRewards.address, totalToDistribute, {
				from: owner,
			});
			assert.equal(await dualRewardsDistribution.distributionsLength(), 1);

			console.log('rewardsTokenA Address is: ', rewardsTokenA.address);
			console.log('rewardsTokenB Address is: ', rewardsTokenB.address);
			console.log('dualRewardsDistribution.address is: ', dualRewardsDistribution.address);

			// Transfer Rewards to the RewardsDistribution contract address
			await rewardsTokenA.transfer(dualRewardsDistribution.address, totalToDistribute, { from: owner });

			const rewardTokenBalance_Of_DualRewardsDistributionAddress_Bef_Dist = 
			 await rewardsTokenA.balanceOf(dualRewardsDistribution.address);
			 console.log('rewardToken Balance of dualRewardsDistribution-Address before rewardDistribution is: ',
			 rewardTokenBalance_Of_DualRewardsDistributionAddress_Bef_Dist.toString());
 	
			// Distribute Rewards called from Synthetix contract as the authority to distribute
			await dualRewardsDistribution.distributeRewards(totalToDistribute, {
				from: authority,
			});

			const rewardTokenBalance_Of_DualRewardsDistributionAddress_After_Dist = 
			 await rewardsTokenA.balanceOf(dualRewardsDistribution.address);
			 console.log('rewardToken Balance of dualRewardsDistribution-Address after rewardDistribution is: ',
			 rewardTokenBalance_Of_DualRewardsDistributionAddress_After_Dist.toString());

			// Period finish should be ~7 days from now
			const periodFinish = await stakingDualRewards.periodFinish();
			const curTimestamp = await currentTime();

			console.log('periodFinish: ', periodFinish.toString());
			console.log('periodFinish-parsed: ', parseInt(periodFinish.toString(), 10));
			console.log('curTimestamp: ', curTimestamp.toString());
			console.log('curTimestamp-advanced-by-7-days: ', curTimestamp + DAY * 7);

			assert.equal(parseInt(periodFinish.toString(), 10), curTimestamp + DAY * 7);

			// Reward duration is 7 days, so we'll
			// Fastforward time by 6 days to prevent expiration
			await fastForward(DAY * 6);

			// Reward rate and reward per token
			const rewardRateA = await stakingDualRewards.rewardRateA();
			console.log('rewardRateA is: ',rewardRateA.toString());
			assert.bnGt(rewardRateA, ZERO_BN);

			const rewardPerToken = await stakingDualRewards.rewardPerTokenA();
			console.log('rewardPerToken is: ',rewardPerToken.toString());
			assert.bnGt(rewardPerToken, ZERO_BN);

			// Make sure we earned in proportion to reward per token
			const rewardRewardsEarned = await stakingDualRewards.earnedA(stakingAccount1);
			console.log(`rewardRewardsEarned earned by staker ${stakingAccount1} is: ${rewardRewardsEarned.toString()}
							 - with rewardPerToken as: ${rewardPerToken} - totalToStake: ${totalToStake} `);

			const snx_token_earned_By_Staker = await stakingDualRewards.userRewardPerTokenAPaid(stakingAccount1);
			console.log(`snx_token_earned_By_Staker earned by staker ${stakingAccount1} is: ${snx_token_earned_By_Staker.toString()}`);
	 
			assert.bnEqual(rewardRewardsEarned, rewardPerToken.mul(totalToStake).div(toUnit(1)));

			// Make sure after withdrawing, we still have the ~amount of rewardRewards
			// The two values will be a bit different as time has "passed"

			//staked LP-Tokens of investor before withdrawal
			const stakedLPTokensOfInvestorBefWdrl = await stakingDualRewards.balanceOf(stakingAccount1);
			console.log(`staked LP-Tokens Of Investor Before Withdrawal: ${stakedLPTokensOfInvestorBefWdrl}`);

			//staking-Token balance of investor of  before withdrawal
			const stakingTokenBalanceOfInvestorBefWdrl = await stakingToken.balanceOf(stakingAccount1);
			console.log(`stakingToken Balance Of Investor Before Withdrawal: ${stakingTokenBalanceOfInvestorBefWdrl}`);

			//investor to withdraw staked LP Tokens 
			const initialWithdraw = toUnit('100');
			await stakingDualRewards.withdraw(initialWithdraw, { from: stakingAccount1 });

			//staked balance of investor of  after withdrawal
			const stakingTokenBalanceOfInvestorAftWdrl = await stakingToken.balanceOf(stakingAccount1);
			console.log(`stakingToken Balance Of Investor After Withdrawal: ${stakingTokenBalanceOfInvestorAftWdrl}`);

			assert.bnEqual(initialWithdraw, await stakingToken.balanceOf(stakingAccount1));

			//staked balance of investor before withdrawal
			const stakedLPTokensOfInvestorAfterWdrl = await stakingDualRewards.balanceOf(stakingAccount1);
			console.log(`staked LP-Tokens Of Investor After Withdrawal: ${stakedLPTokensOfInvestorAfterWdrl}`);


			const rewardRewardsEarnedPostWithdraw = await stakingDualRewards.earnedA(stakingAccount1);
			assert.bnClose(rewardRewardsEarned, rewardRewardsEarnedPostWithdraw, toUnit('0.1'));

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
