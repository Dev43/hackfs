import { createSocketConnection, EVENTS } from "@pushprotocol/socket";
import * as PushAPI from "@pushprotocol/restapi";
import { ethers } from "ethers";
import { Framework } from "@superfluid-finance/sdk-core";
import { Configuration, OpenAIApi } from "openai";
import "dotenv/config";
import { fileTypeFromBuffer } from "file-type";
import { spawn } from "child_process";

let ENV = {
  PROD: "prod",
  STAGING: "staging",
  DEV: "dev",
};

const erc20_abi = [
  // Read-Only Functions
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  // Authenticated Functions
  "function transfer(address to, uint amount) returns (bool)",
  // Events
  "event Transfer(address indexed from, address indexed to, uint amount)",
];

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
const wallet = new ethers.Wallet(PK, provider);

const preProcessRawMessage = async (robot, message) => {
  console.log(message);
  if (message.envType == "PlainText") {
    return message.messageContent;
  } else {
    // need to decrypt the encryptedPvtKey to pass in the api using helper function
    const pgpDecryptedPvtKey = await PushAPI.chat.decryptPGPKey({
      env: ENV.DEV,
      encryptedPGPPrivateKey: robot.encryptedPrivateKey,
      signer: _signer,
    });

    // actual api
    const decryptedChat = await PushAPI.chat.decryptConversation({
      env: ENV.DEV,
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
      env: ENV.DEV,
    });

    // need to decrypt the encryptedPvtKey to pass in the api using helper function
    const pgpDecrpyptedPvtKey = await PushAPI.chat.decryptPGPKey({
      encryptedPGPPrivateKey: robot.encryptedPrivateKey,
      signer: _signer,
    });

    // Actual api
    const requests = await PushAPI.chat.requests({
      account: `eip155:${process.env.ROBOT_ADDRESS}`,
      toDecrypt: true,
      pgpPrivateKey: pgpDecrpyptedPvtKey,
      env: ENV.DEV,
    });
    for (const req of requests) {
      console.log(req);
      // automatic approval of requests
      // this one is from a user
      if (req.did) {
        await PushAPI.chat.approve({
          env: ENV.DEV,
          status: "Approved",
          account: `eip155:${process.env.ROBOT_ADDRESS}`,
          senderAddress: req.wallets, // receiver's address or chatId of a group
          signer: _signer,
          pgpPrivateKey: pgpDecrpyptedPvtKey,
        });
      } else {
        // if it's a group for a DataDAO - then we deploy the contracts
        let isDataDao =
          req.groupInformation.groupDescription.includes("DataDao");
        if (isDataDao) {
          // get all the admin members in the members object
          let memberList = req.groupInformation?.members;
          let pendingMembers = req.groupInformation?.pendingMembers;
          memberList.push(pendingMembers);

          const memberWalletList = memberList.map((member) => member.wallet);

          try {
            await deployDataDao(
              req.chatId,
              memberWalletList,
              pgpDecrpyptedPvtKey
            );
            // this one is from a group
            await PushAPI.chat.approve({
              env: ENV.DEV,
              status: "Approved",
              account: `eip155:${process.env.ROBOT_ADDRESS}`,
              senderAddress: req.chatId, // receiver's address or chatId of a group
              signer: _signer,
              pgpPrivateKey: pgpDecrpyptedPvtKey,
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
  const { createHelia } = await import("helia");
  const { unixfs } = await import("@helia/unixfs");
  const helia = await createHelia();
  const fs = unixfs(helia);

  const superfluid = await Framework.create({
    chainId: 5, //your chainId here
    provider,
  });

  // const superfluidSigner = superfluid.createSigner({ signer: wallet });

  const robot = await PushAPI.user.get({
    account: `eip155:${process.env.ROBOT_ADDRESS}`,
    env: ENV.DEV,
  });
  const pushSDKSocket = createSocketConnection({
    user: `eip155:${process.env.ROBOT_ADDRESS}`, // Not CAIP-10 format
    env: ENV.DEV,
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
      env: ENV.DEV,
    });

    if (message.includes("/huddle")) {
      console.log("huddle!");
    } else if (message.includes("/gpt")) {
      if (!(await isPaying(userDID.split("eip155:")[1]))) {
        console.error("user is not paying");

        await sendMessage(
          "Please subscribe with some Apecoin",
          "Text",
          userDID,
          pgpDecryptedPvtKey
        );

        await sendMessage(subButton, "Text", userDID, pgpDecryptedPvtKey);

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

      await sendMessage(aiMsg, "Text", userDID, pgpDecryptedPvtKey);
    } else if (message.includes("/subscribe")) {
      try {
        let message = "You have already subscribed!";
        // TODO add validation if they are already subscribed
        if (!(await isPaying(userDID.split("eip155:")[1]))) {
          message = subButton;
        }

        await sendMessage(message, "Text", userDID, pgpDecryptedPvtKey);
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
      console.log(mimeType);
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
        userDID,
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
        userDID,
        pgpDecryptedPvtKey
      );
    } else if (message.includes("/fvm-create-new-group")) {
      let members = message
        .replace("/fvm-create-new-group", "")
        .trim()
        .split(",");
      const response = await PushAPI.chat.createGroup({
        ENV: ENV.DEV,
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
      let req = await PushAPI.chat.getGroup({
        env: ENV.DEV,
        chatId: chatID,
      });

      let memberList = req.members;
      let pendingMembers = req.pendingMembers;
      memberList.push(pendingMembers);

      const memberWalletList = memberList.map((member) => member.wallet);

      await deployDataDao(chatID, memberWalletList, pgpDecryptedPvtKey);
    } else if (message.includes("/fvm-delegate-votes")) {
      // delegate to themselves
      // send back button so they can delegate to themselves
    } else if (message.includes("/fvm-propose")) {
      let proposal = message.replace("/fvm-propose", "").trim();

      // propose a file to store
    } else if (message.includes("/fvm-vote")) {
      let vote = message.replace("/fvm-propose", "").trim();
      // vote on the proposal
    } else if (message.includes("/fvm-execute")) {
    } else if (message.includes("/ ")) {
    } else {
    }
  };

  const sendMessage = async (message, type, toDID, pgpDecryptedPvtKey) => {
    return await PushAPI.chat.send({
      env: ENV.DEV,
      messageContent: message,
      messageType: type, // can be "Text" | "Image" | "File" | "GIF"
      receiverAddress: toDID,
      signer: _signer,
      pgpPrivateKey: pgpDecryptedPvtKey,
    });
  };
};
const deployDataDao = async (chatID, memberWalletList, pgpDecryptedPvtKey) => {
  const command = spawn("yarn", ["hardhat", "deploy"], {
    cwd: "../fevm-dao",
  });
  command.stdout.on("data", async (chunk) => {
    console.log(`stdout: ${chunk}`);
    let data = chunk.toString();
    if (data.includes("!Success!")) {
      let d = data.split("!Success!")[1];
      let deployed = JSON.parse(d);
      console.log(deployed);
      console.log("chatID:", chatID);

      let tokenAddress = deployed.dataGovernanceToken;
      let membersOtherThanRobot = memberWalletList.filter(
        (x) => x !== "eip155:" + process.env.ROBOT_ADDRESS
      );

      const erc20_rw = new ethers.Contract(tokenAddress, erc20_abi, _signer);

      for (members of membersOtherThanRobot) {
        // 10 each
        await erc20_rw.transfer(member, "10000000000000000000");
      }

      let req = await PushAPI.chat.getGroup({
        env: ENV.DEV,
        chatId: chatID,
      });

      const response = await PushAPI.chat.updateGroup({
        env: ENV.DEV,
        chatId: chatID,
        groupName: req.groupName,
        groupDescription: d,
        members: req.members,
        groupImage: req.groupImage,
        admins: req.admins,
        account: process.env.ROBOT_ADDRESS,
        pgpPrivateKey: pgpDecryptedPvtKey, //decrypted private key
      });
      console.log(response);

      await PushAPI.chat.send({
        env: ENV.DEV,
        messageContent:
          "Successfully deployed! Each of you have 10 shares. Please delegate your share before you vote.",
        messageType: "Text", // can be "Text" | "Image" | "File" | "GIF"
        receiverAddress: chatID,
        signer: _signer,
        pgpPrivateKey: pgpDecryptedPvtKey,
      });
      await PushAPI.chat.send({
        env: ENV.DEV,
        messageContent: d,
        messageType: "Text", // can be "Text" | "Image" | "File" | "GIF"
        receiverAddress: chatID,
        signer: _signer,
        pgpPrivateKey: pgpDecryptedPvtKey,
      });
    }
  });

  command.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  command.on("close", (code) => {
    console.log(`child process exited with code ${code}`);
  });
  // deploy the datadao from the beginning (run hardhat?)
};

beginSocket().catch(console.error);

// /ipfs-get QmSxQCdduj4C9amh4p1GgnYFDthwQM9kcCx5N4PqMw7qAq

// create button on frontend to create a DataDAO group
// the backend finds the group and sets up a brand new DATADAO with the members of the group, all the while it is updating what is happening
// then take care of all of the things in the backend
