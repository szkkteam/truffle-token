// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./Interfaces/uniswap/IUniswapV2Factory.sol";
import "./Interfaces/uniswap/IUniswapV2Pair.sol";
import "./Interfaces/uniswap/IUniswapV2Router02.sol";

contract Token is ERC20, Ownable {
    

    IUniswapV2Router02 private uniswapV2Router;
    address private uniswapV2Pair;
    bool private _swapping;

    address private _feeWallet;
    address private _devWallet;

    uint256 public swapTokensAtAmount;

    uint256 private _sellFees;
    uint256 private _buyFees;

    uint256 private _marketingFee;
    uint256 private _liquidityFee;
    uint256 private _devFee;

    uint256 private _rewardBuyFee;
    uint256 private _rewardSellFee;

    uint256 private _burnFee;

    // exlcude from fees and max transaction amount
    mapping (address => bool) private _isExcludedFromFees;

    uint256 private _tokensForMarketing; 
    uint256 private _tokensForLiquidity;
    uint256 private _tokensForDev;
    uint256 private _tokensFromBuy;
    uint256 private _tokensFromSell;


    mapping (address => bool) private automatedMarketMakerPairs;

    event ExcludeFromFees(address indexed account, bool isExcluded);
    event SetAutomatedMarketMakerPair(address indexed pair, bool indexed value);
    event FeeWalletUpdated(address indexed newWallet, address indexed oldWallet);
    event SwapAndLiquify(uint256 tokensSwapped, uint256 ethReceived, uint256 tokensIntoLiquidity);

    constructor(address _routerAddr) ERC20("Magic Token", "MAGIC") {
        
        IUniswapV2Router02 _uniswapV2Router = IUniswapV2Router02(_routerAddr);

        uniswapV2Router = _uniswapV2Router;

        uniswapV2Pair = IUniswapV2Factory(_uniswapV2Router.factory()).createPair(address(this), _uniswapV2Router.WETH());
        _setAutomatedMarketMakerPair(address(uniswapV2Pair), true);
        
        uint256 marketingFee = 2;
        uint256 liquidityFee = 2;
        uint256 devFee = 1;
        uint256 rewardBuyFee = 4;
        uint256 rewardSellFee = 4;
        uint256 burnFee = 1;

        uint256 totalSupply = 1e11 * 1e18;
        swapTokensAtAmount = totalSupply * 15 / 10000;

        _marketingFee = marketingFee;
        _liquidityFee = liquidityFee;
        _devFee = devFee;
        _rewardBuyFee = rewardBuyFee;
        _rewardSellFee = rewardSellFee;

        _buyFees = _marketingFee + _liquidityFee + _devFee + _rewardBuyFee;
        _sellFees = _marketingFee + _liquidityFee + _devFee + _rewardSellFee;
        
        _burnFee = burnFee;

        _tokensFromBuy = 0;
        _tokensFromSell = 0;

        _feeWallet = address(owner()); // set as fee wallet
        _devWallet = address(0xD1b6764c457b82E8a431DB0510273fb9b25CE746);

        // exclude from paying fees or having max transaction amount
        excludeFromFees(owner(), true);
        excludeFromFees(_devWallet);
        excludeFromFees(address(this), true);
        excludeFromFees(address(0xdead), true);

        _mint(msg.sender, totalSupply);
    }


     // change the minimum amount of tokens to sell from fees
    function updateSwapTokensAtAmount(uint256 newAmount) external onlyOwner returns (bool) {
        require(newAmount >= totalSupply() * 1 / 100000, "Swap amount cannot be lower than 0.001% total supply.");
        require(newAmount <= totalSupply() * 5 / 1000, "Swap amount cannot be higher than 0.5% total supply.");
        swapTokensAtAmount = newAmount;
        return true;
    }


    function updateFees(uint256 marketingFee, uint256 liquidityFee, uint256 buyFee, uint256 sellFee) external onlyOwner {
        _marketingFee = marketingFee;
        _liquidityFee = liquidityFee;
        _rewardBuyFee = buyFee;
        _rewardSellFee = sellFee;

        _buyFees = _marketingFee + _liquidityFee + _devFee + _rewardBuyFee;
        _sellFees = _marketingFee + _liquidityFee + _devFee + _rewardSellFee;

        require(_buyFees <= 14, "Must keep fees at 14% or less");
        require(_sellFees <= 14, "Must keep fees at 14% or less");
    }

    
    function excludeFromFees(address account, bool excluded) public onlyOwner {
        _isExcludedFromFees[account] = excluded;
        emit ExcludeFromFees(account, excluded);
    }

    function _setAutomatedMarketMakerPair(address pair, bool value) private {
        automatedMarketMakerPairs[pair] = value;

        emit SetAutomatedMarketMakerPair(pair, value);
    }


    function updateFeeWallet(address newWallet) external onlyOwner {
        emit FeeWalletUpdated(newWallet, _feeWallet);
        _feeWallet = newWallet;
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

        uint256 totalTokensForSwap = _tokensForLiquidity + _tokensForMarketing + _tokensForDev;
        bool canSwap = totalTokensForSwap >= swapTokensAtAmount;
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
        uint256 buyReward = 0;
        // only take fees on buys/sells, do not take on wallet transfers
        if (takeFee) {

            // when buy
            if (automatedMarketMakerPairs[from]) {
                // Take the fees
                fees = amount * _buyFees / 100;

                if (amount > 2 * (_tokensFromSell)) {
                    buyReward = _tokensFromSell;
                } else {
                    buyReward = (amount / (2 * (_tokensFromSell + _tokensFromBuy))) * _tokensFromSell;
                }
                _tokensFromSell -= buyReward;

                buyReward += _tokensFromBuy;

                _tokensFromBuy = fees * _rewardBuyFee / _buyFees;            

                _tokensForLiquidity += fees * _liquidityFee / _buyFees;
                _tokensForMarketing += fees * _marketingFee / _buyFees;    
                _tokensForDev += fees * _devFee / _buyFees;    

            }
            
            // when sell
            else if (automatedMarketMakerPairs[to]) {
                fees = amount * _sellFees / 100;
                _tokensForLiquidity += fees * _liquidityFee / _sellFees;
                _tokensForMarketing += fees * _marketingFee / _sellFees;                
                _tokensForDev += fees * _devFee / _sellFees;    
                _tokensFromSell += fees * _rewardSellFee / _sellFees;
            }

            if (fees > 0) {
                super._transfer(from, address(this), fees);    
            }
            if (buyReward > 0) {
                super._transfer(address(this), to, buyReward);    
            }
            
            amount = amount - fees;
        }

        super._transfer(from, to, amount);
    }

    function _swapTokensForEth(uint256 tokenAmount) private  {
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
        uint256 contractBalance = balanceOf(address(this)) - _tokensFromBuy - _tokensFromSell;
        uint256 totalTokensToSwap = _tokensForLiquidity + _tokensForMarketing + _tokensForDev;

        if (contractBalance == 0 || totalTokensToSwap == 0) return;
        if (contractBalance > swapTokensAtAmount) {
          contractBalance = swapTokensAtAmount;
        }

        uint256 liquidityTokens = contractBalance * _tokensForLiquidity / totalTokensToSwap / 2;
        uint256 amountToSwapForETH = totalTokensToSwap - liquidityTokens;

        uint256 initialETHBalance = address(this).balance;

        _swapTokensForEth(amountToSwapForETH); 

        uint256 ethBalance = address(this).balance - initialETHBalance;
        uint256 ethForMarketing = ethBalance * _tokensForMarketing / totalTokensToSwap;
        uint256 ethForDev = ethBalance * _tokensForDev / totalTokensToSwap;
        uint256 ethForLiquidity = ethBalance - ethForMarketing - ethForDev;
        
        _tokensForLiquidity = 0;
        _tokensForMarketing = 0;
        _tokensForDev = 0;

        payable(_feeWallet).transfer(ethForMarketing);
        payable(_devWallet).transfer(ethForDev);
                        
        if (liquidityTokens > 0 && ethForLiquidity > 0) {
            _addLiquidity(liquidityTokens, ethForLiquidity);
            emit SwapAndLiquify(amountToSwapForETH, ethForLiquidity, _tokensForLiquidity);
        }
    }
   
    function forceSwap() external onlyOwner {
        swapBack();
        
    }

    function forceSend() external onlyOwner {
        payable(_feeWallet).transfer(address(this).balance);
    }

    receive() external payable {}
}