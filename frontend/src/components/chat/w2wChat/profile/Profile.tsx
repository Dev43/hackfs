// React + Web3 Essentials
import React, { useContext } from 'react';
import { useWeb3React } from '@web3-react/core';

// External packages
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import styled, { useTheme } from 'styled-components';

// Internal Components
import { ImageV2, ItemVV2, SpanV2 } from 'components/reusables/SharedStylingV2';
import { ChatUserContext } from 'contexts/ChatUserContext';
import { AiOutlineMore } from 'react-icons/ai';
import { useResolveWeb3Name } from 'hooks/useResolveWeb3Name';
import { shortenText } from 'helpers/UtilityHelper';
import { AppContext } from 'contexts/AppContext';
import { AppContextType } from 'types/context';

const Profile = ({ setActiveTab,showQR,setShowQR }: any): JSX.Element => {
  const { web3NameList }:AppContextType=useContext(AppContext);
  const { account }=useWeb3React()

  // theme context
  const theme = useTheme();

  const {connectedUser} = useContext(ChatUserContext);

  // resolve web3 name
  useResolveWeb3Name(account);
  
  const ensName = web3NameList[account];

  return (
    <>
      {/* <Tooltip title="Profile" placement="top-start"> */}
      <WalletDetailsContainer
        direction="row"
        spacing={2}
        onClick={(): void => setActiveTab(2)}
      >
        <ItemVV2
          width="48px"
          maxWidth="48px"
          borderRadius="100%"
          overflow="hidden"
          margin="0 5px 0 0"
        >
          <ImageV2
            alt="Profile"
            src={connectedUser.profilePicture}
          />
        </ItemVV2>
        <SpanV2
          color={theme.default.secondaryColor}
          size="16px"
          weight="400"
        >
          {ensName ? ensName : shortenText(account,8,7)}
        </SpanV2>
      </WalletDetailsContainer>
      {/* </Tooltip> */}

      <SettingsWrapper onClick={()=>setShowQR(!showQR)}>
        <Settings style={{color:theme.default.color}}/>
      </SettingsWrapper>


      {/* <IconButton aria-label="more">
        <MoreVertIcon />
      </IconButton> */}
    </>
  );
};

const WalletDetailsContainer = styled(Stack)`
  display: flex;
  align-items: center;
  displaytext-align: center;
  height: 100%;
`;
const DisplayText = styled(Typography)`
  && {
    color: ${(props): string => props.color || '#000000'};
    font-size: ${(props): string => props.size || '14px'};
    font-weight: ${(props): string => props.weight || '500'};
  }
`;

const SettingsWrapper = styled.span`
`;


const Settings = styled(AiOutlineMore)`
  position: relative;
  width: 40px;
  height: 36px;
  // border: 1px solid #dfdee9;
  border-radius: 8px;
  cursor: pointer;
  transition: 400ms;
  transform: ${(props) => (props.active ? 'rotateZ(90deg)' : 'none')};
`;

export default Profile;
