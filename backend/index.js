import { createSocketConnection, EVENTS } from "@pushprotocol/socket";
import * as PushAPI from "@pushprotocol/restapi";
import { ethers } from "ethers";
import { Framework } from "@superfluid-finance/sdk-core";
import { Configuration, OpenAIApi } from "openai";
import "dotenv/config";
import { fileTypeFromBuffer } from "file-type";

let ENV = {
  PROD: "prod",
  STAGING: "staging",
  DEV: "dev",
};

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
    };
  }
};
const createInterval = () =>
  setInterval(async () => {
    // pre-requisite API calls that should be made before
    // need to get user and through it, the encryptedPvtKey of the user
    const user = await PushAPI.user.get({
      account: `eip155:${process.env.ROBOT_ADDRESS}`,
      env: ENV.DEV,
    });

    // need to decrypt the encryptedPvtKey to pass in the api using helper function
    const pgpDecrpyptedPvtKey = await PushAPI.chat.decryptPGPKey({
      encryptedPGPPrivateKey: user.encryptedPrivateKey,
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
        // this one is from a group
        await PushAPI.chat.approve({
          env: ENV.DEV,
          status: "Approved",
          account: `eip155:${process.env.ROBOT_ADDRESS}`,
          senderAddress: req.chatId, // receiver's address or chatId of a group
          signer: _signer,
          pgpPrivateKey: pgpDecrpyptedPvtKey,
        });
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
    const { message: msg, userDID: userDID } = await preProcessRawMessage(
      robot,
      message
    );
    handleMessage(robot, msg, userDID);
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

  const handleMessage = async (user, message, userDID) => {
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
    } else if (message.includes("/fvm")) {
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

beginSocket().catch(console.error);

// /ipfs-get QmSxQCdduj4C9amh4p1GgnYFDthwQM9kcCx5N4PqMw7qAq
