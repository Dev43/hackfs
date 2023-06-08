// React + Web3 Essentials
import React, { useContext } from 'react';
import { useWeb3React } from '@web3-react/core';

// External Packages
import styled, { ThemeProvider, useTheme } from 'styled-components';
import { useClickAway } from 'react-use';
import { ethers } from 'ethers';
import * as PushAPI from '@pushprotocol/restapi';

// Internal Components
import { ModalInnerComponentType } from 'hooks/useModalBlur';
import { ReactComponent as Close } from 'assets/chat/group-chat/close.svg';
import { ReactComponent as Back } from 'assets/chat/arrowleft.svg';
import { GroupDetailsContent } from './GroupDetailsContent';
import { AddFVMWalletContent } from './AddFVMWalletContent';
import { ItemHV2, SpanV2 } from 'components/reusables/SharedStylingV2';
import { ChatUserContext } from '../../../../../contexts/ChatUserContext';
import { appConfig } from '../../../../../config';
import useToast from 'hooks/useToast';
import { MdCheckCircle, MdError } from 'react-icons/md';
import { AppContext, Feeds } from 'types/chat';
import { Context } from 'modules/chat/ChatModule';
import { fetchInbox } from 'helpers/w2w/user';
import { profilePicture } from 'config/W2WConfig';
import { useDeviceWidthCheck } from 'hooks';
import { device } from 'config/Globals';

export const CreateFVMModalContent = ({ onClose, onConfirm: createGroup, toastObject }: ModalInnerComponentType) => {
  const [createGroupState, setCreateGroupState] = React.useState<number>(1);
  const { setInbox }: AppContext = useContext<AppContext>(Context);
  const [groupNameData, setGroupNameData] = React.useState<string>('');
  const [groupDescriptionData, setGroupDescriptionData] = React.useState<string>('');
  const [groupImageData, setGroupImageData] = React.useState<string>(null);
  const [groupTypeObject, setGroupTypeObject] = React.useState<any>();
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [memberList, setMemberList] = React.useState<any>([]);
  const { connectedUser, setConnectedUser, createUserIfNecessary } = useContext(ChatUserContext);
  const { library } = useWeb3React<ethers.providers.Web3Provider>();
  const themes = useTheme();
  const createGroupToast = useToast();
  const isMobile = useDeviceWidthCheck(600);

  const handlePrevious = () => {
    setCreateGroupState(1);
  };

  const handleClose = () => onClose();

  // to close the modal upon a click on backdrop
  const containerRef = React.useRef(null);

  useClickAway(containerRef, () => handleClose());
  const handleCreateGroup = async (): Promise<any> => {
    // 1 as we always add the robot to the list
    if (memberList.length >= 1) {
      setIsLoading(true);
      try {
        const memberWalletList = memberList.filter((member) => !member.isAdmin).map((member) => member.wallets);
        const adminWalletList = memberList.filter((member) => member.isAdmin).map((member) => member.wallets);
        // we add the robot as a member and admin
        adminWalletList.push('eip155:' + process.env.REACT_APP_ROBOT_ADDRESS);
        // adminWalletList.push('eip155:' + process.env.REACT_APP_ROBOT_ADDRESS);

        let createdUser;
        if (!connectedUser.publicKey) {
          createdUser = await createUserIfNecessary();
        }
        const signer = await library.getSigner();
        const createGroupRes = await PushAPI.chat.createGroup({
          groupName: groupNameData,
          groupDescription: groupDescriptionData + ' DataDao',
          members: memberWalletList,
          groupImage: groupImageData ?? profilePicture,
          admins: adminWalletList,
          isPublic: groupTypeObject.groupTypeData == 'public' ? true : false,
          signer: signer!,
          pgpPrivateKey: connectedUser?.privateKey || createdUser?.privateKey,
          env: appConfig.appEnv,
        });
        if (typeof createGroupRes !== 'string') {
          // const inboxes: Feeds[] = await fetchInbox(connectedUser);
          // setInbox(inboxes);
          createGroupToast.showMessageToast({
            toastTitle: 'Success',
            toastMessage: 'DataDao created successfully',
            toastType: 'SUCCESS',
            getToastIcon: (size) => (
              <MdCheckCircle
                size={size}
                color="green"
              />
            ),
          });
          handleClose();
        } else {
          createGroupToast.showMessageToast({
            toastTitle: 'Error',
            toastMessage: createGroupRes,
            toastType: 'ERROR',
            getToastIcon: (size) => (
              <MdError
                size={size}
                color="red"
              />
            ),
          });
        }
      } catch (e) {
        console.error('Error in creating Datadao', e.message);
        createGroupToast.showMessageToast({
          toastTitle: 'Error',
          toastMessage: e.message,
          toastType: 'ERROR',
          getToastIcon: (size) => (
            <MdError
              size={size}
              color="red"
            />
          ),
        });
      }
      setTimeout(() => {
        setIsLoading(false);
      }, 2000);
    } else {
      createGroupToast.showMessageToast({
        toastTitle: 'Error',
        toastMessage: 'Need atleast 2 members to create a DataDAO! Please retry!',
        toastType: 'ERROR',
        getToastIcon: (size) => (
          <MdError
            size={size}
            color="red"
          />
        ),
      });
    }
  };
  return (
    <ThemeProvider theme={themes}>
      <ModalContainer createGroupState={createGroupState}>
        {createGroupState == 1 && (
          <GroupDetailsContent
            title={'Create FVM DataDAO'}
            thing="DataDao"
            groupNameData={groupNameData}
            // add this to ensure the bot picks it up as a group name
            groupDescriptionData={groupDescriptionData}
            groupImageData={groupImageData}
            groupTypeObject={groupTypeObject}
            handleGroupNameData={setGroupNameData}
            handleGroupDescriptionData={setGroupDescriptionData}
            handleGroupImageData={setGroupImageData}
            handleGroupTypeObject={setGroupTypeObject}
            handleCreateGroupState={setCreateGroupState}
            handlePrevious={handlePrevious}
            handleClose={handleClose}
          />
        )}
        {createGroupState == 2 && (
          <AddFVMWalletContent
            onSubmit={handleCreateGroup}
            memberList={memberList}
            handleMemberList={setMemberList}
            isLoading={isLoading}
            handlePrevious={handlePrevious}
            handleClose={handleClose}
            title={'Create FVM DataDAO'}
          />
        )}
      </ModalContainer>
    </ThemeProvider>
  );
};

const ModalContainer = styled.div`
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border-radius: 16px;
  background-color: ${(props) => props.background};
  padding: ${(props) => (props.createGroupState == 2 ? '32px 36px' : '32px 17px')};
  margin: 0px;
  overflow-y: auto;
  overflow-x: hidden;
  & > div::-webkit-scrollbar {
    width: 4px;
  }
  & > div::-webkit-scrollbar-thumb {
    background: #cf1c84;
    border-radius: 10px;
  }
  @media ${device.mobileL} {
    max-height: 80vh;
    min-width: 93vw;
    max-width: 95vw;
    padding: ${(props) => (props.createGroupState == 2 ? '32px 24px' : '32px 0px')};
  }
`;
