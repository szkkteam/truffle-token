type Network = "development" | "kovan" | "mainnet";
const { ether } = require('@openzeppelin/test-helpers');

module.exports = (artifacts: Truffle.Artifacts, web3: Web3) => {
    return async (
      deployer: Truffle.Deployer,
      network: Network,
      accounts: string[]
    ) => {
      const MockToken = artifacts.require("MockToken");
  
      await deployer.deploy(MockToken, ether('1000') );
  
      const mockToken = await MockToken.deployed();
      console.log(
        `MockToken deployed at ${mockToken.address} in network: ${network}.`
      );
    };
  };