// Motor control pins
const UP_GPIO = 38;
const DOWN_GPIO = 36;
// Mapping of floors to WiringPi pin numbers of LEDs
const FLOORS = [37, 35, 33, 31, 29, 23, 21, 19];
// Motion Detected button
const MOTION = 32;
// Reset button
//   pin 5
// UART
//   2 = +5V (only if powering by USB)
//   6 - Black
//   8 - White
//   10 - Green
// Ground
//   pin 39

// Amount of time to continue running the motor after
// the floor level triggers
const FLOOR_LAG = 500;

// donenv - Read environment variables from .env file
var dotenv = require('dotenv');
// Needed for crontab to find .env file
dotenv.config({path: '/home/pi/ConnectedElevator/.env'});
dotenv.load();

// Raspicam - Raspberry Pi Camera
const Raspistill = require('node-raspistill').Raspistill;
const camera = new Raspistill({
  verticalFlip: false,
  width: 1296,
  height: 972,
  time: 1000
});

// GPIO - General Purpose I/O pin control
var rpio = require('rpio');
// Debounce "Motion Detected" hardware button
var debounce = require('debounce');

// Cometd libraries enable subscription to Platform Events
var cometdnodejs = require('cometd-nodejs-client').adapt();
var cometdlib = require('cometd');
var cometd = new cometdlib.CometD();
var TimeStampExtension = require('cometd/TimeStampExtension');
cometd.registerExtension('timestamp', new TimeStampExtension());

// Express - for HTTP messaging
var express = require('express');
var app = express();

// NForce - simplifies authtentication with Salesforce
var nforce = require('nforce');


const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const USERNAME = process.env.SFUSERNAME;
const PASSWORD = process.env.SFPASSWORD;
const SECURITY_TOKEN = process.env.SECURITY_TOKEN;
const DEVICEID = 'ELEVATOR-001';

const AUTH_URL = 'https://login.salesforce.com/services/oauth2/token';
var access_token;
var salesforce_url;

// Topic paths for the Platform Events
const MOTION_DETECTED_TOPIC = '/event/MotionDetected__e';
const TAKE_RIDER_TO_FLOOR_TOPIC = '/event/TakeRiderToFloor__e';

const photoFilename = 'legoPhoto.jpg';

// Current location of elevator
var currentFloor = 1;
var destinationFloor;
var elevatorState = "STOPPED";
const idleInterval = 30000;
var floorIntervalTimers = [];
var idleTimer;
var endOfRideTimer;

// Configure the app for HTTP
app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));
// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');



//==============================================================
// local functions
function configureGPIO() {

  rpio.init({gpiomem: true, mapping: 'physical'});
  // Motor control pins
  rpio.open(UP_GPIO, rpio.OUTPUT, rpio.LOW);
  rpio.open(DOWN_GPIO, rpio.OUTPUT, rpio.LOW);

  // motion sensor switch
  rpio.open(MOTION, rpio.INPUT, rpio.PULL_DOWN);
  // when a GPIO input state change has stablized for one second,
  // handle it.
  rpio.poll(MOTION, debounce(motion, 1000), rpio.POLL_HIGH);

  // Floor sensing pins
  for (i=0; i < FLOORS.length; i++) {
    rpio.open(FLOORS[i], rpio.INPUT, rpio.PULL_DOWN);
    var boundMotion = (function(pin) {
        motion(pin);
    }).bind(this);

    rpio.poll(FLOORS[i], 
      debounce(boundMotion, 500),
      rpio.POLL_HIGH);
  }

}

// Send the elevator up
function motorUp() {
  elevatorState = "UP";
  rpio.write(UP_GPIO, rpio.HIGH);
  rpio.write(DOWN_GPIO, rpio.LOW);
}

// Send the elevator down
function motorDown() {
  elevatorState = "DOWN";
  rpio.write(DOWN_GPIO, rpio.HIGH);
  rpio.write(UP_GPIO, rpio.LOW);
}

// Stop the elevator motion
function motorStop() {
  elevatorState = "STOPPED";
  rpio.write(UP_GPIO, rpio.LOW);
  rpio.write(DOWN_GPIO, rpio.LOW);
}

function startIdleTimer() {
  console.log('Idle Timer Started');
  idleTimer = setInterval(function () {
    moveElevatorToRandomFloor()
  },
    idleInterval);
}

function stopIdleTimer() {
  console.log('Idle Timer Stopped');
  clearInterval(idleTimer);
}

function stopFloorIntervalTimer() {
  console.log('Stopping all Floor Interval Timers: ' + floorIntervalTimers.length);
  for (var i = 0; i < floorIntervalTimers.length; i++) {
    clearTimeout(floorIntervalTimers[i]);
  }
  //reset timer array
  floorIntervalTimers = [];
}

function stopEndOfRideTimer() {
  console.log('EndOfRide Timer Stopped');
  clearTimeout(endOfRideTimer);
}

function stopAllTimers() {
  stopEndOfRideTimer();
  // Stop the floor interval timer
  stopFloorIntervalTimer();
  // Stop the idle timer
  stopIdleTimer();
}

function moveElevatorToRandomFloor() {
  var newFloor = Math.floor(Math.random() * FLOORS.length) + 1;
  console.log('Randomly moving elevator to floor ' + newFloor);
  moveElevatorToFloor(newFloor);
}

function setFloor(floor) {
  // Send an event to update the floor indicator in the Lighting UI
  var currentFloorEvent = nforce.createSObject('CurrentFloor__e');
  currentFloorEvent.set('DeviceId__c', DEVICEID);
  currentFloorEvent.set('Floor__c', floor);
  org.insert({sobject: currentFloorEvent},
    function (err, resp) {
      if (err) return console.log(err);
    });
}

function moveElevatorToFloor(floor) {
  destinationFloor = floor;
  console.log('moveElevatorToFloor ');
  console.log('currentFloor ' + currentFloor);
  console.log('destinationFloor ' + destinationFloor);
  
  if (currentFloor < floor) {
    // Going up
    motorUp();
  };

  if (currentFloor > floor) {
    // Going down
    motorDown();
  };

};

// 
function takePictureAndAlertIoT() {
  var salesforceFileId;
  console.log('TAKE PICTURE');
  camera.takePhoto(photoFilename).then((photo) => {

    console.log('Photo taken');


    // Post the picture as a new ContentVersion (File) in the Salesforce org
    var doc = nforce.createSObject('ContentVersion');
    doc.set('reasonForChange', 'Legoman Image');
    doc.set('pathOnClient', photoFilename);
    doc.setAttachment(photoFilename, photo);

    org.insert({ sobject: doc }, function (err, resp) {
      if (err) return console.log(err);
      salesforceFileId = resp.id;
      console.log('Id of ContentVersion created ' + salesforceFileId);

      // Create the platform event
      var approachingRiderEvent = nforce.createSObject('ApproachingRider__e');
      approachingRiderEvent.set('DeviceId__c', DEVICEID);
      approachingRiderEvent.set('RiderPictureId__c', salesforceFileId);
      org.insert({
        sobject: approachingRiderEvent
      },
        function (err, resp) {
          if (err) return console.log(err);
          console.log('Approaching Rider platform event created ' + resp.id);
        });
    });

  });
};

// Handler for state change on input pins
// If this is the rising edge (release of switch)
// create a platform event.  Since we already have a handler
// for this event (in the case when it is invoked from the
// Salesforce UI), we don't act upon it here.
var motion = function(channel) {
  console.log('channel ' + channel + ' state has changed');

  // Motion detected if there is a state change and the pin is high
  if ((channel == MOTION) && (rpio.read(MOTION))) {
    // Create the platform event
    var motionEvent = nforce.createSObject('MotionDetected__e');
      motionEvent.set('DeviceId__c', DEVICEID);
      org.insert({
        sobject: motionEvent
      },
        function (err, resp) {
          if (err) return console.log(err);
          console.log('Motion Detected platform event created ' + resp.id);
        });

  } else if (FLOORS.includes(channel) ) {
    // Elevator is approaching a floor
    // FLOORS is a zero-based array, so add one.
    currentFloor = FLOORS.indexOf(channel) + 1;
    console.log(elevatorState + ' currentFloor = ' + currentFloor + ' destinationFloor = ' + destinationFloor);
    setFloor(currentFloor);
    // If the motor is running, stop it if the elevator is at or past
    // the destination floor
    if ( ((elevatorState == "UP") && (currentFloor >= destinationFloor)) ||
         ((elevatorState == "DOWN") && (currentFloor <= destinationFloor)) ) {
      // The reed switch will trigger a little before the elevator gets to the floor.
      // Run the elevator for a few seconds more.
      setTimeout ( function() {
          motorStop();
        }
        , FLOOR_LAG );
    }
  }
};

//===================================
// Platform Event handlers
//===================================
// Event handler fired when a MotionDetected Platform Event is detected
function onMotionDetected(m) {
  // Stop all timers
  stopAllTimers();

  moveElevatorToFloor(1);

  var dataFromServer = m.data;
  console.log('Motion has been detected.  Initiating picture cycle');
  takePictureAndAlertIoT();
}

// Event handler fired when the orchestration is commanding to have a rider transported
function onTakeRiderToFloor(m) {
  // Stop all timers
  stopAllTimers();
  
  var dataFromServer = m.data;
  var floor = dataFromServer.payload.Floor__c;

  console.log('Taking rider from floor ' + currentFloor + ' to floor ' + floor);
  moveElevatorToFloor(floor);

  // Wait 30 sec, then tell the Orchestration we are done.
  endOfRideTimer = setTimeout(
    function () {
      // Create the platform event
      var rideCompleteEvent = nforce.createSObject('Ride_Complete__e');
      rideCompleteEvent.set('DeviceId__c', DEVICEID);
      org.insert({
        sobject: rideCompleteEvent
      },
        function (err, resp) {
          if (err) return console.log(err);
          console.log('Ride Complete platform event created ' + resp.id);
        });

      startIdleTimer();

    },
    30000
  );

}

//===================================
// HTTP handlers (only used for testing)
//===================================

// HTTP Get handler /TakeRiderToFloor
// Moves the elevator to the desired floor
// Query Parameters:
//   floor  -  The floor to move to
app.get('/TakeRiderToFloor', function (request, response) {
  // Stop all timers
  stopAllTimers();
    
  var floor = request.query.floor;
  console.log('Moving elevator from floor ' + currentFloor + ' to floor ' + floor);

  moveElevatorToFloor(floor);

  startIdleTimer();

  response.send('Moved to floor ' + floor);
});

// HTTP Get handler /riderThisWayCometh
// Triggers the photo process.  This simulates a motion detecting camera
// Query Parameters:
//   none
app.get('/riderDetected', function (request, response) {
  // Stop all timers
  stopAllTimers();
  
  moveElevatorToFloor(1);

  console.log('A rider has approached the elevator');

  takePictureAndAlertIoT();

  response.send('A rider has approached the elevator');
});

app.get('/Up', function (request, response) {
  motorUp();
  response.send('Going Up');
});

app.get('/Down', function (request, response) {
  motorDown();
  response.send('Going Down');
});

app.get('/Stop', function (request, response) {
  motorStop();
  response.send('Stopped');
});




//===================================
// Initialize system
//===================================
app.listen(app.get('port'), function () {
  console.log('Node app is running on port', app.get('port'));
});

// Create a connection to the IoT Explorer Salesforce org
var org = nforce.createConnection({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: 'http://localhost:5000/oauth/_callback',
  mode: 'single',
  autoRefresh: true
});

// Authenticate to the org
org.authenticate({
  username: USERNAME,
  password: PASSWORD,
  securityToken: SECURITY_TOKEN
}, function (err, resp) {
  if (err) {
    return console.error('Unable to get security token');
  }
  access_token = resp.access_token;
  salesforce_url = resp.instance_url;
  console.log('Access token ' + access_token);
  console.log('Salesforce URL ' + salesforce_url);

  // Configure the CometD object.
  cometd.configure({
    url: salesforce_url + '/cometd/41.0/',
    requestHeaders: { Authorization: 'Bearer ' + access_token },
    appendMessageTypeToURL: false
  });

  // Handshake with the server and subscribe to the PE.
  cometd.handshake(function (h) {
    if (h.successful) {
      // Subscribe to receive messages from the server.
      cometd.subscribe(MOTION_DETECTED_TOPIC, onMotionDetected);
      console.log('Cometd subscribed to ' + MOTION_DETECTED_TOPIC + ' successfully');
      cometd.subscribe(TAKE_RIDER_TO_FLOOR_TOPIC, onTakeRiderToFloor);
      console.log('Cometd subscribed to ' + TAKE_RIDER_TO_FLOOR_TOPIC + ' successfully');

      // Initialize hardware and get this party started!
      configureGPIO();
      startIdleTimer();
      
    } else {
      console.log('Unable to connect to cometd ' + JSON.stringify(h));
    }
  });
});





