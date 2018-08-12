# Connected Elevator

This Node.js app is part of a Connected Elevator IoT demonstration.  This code runs on a Raspberry Pi fitted inside an elevator built with LEGOs.  This code handles the operations of the elevator including:
- taking a photo of the rider using the Raspberry Pi camera module
- uploading the photo to Salesforce as a Content Item
- moving the elevator to the desired floor

The code is notified of an approaching rider by a physical switch connected to Pin 32.  The code then takes a picture and uploads it to Salesforce using the REST API.  The code then notifies Salesforce that the photo is available by publishing a Platform Event.  

Salesforce IoT Explorer handles the event by invoking Einstein Vision.  The photo is matched against a model containing photos of various LEGO figures.  If a match of sufficient confidence is found, the assigned work floor is retrieved from the Contact record for the matching figure.  IoT Explorer will then publish a Platform Event indicating the desired floor.

This code receives the Platform Event and moves the elevator to the desired floor.  The elevator is powered by a LEGO Mindstorm motor driven through pins 36 and 38.  Reed sensors on each floor connected to pins [37, 35, 33, 31, 29, 23, 21, 19] provide feedback as to the location of the elevator car.  As the car changes floors, the code publishes another Platform Event so that subscribers know the current location of the car (i.e. the Lighting App that simulates the interior control panel fo the elevator car).  When the elevator car reaches the desired floor, the code publishes another Platform Event thereby notifying any subscribers (the Salesforce org) that the ride is finished.

Once the elevator car has been idle for 30 seconds, the code will move the elevator car randomly between floors until interrupted by the next approaching rider.

## Prerequisites
It is assumed that you have a Raspberry Pi Zero W with a Camera module to run this code.  

### Software
Additionally, you will need the following software installed:
- Raspian OS
- Node.js
- Nodemon (optional)
- Git

### Hardware
The hardware configuration is very specific to the application.  As built, the following is required:
- Momentary normally open switch on pin 32 to indicate an approaching rider
- TBD motor controller IC controlled by pins 36 and 38
- Floor sensor inputs on pins [37, 35, 33, 31, 29, 23, 21, 19]

## Installation
Install the code to the Raspberry Pi using the following commands:

```sh
$ cd ~
$ git clone https://github.com/dschultz-mo/ConnectedElevator
$ cd ConnectedElevator
$ npm install
```

The connection parameters for the Salesforce org are maintained in a .env file at the root of the project.  You must manually create this file and populate its contents:

```
CLIENT_ID=<id>
CLIENT_SECRET=<secret>
SFUSERNAME=<username>
SFPASSWORD=<password>
SECURITY_TOKEN=<token>
```

You can now start the code with either

```sh
$ node index.js
```
or
```sh
$ nodemon
```

Your app should now be running on [localhost:5000](http://localhost:5000/).
