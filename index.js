// GPIO - General Purpose I/O pin control
//var gpio = require('rpi-gpio');
// Cometd libraries enable subscription to Platform Events
var cometdnodejs = require('cometd-nodejs-client').adapt();
var cometdlib = require('cometd');
var cometd = new cometdlib.CometD();
var TimeStampExtension = require('cometd/TimeStampExtension');
cometd.registerExtension('timestamp', new TimeStampExtension());
// Express - for HTTP messaging
var express = require('express');
var app = express();

// TODO: Automate the acquisition of the bearer token
// For now, create token using bash script.
const access_token = '00DB0000000DSZd!AQcAQHc5s7bl9a_QAWzsy.t294OM3Z_XtVggKgsNmhgdyrst4Sq7.qX3uxv91gmnHcbwWeN8dZOBg_kWpF5sV6Yo1_7m5s88';

// URL link on the Saleforce org for access to Platform Events
const PEURL = 'https://dws-winter18-gs0.my.salesforce.com/cometd/40.0/';
// Topic paths for the Platform Events
const MOVE_ELEVATOR_TOPIC = '/event/MoveElevator__e';
const MOTION_DETECTED_TOPIC = '/event/MotionDetected__e';

// Mapping of floors to WiringPi pin numbers of LEDs
const FLOORS = [8,9,7,0,2,3,12,13];

// Current location of elevator
var currentFloor = 1;

// Configure the app for HTTP
app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));
// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

// Configure the CometD object.
cometd.configure({
    url: PEURL,
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

configureGPIO();

//==============================================================
// local functions
function configureGPIO() {
  for (i = 0; i < 8; i++) {
//    gpio.setup(FLOORS[i], gpio.DIR_OUT, function(err) {
//      if (err) throw err;
//      console.log('Error initializting elevator floor');
//    });
  }
}

function setFloor(floor, state) {
  // FLOORS is a zero-based array, so subtract one from floor.
//  gpio.write(floor-1, state);
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

// 
function takePictureAndAlertIoT() {
  console.log('TAKE PICTURE');
}

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

  response.send('Moving from floor ' + currentFloor + ' to floor ' + floor);
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
