const Token = artifacts.require("Token");

module.exports = async (deployer, network, [defaultAccount]) => {

    let routerAddr;
    if (network.startsWith('kovan')) {

      routerAddr = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    } else if (network.startsWith('development')) {

      routerAddr = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    }

    await deployer.deploy(Token, routerAddr);

    const token = await Token.deployed();
    console.log(
      `Token deployed at ${Token.address} in network: ${network}.`
    );
}
