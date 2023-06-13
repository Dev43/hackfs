import { createSocketConnection, EVENTS } from "@pushprotocol/socket";
import * as PushAPI from "@pushprotocol/restapi";
import { ethers } from "ethers";
import { Framework } from "@superfluid-finance/sdk-core";
import { Configuration, OpenAIApi } from "openai";
import "dotenv/config";
import { fileTypeFromBuffer } from "file-type";
import { exec, spawn } from "child_process";
import { promises } from "node:fs";

const erc20_abi = [
  // Read-Only Functions
  "function balanceOf(address owner) view returns (uint256)",
  // Authenticated Functions
  "function transfer(address to, uint amount) returns (bool)",
];

let dealABI = JSON.parse((await promises.readFile("deal_abi.json")).toString());
let governorABI = JSON.parse(
  (await promises.readFile("governor_abi.json")).toString()
);

const configuration = new Configuration({
  apiKey: process.env.OPENAI_KEY,
});
const openai = new OpenAIApi(configuration);

// init user
const PK = process.env.ROBOT_PRIVATE_KEY;
const Pkey = `0x${PK}`;
const _signer = new ethers.Wallet(Pkey);

const provider = new ethers.providers.InfuraProvider(
  "goerli",
  "cd9284d8201641c5a4cfe394661641e2"
);

const filprovider = new ethers.providers.JsonRpcProvider(
  "https://api.calibration.node.glif.io/rpc/v1"
);
const filWallet = new ethers.Wallet(PK, filprovider);

const preProcessRawMessage = async (robot, message) => {
  if (message.envType == "PlainText") {
    return message.messageContent;
  } else {
    // need to decrypt the encryptedPvtKey to pass in the api using helper function
    const pgpDecryptedPvtKey = await PushAPI.chat.decryptPGPKey({
      env: process.env.ENV,
      encryptedPGPPrivateKey: robot.encryptedPrivateKey,
      signer: _signer,
    });

    // actual api
    const decryptedChat = await PushAPI.chat.decryptConversation({
      env: process.env.ENV,
      messages: [message], // array of message object fetched from chat.history method
      connectedUser: robot, // user meta data object fetched from chat.get method
      pgpPrivateKey: pgpDecryptedPvtKey, //decrypted private key
    });

    return {
      message: decryptedChat[0].messageContent,
      userDID: decryptedChat[0].fromDID,
      chatID: decryptedChat[0].chatId,
    };
  }
};
const createInterval = () =>
  setInterval(async () => {
    // pre-requisite API calls that should be made before
    // need to get user and through it, the encryptedPvtKey of the user
    const robot = await PushAPI.user.get({
      account: `eip155:${process.env.ROBOT_ADDRESS}`,
      env: process.env.ENV,
    });

    // need to decrypt the encryptedPvtKey to pass in the api using helper function
    const pgpDecryptedPvtKey = await PushAPI.chat.decryptPGPKey({
      encryptedPGPPrivateKey: robot.encryptedPrivateKey,
      signer: _signer,
    });

    // Actual api
    const requests = await PushAPI.chat.requests({
      account: `eip155:${process.env.ROBOT_ADDRESS}`,
      toDecrypt: true,
      pgpPrivateKey: pgpDecryptedPvtKey,
      env: process.env.ENV,
    });
    for (const req of requests) {
      console.log(req);
      // automatic approval of requests
      // this one is from a user
      if (req.did) {
        await PushAPI.chat.approve({
          env: process.env.ENV,
          status: "Approved",
          account: `eip155:${process.env.ROBOT_ADDRESS}`,
          senderAddress: req.wallets, // receiver's address or chatId of a group
          signer: _signer,
          pgpPrivateKey: pgpDecryptedPvtKey,
        });
      } else {
        // if it's a group for a DataDAO - then we deploy the contracts
        let isDataDao =
          req.groupInformation.groupDescription.includes("DataDao");
        if (isDataDao) {
          try {
            await deployDataDao(req.chatId, pgpDecryptedPvtKey);
            // this one is from a group
            await PushAPI.chat.approve({
              env: process.env.ENV,
              status: "Approved",
              account: `eip155:${process.env.ROBOT_ADDRESS}`,
              senderAddress: req.chatId, // receiver's address or chatId of a group
              signer: _signer,
              pgpPrivateKey: pgpDecryptedPvtKey,
            });
          } catch (e) {
            console.log(e);
          }
        }
      }
    }
  }, 10000);

// create the socket
export const beginSocket = async () => {
  try {
    await promises.readFile("storage.json");
  } catch (e) {
    await promises.writeFile("storage.json", "{}");
  }
  const { createHelia } = await import("helia");
  const { unixfs } = await import("@helia/unixfs");
  const helia = await createHelia();
  const fs = unixfs(helia);

  const superfluid = await Framework.create({
    chainId: 5, //your chainId here
    provider,
  });

  const getStorage = async () => {
    return JSON.parse((await promises.readFile("storage.json")).toString());
  };
  const saveToStorage = async (storage) => {
    return await promises.writeFile("storage.json", JSON.stringify(storage));
  };
  // const superfluidSigner = superfluid.createSigner({ signer: wallet });

  const robot = await PushAPI.user.get({
    account: `eip155:${process.env.ROBOT_ADDRESS}`,
    env: process.env.ENV,
  });
  const pushSDKSocket = createSocketConnection({
    user: `eip155:${process.env.ROBOT_ADDRESS}`, // Not CAIP-10 format
    env: process.env.ENV,
    socketType: "chat",
    socketOptions: { autoConnect: true, reconnectionAttempts: 3 },
  });

  // runs every 10 seconds
  const interval = createInterval();

  pushSDKSocket?.on(EVENTS.CONNECT, () => {
    console.log("connected");
  });
  pushSDKSocket?.on(EVENTS.DISCONNECT, (err) => {
    console.log(err);
    clearInterval(interval);
  });
  pushSDKSocket?.on(EVENTS.CHAT_RECEIVED_MESSAGE, async (message) => {
    const {
      message: msg,
      userDID: userDID,
      chatID: chatID,
    } = await preProcessRawMessage(robot, message);
    handleMessage(robot, msg, userDID, chatID);
  });
  pushSDKSocket?.on(EVENTS.USER_FEEDS, (message) => {
    console.log("feeds received");
    console.log(message);
  });
  pushSDKSocket?.on(EVENTS.USER_FEEDS, (notification) => {
    console.log("notif received");

    console.log(notification);
  });
  pushSDKSocket?.on(EVENTS.USER_SPAM_FEEDS, (spam) => {
    console.log("spam received");
    console.log(spam);
  });

  const isPaying = async (sender) => {
    // mock apecoin
    const apecoinx = await superfluid.loadSuperToken(
      "0xe9f58b518a44ea51f822223f1025dd999c25f63a"
    );
    const flowInfo = await apecoinx.getFlow({
      sender: sender,
      receiver: process.env.ROBOT_ADDRESS,
      providerOrSigner: provider,
    });
    console.log(flowInfo);
    if (flowInfo.flowRate != "0") {
      return true;
    }
    return false;
  };
  const subButton = `<html><button onclick="let a = async()=>{console.log('loaded');console.log(window.superfluid);let apecoinx = await window.superfluid.loadSuperToken('0xe9f58b518a44ea51f822223f1025dd999c25f63a');const createFlowOperation = apecoinx.createFlow({sender: window.account,receiver: '0x99B9D3918C5e3b40df944e243335A52ecc8F49F5',flowRate: '1000000000',});const txnResponse = await createFlowOperation.exec(window.superfluidSigner);const txnReceipt = await txnResponse.wait();}; a().catch(console.error);">Click me to Subscribe</button></html>`;

  const handleMessage = async (user, message, userDID, chatID) => {
    const pgpDecryptedPvtKey = await PushAPI.chat.decryptPGPKey({
      encryptedPGPPrivateKey: user.encryptedPrivateKey,
      signer: _signer,
      env: process.env.ENV,
    });
    if (message.includes("/huddle")) {
      console.log("huddle!");
    } else if (message.includes("/gpt")) {
      if (!(await isPaying(userDID.split("eip155:")[1]))) {
        console.error("user is not paying");

        await sendMessage(
          "Please subscribe with some Apecoin",
          "Text",
          chatID || userDID,
          pgpDecryptedPvtKey
        );

        await sendMessage(
          subButton,
          "Text",
          chatID || userDID,
          pgpDecryptedPvtKey
        );

        return;
      }

      const completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: message.replace("/gpt", "") }],
      });
      console.log(completion.data.choices[0].message);
      let aiMsg = "";
      if (completion.data.choices.length > 0) {
        aiMsg = completion.data.choices[0].message?.content || "";
      }

      await sendMessage(aiMsg, "Text", chatID || userDID, pgpDecryptedPvtKey);
    } else if (message.includes("/subscribe")) {
      try {
        let message = "You have already subscribed!";
        // TODO add validation if they are already subscribed
        if (!(await isPaying(userDID.split("eip155:")[1]))) {
          message = subButton;
        }

        await sendMessage(
          message,
          "Text",
          chatID || userDID,
          pgpDecryptedPvtKey
        );
      } catch (err) {
        console.error(err);
      }
    } else if (message.includes("/ipfs-get")) {
      let ipfsCID = message.replace("/ipfs-get", "").trim();
      console.log("Fetching", ipfsCID, " on IPFS");

      let fileContent = [];

      for await (const chunk of fs.cat(ipfsCID)) {
        Uint8Array.from(chunk).forEach((byte) => fileContent.push(byte));
      }
      let buffer = Buffer.from(fileContent);
      let mimeType = await fileTypeFromBuffer(buffer);
      let f = buffer.toString("base64");
      let file = {
        name: ipfsCID,
        size: f.length,
        type: mimeType.mime,
        content: f,
      };

      console.log("Fetched, sending chat msg");
      await sendMessage(
        JSON.stringify(file),
        "File",
        chatID || userDID,
        pgpDecryptedPvtKey
      );
    } else if (message.includes("/ipfs-push")) {
      // we will use this TextEncoder to turn strings into Uint8Arrays
      const encoder = new TextEncoder();
      // add the bytes to your node and receive a unique content identifier
      const cid = await fs.addBytes(encoder.encode(message), {
        onProgress: (evt) => {
          // console.info("add event", evt.type, evt.detail);
        },
      });

      console.log("Added file:", cid.toString());
      await sendMessage(
        `IPFS CID: ` + cid.toString(),
        "Text",
        chatID || userDID,
        pgpDecryptedPvtKey
      );
    } else if (message.includes("/fvm-create-new-group")) {
      let members = message
        .replace("/fvm-create-new-group", "")
        .trim()
        .split(",");
      const response = await PushAPI.chat.createGroup({
        ENV: process.env.ENV,
        groupName: "FVM DataDao " + Math.floor(Math.random() * 1000),
        groupDescription: "FVM Datadao control group",
        members: members,
        groupImage:
          "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTOh2vDVjgzS36O9asolblqTVhCzchTP6yKhg&usqp=CAU",
        admins: [process.env.ROBOT_ADDRESS],
        isPublic: true,
        account: process.env.ROBOT_ADDRESS,
        pgpPrivateKey: pgpDecryptedPvtKey, //decrypted private key
      });
    } else if (message.includes("/fvm-redeploy")) {
      await deployDataDao(chatID, pgpDecryptedPvtKey);
    } else if (message.includes("/fvm-delegate-votes")) {
      // delegate to themselves
      // send back button so they can delegate to themselves
      let address = userDID.split("eip155:")[1];
      let storage = await getStorage();
      let tokenAddress = storage[chatID].info.dataGovernanceToken;
      const delegateButton = `<html><button onclick="let a = async()=>{console.log('loaded1');await window.ethereum.request({method: 'wallet_switchEthereumChain',params: [{ chainId: '0x4CB2F' }]}); app_abi = ['function delegate(address delegatee)']; let ct = new window.ethers.Contract('${tokenAddress}', app_abi,window.myWeb3Provider.getSigner()); await ct.delegate('${address}'); await window.ethereum.request({method: 'wallet_switchEthereumChain',params: [{ chainId: '0x5' }]})}; a().catch(console.error);">Click me to delegate</button></html>`;
      await sendMessage(
        delegateButton,
        "Text",
        chatID || userDID,
        pgpDecryptedPvtKey
      );

      // fvm propose needs to send the proposal piece cid
      // /fvm-propose <piece_cid>,<piece_size>,<piece_label>,<location_ref>,<car_size>,<proposal_description>
    } else if (message.includes("/fvm-propose")) {
      let proposal = message.replace("/fvm-propose", "").trim().split(",");
      let pieceCID = proposal[0];
      let pieceSize = proposal[1];
      let pieceLabel = proposal[2];
      let locationRef = proposal[3];
      let carSize = proposal[4];
      let proposalDescription = proposal[5];
      let storage = await getStorage();
      let s = storage[chatID];
      let dealAddress = s.info.daoDeal;
      let governorAddress = s.info.governor;
      const daoDealClient = new ethers.Contract(
        dealAddress,
        dealABI,
        filWallet
      );
      const governor = new ethers.Contract(
        governorAddress,
        governorABI,
        filWallet
      );
      try {
        const functionToCall = "makeDealProposal";
        let DealRequestStruct = [
          [
            //piece_cid
            pieceCID,
            //piece_size;
            pieceSize,
            // verified_deal;
            false,
            // label
            pieceLabel,
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
            [
              //location_ref
              locationRef,
              //car_size
              carSize,
              // skip_ipni_announce
              "true",
              // remove_unsealed_copy
              "false",
            ],
          ],
        ];
        const encodedFunctionCall = daoDealClient.interface.encodeFunctionData(
          functionToCall,
          DealRequestStruct
        );

        try {
          await sendMessage(
            `Proposing ${functionToCall} on ${daoDealClient.address} with ${DealRequestStruct}`,
            "Text",
            chatID || userDID,
            pgpDecryptedPvtKey
          );
        } catch (e) {
          console.error(e);
        }
        const proposeTx = await governor.propose(
          [daoDealClient.address],
          [0],
          [encodedFunctionCall],
          proposalDescription
        );

        const proposeReceipt = await proposeTx.wait();
        const proposalId = proposeReceipt.events[0].args.proposalId;
        let txt = `Proposed with proposal ID: ${proposalId}`;
        console.log(txt);
        let proposals = storage[chatID].proposals || {};
        proposals[proposalId] = {
          dealStruct: DealRequestStruct,
          targets: [daoDealClient.address],
          values: [0],
          encodedFunctionCall: [encodedFunctionCall],
          proposalDescription: proposalDescription,
          proposalDescriptionHash: ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(proposalDescription)
          ),
        };
        storage[chatID].proposals = proposals;
        await saveToStorage(storage);
        await sendMessage(txt, "Text", chatID || userDID, pgpDecryptedPvtKey);
      } catch (e) {
        console.error(e);
        await sendMessage(
          "Error creating the proposal\n\n: " + e,
          "Text",
          chatID || userDID,
          pgpDecryptedPvtKey
        );
      }

      // propose a file to store
      // to vote the user needs to send /fvm-vote <proposalID>
    } else if (message.includes("/fvm-vote")) {
      let proposalId = message.replace("/fvm-vote", "").trim();

      if (!proposalId) {
        await sendMessage(
          "Proposal ID is missing",
          "Text",
          chatID || userDID,
          pgpDecryptedPvtKey
        );
        return;
      }

      let storage = await getStorage();
      let s = storage[chatID];
      let governorAddress = s.info.governor;
      let buttons = `<html><button onclick="let a = async()=>{console.log('loaded2');await window.ethereum.request({method: 'wallet_switchEthereumChain',params: [{ chainId: '0x4CB2F' }]}); app_abi = ['function castVoteWithReason(uint256 proposalId,uint8 support,string calldata reason)  returns (uint256)']; let ct = new window.ethers.Contract('${governorAddress}', app_abi,window.myWeb3Provider.getSigner()); await ct.castVoteWithReason('${proposalId}', 1, ''); await window.ethereum.request({method: 'wallet_switchEthereumChain',params: [{ chainId: '0x5' }]})}; a().catch(console.error);">Yes</button><button onclick="let a = async()=>{console.log('loaded2');await window.ethereum.request({method: 'wallet_switchEthereumChain',params: [{ chainId: '0x4CB2F' }]}); app_abi = ['function castVoteWithReason(uint256 proposalId,uint8 support,string calldata reason)  returns (uint256)']; let ct = new window.ethers.Contract('${governorAddress}', app_abi,window.myWeb3Provider.getSigner()); await ct.castVoteWithReason('${proposalId}', 0, ''); await window.ethereum.request({method: 'wallet_switchEthereumChain',params: [{ chainId: '0x5' }]})}; a().catch(console.error);">No</button><button onclick="let a = async()=>{console.log('loaded2');await window.ethereum.request({method: 'wallet_switchEthereumChain',params: [{ chainId: '0x4CB2F' }]}); app_abi = ['function castVoteWithReason(uint256 proposalId,uint8 support,string calldata reason)  returns (uint256)']; let ct = new window.ethers.Contract('${governorAddress}', app_abi,window.myWeb3Provider.getSigner()); await ct.castVoteWithReason('${proposalId}', 2, ''); await window.ethereum.request({method: 'wallet_switchEthereumChain',params: [{ chainId: '0x5' }]})}; a().catch(console.error);">Abstain</button></html>`;
      // we need to send back 3 buttons, yes, no or abstain
      await sendMessage(buttons, "Text", chatID || userDID, pgpDecryptedPvtKey);
      //execute a proposal
      // to execute the user needs to send /fvm-execute <proposalID>
    } else if (message.includes("/fvm-execute")) {
      let proposalId = message.replace("/fvm-execute", "").trim();

      let storage = await getStorage();
      let s = storage[chatID];
      let governorAddress = s.info.governor;
      let proposal = s.proposals[proposalId];
      await sendMessage(
        "Queuing proposal with ID " + proposalId,
        "Text",
        chatID || userDID,
        pgpDecryptedPvtKey
      );
      try {
        const governor = new ethers.Contract(
          governorAddress,
          governorABI,
          filWallet
        );
        const queueTx = await governor.queue(
          proposal.targets,
          proposal.values,
          proposal.encodedFunctionCall,
          proposal.proposalDescriptionHash
        );
        console.log("Queued tx ID", queueTx.hash);
        await queueTx.wait(1);

        await sendMessage(
          "Queueing done, executing proposal with ID " + proposalId,
          "Text",
          chatID || userDID,
          pgpDecryptedPvtKey
        );
        const executeTx = await governor.execute(
          proposal.targets,
          proposal.values,
          proposal.encodedFunctionCall,
          proposal.proposalDescriptionHash
        );
        console.log("Execute tx ID", executeTx.hash);
        await executeTx.wait();
        await sendMessage(
          "Proposal" + proposalId + " successfully executed!",
          "Text",
          chatID || userDID,
          pgpDecryptedPvtKey
        );
      } catch (e) {
        console.error(e);
        await sendMessage(
          "Queueing and executing failed for proposal " + proposalId,
          "Text",
          chatID || userDID,
          pgpDecryptedPvtKey
        );
      }
    } else if (message.includes("/bacalhau-sd")) {
      let prompt = message.replace("/bacalhau-sd", "").trim();

      const command = spawn(
        "bacalhau",
        [
          "docker",
          "run",
          "--id-only",
          "--gpu",
          "1",
          "ghcr.io/bacalhau-project/examples/stable-diffusion-gpu:0.0.1",
          "--",
          "python",
          "main.py",
          "--o",
          "./outputs",
          "--p",
          prompt,
        ],
        {}
      );
      command.stdout.on("data", async (chunk) => {
        let data = chunk.toString().trim();
        console.log("Bacalhau-sd:", data);
        await sendMessage(
          "You request was received and sent to the Bacalhau network, please wait a few minutes and then call `/bacalhau-get " +
            data +
            "`",
          "Text",
          chatID || userDID,
          pgpDecryptedPvtKey
        );
      });

      command.stderr.on("data", (data) => {
        console.error(`bacalhau-sd stderr: ${data}`);
      });

      command.on("close", (code) => {
        console.log(`bacalhau-sd process exited with code ${code}`);
      });
      ///////////////////////////////////////////////////////
    } else if (message.includes("/bacalhau-get")) {
      let jobID = message.replace("/bacalhau-get", "").trim();
      let mainDir = "job-" + jobID.split("-")[0];

      exec("rm -rf " + mainDir, {}, () => {});

      const command = spawn("bacalhau", ["get", jobID], {});
      command.stdout.on("data", async (chunk) => {
        let data = chunk.toString().trim();
        console.log("Bacalhau-get:", data);
      });

      command.stderr.on("data", (data) => {
        console.error(`bacalhau-get stderr: ${data}`);
      });

      command.on("close", async (code) => {
        console.log(`bacalhau-sd process exited with code ${code}`);
        if (code == 0) {
          let dir = mainDir + "/outputs";
          const files = await promises.readdir(dir);
          console.log(files);
          for (const fileName of files) {
            let buffer = await promises.readFile(dir + "/" + fileName);

            let mimeType = await fileTypeFromBuffer(buffer);
            let f = buffer.toString("base64");
            let file = {
              name: "image0.png",
              size: f.length,
              type: mimeType.mime,
              content: f,
            };
            console.log("Fetched, sending bacalhau response");
            await sendMessage(
              JSON.stringify(file),
              "Image",
              chatID || userDID,
              pgpDecryptedPvtKey
            );

            exec("rm -rf " + mainDir, {}, () => {});
          }
        }
      });
    }
  };

  const sendMessage = async (message, type, toDID, pgpDecryptedPvtKey) => {
    return await PushAPI.chat.send({
      env: process.env.ENV,
      messageContent: message,
      messageType: type, // can be "Text" | "Image" | "File" | "GIF"
      receiverAddress: toDID,
      // account: "eip155:" + process.env.ROBOT_ADDRESS,
      signer: _signer,
      pgpPrivateKey: pgpDecryptedPvtKey,
    });
  };
};

const deployDataDao = async (chatID, pgpDecryptedPvtKey) => {
  // we clear the last deployment
  exec(
    "rm -rf deployments",
    {
      cwd: "../fevm-dao",
    },
    () => {}
  );
  const command = spawn("yarn", ["hardhat", "deploy"], {
    cwd: "../fevm-dao",
  });
  command.stdout.on("data", async (chunk) => {
    let data = chunk.toString();
    console.log("Deploy:", data);
    // we send a message whenever a new COMM: event comes through
    if (data.includes("COMM:")) {
      let msg = data.split("COMM:")[1];
      try {
        await PushAPI.chat.send({
          env: process.env.ENV,
          messageContent: msg,
          messageType: "Text", // can be "Text" | "Image" | "File" | "GIF"
          receiverAddress: chatID,
          signer: _signer,
          pgpPrivateKey: pgpDecryptedPvtKey,
        });
      } catch (e) {
        console.error(e);
      }
    }

    if (data.includes("!Success!")) {
      let d = data.split("!Success!")[1];
      let deployed = JSON.parse(d);
      console.log(deployed);

      let governanceAddress = deployed.governor;
      let dealDaoAddress = deployed.daoDeal;
      let tokenAddress = deployed.dataGovernanceToken;
      let timeLock = deployed.timeLock;

      let req = await PushAPI.chat.getGroup({
        env: process.env.ENV,
        chatId: chatID,
      });

      let memberList = req.members.map((member) => member.wallet);
      let pendingList = req.pendingMembers.map((member) => member.wallet);
      memberList.push(...pendingList);

      let membersOtherThanRobot = memberList.filter(
        (x) => x !== "eip155:" + process.env.ROBOT_ADDRESS
      );

      const erc20_rw = new ethers.Contract(tokenAddress, erc20_abi, filWallet);

      for (const member of membersOtherThanRobot) {
        // 10 each
        console.log("sending tokens to ", member);
        let address = member.split("eip155:")[1];
        let tx = await erc20_rw.transfer(address, "10000000000000000000");
        await tx.wait();
      }

      await PushAPI.chat.send({
        env: process.env.ENV,
        messageContent:
          "Successfully deployed! Each of you have 10 shares. Please delegate your share before you vote.",
        messageType: "Text", // can be "Text" | "Image" | "File" | "GIF"
        receiverAddress: chatID,
        signer: _signer,
        pgpPrivateKey: pgpDecryptedPvtKey,
      });
      await PushAPI.chat.send({
        env: process.env.ENV,
        messageContent: d,
        messageType: "Text", // can be "Text" | "Image" | "File" | "GIF"
        receiverAddress: chatID,
        signer: _signer,
        pgpPrivateKey: pgpDecryptedPvtKey,
      });

      let storage = await JSON.parse(
        (await promises.readFile("storage.json")).toString()
      );
      storage[chatID] = { info: deployed };

      await promises.writeFile("storage.json", JSON.stringify(storage));
    }
  });

  command.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  command.on("close", (code) => {
    console.log(`child process exited with code ${code}`);
  });
};

beginSocket().catch(console.error);
