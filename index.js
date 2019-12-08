const app = require('express')()
const server = require('http').Server(app)
const io = require('socket.io')(server)

const simpleID = require('simple-id')
const gamePrompts = require('./gameData.json')

// hold information about ongoing games
let gameDictionary = {
  /* example object:
  1234: {
    players: [{
      nickname: 'Tina',
      score: 10
    }],
    judge: 0 (index of player),
    shuffledPrompts: {
      "people": [],
      "places": [],
      "things": [],
      "activities": [],
      "ideas": []
    },
    nextPromptIndexes: {
      "people": 1,
      "places": 0,
      "things": 0,
      "activities": 3,
      "ideas": 0
    },
    started: false,
    completed: false
  } 
  */
}

// this object holds information about connected devices and rooms
let deviceDictionary = {}

// store closed rooms to force exit remote connections
let closedRooms = []

const roomClosed = function(roomToCheck) {
  let check = false

  let dictionary = closedRooms

  for (let i=0; i<dictionary.length; i++) {
    if (dictionary[i] == roomToCheck) {
      check = true
      break
    }
  }

  return check
}

const roomExists = function(roomToCheck) {
  let check = false

  let dictionary = gameDictionary

  let registeredRooms = Object.keys(dictionary)

  for (let i=0; i<registeredRooms.length; i++) {
    if (registeredRooms[i] == roomToCheck) {
      check = true
      break
    }
  }

  return check
}

const createNewRoom = function() {
  let id = simpleID(4, '1234567890')

  if (!roomExists(id)) {
    addNewGameRecord(id)
    return id
  } else {
    createNewRoom()
  }
}

const nicknameIsUnique = function(nickname, roomToCheck) {
  let check = true

  console.log(gameDictionary)
  console.log(roomToCheck)

  let players = gameDictionary[roomToCheck].players

  for (let i=0; i<players.length; i++) {
    if (players[i].nickname == nickname) {
      check = false
      break
    }
  }

  return check
}

const addNewGameRecord = function(roomID) {
  gameDictionary[roomID] = {
    players: [],
    judge: 0,
    shuffledPrompts: {
      "people": shuffle(gamePrompts.categories.people),
      "places": shuffle(gamePrompts.categories.places),
      "things": shuffle(gamePrompts.categories.things),
      "activities": shuffle(gamePrompts.categories.activities),
      "ideas": shuffle(gamePrompts.categories.ideas)
    },
    nextPromptIndexes: {
      "people": 0,
      "places": 0,
      "things": 0,
      "activities": 0,
      "ideas": 0
    },
    started: false,
    completed: false
  }

  return gameDictionary[roomID]
}

const shuffle = function(arr) {
  var j, x, i
  for (i = arr.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1))
      x = arr[i]
      arr[i] = arr[j]
      arr[j] = x
  }

  return arr
}

io.on('connection', socket => {
  io.to(socket.id).emit('connected')

  console.log('a user connected')

  // set up a game room
  socket.on('createRoom', () => {
    let newID = createNewRoom()

    // send host to newly created room
    socket.join(newID)

    // register host device in dictionary
    deviceDictionary[socket.id] = newID

    io.to(newID).emit('gameRoomEstablished', newID)
  })

  // game device connects
  socket.on('joinGameRoom', (room) => {
    if (roomExists(room) && !roomClosed(room)) {
      socket.join(room)

      // register game device in dictionary
      deviceDictionary[socket.id] = room

      // send notification to game device and host
      let nicknames = []

      gameDictionary[room].players.forEach((obj) => {
        nicknames.push(obj.nickname)
      })

      io.to(socket.id).emit('roomJoined', room, nicknames)
      io.to(room).emit('gameDeviceConnected', socket.id)

    } else {
      // notify game device that room does not exist
      io.to(socket.id).emit('roomJoinRejected')
    }
  })

  // game device user sends their shortened name for identification
  socket.on('checkNickname', (nickname) => {
    let room = deviceDictionary[socket.id]

    let isUnique = nicknameIsUnique(nickname, room)

    if (isUnique) {
      io.to(socket.id).emit('nicknameAccepted')
      gameDictionary[room].players.push({nickname: nickname, score: 0})

      io.to(room).emit('newUserConnected', nickname)

      if (gameDictionary[room].started) {
        io.to(room).emit('allowGameStart')
      }
    } else {
      io.to(socket.id).emit('nicknameRejected')
    }
  })

  // game device requests data
  socket.on('requestGameData', () => {
    let roomID = deviceDictionary[socket.id]

    io.to(socket.id).emit('gameDataIncoming', gameDictionary[roomID])
  })

  // host sends start signal
  socket.on('sendStartSignal', () => {
    let gameRoom = deviceDictionary[socket.id]

    io.to(gameRoom).emit('allowGameStart')

    gameDictionary[gameRoom].started = true
  })

  // judge selects category, which starts the round
  socket.on('startRound', (data) => {
    let category = data.category
    let game = gameDictionary[deviceDictionary[socket.id]]
    let nextIndex = game.nextPromptIndexes[category]
    let prompt = game.shuffledPrompts[category][nextIndex]

    // send prompt to writers
    io.to(deviceDictionary[socket.id]).emit('promptIncoming', {category: category, prompt: prompt})

    // increment prompt category
    game.nextPromptIndexes[category]++
  })

  // writer sends response to judge
  socket.on('sendResponse', (data) => {
    io.to(deviceDictionary[socket.id]).emit('responseIncoming', data)
  });

  // judge makes choice, which ends the round
  socket.on('endRound', (data) => {
    let game = gameDictionary[deviceDictionary[socket.id]]
    let numOfPlayers = game.players.length

    let winningPlayerIndex;
    for (let i=0; i<numOfPlayers; i++) {
      if (game.players[i].nickname == data.winner) {
        winningPlayerIndex = i;
        break
      }
    }

    // increment winner's score
    game.players[winningPlayerIndex].score += 1

    // increment judge
    if (game.judge !== numOfPlayers) {
      game.judge++
    } else {
      game.judge = 0
    }

    io.to(deviceDictionary[socket.id]).emit('winnerChosen', winningPlayerIndex)
    io.to(deviceDictionary[socket.id]).emit('changeRounds', game)
  })

  // game device sends activity response
  socket.on('sendResponseData', (data) => {
    gameDictionary[deviceDictionary[socket.id]].push(data)
    io.to(socket.id).emit('responseReceiptConfirmed')
    io.to(deviceDictionary[socket.id]).emit('incomingResponseData', data)
  })

  socket.on('rejoinGameRoom', (room) => {
    socket.join(room)

    deviceDictionary[socket.id] = room

    io.to(socket.id).emit('rejoinedGameRoom')
    io.to(deviceDictionary[socket.id]).emit('rejoinedRoom')
  })

  // upon reconnect, game device checks if game has started
  socket.on('checkGameStatus', (room) => {
    io.to(room).emit('gameStatusRequested', socket.id)
  })

  // if the game is finished, notify game device attempting to join
  socket.on('rejectDeviceParticipation', (device) => {
    io.to(device).emit('participationRejected')
  })

  socket.on('cancelGame', () => {
    let roomID = deviceDictionary[socket.id]

    closedRooms.push(roomID)

    // remove device from room
    socket.leave(deviceDictionary[socket.id])
    // notify game devices
    io.to(deviceDictionary[socket.id]).emit('activityGame')
  })

  // host prepares to leave session, requests final responses from server
  socket.on('endGameSession', () => {
    let roomID = deviceDictionary[socket.id]

    io.to(socket.id).emit('incomingResponses', gameDictionary[roomID])
  })

  // host ends game after receiving final responses
  socket.on('confirmResponsesReceipt', () => {
    let roomID = deviceDictionary[socket.id]

    closedActivityRooms.push(roomID)

    // remove device from room
    socket.leave(deviceDictionary[socket.id])
    // notify game devices
    io.to(deviceDictionary[socket.id]).emit('activityCanceled')
  })

  // reconnect
  socket.on('rejoinRoom', (room) => {
    socket.join(room)

    // reregister device in dictionary in case of id change
    idDictionary[socket.id] = room
    

    // send notification to room
    io.to(idDictionary[socket.id]).emit('rejoinedRoom')
  })

  // host ends session
  socket.on('endSession', () => {
    let roomID = idDictionary[socket.id]

    // notify remote devices
    io.to(roomID).emit('sessionEnded')
    closedRooms.push(roomID)

    // remove device from room
    socket.leave(idDictionary[socket.id])
  })

  socket.on('disconnect', () => {
    // send notification to device
    io.to(socket.id).emit('disconnected')

    // send notification to room
    io.to(deviceDictionary[socket.id]).emit('deviceDisconnection', socket.id)
  })

})

server.listen(4000, () => {
  console.log('The server is running')
})