FROM ubuntu:22.04

RUN  apt update 
RUN  apt install ca-certificates curl gnupg wget gcc g++ make  -y
RUN curl -fsSL https://deb.nodesource.com/setup_18.x |  bash - 
RUN  apt-get install -y nodejs
RUN install -m 0755 -d /etc/apt/keyrings
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg |  gpg --dearmor -o /etc/apt/keyrings/docker.gpg
RUN  chmod a+r /etc/apt/keyrings/docker.gpg
RUN echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
   tee /etc/apt/sources.list.d/docker.list > /dev/nul

RUN  apt-get update

RUN  apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y

RUN curl -sL https://get.bacalhau.org/install.sh | bash

RUN npm install --global yarn

# /////////////////////////////////////////


RUN mkdir fevm-dao

# first we copy the package.json from fevm-dao
COPY ./fevm-dao/package*.json ./fevm-dao/
COPY ./fevm-dao/yarn.lock ./fevm-dao/

RUN cd fevm-dao && yarn

RUN cd ..

COPY ./fevm-dao ./fevm-dao

RUN mkdir backend

COPY ./backend/package*.json ./backend
COPY ./backend/yarn.lock ./fevm-dao/

RUN cd backend && yarn

COPY ./backend ./backend

RUN rm ./backend/.env

WORKDIR backend

CMD [ "node", "./index.js" ]