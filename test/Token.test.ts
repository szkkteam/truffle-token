import { utils } from "mocha";
import { TokenInstance } from "../types/truffle-contracts";
const truffleAssert = require('truffle-assertions');

//const { expect, assert } = require('chai');
const TokenContract = artifacts.require("Token");
const WETH = artifacts.require("ERC20");
const Router = artifacts.require("IUniswapV2Router02")
const {
    BN,           // Big Number support
    constants,    // Common constants, like the zero address and largest integers
    time,
  } = require('@openzeppelin/test-helpers');

const wethWhale = "0x6555e1cc97d3cba6eaddebbcd7ca51d75771e0b8";
const wethAddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const routerAddr = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";


contract("Token", ([deployer, user1, user2, user3, ...users]) => {

    const fundWeth = async (to: string, amount: string | number | BN) => {
        const weth = await WETH.at(wethAddr);
        await weth.transferFrom(wethWhale, to, amount, {from: wethWhale});
    }

    const fundToken = async (to: string, amount: string | number | BN, tokenInstance: TokenInstance | null = null) => {
        let instance = tokenInstance? tokenInstance : await TokenContract.deployed();
        await instance.transfer(to, amount, {from: deployer});
    }

    const addLiquidity = async (amount1: string, amount2: string, tokenInstance: TokenInstance | null = null) => {
        let instance = tokenInstance? tokenInstance : await TokenContract.deployed();
        const router = await Router.at(routerAddr);
        const weth = await WETH.at(wethAddr);

        // Send weth to deployer
        await fundWeth(deployer, web3.utils.toWei(amount1));

        await instance.approve(router.address, await instance.balanceOf(deployer));
        await weth.approve(router.address, await instance.balanceOf(deployer));

        await router.addLiquidity(
            instance.address,
            weth.address,
            web3.utils.toWei(amount2),
            web3.utils.toWei(amount1),
            0,
            0,
            deployer,
            Date.now() + 1000 * 60 * 1, 
        )
    }

    
    const buy = async (from: string, amountIn: string | BN | number, amountOut: string | BN | number = 0 , tokenInstance: TokenInstance | null = null) => {
        let instance = tokenInstance? tokenInstance : await TokenContract.deployed();
        const router = await Router.at(routerAddr);
        const weth = await WETH.at(wethAddr);     
        
        await weth.approve(router.address, amountIn, {from});

        return router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn,
            amountOut,
            [weth.address, instance.address],
            from,
            Date.now() + 1000 * 60 * 1,       
            {from}       
        );
    }

    const getAmountsOutBuy = async(amountIn: string | BN | number) => {
        const instance = await TokenContract.deployed();
        const router = await Router.at(routerAddr);
        const weth = await WETH.at(wethAddr);     

        const amount = await router.getAmountsOut(amountIn, 
            [weth.address, instance.address],
        );

        return amount[1];
    }

    const getAmountsOutSell = async(amountIn: string | BN | number) => {
        const instance = await TokenContract.deployed();
        const router = await Router.at(routerAddr);
        const weth = await WETH.at(wethAddr);     

        const amount = await router.getAmountsOut(amountIn, 
            [instance.address, weth.address],
        );

        return amount[1];
    }

    const getSlippage = (expectedOutAmount: BN, actualOutAmount: BN) => {
        return 1 - ((actualOutAmount.muln(1000).div(expectedOutAmount)).toNumber() / 1000)
    }

    const sell = async (from: string, amountIn: string | BN | number, amountOut: string | BN | number = 0, tokenInstance: TokenInstance | null = null) => {
        let instance = tokenInstance? tokenInstance : await TokenContract.deployed();
        const router = await Router.at(routerAddr);
        const weth = await WETH.at(wethAddr);     
        
        await instance.approve(router.address, amountIn, {from});

        return router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn,
            amountOut,
            [instance.address, weth.address],
            from,
            Date.now() + 1000 * 60 * 1,       
            {from}       
        );
    }

    
    const buyCheckSlippage = async (from: string, amount : BN | string | number) => {
        const instance = await TokenContract.deployed();
        const balanceBefore = await instance.balanceOf(from);

        const expectedOutAmount = await getAmountsOutBuy(amount);
        await buy(from, amount);
        const balanceAfter = await instance.balanceOf(from);
        const actualOutAmount = balanceAfter.sub(balanceBefore);
        return getSlippage(expectedOutAmount, actualOutAmount);
    }

    const sellCheckSlippage = async (from: string, amount : BN | string | number) => {
        const instance = await TokenContract.deployed();
        const weth = await WETH.at(wethAddr);     
        const balanceBefore = await weth.balanceOf(from);

        const expectedOutAmount = await getAmountsOutSell(amount);
        await sell(from, amount);
        const balanceAfter = await weth.balanceOf(from);
        const actualOutAmount = balanceAfter.sub(balanceBefore);
        return getSlippage(expectedOutAmount, actualOutAmount);
    }

    const openTrade = async (deadblocks: string | number | BN = 0, tokenInstance: TokenInstance | null = null) => {
        let instance = tokenInstance? tokenInstance : await TokenContract.deployed();
        const totalSupply = await instance.totalSupply();
        await instance.openTrade(deadblocks, totalSupply.muln(5).divn(1000), totalSupply.muln(15).divn(1000), {from: deployer});
    }

    before(async () => {
        const weth = await WETH.at(wethAddr);
        const balance = await weth.balanceOf(wethWhale);
        // Approve the weth transfer
        await weth.approve(wethWhale, balance, {from: wethWhale});
    });


    describe("deployment", async () => {

        it("should assign the total supply to the owner", async () => {
            const instance = await TokenContract.deployed();
            const balance = await instance.balanceOf(deployer);
            expect((await instance.totalSupply())).to.eql(balance);
            
        }); 

    });

    describe("owner functions", async () => {

        after(async () => {
            const instance = await TokenContract.deployed();
            
            // Restore the default fee's because they are used for later calculation
            const marketingFee = new BN(20);
            const liquidityFee = new BN(20);
            const buyFee = new BN(40);
            const sellFee = new BN(40);

            await truffleAssert.passes(instance.updateFees(marketingFee, liquidityFee, buyFee, sellFee, {from: deployer}));

            const adaptiveFeeIncrease = new BN(5);
            const adaptiveFeeMax = new BN(300);

            await truffleAssert.passes(instance.updateAdaptiveSellFee(adaptiveFeeIncrease, adaptiveFeeMax, {from: deployer}));
        });

        it("should update swapTokensAmount", async () => {
            const instance = await TokenContract.deployed();

            const newAmount = (await instance.totalSupply()).mul(new BN(3)).div(new BN(1000));
            await instance.updateSwapTokensAtAmount(newAmount, {from: deployer});
            expect((await instance.swapTokensAtAmount()).toString()).to.equal(newAmount.toString());
        });

        it("should revert swapTokensAmount", async () => {
            const instance = await TokenContract.deployed();

            let newAmount = (await instance.totalSupply()).mul(new BN(6)).div(new BN(1000));
            await truffleAssert.fails(instance.updateSwapTokensAtAmount(newAmount, {from: deployer}), "Swap amount cannot be higher than 0.5% total supply.");

            newAmount = (await instance.totalSupply()).mul(new BN(1)).div(new BN(1000000));
            await truffleAssert.fails(instance.updateSwapTokensAtAmount(newAmount, {from: deployer}), "Swap amount cannot be lower than 0.001% total supply.");
        });

        it("should revert swapTokensAmount if not owner", async() => {
            const instance = await TokenContract.deployed();

            const newAmount = (await instance.totalSupply()).mul(new BN(3)).div(new BN(1000));
            await truffleAssert.fails(instance.updateSwapTokensAtAmount(newAmount, {from: user1}));
        });

        it("should update fees", async () => {
            const instance = await TokenContract.deployed();

            const marketingFee = new BN(10);
            const liquidityFee = new BN(10);
            const buyFee = new BN(10);
            const sellFee = new BN(10);

            await truffleAssert.passes(instance.updateFees(marketingFee, liquidityFee, buyFee, sellFee, {from: deployer}));
        });

        it("should update adaptive fees", async () => {
            const instance = await TokenContract.deployed();

            const adaptiveFeeIncrease = new BN(1);
            const adaptiveFeeMax = new BN(40);

            await truffleAssert.passes(instance.updateAdaptiveSellFee(adaptiveFeeIncrease, adaptiveFeeMax, {from: deployer}));
        });

        it("should update adaptive fees with 0", async () => {
            const instance = await TokenContract.deployed();

            const adaptiveFeeIncrease = new BN(0);
            const adaptiveFeeMax = new BN(40);

            await truffleAssert.passes(instance.updateAdaptiveSellFee(adaptiveFeeIncrease, adaptiveFeeMax, {from: deployer}));
        });

        it("should revert update adaptive fees above max", async () => {
            const instance = await TokenContract.deployed();

            const adaptiveFeeIncrease = new BN(5);
            const adaptiveFeeMax = new BN(500);

            await truffleAssert.reverts(instance.updateAdaptiveSellFee(adaptiveFeeIncrease, adaptiveFeeMax, {from: deployer}), "Must keep fees at 30% or less");
        });

        it("should revert update adaptive fee increase above max", async () => {
            const instance = await TokenContract.deployed();

            const adaptiveFeeIncrease = new BN(120);
            const adaptiveFeeMax = new BN(300);

            await truffleAssert.reverts(instance.updateAdaptiveSellFee(adaptiveFeeIncrease, adaptiveFeeMax, {from: deployer}), "Must keep increate at 2% or less");
        });

        it("should revert update fees", async() => {
            const instance = await TokenContract.deployed();

            const marketingFee = new BN(100);
            const liquidityFee = new BN(50);
            const buyFee = new BN(10);
            const sellFee = new BN(10);

            await truffleAssert.reverts(instance.updateFees(marketingFee, liquidityFee, buyFee, sellFee, {from: deployer}), "Must keep fees at 14% or less");
        });

        it("should revert update fees if not owner", async() => {
            const instance = await TokenContract.deployed();

            const marketingFee = new BN(10);
            const liquidityFee = new BN(10);
            const buyFee = new BN(10);
            const sellFee = new BN(10);

            await truffleAssert.reverts(instance.updateFees(marketingFee, liquidityFee, buyFee, sellFee, {from: user1}));
        });

        it("should exlcude from fees", async() => {
            const instance = await TokenContract.deployed();
            truffleAssert.eventEmitted(await instance.excludeFromFees(deployer, true, {from: deployer}), "ExcludeFromFees", {account: deployer, isExcluded: true});
        });

        it("should update fee wallet", async() => {
            const instance = await TokenContract.deployed();
            truffleAssert.eventEmitted(await instance.updateFeeWallet(deployer, {from: deployer}), "FeeWalletUpdated", {newWallet: deployer, oldWallet: deployer});
        });

        it("should force swap tokens for eth",async () => {
            const instance = await TokenContract.deployed();
            await truffleAssert.passes(instance.forceSwap({from: deployer}));
        });

        it("should revert force swap tokens for eth if not owner",async () => {
            const instance = await TokenContract.deployed();
            await truffleAssert.fails(instance.forceSwap({from: user1}));
        });

        it("should revert if resetFees is called by non owner", async () => {
            const instance = await TokenContract.deployed();
            await truffleAssert.reverts(instance.resetAdaptiveFees({from: user1}));
        });

        it("should revert if update adataptiveFees is called by non owner", async () => {
            const instance = await TokenContract.deployed();

            const adaptiveFeeIncrease = new BN(2);
            const adaptiveFeeMax = new BN(300);

            await truffleAssert.reverts(instance.updateAdaptiveSellFee(adaptiveFeeIncrease, adaptiveFeeMax ,{from: user1}));
        });
        /*
        it("should force send eth",async () => {
            const instance = await MagicContract.deployed();
            truffleAssert.passes(instance.forceSend(), {from: deployer});
        });

        it("should revert force send eth if not owner",async () => {
            const instance = await MagicContract.deployed();
            truffleAssert.reverts(instance.forceSend(), {from: user1});
        });
        */
    });

    describe("fee collection", async() => {
        let instance: TokenInstance;

        before(async () => {
            instance = await TokenContract.new(routerAddr, {from: deployer});
            // Create liquidity and fund addresses
            await addLiquidity('1', '1000', instance);
            await openTrade(undefined, instance);
            await fundWeth(user1, web3.utils.toWei('1'));
            //await fundWeth(user2, web3.utils.toWei('1'));
            //await fundWeth(user3, web3.utils.toWei('1'));
        });

        beforeEach(async () => {
            // Generate fee tokens by buying
            const buyAmount = '1';
            await buy(user1, web3.utils.toWei(buyAmount), undefined, instance);
            
        });

        
        it("should force swap tokens and send eth",async () => {
            const balanceBefore = await web3.eth.getBalance(deployer);

            const tx = await instance.forceSwap({from: deployer})
            truffleAssert.eventEmitted(tx, "Transfer", {to: deployer});
            truffleAssert.eventEmitted(tx, "SwapAndLiquify");

            const balanceAfter = await web3.eth.getBalance(deployer);
            
            assert((web3.utils.toBN(balanceAfter)).gt(web3.utils.toBN(balanceBefore)));
        });
        /*
        it("should force send eth",async () => {
            const instance = await MagicContract.deployed();

            const balanceBefore = await web3.eth.getBalance(deployer);
            truffleAssert.passes(instance.forceSend(), {from: deployer});
        });

        it("should revert force send eth if not owner",async () => {
            const instance = await MagicContract.deployed();
            truffleAssert.reverts(instance.forceSend(), {from: user1});
        });
        */
    });

    describe("close trade", async() => {
        let instance: TokenInstance;

        before(async () => {
            instance = await TokenContract.new(routerAddr, {from: deployer});
            await addLiquidity('1', '1000', instance);
            // DO NOT open the trade yet
        });

        beforeEach(async () => {
            await fundWeth(user1, web3.utils.toWei('1'));
            await fundWeth(user2, web3.utils.toWei('1'));
            await fundWeth(user3, web3.utils.toWei('1'));
        });

        it("should revert if trading not open yet", async () => {
            await truffleAssert.reverts(buy(user1, web3.utils.toWei('1'), undefined, instance));
        })

        it("should allow transfer", async () => {
            await truffleAssert.passes(instance.transfer(user1, web3.utils.toWei('0.001'), {from: deployer}));
        }); 

    });

    describe("anti-bot", async() => {
        let instance: TokenInstance;

        before(async () => {
            instance = await TokenContract.new(routerAddr, {from: deployer});
            await addLiquidity('1', '1000', instance);
            // Open trade with 10 blocks delay
        });

        beforeEach(async () => {
            await fundWeth(user1, web3.utils.toWei('1'));
            await fundWeth(user2, web3.utils.toWei('1'));
        });


        it("should get blacklisted", async () => {
            await openTrade(new BN(10), instance);
            const currentBlock = await time.latestBlock();

            // user1 buy (bl)
            await truffleAssert.passes(buy(user1, web3.utils.toWei('1'), undefined, instance));
            // Jump to end of bl
            await time.advanceBlockTo(new BN(currentBlock).add(new BN(11)))
            // user2 buy (no bl)
            await truffleAssert.passes(buy(user2, web3.utils.toWei('1'), undefined, instance));
            // user2 sell
            await truffleAssert.passes(sell(user2, await instance.balanceOf(user2), undefined, instance));            
            // user1 sell (fail)
            await truffleAssert.reverts(sell(user1, await instance.balanceOf(user1), undefined, instance));        
            // remove user1 from bl
            await truffleAssert.passes(instance.removeFromBlacklist(user1, {from: deployer}));
            // user1 can sell
            await truffleAssert.passes(sell(user1, await instance.balanceOf(user1), undefined, instance));        
            
        });
    });

    describe("transactions", async () => {
        let instance: TokenInstance;
        before(async () => {
            instance = await TokenContract.new(routerAddr, {from: deployer});
            await addLiquidity('1', '1000', instance);
            await openTrade(undefined, instance);
            
            /*
            await fundWeth(user1, web3.utils.toWei('10'));
            await fundWeth(user2, web3.utils.toWei('10'));
            await fundWeth(user3, web3.utils.toWei('10'));
            */
        });

        beforeEach(async () => {
            await fundWeth(user1, web3.utils.toWei('1'));
            await fundWeth(user2, web3.utils.toWei('1'));
            await fundWeth(user3, web3.utils.toWei('1'));
        });

        it("should buy", async () => {
            await truffleAssert.passes(buy(user1, web3.utils.toWei('0.001'), undefined, instance));
        });

        it("should buy consecutevly", async () => {
            await truffleAssert.passes(buy(user1, web3.utils.toWei('0.001'), undefined, instance));
            await truffleAssert.passes(buy(user2, web3.utils.toWei('0.001'), undefined, instance));
            await truffleAssert.passes(buy(user3, web3.utils.toWei('0.001'), undefined, instance));
        });
        
        it("should buy - sell", async () => {
            // Buys
            await truffleAssert.passes(buy(user1, web3.utils.toWei('0.001'), undefined, instance));
            await truffleAssert.passes(buy(user2, web3.utils.toWei('0.001'), undefined, instance));
            await truffleAssert.passes(buy(user3, web3.utils.toWei('0.001'), undefined, instance));

            // Sells
            await truffleAssert.passes(sell(user1, await instance.balanceOf(user1), undefined, instance));
            await truffleAssert.passes(sell(user2, await instance.balanceOf(user2), undefined, instance));
            await truffleAssert.passes(sell(user3, await instance.balanceOf(user3), undefined, instance));
        });

        it("should buy - sell mixed", async () => {
            // Buy
            await truffleAssert.passes(buy(user1, web3.utils.toWei('0.001'), undefined, instance));
            await truffleAssert.passes(buy(user2, web3.utils.toWei('0.001'), undefined, instance));
            // Sell
            await truffleAssert.passes(sell(user1, await instance.balanceOf(user1), undefined, instance));
            // Buy
            await truffleAssert.passes(buy(user3, web3.utils.toWei('0.001'), undefined, instance));
            
            // Sells
            await truffleAssert.passes(sell(user2, await instance.balanceOf(user2), undefined, instance));
            
            await truffleAssert.passes(sell(user3, await instance.balanceOf(user3), undefined, instance));
            // Buy
            await truffleAssert.passes(buy(user2, web3.utils.toWei('0.001'), undefined, instance));            
        });

    });
    
    describe("adaptive fees", async () => {
        let baseFee = 80;
        let instance: TokenInstance;

        before(async () => {
            instance = await TokenContract.new(routerAddr, {from: deployer});
            await addLiquidity('1', '1000', instance);
            await openTrade(undefined, instance);
        });

        beforeEach(async () => {
            await instance.resetAdaptiveFees({from: deployer});

            await fundWeth(user1, web3.utils.toWei('1'));
            await fundWeth(user2, web3.utils.toWei('1'));
            await fundWeth(user3, web3.utils.toWei('1'));

            await fundToken(user1, web3.utils.toWei('1000'), instance);
            await fundToken(user2, web3.utils.toWei('1000'), instance);
            await fundToken(user3, web3.utils.toWei('1000'), instance);
           
        });

        it("should not increase in case of buy", async () => {
            // User1 buy
            let tx = await buy(user1, web3.utils.toWei('0.001'), undefined, instance);
            // Workaround to handle nested events
            let newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {buyFee: web3.utils.toBN(baseFee)});

            // User2 buy
            tx = await buy(user2, web3.utils.toWei('0.001'), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {buyFee: web3.utils.toBN(baseFee)});

            // User3 buy
            tx = await buy(user3, web3.utils.toWei('0.001'), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {buyFee: web3.utils.toBN(baseFee)});
        });

        it("should increase in case of sell", async () => {           
            let tx = await sell(user1, await instance.balanceOf(user1), undefined, instance);
            // Workaround to handle nested events
            let newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee + 5)});

            tx = await sell(user2, await instance.balanceOf(user2), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 10%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee + 10)});
            
            tx = await sell(user3, await instance.balanceOf(user3), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 10.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee + 15)});

        });

        it("should decrease in case of buy", async () => {
            // Sell
            let tx = await sell(user1, await instance.balanceOf(user1), undefined, instance);
            // Workaround to handle nested events
            let newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee + 5)});

            // Buy
            tx = await buy(user1, web3.utils.toWei('0.001'), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee)});

            // Sell
            tx = await sell(user2, await instance.balanceOf(user2), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 10%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee + 5)});
            
            tx = await sell(user3, await instance.balanceOf(user3), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 10.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee + 10)});

            // Buy
            tx = await buy(user2, web3.utils.toWei('0.001'), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee + 5)});
        });

        it("should not go below _rewardSellFee", async () => {            
            let tx = await buy(user1, web3.utils.toWei('0.001'), undefined, instance);
            // Workaround to handle nested events
            let newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee)});

            tx = await buy(user2, web3.utils.toWei('0.001'), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee )});

            tx = await buy(user3, web3.utils.toWei('0.001'), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 9.5%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(baseFee)});
        });

        it("should not go above _adaptiveSellFeesMax", async () => {
            let feeCounter = baseFee + 5;
            for(; feeCounter <= 340; feeCounter += 5) {
                // Sell
                let tx = await sell(user1, web3.utils.toWei('10'), undefined, instance);
                // Workaround to handle nested events
                let newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
                // After the 1st sell, the sell fee should be 10%
                truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(feeCounter)});
            }
            // Sell fee at max. Perform some more sells
            let tx = await sell(user2, web3.utils.toWei('1000'), undefined, instance);
            // Workaround to handle nested events
            let newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 10%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(340)});
            // Sell fee at max. Perform some more sells
            tx = await sell(user3, web3.utils.toWei('1000'), undefined, instance);
            // Workaround to handle nested events
            newTx = await truffleAssert.createTransactionResult(instance, tx.tx);
            // After the 1st sell, the sell fee should be 10%
            truffleAssert.eventEmitted(newTx, 'AdaptiveFeesUpdated', {sellFee: web3.utils.toBN(340)});
        });
    });
        
});