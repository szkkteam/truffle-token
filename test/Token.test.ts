import { utils } from "mocha";
const truffleAssert = require('truffle-assertions');

//const { expect, assert } = require('chai');
const TokenContract = artifacts.require("Token");
const WETH = artifacts.require("ERC20");
const Router = artifacts.require("IUniswapV2Router02")
const {
    BN,           // Big Number support
    constants,    // Common constants, like the zero address and largest integers
  } = require('@openzeppelin/test-helpers');

const wethWhale = "0x6555e1CC97d3cbA6eAddebBCD7Ca51d75771e0B8";
const wethAddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const routerAddr = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";


contract("Token", ([deployer, user1, user2, user3, user4]) => {

    const fundWeth = async (to: string, amount: string | number | BN) => {
        const weth = await WETH.at(wethAddr);
        await weth.transferFrom(wethWhale, to, amount, {from: wethWhale});
    }

    const addLiquidity = async (amount1: string, amount2: string) => {
        const instance = await TokenContract.deployed();
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

    
    const buy = async (from: string, amountIn: string | BN | number, amountOut: string | BN | number = 0 ) => {
        const instance = await TokenContract.deployed();
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

    const getAmountsOut = async(amountIn: string | BN | number) => {
        const instance = await TokenContract.deployed();
        const router = await Router.at(routerAddr);
        const weth = await WETH.at(wethAddr);     

        const amount = await router.getAmountsOut(amountIn, 
            [weth.address, instance.address],
        );

        return amount[1];
    }

    const sell = async (from: string, amountIn: string | BN | number, amountOut: string | BN | number = 0 ) => {
        const instance = await TokenContract.deployed();
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

            const marketingFee = new BN(1);
            const liquidityFee = new BN(1);
            const buyFee = new BN(1);
            const sellFee = new BN(1);

            await truffleAssert.passes(instance.updateFees(marketingFee, liquidityFee, buyFee, sellFee, {from: deployer}));
        });

        it("should revert update fees", async() => {
            const instance = await TokenContract.deployed();

            const marketingFee = new BN(10);
            const liquidityFee = new BN(5);
            const buyFee = new BN(1);
            const sellFee = new BN(1);

            await truffleAssert.reverts(instance.updateFees(marketingFee, liquidityFee, buyFee, sellFee, {from: deployer}), "Must keep fees at 14% or less");
        });

        it("should revert update fees if not owner", async() => {
            const instance = await TokenContract.deployed();

            const marketingFee = new BN(1);
            const liquidityFee = new BN(1);
            const buyFee = new BN(1);
            const sellFee = new BN(1);

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

        before(async () => {
            // Create liquidity and fund addresses
            await addLiquidity('1', '1000');

            await fundWeth(user1, web3.utils.toWei('1'));
            //await fundWeth(user2, web3.utils.toWei('1'));
            //await fundWeth(user3, web3.utils.toWei('1'));
        });

        beforeEach(async () => {
            // Generate fee tokens by buying
            const buyAmount = '1';
            await buy(user1, web3.utils.toWei(buyAmount));
        });

        
        it("should force swap tokens and send eth",async () => {
            const instance = await TokenContract.deployed();

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

    describe("transactions", async () => {

        before(async () => {
            await addLiquidity('1', '1000');
            
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
            await truffleAssert.passes(buy(user1, web3.utils.toWei('0.001')));
        });

        it("should buy consecutevly", async () => {
            await truffleAssert.passes(buy(user1, web3.utils.toWei('0.001')));
            await truffleAssert.passes(buy(user2, web3.utils.toWei('0.001')));
            await truffleAssert.passes(buy(user3, web3.utils.toWei('0.001')));
        });
        
        it("should buy - sell", async () => {
            const instance = await TokenContract.deployed();
            // Buys
            await truffleAssert.passes(buy(user1, web3.utils.toWei('0.001')));
            await truffleAssert.passes(buy(user2, web3.utils.toWei('0.001')));
            await truffleAssert.passes(buy(user3, web3.utils.toWei('0.001')));

            // Sells
            await truffleAssert.passes(sell(user1, await instance.balanceOf(user1)));
            await truffleAssert.passes(sell(user2, await instance.balanceOf(user2)));
            await truffleAssert.passes(sell(user3, await instance.balanceOf(user3)));
        });

        it("should buy - sell mixed", async () => {
            const instance = await TokenContract.deployed();
            // Buy
            await truffleAssert.passes(buy(user1, web3.utils.toWei('0.001')));
            await truffleAssert.passes(buy(user2, web3.utils.toWei('0.001')));
            // Sell
            await truffleAssert.passes(sell(user1, await instance.balanceOf(user1)));
            // Buy
            await truffleAssert.passes(buy(user3, web3.utils.toWei('0.001')));
            
            // Sells
            await truffleAssert.passes(sell(user2, await instance.balanceOf(user2)));
            
            await truffleAssert.passes(sell(user3, await instance.balanceOf(user3)));
            // Buy
            await truffleAssert.passes(buy(user1, web3.utils.toWei('0.001')));            
        });

        /*
        it("should get fee from buy", async () => {
            
            const instance = await MagicContract.deployed();
            const buyAmount = '1';
            const buyAmount2 = '0.001';

            await fundWeth(user1, web3.utils.toWei('10'));
            const tx = await buy(user1, web3.utils.toWei(buyAmount));
            console.log(`Buy tx: ${tx.toString()}`)
            //await fundWeth(user2, web3.utils.toWei('10'));
            //await fundWeth(user3, web3.utils.toWei('10'));
            
            
            console.log(`user1 amountOut: ${(await getAmountsOut(web3.utils.toWei(buyAmount))).toString()}`);
            await buy(user1, web3.utils.toWei(buyAmount));
            console.log(`user1 balance: ${(await instance.balanceOf(user1)).toString()}`);

            instance._tokensFromBuy.call()
            
            console.log(`user2 amountOut: ${(await getAmountsOut(web3.utils.toWei(buyAmount2))).toString()}`);
            await buy(user2, web3.utils.toWei(buyAmount2));
            console.log(`user2 balance: ${(await instance.balanceOf(user2)).toString()}`);
            

        });
        */
    })
        
});