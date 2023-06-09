require("hardhat-deploy")
require("hardhat-deploy-ethers")

const private_key = network.config.accounts[0]
const wallet = new ethers.Wallet(private_key, ethers.provider)

module.exports = async ({ deployments }) => {
    const { deploy } = deployments
    console.log("COMM: Deploying TimeLock.sol")
    const timeLock = await deploy("TimeLock", {
        from: wallet.address,
        args: [0, [], [], wallet.address],
        log: true,
    })
    console.log("COMM: TimeLock.sol deployed")
}
