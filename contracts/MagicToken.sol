// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./Interfaces/uniswap/IUniswapV2Factory.sol";
import "./Interfaces/uniswap/IUniswapV2Pair.sol";
import "./Interfaces/uniswap/IUniswapV2Router02.sol";

contract MagicToken is ERC20, Ownable {
    

    IUniswapV2Router02 private uniswapV2Router;
    address private uniswapV2Pair;
    bool private _swapping;

    address private _feeWallet;

    uint256 public swapTokensAtAmount;

    uint256 private _sellFees;
    uint256 private _buyFees;

    uint256 private _marketingFee;
    uint256 private _liquidityFee;

    uint256 private _rewardBuyFee;
    uint256 private _rewardSellFee;

    uint256 private _burnFee;

    // exlcude from fees and max transaction amount
    mapping (address => bool) private _isExcludedFromFees;

    uint256 private _tokensForMarketing;
    uint256 private _tokensForLiquidity;
    uint256 private _tokensFromBuy;
    uint256 private _tokensFromSell;


    mapping (address => bool) private automatedMarketMakerPairs;

    event ExcludeFromFees(address indexed account, bool isExcluded);
    event SetAutomatedMarketMakerPair(address indexed pair, bool indexed value);
    event SwapAndLiquify(uint256 tokensSwapped, uint256 ethReceived, uint256 tokensIntoLiquidity);

    constructor() ERC20("Magic Token", "MAGIC") {
        
        IUniswapV2Router02 _uniswapV2Router = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

        uniswapV2Router = _uniswapV2Router;

        uniswapV2Pair = IUniswapV2Factory(_uniswapV2Router.factory()).createPair(address(this), _uniswapV2Router.WETH());
        _setAutomatedMarketMakerPair(address(uniswapV2Pair), true);
        
        uint256 marketingFee = 2;
        uint256 liquidityFee = 2;
        uint256 rewardBuyFee = 4;
        uint256 rewardSellFee = 4;
        uint256 burnFee = 1;

        uint256 totalSupply = 1e11 * 1e18;
        swapTokensAtAmount = totalSupply * 15 / 10000;

        _marketingFee = marketingFee;
        _liquidityFee = liquidityFee;
        _rewardBuyFee = rewardBuyFee;
        _rewardSellFee = rewardSellFee;

        _buyFees = _marketingFee + _liquidityFee + _rewardBuyFee;
        _sellFees = _marketingFee + _liquidityFee + _rewardSellFee;
        
        _burnFee = burnFee;

        _tokensFromBuy = 0;
        _tokensFromSell = 0;

        _feeWallet = address(owner()); // set as fee wallet

        // exclude from paying fees or having max transaction amount
        excludeFromFees(owner(), true);
        excludeFromFees(address(this), true);
        excludeFromFees(address(0xdead), true);

        _mint(msg.sender, totalSupply);
    }


    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        if (amount == 0) {
            super._transfer(from, to, 0);
            return;
        }

        // Burn baby burn! 🔥
        if (!_isExcludedFromFees[from] && !_isExcludedFromFees[to]) {
            uint256 burnAmount = amount / 100;
            _burn(from, burnAmount);
            amount -= burnAmount;
        }

        uint256 contractTokenBalance = balanceOf(address(this));
        bool canSwap = contractTokenBalance >= swapTokensAtAmount;
        if (
            canSwap &&
            !_swapping &&
            !automatedMarketMakerPairs[from] &&
            !_isExcludedFromFees[from] &&
            !_isExcludedFromFees[to]
        ) {
            _swapping = true;
            swapBack();
            _swapping = false;
        }

        bool takeFee = !_swapping;

        // if any account belongs to _isExcludedFromFee account then remove the fee
        if (_isExcludedFromFees[from] || _isExcludedFromFees[to]) {
            takeFee = false;
        }

        uint256 fees = 0;
        uint256 cachedCollectedBuyFee = 0;
        uint256 cachedCollectedSellFee = 0;
        // only take fees on buys/sells, do not take on wallet transfers
        if (takeFee) {

            // when buy
            if (automatedMarketMakerPairs[from]) {

                // Get the currently collected buy fees
                cachedCollectedBuyFee = _tokensFromBuy;
                _tokensFromBuy = 0;
                // Get the currently collected sell fees
                cachedCollectedSellFee = _tokensFromSell;
                _tokensFromSell = 0;

                // Take the fees
                fees = amount * _buyFees / 100;
                _tokensForLiquidity += fees * _liquidityFee / _buyFees;
                _tokensForMarketing += fees * _marketingFee / _buyFees;    
                _tokensFromBuy += fees * _rewardBuyFee / _burnFee;            


            }
            
            // when sell
            else if (automatedMarketMakerPairs[to]) {
                fees = amount * _sellFees / 100;
                _tokensForLiquidity += fees * _liquidityFee / _sellFees;
                _tokensForMarketing += fees * _marketingFee / _sellFees;                
                _tokensFromSell += fees * _rewardSellFee / _sellFees;
            }

            if (fees > 0) {
                super._transfer(from, address(this), fees);
            }
            
            amount = amount - fees + cachedCollectedBuyFee + cachedCollectedSellFee;
        }

        super._transfer(from, to, amount);
    }

    
    function excludeFromFees(address account, bool excluded) public onlyOwner {
        _isExcludedFromFees[account] = excluded;
        emit ExcludeFromFees(account, excluded);
    }

    function _setAutomatedMarketMakerPair(address pair, bool value) private {
        automatedMarketMakerPairs[pair] = value;

        emit SetAutomatedMarketMakerPair(pair, value);
    }

    function _swapTokensForEth(uint256 tokenAmount) private {
        // generate the uniswap pair path of token -> weth
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = uniswapV2Router.WETH();

        _approve(address(this), address(uniswapV2Router), tokenAmount);

        // make the swap
        uniswapV2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0, // accept any amount of ETH
            path,
            address(this),
            block.timestamp
        );
    }

    function _addLiquidity(uint256 tokenAmount, uint256 ethAmount) private {
        // approve token transfer to cover all possible scenarios
        _approve(address(this), address(uniswapV2Router), tokenAmount);

        // add the liquidity
        uniswapV2Router.addLiquidityETH{value: ethAmount}(
            address(this),
            tokenAmount,
            0, // slippage is unavoidable
            0, // slippage is unavoidable
            owner(),
            block.timestamp
        );
    }


    function swapBack() private {
        uint256 contractBalance = balanceOf(address(this));
        uint256 totalTokensToSwap = _tokensForLiquidity + _tokensForMarketing;
        
        if (contractBalance == 0 || totalTokensToSwap == 0) return;
        if (contractBalance > swapTokensAtAmount) {
          contractBalance = swapTokensAtAmount;
        }
        
        // Halve the amount of liquidity tokens
        uint256 liquidityTokens = contractBalance * _tokensForLiquidity / totalTokensToSwap / 2;
        uint256 amountToSwapForETH = contractBalance - liquidityTokens;
        
        uint256 initialETHBalance = address(this).balance;

        _swapTokensForEth(amountToSwapForETH); 
        
        uint256 ethBalance = address(this).balance - initialETHBalance;
        uint256 ethForMarketing = ethBalance * _tokensForMarketing / totalTokensToSwap;
        uint256 ethForLiquidity = ethBalance - ethForMarketing;
        
        _tokensForLiquidity = 0;
        _tokensForMarketing = 0;

        payable(_feeWallet).transfer(ethForMarketing);
                
        if (liquidityTokens > 0 && ethForLiquidity > 0) {
            _addLiquidity(liquidityTokens, ethForLiquidity);
            emit SwapAndLiquify(amountToSwapForETH, ethForLiquidity, _tokensForLiquidity);
        }
    }

    function forceSwap() external onlyOwner {
        _swapTokensForEth(address(this).balance);
        payable(_feeWallet).transfer(address(this).balance);
    }

    function forceSend() external onlyOwner {
        payable(_feeWallet).transfer(address(this).balance);
    }

}