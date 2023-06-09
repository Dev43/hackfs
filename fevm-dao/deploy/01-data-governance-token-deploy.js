require("hardhat-deploy")
require("hardhat-deploy-ethers")

const private_key = network.config.accounts[0]
const wallet = new ethers.Wallet(private_key, ethers.provider)

module.exports = async ({ deployments }) => {
    const { deploy } = deployments

    console.log("COMM: Beginning deployment of DataDao")

    console.log("COMM: Deploying DataGovernanceToken.sol")
    const dataGovernanceToken = await deploy("DataGovernanceToken", {
        from: wallet.address,
        args: [],
        log: true,
    })
    console.log("COMM: DataGovernanceToken.sol deployed")

    console.log("COMM: Delegating to deployer wallet")
    //Define function to delegate to deployer wallet
    const delegate = async (dataGovernanceTokenAddress, delegatedAccount) => {
        const dataGovernanceToken = await ethers.getContractAt(
            "DataGovernanceToken",
            dataGovernanceTokenAddress
        )
        delegateTx = await dataGovernanceToken.delegate(delegatedAccount)
        await delegateTx.wait()
        console.log(`Checkpoints ${await dataGovernanceToken.numCheckpoints(delegatedAccount)}`)
    }

    //Call delegate function below
    await delegate(dataGovernanceToken.address, wallet.address)
    console.log("COMM: Delegated to deployer wallet!")
}
