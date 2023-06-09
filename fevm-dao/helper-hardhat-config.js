const { ethers } = require("hardhat")

const networkConfig = {
    314159: {
        name: "Calibration",
    },
    314: {
        name: "FilecoinMainnet",
    },
}

const extraParamsV1 = [
    //location_ref
    "https://data-depot.lighthouse.storage/api/download/download_car?fileId=65e0bdfa-5fd3-4de7-ade1-045a8c7b353c.car",
    //car_size
    1439273,
    // skip_ipni_announce
    "true",
    // remove_unsealed_copy
    "false",
]

const DealRequestStruct = [
    //piece_cid
    "0x000181e20392202007554549d24e42b38403cbd9d30d30299010c75e8473c4a131c6fa5b04267220",
    //piece_size;
    2097152,
    // verified_deal;
    false,
    // label
    "bafybeicxcclvlid2ocrksh52lub3ny6vd3muic5etjppd2r7g6pcfdxufm",
    //start_epoch
    270000,
    //end_epoch
    700000,
    //storage_price_per_epoch
    0,
    // provider_collateral
    0,
    // client_collateral
    0,
    //extra_params_version
    1,
    extraParamsV1,
]

const proposalsFile = "proposals.json"

const PROPOSAL_DESCRIPTION = "Proposal #1 Store ATTAK_CAT!"

module.exports = {
    networkConfig,
    DealRequestStruct,
    proposalsFile,
    PROPOSAL_DESCRIPTION,
}
