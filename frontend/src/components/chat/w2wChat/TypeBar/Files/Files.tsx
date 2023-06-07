// React + Web3 Essentials
import React from 'react';
import { FILE_ICON } from '../../stickers/stickerHelper';
import { formatFileSize } from 'helpers/w2w';
import { MessageIPFS } from 'types/chat';

// External Packages
import styled from 'styled-components';

interface FileProps {
  msg: MessageIPFS;
}

export interface FileMessageContent {
  content: string;
  name: string;
  type: string;
  size: number;
}

const Files = (props: FileProps) => {
  try {
    const fileContent: FileMessageContent = JSON.parse(props.msg.messageContent);
    const name = fileContent.name;
    let modifiedName: string;
    if (name.length > 11) {
      modifiedName = name.slice(0, 11) + '...';
    } else {
      modifiedName = name;
    }
    const content = fileContent.content as string;
    let url = URL.createObjectURL(b64toBlob(content, fileContent.type, 512));

    const size = fileContent.size;

    return (
      <OuterContainer>
        <Extension>
          <ExtensionImage src={FILE_ICON(name.split('.').slice(-1)[0])} />
        </Extension>
        <FileDetails>
          <FileDetailsName>{modifiedName}</FileDetailsName>
          <FileDetailsText>{formatFileSize(size)}</FileDetailsText>
        </FileDetails>
        <FileDownload>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download
          >
            <FileDownloadIcon
              className="fa fa-download"
              aria-hidden="true"
            />
          </a>
        </FileDownload>
      </OuterContainer>
    );
  } catch (e) {
    console.log(e);
    return <></>;
  }
};

const OuterContainer = styled.div`
  width: 14rem;
  height: 60px;
  display: flex;
  color: white;
  background-color: #343536;
  justify-content: space-around;
  border-radius: 8px;
`;

const Extension = styled.div`
  width: 2rem;
  display: flex;
  justify-content: center;
  object-fit: cover;
`;

const ExtensionImage = styled.img`
  width: 2rem;
  position: relative;
  top: 40%;
  height: 1rem;
  &:hover {
    background-color: transparent;
  }
`;

const FileDetails = styled.div`
  font-size: 1rem;
  display: flex;
  font-weight: 400;
  margin-top: 5px;
  margin-bottom: 5px;
  width: 10rem;
  flex-direction: column;
`;

const FileDetailsName = styled.span`
  margin-left: 15px;
`;

const FileDetailsText = styled.p`
  margin-left: 15px;
`;

const FileDownload = styled.div`
  display: flex;
  padding: 10px;
  font-size: 1.5rem;
  justify-content: center;
`;

const FileDownloadIcon = styled.i`
  margin-top: 10px;
  color: #575757;
`;

export default Files;

const b64toBlob = (b64Data, contentType = '', sliceSize = 512) => {
  const byteCharacters = atob(b64Data);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);

    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  const blob = new Blob(byteArrays, { type: contentType });
  return blob;
};
