// Raspicam - Raspberry Pi Camera
const Raspistill = require('node-raspistill').Raspistill;
const camera = new Raspistill({
    verticalFlip: true,
    width: 1296,
    height: 972
});
// GPIO - General Purpose I/O pin control
var gpio = require('rpi-gpio');
// Cometd libraries enable subscription to Platform Events
var cometdnodejs = require('cometd-nodejs-client').adapt();
var cometdlib = require('cometd');
var cometd = new cometdlib.CometD();
var TimeStampExtension = require('cometd/TimeStampExtension');
cometd.registerExtension('timestamp', new TimeStampExtension());
// Express - for HTTP messaging
var express = require('express');
var app = express();
// Request - for making HTTP outbound calls
var request = require('request');
const fs = require('fs');


// TODO: Automate the acquisition of the bearer token
// For now, create token using bash script.
const CLIENT_ID = '3MVG9SemV5D80oBdmc6xXgw8vJXukPIYmjGVvw3DUQnz9yElDgEhg1_NcmTU2LZrN5jRcYUHkcTctdjPt8TD6';
const CLIENT_SECRET = '763717480919241910';
const USERNAME = 'dschultz-ubcu@force.com';
const PASSWORD = 'salesforce1';
const SECURITY_TOKEN = 'DvQgm3UuPu9aJceIq2lVn7U8C';
const AUTH_URL = 'https://login.salesforce.com/services/oauth2/token';
var access_token;
var salesforce_url;

// Topic paths for the Platform Events
const MOVE_ELEVATOR_TOPIC = '/event/MoveElevator__e';
const MOTION_DETECTED_TOPIC = '/event/MotionDetected__e';

request.post({
  url: AUTH_URL,
  form: {
    grant_type:'password',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username: USERNAME,
    password: PASSWORD + SECURITY_TOKEN }},
  function(err,httpResponse,body) {
    if (err) {
      return console.error('Unable to get security token');
    }
    access_token = JSON.parse(body).access_token;
    salesforce_url = JSON.parse(body).instance_url;
    console.log('salesforce url is ' + salesforce_url);

    // Configure the CometD object.
    cometd.configure({
        url: salesforce_url + '/cometd/40.0/',
        requestHeaders: { Authorization: 'Bearer '+ access_token},
        appendMessageTypeToURL : false
    });

    // Handshake with the server and subscribe to the PE.
    cometd.handshake(function(h) {
        if (h.successful) {
            // Subscribe to receive messages from the server.
            cometd.subscribe(MOVE_ELEVATOR_TOPIC, onMoveElevator);
            console.log('Cometd subscribed to ' + MOVE_ELEVATOR_TOPIC + ' successfully');
            cometd.subscribe(MOTION_DETECTED_TOPIC, onMotionDetected);
            console.log('Cometd subscribed to ' + MOTION_DETECTED_TOPIC + ' successfully');
        } else {
          console.log('Unable to connect to cometd ' + JSON.stringify(h));
        }
    });
});


// Mapping of floors to WiringPi pin numbers of LEDs
const FLOORS = [3,5,7,11,13,15,19,21];


// Current location of elevator
var currentFloor = 1;

// Configure the app for HTTP
app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));
// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');


configureGPIO();

//==============================================================
// local functions
function configureGPIO() {
  for (i = 0; i < 8; i++) {
    gpio.setup(FLOORS[i], gpio.DIR_OUT, function() {
      gpio.write(FLOORS[0], 1);
    });
  }
}

function setFloor(floor, state) {
  // FLOORS is a zero-based array, so subtract one from floor.
  gpio.write(FLOORS[floor-1], state);
}

function moveElevatorToFloor(floor) {
  if (currentFloor < floor) {
    // Going up
    currentFloor++;
    console.log('... floor ' + currentFloor);
    setFloor(currentFloor-1, 0);
    setFloor(currentFloor, 1);
    setTimeout(
      function() {
        moveElevatorToFloor(floor);
      },
      1000
    );
  };

  if (currentFloor > floor) {
    // Going down
    currentFloor--;
    console.log('... floor ' + currentFloor);
    setFloor(currentFloor+1, 0);
    setFloor(currentFloor, 1);
    setTimeout(
      function() {
        moveElevatorToFloor(floor);
      },
      1000
    );
  };

};

const photoFilename = 'textPhotoName.jpg';  

// 
function takePictureAndAlertIoT() {
  console.log('TAKE PICTURE');
  camera.takePhoto(photoFilename).then((photo) => {
    

  // specify the path to the file, and create a buffer with characters we want to write
  const path = 'text.txt';  
  var buffer = new Buffer(
    '--boundary_string\n' + 
    'Content-Disposition: form-data; name="entity_document";\n' +
    'Content-Type: application/json' +
    '\n' +
    '{\n' +
    '    "Description" : "Test Lego image",\n' +
    '    "PathOnClient" : "' + photoFilename + '"\n' +
    '}\n' +
    '\n' +
    '--boundary_string\n' + 
    'Content-Type: image/jpg\n' +
    'Content-Disposition: form-data; name="VersionData"; filename="' + photoFilename + '"\n' +
    '\n' );

  var buffer2 = new Buffer(
    '\n' +
    '--boundary_string\n' );

  var buffer3 = Buffer.concat([buffer, photo, buffer2]);

// open the file in writing mode, adding a callback function where we do the actual writing
fs.open(path, 'w', function(err, fd) {  
    if (err) throw 'could not open file: ' + err;

    // write the contents of the buffer, from position 0 to the end, to the file descriptor returned in opening our file
    fs.write(fd, buffer3, 0, buffer3.length, null, function(err) {
        if (err) throw 'error writing file: ' + err;
        fs.close(fd, function() {
            console.log('wrote the file successfully');
       });
    });
});

  request.post(
    {
      url: salesforce_url + '/services/data/v40.0/sobjects/ContentVersion/',
      method: 'POST',
      headers: {
        Authorization: 'Bearer' + access_token,
        'Content-Type': 'multipart/form-data; boundary="boundary_string"' },
      body: buffer3 },
    function(err,httpResponse,body) {
      if (err) return console.error('Unable to get security token');
    });
};

// Event handler fired when a MoveElevator Platform Event is detected
function onMoveElevator(m) {
  var dataFromServer = m.data;
//  console.log('Move Elevator event handled: ' + JSON.stringify(dataFromServer));
  var floor = dataFromServer.payload.Floor__c;
  console.log('Moving elevator from floor ' + currentFloor + ' to floor ' + floor);  
  moveElevatorToFloor(floor);
}

// Event handler fired when a MotionDetected Platform Event is detected
function onMotionDetected(m) {
  var dataFromServer = m.data;
  console.log('Motion has been detected.  Initiating picture cycle');  
  takePictureAndAlertIoT();
}


// HTTP Get handler /
// Renders the default page.  Mainly for testing.
app.get('/', function(request, response) {
  response.render('pages/index');
});

// HTTP Get handler /moveTo
// Moves the elevator to the desired floor
// Query Parameters:
//   floor  -  The floor to move to
app.get('/moveTo', function(request, response) {
  var floor = request.query.floor;
  console.log('Moving elevator from floor ' + currentFloor + ' to floor ' + floor);
  
  moveElevatorToFloor(floor);

  response.send('Moved to floor ' + floor);
});

// HTTP Get handler /riderThisWayCometh
// Triggers the photo process.  This simulates a motion detecting camera
// Query Parameters:
//   none
app.get('/riderThisWayCometh', function(request, response) {
  console.log('A rider has approached the elevator');
  
  takePictureAndAlertIoT();

  response.send('A rider has approached the elevator');
});

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});
