type Network = "development" | "kovan" | "mainnet";
const { ether } = require('@openzeppelin/test-helpers');

module.exports = (artifacts: Truffle.Artifacts, web3: Web3) => {
    return async (
      deployer: Truffle.Deployer,
      network: Network,
      accounts: string[]
    ) => {
      const MagicToken = artifacts.require("MagicToken");
  
      await deployer.deploy(MagicToken);
  
      const magicToken = await MagicToken.deployed();
      console.log(
        `MagicToken deployed at ${magicToken.address} in network: ${network}.`
      );
    };
  };