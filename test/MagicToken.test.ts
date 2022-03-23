import { utils } from "mocha";

//const { expect, assert } = require('chai');
const MagicContract = artifacts.require("MagicToken");
const WETH = artifacts.require("ERC20");
const Router = artifacts.require("IUniswapV2Router02")
const {
    BN,           // Big Number support
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
  } = require('@openzeppelin/test-helpers');

const wethWhale = "0x6555e1CC97d3cbA6eAddebBCD7Ca51d75771e0B8";
const wethAddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const routerAddr = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

contract("MagicToken", ([deployer, user1, user2]) => {
    let MagicToken;

    const fundWeth = async (to: string, amount: string | number | BN) => {
        console.log(`to: ${to} | amount: ${amount}`);
        const weth = await WETH.at(wethAddr);
        await weth.transferFrom(wethWhale, to, amount, {from: wethWhale});
    }

    const addLiquidity = async (amount1: string, amount2: string) => {
        const instance = await MagicContract.deployed();
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

    before(async () => {
        const weth = await WETH.at(wethAddr);
        const balance = await weth.balanceOf(wethWhale);
        // Approve the weth transfer
        await weth.approve(wethWhale, balance, {from: wethWhale});
    });


    describe("initial state", async () => {

        it("should have 1 billion of initial minted", async () => {
            const instance = await MagicContract.deployed();
            const balance = await instance.balanceOf(deployer);
            assert.equal(
                balance.toString(),
                "100000000000000000000000000000",
                "1 billion was not in the deployer account"
            );
        }); 

        it("should create liquidity", async () => {
            const instance = await MagicContract.deployed();
            const router = await Router.at(routerAddr);
            const weth = await WETH.at(wethAddr);

            // Send weth to deployer
            await fundWeth(deployer, web3.utils.toWei('10'));

            assert.equal(
                (await weth.balanceOf(deployer)).toString(),
                web3.utils.toWei('10')
            );

            await instance.approve(router.address, await instance.balanceOf(deployer));
            await weth.approve(router.address, await instance.balanceOf(deployer));

            const tx = await router.addLiquidity(
                instance.address,
                weth.address,
                web3.utils.toWei('1000'),
                web3.utils.toWei('1'),
                0,
                0,
                deployer,
                Date.now() + 1000 * 60 * 1, 
            )
            /* No event ... 
            expectEvent(tx, 'Mint', {
                from: deployer,
            })
            */
        });
    });

    const buy = async (from: string, amountIn: string | BN | number, amountOut: string | BN | number = 0 ) => {
        const instance = await MagicContract.deployed();
        const router = await Router.at(routerAddr);
        const weth = await WETH.at(wethAddr);     
        
        await weth.approve(router.address, await instance.balanceOf(from), {from});
        return router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn,
            amountOut,
            [weth.address, instance.address],
            from,
            Date.now() + 1000 * 60 * 1,       
            {from}       
        )
    }

    describe("trade state", async () => {

        before(async () => {
            await addLiquidity('1', '1000');
        });

        it("should swap-in", async () => {
            const instance = await MagicContract.deployed();

            await fundWeth(user1, web3.utils.toWei('10'));

            const tx = await buy(
                user1,
                web3.utils.toWei('1'),
            )
            
            console.log(`Balance: ${(await instance.balanceOf(user1)).toString()}`);

        });
    })
        
});