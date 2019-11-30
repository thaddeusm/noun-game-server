const app = require('express')()
const server = require('http').Server(app)
const io = require('socket.io')(server)

const simpleID = require('simple-id')

// hold information about ongoing games
let gameDictionary = {}

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

  let dictionary = closedRooms

  let registeredRooms = Object.values(dictionary)

  for (let i=0; i<registeredRooms.length; i++) {
    if (registeredRooms[i] == roomToCheck) {
      check = true
      break
    }
  }

  return check
}

io.on('connection', socket => {
  io.to(socket.id).emit('connected')

  console.log('a user connected')

  // set up a game room
  socket.on('createRoom', () => {
    let newID = simpleID(4, '1234567890')

    // send host to newly created room
    socket.join(newID)

    // register host in dictionary
    deviceDictionary[socket.id] = newID

    // establish property as array in response dictionary
    gameDictionary[newID] = []

    // send room id back to host
    io.to(newID).emit('gameRoomEstablished', newID)
  })

  // game device connects
  socket.on('joinGameRoom', (room) => {
    if (roomExists(room) && !roomClosed(room)) {
      socket.join(room)

      // register game device in dictionary
      deviceDictionary[socket.id] = room

      // send notification to game device and host
      io.to(socket.id).emit('roomJoined', room)
      io.to(room).emit('gameDeviceConnected', socket.id)

    } else {
      // notify game device that room does not exist
      io.to(socket.id).emit('roomJoinRejected')
    }
  })

  // game device user sends their shortened name for identification
  socket.on('sendingUsername', (name) => {
    io.to(deviceDictionary[socket.id]).emit('incomingUsername', name)
  })

  // game device requests data
  socket.on('requestGameData', () => {
    let roomID = deviceDictionary[socket.id]

    io.to(roomID).emit('gameDataRequested')
  })

  // host sends activity data to connected client
  socket.on('gameDataIncoming', (data) => {
    io.to(deviceDictionary[socket.id]).emit('incomingGameData', data)
  })

  // host sends start signal
  socket.on('sendStartSignal', () => {
    io.to(deviceDictionary[socket.id]).emit('allowGameStart')
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