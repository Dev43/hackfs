require("hardhat-deploy")
require("hardhat-deploy-ethers")

const private_key = network.config.accounts[0]
const wallet = new ethers.Wallet(private_key, ethers.provider)

module.exports = async ({ deployments }) => {
    const { deploy, get } = deployments
    const timeLock = await get("TimeLock")

    const daoDealClient = await deploy("DaoDealClient", {
        from: wallet.address,
        args: [],
        log: true,
    })

    //Transfer Ownership to TimeLock.sol
    //Comment this out after deploying the first time
    console.log("COMM: Transferring DaoDealClient Owner to TimeLock.sol")
    const dealDaoClientContract = await ethers.getContractAt("DaoDealClient", daoDealClient.address)
    const transferOwnerTx = await dealDaoClientContract.transferOwnership(timeLock.address)
    await transferOwnerTx.wait()
    console.log("COMM: Ownership transferred!")
    const governor = await get("GovernorContract")
    const daoDeal = await get("DaoDealClient")
    const dataGovernanceToken = await get("DataGovernanceToken")

    console.log(
        "!Success! " +
            JSON.stringify({
                governor: governor.address,
                daoDeal: daoDeal.address,
                dataGovernanceToken: dataGovernanceToken.address,
                timeLock: timeLock.address,
            })
    )
}
