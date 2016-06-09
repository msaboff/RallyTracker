"use strict";

var statusElement = null;

function status(msg)
{
    statusElement.innerHTML = msg;
}

var metersPerSecToMPH = 2.23694;
var metersPerSecToKnots = 1.94384;
var metersToFeet = 3.28084;
var metersToMiles = 0.000621371;
var metersToNauticalMiles = 0.000539957;
var radiusOfEarthInMiles = 3959;
var radiusOfEarthInNauticalMiles = 3440;
var earthRadius = radiusOfEarthInNauticalMiles;
var magneticVariation = -14;
var useMiles = false;

var currentLocation = null;
var waypointsTableElement = null;
var engineConfigTableElement = null;

if (typeof(Number.prototype.toRadians) === "undefined") {
    Number.prototype.toRadians = function() {
        return this * Math.PI / 180;
    }
}

if (typeof(Number.prototype.toDegrees) === "undefined") {
    Number.prototype.toDegrees = function() {
        return this * 180 / Math.PI;
    }
}

class Time
{
    constructor(time)
    {
        if (time instanceof Date) {
            this.seconds = time.valueOf();
            return;
        }

        if (time instanceof String) {
            // Add later if needed
            this.seconds = 0;
            return;
        }

        if (typeof time == "number") {
            this.seconds = time;
            return;
        }

        this.seconds = 0;
    }

    toString()
    {
        var seconds = this.seconds % 60;
        var minutes = this.seconds / 60 | 0;
        var hours = minutes / 60 | 0;
        minutes = minutes % 60;

        var result = "";
        if (hours)
            result = result + hours + ":";
        if (minutes < 10)
            result = result + "0";
        result = result + minutes + ":";
        if (seconds < 10)
            result = result + "0";
        result = result + seconds;

        return result;
    }
}

class GeoLocation
{
    constructor(latitude, longitude)
    {
	this.latitude = latitude;
	this.longitude = longitude;
    }

    latitudeString()
    {
	var latitude = this.latitude.toFixed(6)
	var latitudeSuffix = "&degN";
	if (latitude < 0) {
	    latitudeSuffix = "&degS"
	    latitude = -latitude;
	}
	return latitude + latitudeSuffix;
    }

    longitudeString()
    {
	var longitude = this.longitude.toFixed(6);
	var longitudeSuffix = "&degE";
	if (longitude < 0) {
	    longitudeSuffix = "&degW"
	    longitude = -longitude;
	}	
	return longitude + longitudeSuffix; 
    }

    distanceTo(otherLocation)
    {
	var dLat = (otherLocation.latitude - this.latitude).toRadians();
	var dLon = (otherLocation.longitude - this.longitude).toRadians(); 
	var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
	    Math.cos(this.latitude.toRadians()) * Math.cos(otherLocation.latitude.toRadians()) * 
	    Math.sin(dLon/2) * Math.sin(dLon/2); 
	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
	return earthRadius * c;
    }
    
    bearingFrom(otherLocation)
    {
	var dLon = (this.longitude - otherLocation.longitude).toRadians();
	var thisLatitudeRadians = this.latitude.toRadians();
	var otherLatitudeRadians = otherLocation.latitude.toRadians();
	var y = Math.sin(dLon) * Math.cos(this.latitude.toRadians());
	var x = Math.cos(otherLatitudeRadians) * Math.sin(thisLatitudeRadians) -
	    Math.sin(otherLatitudeRadians) * Math.cos(thisLatitudeRadians) * Math.cos(dLon);
	return (Math.atan2(y, x).toDegrees() + 720 + magneticVariation) % 360;
    }

    bearingTo(otherLocation)
    {
	var dLon = (otherLocation.longitude - this.longitude).toRadians();
	var thisLatitudeRadians = this.latitude.toRadians();
	var otherLatitudeRadians = otherLocation.latitude.toRadians();
	var y = Math.sin(dLon) * Math.cos(otherLocation.latitude.toRadians());
	var x = Math.cos(thisLatitudeRadians) * Math.sin(otherLatitudeRadians) -
	    Math.sin(thisLatitudeRadians) * Math.cos(otherLatitudeRadians) * Math.cos(dLon);
	return (Math.atan2(y, x).toDegrees() + 720 + magneticVariation) % 360
    }
}

class EngineConfig
{
    constructor(type, rpm, manifoldPressure, fuelFlow, trueAirspeed)
    {
        this.type = type;
        this.rpm = rpm;
        this.manifoldPressure = manifoldPressure;
        this.fuelFlow = fuelFlow;
        this.trueAirspeed = trueAirspeed;

        this.cells = [];
        var rows = engineConfigTableElement.rows;

        for (var i = 0; i < 5; i++)
	    this.cells[i] = rows.item(i).insertCell(-1);

        this.deselect();
    }

    deselect()
    {
        for (var i = 0; i < 5; i++) {
            var classes = "engine-config";
            if (i == 0)
                classes = classes + " engine-config-type";
            this.cells[i].className = classes;
        }

        this.updateTable();
    }
    
    select()
    {
        for (var i = 0; i < 5; i++) {
            var classes = "engine-config-highlight";
            if (i == 0)
                classes = classes + " engine-config-type";
            this.cells[i].className = classes;
        }
 
        this.updateTable();
    }

    updateTable()
    {
	this.cells[0].innerHTML = this.type;
	this.cells[1].innerHTML = this.rpm;
	this.cells[2].innerHTML = this.manifoldPressure;
	this.cells[3].innerHTML = this.fuelFlow;
	this.cells[4].innerHTML = this.trueAirspeed;
    }

    static appendConfig(type, rpm, manifoldPressure, fuelFlow, trueAirspeed)
    {
        if (this.allConfigsByType[type]) {
            status("Duplicate Engine configuration: " + type);
            return;
        }

        var newConfig = new EngineConfig(type, rpm, manifoldPressure, fuelFlow, trueAirspeed);
        this.allConfigs.push(newConfig);
        this.allConfigsByType[type] = newConfig;

    }

    static selectConfig(n)
    {
        if (n == this.currentConfig || n >= this.allConfigs.length)
            return;

        this.allConfigs[this.currentConfig].deselect();
        this.currentConfig = n;
        this.allConfigs[this.currentConfig].select();
    }

    static currentTAS()
    {
        return this.allConfigs[this.currentConfig].trueAirspeed;
    }
}

EngineConfig.allConfigs = [];
EngineConfig.allConfigsByType = {};
EngineConfig.currentConfig = 0;

class LocationStatus
{
    constructor()
    {
        if (useMiles) {
            this.speedConvert = metersPerSecToMPH;
            this.speedUnits = "MPH";
        } else {
            this.speedConvert = metersPerSecToKnots;
            this.speedUnits = "KTS";
        }
        this.heightConvert = metersToFeet;
        this.latitudeElement = document.getElementById("currentLatitude");
        this.longitudeElement = document.getElementById("currentLongitude");
        this.speedElement = document.getElementById("currentSpeed");
        this.courseElement = document.getElementById("currentCourse");
        this.altitudeElement = document.getElementById("currentAltitude");
        this.accuracyElement = document.getElementById("currentAccuracy");
        this.timestampElement = document.getElementById("currentTimeStamp");
        this.currentTimeElement = document.getElementById("currentTime");
        this.timeToWaypointElement = document.getElementById("timeToWaypoint");
        this.timeToGateElement = document.getElementById("timeToGate");
    }
	
    getFeetOrNull(meters)
    {
	var feet = "";
	
	if (meters)
	    feet = (meters * metersToFeet).toFixed(0) + "'";

	return feet;
    }

    update(position)
    {
	var latitude = position.coords.latitude.toFixed(4);
	var latitudeSuffix = "&degN";
	if (latitude < 0) {
	    latitudeSuffix = "&degS"
	    latitude = -latitude;
	}
	this.latitudeElement.innerHTML = latitude + latitudeSuffix;

	var longitude = position.coords.longitude.toFixed(4);
	var longitudeSuffix = "&degE";
	if (longitude < 0) {
	    longitudeSuffix = "&degW"
	    longitude = -longitude;
	}	
	this.longitudeElement.innerHTML = longitude + longitudeSuffix;
	var speed = position.coords.speed * this.speedConvert;
	this.speedElement.innerHTML = speed.toFixed(1) + " " + this.speedUnits;
	var heading = "";
	if (position.coords.heading)
	    heading = position.coords.heading.toFixed(0) + "&deg";
	this.courseElement.innerHTML = heading;
	this.altitudeElement.innerHTML = this.getFeetOrNull(position.coords.altitude);
	this.accuracyElement.innerHTML = this.getFeetOrNull(position.coords.accuracy);
	var time = new Date(position.timestamp);
	this.timestampElement.innerHTML = time.toTimeString().split(" ")[0];
	var now = new Date();
	this.currentTimeElement.innerHTML = now.toTimeString().split(" ")[0];
    }
}

class Leg
{
    constructor(index, fix, location)
    {
	this.index = index;
	this.fix = fix;
	this.location = location;
	this.distance = 0;
        this.cumDistance = 0;
	this.heading = 0;
        this.estTAS = 120;
        this.estGS = 112
        this.actGS = 0;
        this.ete = 0;
        this.ate = 0;
        this.estFuel = 0;
        this.actFuel = 0;
	this.row = waypointsTableElement.insertRow(this.index + 1)
	this.cells = [];
        // Wpt, Lat., Long., Leg Dist., Cumm Dist., Heading, Est TAS, Est GS, Act GS, ETE, ATE, Est Fuel, Act Fuel
	for (var i = 0; i < 13; i++) {
	    this.cells[i] = this.row.insertCell(i);
            this.cells[i].className = "waypoint-cell";
	}
	this.updateTable();
    }
    
    updateTable()
    {
	this.cells[0].innerHTML = this.fix;
	this.cells[1].innerHTML = this.location.latitudeString();
	this.cells[2].innerHTML = this.location.longitudeString();
	this.cells[3].innerHTML = this.distance.toFixed(2);
        this.cells[4].innerHTML = this.cumDistance.toFixed(2);
	this.cells[5].innerHTML = this.heading.toFixed(0);
        this.cells[6].innerHTML = this.estTAS;
        this.cells[7].innerHTML = this.estGS;
        this.cells[8].innerHTML = this.actGS;
        this.cells[9].innerHTML = this.ete ? this.ete.toString() : "";
        this.cells[10].innerHTML = this.ate;
        this.cells[11].innerHTML = this.estFuel;
        this.cells[12].innerHTML = this.actFuel;
    }

    updateDistanceAndBearing(other)
    {
	this.distance = this.location.distanceTo(other);
	this.heading = this.location.bearingFrom(other);
        if (this.ete == 0 && this.estGS != 0) {
            var eteSeconds = Math.round(this.distance * 3600 / this.estGS);
            this.ete = new Time(eteSeconds);
            
            
        }
	this.updateTable();
    }

    static updatePositionToActiveLeg(currentLocation)
    {
        if (this.allLegs.length)
            this.allLegs[this.currentLeg].updateDistanceAndBearing(currentLocation);
    }

    static updateIndecies()
    {
    }

    static updateRows()
    {
        if (this.allLegs.length == 0)
            return;

        var currentLeg = this.allLegs[0];
        for (var i = 1; i < this.allLegs.length; i++) {
            var nextLeg = this.allLegs[i];
            nextLeg.updateDistanceAndBearing(currentLeg.location);
            currentLeg = nextLeg;
        }

        currentLeg = this.allLegs[this.allLegs.length - 1];
        var cumDistance = currentLeg.distance;
        currentLeg.cumDistance = cumDistance;
        
        for (var i = this.allLegs.length - 1; i > 0; i--) {
            var prevLeg = this.allLegs[i - 1];
            cumDistance = cumDistance + prevLeg.distance;
            prevLeg.cumDistance = cumDistance;
            currentLeg.updateTable();
            currentLeg = prevLeg;
        }
    }

    static appendLeg(fix, location)
    {
        var leg = new Leg(this.allLegs.length, fix, location);
        this.allLegs.push(leg);
        this.updateRows();
    }
}

Leg.allLegs = [];
Leg.currentLeg = 0;

var geolocationOptions = {
  enableHighAccuracy: true, 
  maximumAge        : 30000, 
  timeout           : 10000
};

var watchPositionID = 0;
var locationStatus = null;

function startLocationUpdates()
{
    if (navigator.geolocation)
        watchPositionID = navigator.geolocation.watchPosition(logPosition, showGeolocationError, geolocationOptions);
    else
        status("Geolocation is not supported by this browser.");
}

function showGeolocationError(error) {
    switch(error.code) {
    case error.PERMISSION_DENIED:
        status("User denied the request for Geolocation.");
        break;
    case error.POSITION_UNAVAILABLE:
        status("Location information is unavailable.");
        break;
    case error.TIMEOUT:
        status("The request to get user location timed out.");
        break;
    case error.UNKNOWN_ERROR:
        status("An unknown error occurred.");
        break;
    }
}

function logPosition(position) {
    currentLocation = new GeoLocation(position.coords.latitude, position.coords.longitude);

    if (locationStatus)
	locationStatus.update(position);
    Leg.updatePositionToActiveLeg(currentLocation);
}

var userWaypoints = [
    { "name":"OILCAMP", "type":"User", "description":"Oil Camp", "latitude":36.68471, "longitude":-120.50277},
    { "name":"I5.WESTSHIELDS", "type":"User", "description":"I5 & West Shields", "latitude":36.77774, "longitude":-120.72426},
    { "name":"I5.165", "type":"User", "description":"I5 & 165", "latitude":36.93022, "longitude":-120.84068},
    { "name":"I5.VOLTA", "type":"User", "description":"I5 & Volta", "latitude":37.01419, "longitude":-120.92878},
    { "name":"PT.ALPHA", "type":"User", "description":"I5 & 152", "latitude":37.05665, "longitude":-120.96990}
];

var db;
var dbName = "RallyTrackerDB";

function openDB()
{
    var request = indexedDB.open(dbName, 1);

    request.onerror = function(event) {
        status("Could not open " + dbName + " IndexedDB");
        setTimeout(start(), 0);
    };
    request.onsuccess = function(event) {
        db = event.target.result;
         setTimeout(start(), 0);
    };
    request.onupgradeneeded = function(event) {
        db = event.target.result;
        createObjectStores();
    };        
}

function createObjectStores()
{
    var faaWaypointOS = db.createObjectStore("faaWaypoints", { keyPath: "name" });
    faaWaypointOS.createIndex("type", "type", {unique: false });

    var userWaypointOS = db.createObjectStore("userWaypoints", { keyPath: "name" });

    var aircraftOS = db.createObjectStore("aircraft", { keyPath: "nNumber" });

    var flightPlanOS = db.createObjectStore("flightPlans", { keyPath: "name" });
    flightPlanOS.createIndex("description", "description", { unique: false });

    var flightLogOS = db.createObjectStore("flightLogs", { keyPath: "dateFlown" });
    flightLogOS.createIndex("name", "name", { unique: false });

    var faaRecordsLoaded = 0;
    for (var i in faaWaypoints) {
        faaWaypointOS.add(faaWaypoints[i]);
        faaRecordsLoaded++;
    }

    var userRecordsLoaded = 0;
    for (var i in userWaypoints) {
        userWaypointOS.add(userWaypoints[i]);
        userRecordsLoaded++;
    }

    status("Loaded " + faaRecordsLoaded + " FAA and " + userRecordsLoaded + " user records");

    faaWaypointOS.transaction.oncomplete = function(event) {
    };
}

var waypointsToLookup = [];

function getWaypoints(waypoints)
{
    waypointsToLookup = waypoints.split(" ");
    getNextWaypoint();
}

function getNextWaypoint()
{
    if (waypointsToLookup.length) {
        var nextWaypoint = waypointsToLookup.shift();
        getWaypoint(nextWaypoint, waypointResult);
    }
}

function getWaypoint(name, callback)
{
    var transaction = db.transaction(["userWaypoints"], "readonly");
    var waypointsObjectStore = transaction.objectStore("userWaypoints");
    var request = waypointsObjectStore.get(name);

    request.onsuccess = function(event) {
        callback(name, request.result);
    }

    request.onerror = function(event) {
        callback(name, undefined);
    }
}

function waypointResult(name, waypoint)
{
    if (waypoint) {
        Leg.appendLeg(waypoint.name, new GeoLocation(waypoint.latitude, waypoint.longitude));
    } else {
        status("Couldn't find waypoint: " + name);
    }
    getNextWaypoint();
}

function init()
{
    if (useMiles)
	earthRadius = radiusOfEarthInMiles;
    statusElement = document.getElementById("status");
    engineConfigTableElement = document.getElementById("engineConfigs")
    waypointsTableElement = document.getElementById("waypoints");
    locationStatus = new LocationStatus();

    status("Starting...");

    openDB();
}

function start()
{
    getWaypoints("OILCAMP I5.WESTSHIELDS I5.165 I5.VOLTA PT.ALPHA");

    EngineConfig.appendConfig("Cold Taxi", 1000, "Rich", 2.1, 0);
    EngineConfig.appendConfig("Warm Taxi", 1000, "Rich", 1.85, 0);
    EngineConfig.appendConfig("Runup", 1800, "Rich", 5.79, 0);
    EngineConfig.appendConfig("Takeoff", 2700, "Rich", 26.09, 125);
    EngineConfig.appendConfig("Climb", 2500, 25, 19.15, 125);
    EngineConfig.appendConfig("Hi Cruise", 2400, 20, 14.10, 142);
    EngineConfig.appendConfig("Low Cruise", 2400, 20, 14.23, 142);
    EngineConfig.appendConfig("Pattern", 2700, 15, 7.8, 95);
    EngineConfig.selectConfig(6);

//    legs.push(new Leg(0, "Home", new GeoLocation(37.307008, -122)));
//    currentLeg = 0;
    /*
      var laxLocation =  new GeoLocation(33.95, -118.4);
      legs.push(new Leg(0, "KLAX", laxLocation));
      var jfkLocation = new GeoLocation(40.6334, -73.78334);
      var jfkLeg = new Leg(1, "KJFK", jfkLocation);
      jfkLeg.updateDistanceAndBearing(laxLocation);
      legs.push(jfkLeg);
    */

    startLocationUpdates();
}
                            
