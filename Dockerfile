FROM node:18


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