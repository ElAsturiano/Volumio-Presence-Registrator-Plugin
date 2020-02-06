'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var Gpio = require('onoff').Gpio;
var io = require('socket.io-client');
var socket = io.connect('http://localhost:3000');


module.exports = presenceRegistrator;
function presenceRegistrator(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
	
	// Global Trigger array
	this.triggers = [];
	
	// Variables for the sensor states
	this.activatedDoor = 0;
	this.activatedRoom = 0;
	
	// Current Volume
	this.currVol = 0;
	
	// Goal Volume
	this.goalVolume = 0;
	
	// Fading status
	this.fading = false;
	
	// Refreshing status
	this.refreshingDevices = false;
	this.updatingConfig = false;
	// Volume increment
	this.increment = 2;
	
	// Arrays for Presence Devices and States
	this.presenceDevices = [];
	this.presenceStates = [];
	this.temp_PresenceDevices = [];
	this.pSelf;
	
	// Socket Port
	this.socket_port = ":3000";
	
}

presenceRegistrator.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);
	
	// Log Plugin start
	self.logger.info("Presence Registrator initialized.");

    return libQ.resolve();
}

presenceRegistrator.prototype.onStart = function() {
    var self = this;
	var defer=libQ.defer();
	
	// Log Plugin start
	self.logger.info("Presence Registrator started.");
	
	// Set config
	self.config.set('enabled',true);
	
	// Clear all Triggers and set them again
	self.clearTriggers()
		.then(self.createTriggers());
	
	// Notify user about Plugin start
	self.commandRouter.pushToastMessage('success', "Hola!", "Presence Registrator enabled!");
	
	// Once the Plugin has successfully started and refreshed the volume resolve the promise
	self.refreshVolume()
		.then(function(){
			self.logger.info("PRESENCE REGISTRATOR: Current Volume: " + self.currVol);
			self.refreshDevices().then(defer.resolve());
		});

    return defer.promise;
};

presenceRegistrator.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();
	
	// Log Plugin stop
	self.logger.info("Presence Registrator stopped.");
	
	// Set config
	self.config.set('enabled',false);
	
	// Notify user about Plugin stop
	self.commandRouter.pushToastMessage('success', "Adios!", "Presence Registrator disabled!");
	
    // Once the Plugin has successfull stopped and the triggers deleted resolve the promise
	self.clearTriggers()
		.then(defer.resolve());

    return defer.promise;
};

presenceRegistrator.prototype.onRestart = function() {
    var self = this;
	self.onStop()
		.then(function(){
			self.onVolumioStart()
				.then(self.onStart());
		});
};


// Configuration Methods -----------------------------------------------------------------------------

presenceRegistrator.prototype.getUIConfig = function() {
    var self = this;
	self.updatingConfig = true;
	var defer = libQ.defer();
    var lang_code = this.commandRouter.sharedVars.get('language_code');
	self.refreshDevices()
		.then(function(){
			self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
				__dirname+'/i18n/strings_en.json',
				__dirname + '/UIConfig.json')
				.then(function(uiconf)
				{
					
					self.logger.info("PRESENCE REGISTRATOR: populating UI...");
					
					// Populate the UI configuration page with 
					uiconf.sections[0].content[0].value = self.config.get('maxVol');
					uiconf.sections[0].content[1].value = self.config.get('minVol');
					uiconf.sections[0].content[2].value = self.config.get('listenedPinDoor');
					uiconf.sections[0].content[3].value = self.config.get('listenedPinRoom');
					uiconf.sections[0].content[4].value = self.config.get('fadeConf');

					
					self.logger.info("PRESENCE REGISTRATOR: Number of Devices: " + self.presenceDevices.length);
					
					// Popluate presence Host list
					var hostIsSelf = false;
					for (var n = 0; n < self.presenceDevices.length; n++){		
						var temp_name = self.presenceDevices[n].name;
						var temp_url = self.extractURL(self.presenceDevices[n]);
						self.logger.info("PRESENCE REGISTRATOR: Device: " + temp_name + ", " + temp_url);
						if(self.presenceDevices[n].isSelf == true)
						{
							if(self.config.get('presenceHost') == temp_url){
								hostIsSelf = true;
							}
							temp_name = (temp_name + " [self]");
							uiconf.sections[0].content[5].options.push({
								"value": temp_url,
								"label": temp_name
							});
							
						}
						else
						{
							uiconf.sections[0].content[5].options.push({
								"value": temp_url,
								"label": temp_name
							});
						}
						
						if(temp_url == self.config.get('presenceHost'))
						{
							uiconf.sections[0].content[5].value.value = temp_url;
							uiconf.sections[0].content[5].value.label = temp_name;
						}
						
					}
					
					self.logger.info("PRESENCE REGISTRATOR: Devices read.");
								
					if (hostIsSelf){
						self.logger.info("PRESENCE REGISTRATOR: Host is self: " + hostIsSelf + " (" + typeof(hostIsSelf) + ").");
						var new_sec = {
							"id": "section_presences",
							"element": "section",
							"label": "Presence States",
							"icon": "fa-plug",
							"content": [
							]
						};
						uiconf.sections.push(new_sec);
						self.presenceStates.forEach(function(tmp_state, index, array) {
							if (tmp_state.device){
								var uiToPush = {
									"id": self.extractURL(tmp_state.device),
									"element": "switch",
									"doc": "Presence State in the Room of device " + tmp_state.device.name,
									"label": "State of " + tmp_state.device.name,
									"value": tmp_state.state
								}
								uiconf.sections[1].content.push(uiToPush);
							}
						});
					
					}
					self.logger.info("PRESENCE REGISTRATOR: UI populated!");
					self.updatingConfig = false;
					defer.resolve(uiconf);
				})
				.fail(function(){
					defer.reject(new Error());
				});
		});
    return defer.promise;
};

presenceRegistrator.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

presenceRegistrator.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

presenceRegistrator.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

presenceRegistrator.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};




// ******************************************************************************************
// Custom functions to save and retrieve config parameters

// Save config parameters from config.json file
presenceRegistrator.prototype.saveConfig = function(data)
{
	var self = this;
	var defer = libQ.defer();
	
	self.logger.info("PRESENCE REGISTRATOR: Attempting to save parameters");
	self.config.set('maxVol', data['maxVol']);
	self.config.set('minVol', data['minVol']);
	self.config.set('listenedPinDoor', data['listenedPinDoor']);
	self.config.set('listenedPinRoom', data['listenedPinRoom']);
	self.config.set('fadeConf', data['fadeConf']);
	self.config.set('presenceHost', data['volumio_host'].value);
	
	// Extract configuration parameters from config file
	var maxVol = self.config.get('maxVol');
	var minVol = self.config.get('minVol');
	var pinDoor = self.config.get('listenedPinDoor');
	var pinRoom = self.config.get('listenedPinRoom');
	var fadeConf = self.config.get('fadeConf');
	var newHost = self.config.get('presenceHost');
	
	if (maxVol == null || minVol == null || pinDoor == null || pinRoom == null || fadeConf == null || newHost == null){
		var outstr = "Could not save Config as at least one variable was not defined.";
		self.logger.info("PRESENCE REGISTRATOR: " + outstr);
		self.commandRouter.pushToastMessage('error',"Presence Registrator", outstr);
		defer.reject(new Error());
	} else{
		// Clear all Triggers and set them again
		self.clearTriggers()
			.then(self.createTriggers());
			
		self.pushNewHost()
			.then(function(){
				// Notify log and user about the config parameters
				self.logger.info("PRESENCE REGISTRATOR: New configuration saved.");
				var outstr = "Listening on Pins " + pinDoor + "(Door) and " + pinRoom + "(Room) with a maximum Volume of " + maxVol + "% and a minimum Volume of " + minVol + "%. Fading activated: " + fadeConf + ". New Host is: " + newHost;
				self.logger.info("PRESENCE REGISTRATOR: " + outstr);
				self.commandRouter.pushToastMessage('success',"Presence Registrator", outstr);
				defer.resolve();
			});
	}
	return defer.promise;
};

// Function to refresh the UI 
presenceRegistrator.prototype.refreshUIConfig = function() {
	var self = this;
	if(self.updatingConfig == false){
		var respconfig = self.commandRouter.getUIConfigOnPlugin('system_controller', 'presence_registrator', {});
		respconfig.then(function(config){
			self.commandRouter.broadcastMessage('pushUiConfig', config);
		});
	}
}

// Same as above but update Host with presence before refreshing UI
presenceRegistrator.prototype.refreshUIConfigUpHost = function() {
	var self = this;
	
	self.updateHost();
	self.refreshUIConfig();
}

// End of custom configuration functions
// ******************************************************************************************


// ******************************************************************************************
// Custom functions to set and clear Triggers on the Gpio Pins

// Create Triggers from config data
presenceRegistrator.prototype.createTriggers = function()
{
	var self = this;
	var defer = libQ.defer();
	
	// Read config parameters
	var pinDoor = self.config.get('listenedPinDoor');
	var pinRoom = self.config.get('listenedPinRoom');
	
	if (pinDoor == null || pinRoom == null){
		self.logger.info("PRESENCE REGISTRATOR: Could not activate interrupts.");
		defer.reject();
	} else{
		// Log what I am doing
		self.logger.info("PRESENCE REGISTRATOR: Attempting to set up Trigger on pins " + pinDoor + "(Door) and " + pinRoom + "(Room).");
		
		// Create rising and falling Trigger on configured pin
		var listenerDoor = new Gpio(pinDoor,'in','both', {debounceTimeout: 250});
		var listenerRoom = new Gpio(pinRoom,'in','both', {debounceTimeout: 250});
		self.logger.info("PRESENCE REGISTRATOR: Created Triggers.");
		
		// Define Interrupt handlers
		listenerDoor.watch((err,value) => {
			if (err) {
				self.logger.info("PRESENCE REGISTRATOR: Could not activate interrupt on pin " + pinDoor + "(Door).");
			}
			self.presenceChangerDoor(value);
		});
		self.logger.info("PRESENCE REGISTRATOR: Assigned Interrupt Handler Door.");
		
		listenerRoom.watch((err,value) => {
			if (err) {
				self.logger.info("PRESENCE REGISTRATOR: Could not activate interrupt on pin " + pinRoom + "(Room).");
			}
			self.presenceChangerRoom(value);
		});
		self.logger.info("PRESENCE REGISTRATOR: Assigned Interrupt Handler Room.");
		
		// Add Trigger to global Trigger array
		self.triggers.push(listenerDoor);
		self.triggers.push(listenerRoom);
		self.logger.info("PRESENCE REGISTRATOR: Added Triggers to Global Array");
		
		// Resolve promise
		defer.resolve();
	}
	
	return defer.promise;
}

// Clear all active Triggers
presenceRegistrator.prototype.clearTriggers = function()
{
	var self = this;
	var defer = libQ.defer();
	
	// Log what I am doing
	self.logger.info("PRESENCE REGISTRATOR: Attempting to delete all Triggers.");
	
	// Cycle through Trigger array deleting all Triggers
	self.triggers.forEach(function(trigger, index, array) {
		trigger.unwatchAll();
		trigger.unexport();
	});
	self.triggers = [];
	self.logger.info("PRESENCE REGISTRATOR: Deleted all Triggers.");
	
	defer.resolve();
	
	return defer.promise;	
};

// Interrupt handler function Door
presenceRegistrator.prototype.presenceChangerDoor = function(value)
{
	var self = this;
	
	// Check if there was a rising (1) or a falling (0) edge on the GPIO Pin
	if (value > 0) {
		self.activatedDoor = 1;
	} else {
		self.activatedDoor = -1;
		if(self.activatedRoom == -1){
			self.changeVolume(false);
		}
	}
	
	return libQ.resolve();
}

// Interrupt handler function Door
presenceRegistrator.prototype.presenceChangerRoom = function(value)
{
	var self = this;
	
	// Check if there was a rising (1) or a falling (0) edge on the GPIO Pin
	if (value > 0) {
		self.activatedRoom = 1;
		self.changeVolume(true);
		
	} else {
		self.activatedRoom = -1;
	}
	
	return libQ.resolve();
}

// Function to change volume (if value true -> elevate volume, else lower it)
presenceRegistrator.prototype.changeVolume = function(value)
{
	var self = this;
	
	// Get config data
	var maxVol = parseInt(self.config.get('maxVol'));
	var minVol = parseInt(self.config.get('minVol'));
	var present_old = self.config.get('present');
	var fadeConf = self.config.get('fadeConf');
	var compVal;
	
	// as sometimes the type of fadeConf is a boolean and other times a string, a comparison value has to be created accordingly
	if ((typeof fadeConf) == "boolean"){
		compVal = true;
	}else{
		compVal = "true";
	}
	
	// Create new variables for this execution
	var present;
	var outstr;
	
	// Check if the value is true (--> volume should increase) or false (--> volume should decrease)
	if (value) {
		present = true;
		outstr = "full";
		self.goalVolume = maxVol;
	}else{
		present = false;
		outstr = "empty";
		self.goalVolume = minVol;
	}
	
	// Check if presence has changed
	if (present != present_old){
		
		// Write new presence information to config
		self.config.set('present',present);
		
		// Set new volume by either fading or directly depending on configuration read from config data (Notice: Somehow, volumio saves fadeConfig as a String. Therefore it is to be treated as such in the code; hence the comparison with "")
		if (fadeConf == compVal){
			// Volume has to be faded until the goal Volume is reached, new function is called
			self.logger.info("PRESENCE REGISTRATOR: Began fading volume: Step 1"); // debugging log
			if (self.fading == false){
				self.logger.info("PRESENCE REGISTRATOR: Began fading volume: Step 2");
				self.fading = true;
				self.refreshVolume().then(self.fadeVolume().then(self.fading = false));
			}
		} else{
			// Volume has to change instantly, command is sent per websocket command
			//self.logger.info("PRESENCE REGISTRATOR: NOT fading volume. Fadeconf = " + fadeConf + ". It is a " + typeof fadeConf); // debugging log
			socket.emit('volume',self.goalVolume);
		}
		
		self.pushPresence();
		
		// Notify log and user about it
		self.logger.info("PRESENCE REGISTRATOR: The room is now " + outstr + ".");
		self.commandRouter.pushToastMessage('success',"Presence Registrator", "The room is now " + outstr + ".");
	}
	return libQ.resolve();
}

// Custom function to fade Volume to the custom value goalVol
presenceRegistrator.prototype.fadeVolume = function()
{
	var self = this;
	var defer = libQ.defer();
	self.logger.info("PRESENCE REGISTRATOR: Fading volume: Step 3");
	// Refresh the volume then continue fading
	//self.refreshVolume()
	//.then(function(){
		// Compare current volume to goal volume
		if ((self.currVol > (self.goalVolume - self.increment)) && (self.currVol < (self.goalVolume + self.increment))){
			// If goalVolume in increment range is reached, emit final volume and resolve promise
			socket.emit('volume',self.goalVolume);
			self.logger.info("PRESENCE REGISTRATOR: Fading volume: Promise solved; currVol: " + self.currVol + ", goalVolume: " + self.goalVolume);
			defer.resolve();
		}else{
			self.logger.info("PRESENCE REGISTRATOR: Fading volume: Promise not yet solved");
			// Else check if it has to go up or down
			if (self.currVol < self.goalVolume){
				// if lower, add increment to the current volume
				self.currVol = self.currVol + self.increment;
			}else{
				// else if higher (if equal it should not get to this point), substract increment from current volume
				self.currVol = self.currVol - self.increment;
			}
					
			// Emit new current Volume
			socket.emit('volume', self.currVol);
			
			// Call this function recursively with a timeout defined as second argument of 'setTimeout' in ms
			setTimeout(function() {
				self.fadeVolume().then(defer.resolve());
			}, 50);
		}
	//});
	return defer.promise;	
}

presenceRegistrator.prototype.refreshVolume = function()
{
	var self = this;
	var defer = libQ.defer();
	
	self.logger.info("PRESENCE REGISTRATOR: Asking for Volume.");
	socket.emit('getState', '');
	socket.once('pushState', function(data) {
		self.logger.info("PRESENCE REGISTRATOR: Got the Volume: " + data.volume + "(" + typeof data.volume + ")");
		self.currVol = parseInt(data.volume);
		self.logger.info("PRESENCE REGISTRATOR: Saved Volume: " + self.currVol + "(" + typeof self.currVol + ")");
		defer.resolve();
	});
	
	return defer.promise;
}

// End of custom Trigger functions
// ******************************************************************************************



// ******************************************************************************************
// Start of custom Socket-reporting functions

// This function refreshes the List of Multiroom Volumio devices
presenceRegistrator.prototype.refreshDevices = function() {
	var self = this;
	var defer = libQ.defer();
	
	if (self.refreshingDevices == false){
		self.refreshingDevices = true;
		// Ask for Multiroom devices
		socket.emit('getMultiRoomDevices', '');
		
		socket.once('pushMultiRoomDevices', function(data) {
			// Refresh Device List with Multiroom devices and empty array with index 0
			self.logger.info("PRESENCE REGISTRATOR: Refreshing " + data.list.length +" Multiroom Devices");
			self.temp_PresenceDevices = [];
			self.refreshDevicesList(data.list, 0).then(function(){
				self.logger.info("PRESENCE REGISTRATOR: Refreshed Multiroom Devices");
				self.refreshingDevices = false;
				defer.resolve();
			});
		});
	} else{
		self.logger.info("PRESENCE REGISTRATOR: Already Refreshing Multiroom Devices: " + self.refreshingDevices);
		defer.resolve();
	}
	return defer.promise;
}

// This function is auxiliary to refreshing the List of Multiroom Volumio devices (recursive)
presenceRegistrator.prototype.refreshDevicesList = function(dev_data, i) {
	var self = this;
	var defer = libQ.defer();
	
	self.logger.info("PRESENCE REGISTRATOR: Refreshing Devices, loop No " + i + " from " + dev_data.length);
	
	if (i < dev_data.length) {
		
		self.getPluginStatus(dev_data[i])
			.then(function(){
				self.refreshDevicesList(dev_data, (i+1)).then(defer.resolve());
			});
	
	} else {
		self.presenceDevices = [];
		self.presenceDevices = self.temp_PresenceDevices;
		self.logger.info("PRESENCE REGISTRATOR: Refreshed.");
		defer.resolve();
	}
	return defer.promise;
}

// Function that reads if a device has the presence registrator and it is activated
presenceRegistrator.prototype.getPluginStatus = function(device_data){
	var self = this;
	var defer = libQ.defer();
	
	var temporary_socket = io(self.extractURL(device_data));
	
	temporary_socket.emit('getInstalledPlugins', '');
	temporary_socket.once('pushInstalledPlugins',function(data){
		data.forEach(function(tmp_plugin, index, array) {
			self.logger.info("PRESENCE REGISTRATOR: Checking Plugin No " + index);
			var tmp_name = tmp_plugin.name;
			var tmp_active = tmp_plugin.active;
			self.logger.info("PRESENCE REGISTRATOR: Checking Plugins... " + tmp_name + " (" + typeof tmp_name + ") is " + tmp_active + " (" + typeof tmp_active + ").");
			if (tmp_name == "presence_registrator"){
				if (tmp_active == true){
					self.temp_PresenceDevices.push(device_data);
				}
			}
		});
		defer.resolve();
	});
	
	return defer.promise;
}

// This function sends a command to all presence devices to update their hosts
presenceRegistrator.prototype.updateHost = function(){
	var self = this;
	self.presenceDevices.forEach(function(tmp_device, index, array){
		var temp_url = self.extractURL(tmp_device);
		var temporary_socket = io(temp_url);
		temporary_socket.emit('callMethod', {endpoint:'system_controller/presence_registrator',method:'pushPresence'});
	});
}

// Function which pushes the presence state to a defined recipient device 
presenceRegistrator.prototype.pushPresence = function() {
	var self = this;
	
	// Check if own device has already been identified
	if (self.pSelf == null){
		self.presenceDevices.forEach(function(device, index, array) {
			if (device.isSelf){
				self.pSelf = device;
			}
		});
	}
	
	// Prepare data to send to host
	var temp_recipient = self.config.get('presenceHost');
	var message_data = {'presenceDevice':self.pSelf,'presenceState':self.config.get('present')};
	
	// Open socket and send data to recipient
	var temporary_socket = io(temp_recipient);
	temporary_socket.emit('callMethod', {endpoint:'system_controller/presence_registrator',method:'registerPresence', data:message_data});
	//temporary_socket.close();
}

// Function which gets the new presence of other devices
presenceRegistrator.prototype.registerPresence = function(data) {
	var self = this;
	
	// Check if presenceStates maybe doesnt exist
	if (!self.presenceStates){
		self.presenceStates = [];
	}
	
	// Refresh the States list with new information
	self.refreshStates(data);
	
	// Log complete List
	self.presenceStates.forEach(function(tmp_state, index, array) {
		if (tmp_state.device){
			var temp_name = tmp_state.device.name;
			var temp_state = tmp_state.state;
			self.logger.info("PRESENCE REGISTRATOR: New State for " + temp_name + " is " + temp_state);
		}
	});
	self.refreshUIConfig();
}

// Function that adds refreshes a devices state in the state list
presenceRegistrator.prototype.refreshStates = function(data) {
	var self = this;
	var temp_presenceDevice = data.presenceDevice;
	var temp_presenceState = data.presenceState;
	var exists = false;
	self.presenceStates.forEach(function(tmp_state, index, array) {
		if (temp_presenceDevice && tmp_state.device){
			if (temp_presenceDevice.name == tmp_state.device.name){
				self.presenceStates[index].state = temp_presenceState;
				exists = true;
			}
		}
	});
	if (exists == false){
		self.presenceStates.push({'device':temp_presenceDevice,'state':temp_presenceState});
	}
}

// Function which defines the new host to report to
presenceRegistrator.prototype.setNewHost = function(data) {
	var self = this;
	self.config.set('presenceHost', data);
	self.refreshUIConfigUpHost();
}

// Function which reports the new host to all devices
presenceRegistrator.prototype.pushNewHost = function() {
	var self = this;
	var defer = libQ.defer();
	
	var temp_host = self.config.get('presenceHost');
	var temp_devices = self.presenceDevices;
	// Go through all known devices and set the new host
	temp_devices.forEach(function(device, index, array) {
		var temp_url = self.extractURL(device);
		var temporary_socket = io(temp_url);
		temporary_socket.emit('callMethod', {endpoint:'system_controller/presence_registrator',method:'setNewHost', data:temp_host});
	});
	
	defer.resolve();
	return defer.promise;
	
}

// Function that extracts a devices IP and returns it as URL
presenceRegistrator.prototype.extractURL = function(data) {
	var self = this;
	
	// Extract IP from Albumart, as it is more reliable than 'host'
	var str = data.state.albumart;
	
	// Delete the Albumart section of the IP (last 9 characters)
	var newStr = str.substring(0, str.length - 9);
	
	// Return URL as IP + Port
	return (newStr + self.socket_port);
}

// End of custom Socket-reporting functions
// ******************************************************************************************



// Playback Controls ---------------------------------------------------------------------------------------
// If your plugin is not a music_sevice don't use this part and delete it


presenceRegistrator.prototype.addToBrowseSources = function () {

	// Use this function to add your music service plugin to music sources
    //var data = {name: 'Spotify', uri: 'spotify',plugin_type:'music_service',plugin_name:'spop'};
    this.commandRouter.volumioAddToBrowseSources(data);
};

presenceRegistrator.prototype.handleBrowseUri = function (curUri) {
    var self = this;

    //self.commandRouter.logger.info(curUri);
    var response;


    return response;
};



// Define a method to clear, add, and play an array of tracks
presenceRegistrator.prototype.clearAddPlayTrack = function(track) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'presenceRegistrator::clearAddPlayTrack');

	self.commandRouter.logger.info(JSON.stringify(track));

	return self.sendSpopCommand('uplay', [track.uri]);
};

presenceRegistrator.prototype.seek = function (timepos) {
    this.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'presenceRegistrator::seek to ' + timepos);

    return this.sendSpopCommand('seek '+timepos, []);
};

// Stop
presenceRegistrator.prototype.stop = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'presenceRegistrator::stop');


};

// Spop pause
presenceRegistrator.prototype.pause = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'presenceRegistrator::pause');


};

// Get state
presenceRegistrator.prototype.getState = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'presenceRegistrator::getState');


};

//Parse state
presenceRegistrator.prototype.parseState = function(sState) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'presenceRegistrator::parseState');

	//Use this method to parse the state and eventually send it with the following function
};

// Announce updated State
presenceRegistrator.prototype.pushState = function(state) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'presenceRegistrator::pushState');

	return self.commandRouter.servicePushState(state, self.servicename);
};


presenceRegistrator.prototype.explodeUri = function(uri) {
	var self = this;
	var defer=libQ.defer();

	// Mandatory: retrieve all info for a given URI

	return defer.promise;
};

presenceRegistrator.prototype.getAlbumArt = function (data, path) {

	var artist, album;

	if (data != undefined && data.path != undefined) {
		path = data.path;
	}

	var web;

	if (data != undefined && data.artist != undefined) {
		artist = data.artist;
		if (data.album != undefined)
			album = data.album;
		else album = data.artist;

		web = '?web=' + nodetools.urlEncode(artist) + '/' + nodetools.urlEncode(album) + '/large'
	}

	var url = '/albumart';

	if (web != undefined)
		url = url + web;

	if (web != undefined && path != undefined)
		url = url + '&';
	else if (path != undefined)
		url = url + '?';

	if (path != undefined)
		url = url + 'path=' + nodetools.urlEncode(path);

	return url;
};





presenceRegistrator.prototype.search = function (query) {
	var self=this;
	var defer=libQ.defer();

	// Mandatory, search. You can divide the search in sections using following functions

	return defer.promise;
};

presenceRegistrator.prototype._searchArtists = function (results) {

};

presenceRegistrator.prototype._searchAlbums = function (results) {

};

presenceRegistrator.prototype._searchPlaylists = function (results) {


};

presenceRegistrator.prototype._searchTracks = function (results) {

};

presenceRegistrator.prototype.goto=function(data){
    var self=this
    var defer=libQ.defer()

// Handle go to artist and go to album function

     return defer.promise;
};
