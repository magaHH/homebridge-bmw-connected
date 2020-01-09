var request = require("request");
var requestretry = require('requestretry');
var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-bmw-connected", "BMWConnected", BMWConnected);
}

function BMWConnected(log, config) {
  this.log = log;
	this.name = config["name"];
	this.vin = config["vin"];
  this.username = config["username"];
	this.password = config["password"];
	this.client_id = config["client_id"];
	this.enable_heater = config["heater"];
	this.enable_lights = config["lights"];
	this.enable_horn = config["horn"];
  //this.currentState = Characteristic.LockCurrentState.SECURED;
  this.currentStateLock = Characteristic.LockCurrentState.SECURED;
  this.currentStateHeater = Characteristic.Off;
  this.currentStateLights = Characteristic.Off;
  this.currentStateHorn = Characteristic.Off;

  this.refreshToken = "";
	this.refreshtime = 0;
	this.authToken = "";
	this.lastUpdate = 0;

  this.lockService = new Service.LockMechanism(this.name);

  this.lockService
    .getCharacteristic(Characteristic.LockCurrentState)
    .on('get', this.getState.bind(this));

  this.lockService
    .getCharacteristic(Characteristic.LockTargetState)
    .on('get', this.getState.bind(this))
    .on('set', this.setState.bind(this));

    this.getState(function(err,state){
  		if (err){
  			if (err){this.log("Auth Error: " + err + "Check your creds")}
  			this.log('stateRequest error');
  			this.log("Current lock state is " + ((this.currentStateLock == Characteristic.LockTargetState.SECURED) ? "locked" : "unlocked"));
  		}else{

        var currentStateLock = (state == Characteristic.LockTargetState.SECURED) ?
          Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;

        this.lockService
          .setCharacteristic(Characteristic.LockCurrentState, currentStateLock);

  			this.log("Current lock state is " + ((this.currentStateLock == Characteristic.LockTargetState.SECURED) ? "locked" : "unlocked"));
  		}
  	}.bind(this))

}

BMWConnected.prototype.getState = function(callback) {
  this.log("Getting current state...");
  this.getauth(function(err){
    if (err) {
      callback(err,this.currentStateLock);
    }

  request.get({
    url: 'https://www.bmw-connecteddrive.co.uk/api/vehicle/dynamic/v1/' + this.vin,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_1 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Version/11.0 Mobile/15B150 Safari/604.1',
      'Authorization': 'Bearer ' + this.authToken,
    },
  }, function(err, response, body) {

    if (!err && response.statusCode == 200) {
      var json = JSON.parse(body);
      this.log(json["attributesMap"]["door_lock_state"]);
      var state = (json["attributesMap"]["door_lock_state"] == "LOCKED" || json["attributesMap"]["door_lock_state"] == "SECURED") ? Characteristic.LockCurrentState.SECURED  : Characteristic.LockCurrentState.UNSECURED;;
      //var state = json.state; // "lock" or "unlock"
      callback(null, state); // success
    }
    else {
      callback( new Error(response.statusCode),this.currentStateLock);
      this.log(' ERROR REQUEST RESULTS:', err, response.statusCode, body);
    }
  }.bind(this));
}.bind(this));
}

BMWConnected.prototype.getExecution = function(callback) {
  this.log("Waiting for confirmation...");
  this.getauth(function(err){
    if (err) {
      callback(err,this.currentStateLock);
    }

  var complete = 0;

  requestretry.get({
    url: 'https://www.bmw-connecteddrive.co.uk/api/vehicle/remoteservices/v1/' + this.vin + '/state/execution',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_1 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Version/11.0 Mobile/15B150 Safari/604.1',
      'Authorization': 'Bearer ' + this.authToken,
      'accept':	'application/json, text/plain, */*',
    },
    // The below parameters are specific to request-retry
    maxAttempts: 20,   // (default) try 10 times
    retryDelay: 2000,  // (default) wait for 5s before trying again
    retryStrategy: myRetryStrategy

  }, function(err, response, body) {

    if (!err && response.statusCode == 200) {
      this.log('Success!');

      callback(null); // success
    }
    else {
      callback( new Error(response.statusCode),this.currentStateLock);
      this.log(' ERROR REQUEST RESULTS:', err, response.statusCode, body);
    }
  }.bind(this));
}.bind(this));
}

function myRetryStrategy(err, response, body){
  // retry the request if we had an error or if the response was a 'Bad Gateway'
  var json = JSON.parse(body);
  var commandtype = (json["remoteServiceType"]);
  var execution = (json["remoteServiceStatus"]);

  return err || execution === "PENDING" || execution ==="DELIVERED_TO_VEHICLE"
}


BMWConnected.prototype.setState = function(state, callback) {
  var bmwState = (state == Characteristic.LockTargetState.SECURED) ? "RDL" : "RDU";

  this.log("Sending Command %s", bmwState);
  this.getauth(function(err){
    if (err) {
      callback(err);
    }

  request.post({
    url: 'https://customer.bmwgroup.com/api/vehicle/remoteservices/v1/' + this.vin +'/' + bmwState,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_1 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Version/11.0 Mobile/15B150 Safari/604.1',
      'Authorization': 'Bearer ' + this.authToken,
  }
  }, function(err, response, body) {

    if (!err && response.statusCode == 200) {
      //this.log('Remote: ' + bmwState);

      // call this.getExecution
      this.getExecution(function(err){
        if (err) {
          callback(err,this.currentStateLock);
        }

      // we succeeded, so update the "current" state as well
      var currentStateLock = (state == Characteristic.LockTargetState.SECURED) ?
        Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;

      //this.log(currentStateLock);
      this.lockService
        .setCharacteristic(Characteristic.LockCurrentState, currentStateLock);

      callback(null); // success
    }.bind(this));
    }
    else {
      callback( new Error(response.statusCode));
      console.log(' ERROR REQUEST RESULTS:', err, response.statusCode, body);
    }
  }.bind(this));
}.bind(this));
}

BMWConnected.prototype.getOnCharacteristicHandlerHeaterSwitch = function(callback) {
	//get State for heater
}

BMWConnected.prototype.setOnCharacteristicHandlerHeaterSwitch = function(state, callback) {
	//set State for heater "RCN"
  var bmwState = "RCN";
  this.currentStateHeater = state
  //if switched on -> set switch on, call bmwconnect, set switch off after 10 seconds
  if(state){

  this.log("Sending Command %s", bmwState);
  this.getauth(function(err){
    if (err) {
      callback(err);
    }

  request.post({
    url: 'https://customer.bmwgroup.com/api/vehicle/remoteservices/v1/' + this.vin +'/' + bmwState,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_1 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Version/11.0 Mobile/15B150 Safari/604.1',
      'Authorization': 'Bearer ' + this.authToken,
  }
  }, function(err, response, body) {

    if (!err && response.statusCode == 200) {
      //this.log('Remote: ' + bmwState);

      // call this.getExecution
      this.getExecution(function(err){
        if (err) {
          callback(err,this.currentStateHeater);
        }
		
		
		
	/*

      // we succeeded, so update the "current" state as well
      var currentStateLock = (state == Characteristic.LockTargetState.SECURED) ?
        Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;

      //this.log(currentStateLock);
      this.lockService
        .setCharacteristic(Characteristic.LockCurrentState, currentStateLock);
	*/
	
	this.heaterSwitchService.setCharacteristic(currentStateHeater);

	this.timer = setTimeout(function() {
          this.log('Time is Up!');
          this.heaterSwitchService.getCharacteristic(Characteristic.On).updateValue(false);
          this.switchOn = false;
    }.bind(this), 10000);
	
	
	
      callback(null); // success
    }.bind(this));
    }
    else {
      callback( new Error(response.statusCode));
      console.log(' ERROR REQUEST RESULTS:', err, response.statusCode, body);
    }
  }.bind(this));
}.bind(this));
  }else{
this.heaterSwitchService.setCharacteristic(Characteristic.On);
  }	  
	
}

BMWConnected.prototype.getServices = function() {
	var this.services = [];
	
	//adding lock Service
	services.push(this.lockService);
	
	if (this.enable_heater){
		//create switch for heater
		this.heaterSwitchService = new Service.Switch(this.name + "_heater");
		/*
     			* For each of the service characteristics we need to register setters and getter functions
     			* 'get' is called when HomeKit wants to retrieve the current state of the characteristic
     			* 'set' is called when HomeKit wants to update the value of the characteristic
     		*/
    		this.heaterSwitchService.getCharacteristic(Characteristic.On)
      			.on('get', this.getOnCharacteristicHandlerHeaterSwitch.bind(this))
      			.on('set', this.setOnCharacteristicHandlerHeaterSwitch.bind(this))
		services.push(this.heaterSwitchService);
	}
	if (this.enable_lights){
		//create switch for lights
		this.lightsSwitchService = new Service.Switch(this.name + "_lights");
		/*
     			* For each of the service characteristics we need to register setters and getter functions
     			* 'get' is called when HomeKit wants to retrieve the current state of the characteristic
     			* 'set' is called when HomeKit wants to update the value of the characteristic
     		*/
    		this.lightsSwitchService.getCharacteristic(Characteristic.On)
      			.on('get', this.getOnCharacteristicHandlerLightsSwitch.bind(this))
      			.on('set', this.setOnCharacteristicHandlerLightsSwitch.bind(this))
		services.push(this.lightsSwitchService);
	}
	if (this.enable_horn){
		//create switch for horn
		this.hornSwitchService = new Service.Switch(this.name + "_lights");
		/*
     			* For each of the service characteristics we need to register setters and getter functions
     			* 'get' is called when HomeKit wants to retrieve the current state of the characteristic
     			* 'set' is called when HomeKit wants to update the value of the characteristic
     		*/
    		this.hornSwitchService.getCharacteristic(Characteristic.On)
      			.on('get', this.getOnCharacteristicHandlerHornSwitch.bind(this))
      			.on('set', this.setOnCharacteristicHandlerHornSwitch.bind(this))
		services.push(this.hornSwitchService);
	}
	
	
	
	
  return this.services;
}

BMWConnected.prototype.getauth = function(callback) {
	if (this.needsAuthRefresh() === true) {
		this.log ('Getting Auth Token');
			request.post({
				url: 'https://customer.bmwgroup.com/gcdm/oauth/authenticate',
				headers: {
				'Host':	'customer.bmwgroup.com',
				'Origin':	'https://customer.bmwgroup.com',
				'Accept-Encoding':	'br, gzip, deflate',
				'Content-Type' : 'application/x-www-form-urlencoded',
    		'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_1 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Version/11.0 Mobile/15B150 Safari/604.1',
				'Origin': 'https://customer.bmwgroup.com',
				//'Authorization': 'Basic ' + this.authbasic,
  			},
				form: {
					'username': this.username,
					'password': this.password,
					'client_id':this.client_id,
					'response_type': 'token',
					'redirect_uri':	'https://www.bmw-connecteddrive.com/app/default/static/external-dispatch.html',
					'scope': 'authenticate_user fupo',
					'state': 'eyJtYXJrZXQiOiJnYiIsImxhbmd1YWdlIjoiZW4iLCJkZXN0aW5hdGlvbiI6ImxhbmRpbmdQYWdlIiwicGFyYW1ldGVycyI6Int9In0',
					'locale': 'GB-en'
				}
			},function(err, response, body) {
				 if (!err && response.statusCode == 302) {
					 //this.log('Auth Success!');
					 var d = new Date();
				   var n = d.getTime();
					 var location = response.headers['location'];
					 //this.log(location);
					 var myURL = require('url').parse(location).hash;
					 //this.log(myURL);
					 var arr = myURL.split("&");
					 this.authToken = arr[1].substr(arr[1].indexOf("=")+1);
					 this.refreshtime = n + arr[3].substr(arr[3].indexOf("=")+1) * 1000;
					 this.log ('Got Auth Token: ' + this.authToken);
					 //this.log('Refreshtime: ' + this.refreshtime);
					 callback(null);
				 }
				 else{
				this.log('Error getting Auth Token');
				 callback(response.statusCode);
			 			}
				}.bind(this)
		);
	}
	else{
		callback(null);
	}
}

BMWConnected.prototype.needsAuthRefresh = function () {
	var currentDate = new Date();
  	var now = currentDate.getTime();
 	//this.log("Now   :" + now);
 	//this.log("Later :" + this.refreshtime);
	if (now > this.refreshtime) {
		return true;
	}
	return false;
}
