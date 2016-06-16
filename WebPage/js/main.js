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

var state = "Stopped";
var timeUpdateInterval = 0;
var startTime = null;
var lastUpdate = new Date();
var legStartTime = null;
var distanceToWaypoint = 0;
var etaWaypoint = 0;
var etaGate = 0;
var deltaTime = 0;

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
            this.seconds = time.valueOf() / 1000;;
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

    add(otherTime)
    {
        return new Time(this.seconds + otherTime.seconds);
    }

    addDate(otherDate)
    {
        return new Date(this.seconds * 1000 + otherDate.valueOf());
    }

    static differenceBetween(time2, time1)
    {
        return new Time(((time2.valueOf() - time1.valueOf()) / 1000) | 0);
    }

    seconds()
    {
        return this.seconds;
    }

    minutes()
    {
        return this.seconds / 60;
    }

    hours()
    {
        return this.seconds / 3600;
    }

    toString()
    {
        var result = "";
        var seconds = this.seconds % 60;
        if (seconds < 0) {
            result = "-";
            seconds = -seconds;
        }
        var minutes = this.seconds / 60 | 0;
        var hours = minutes / 60 | 0;
        minutes = minutes % 60;

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

    locationFrom(bearing, distance)
    {
        var bearingRadians = (bearing - magneticVariation).toRadians();
        var thisLatitudeRadians = this.latitude.toRadians();
        var angularDistance = distance / earthRadius;
        var latitudeRadians = Math.asin(Math.sin(thisLatitudeRadians) * Math.cos(angularDistance) +
                                 Math.cos(thisLatitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians));
        var longitudeRadians = this.longitude.toRadians() +
            Math.atan2(Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(thisLatitudeRadians),
                       Math.cos(angularDistance) - Math.sin(thisLatitudeRadians) * Math.sin(latitudeRadians));

        return new GeoLocation(latitudeRadians.toDegrees(), longitudeRadians.toDegrees());
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

        this.redraw();
    }
    
    select()
    {
        for (var i = 0; i < 5; i++) {
            var classes = "engine-config-highlight";
            if (i == 0)
                classes = classes + " engine-config-type";
            this.cells[i].className = classes;
        }
 
        this.redraw();
    }

    redraw()
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
        this.recentGroundSpeeds = [];
        this.latitudeElement = document.getElementById("currentLatitude");
        this.longitudeElement = document.getElementById("currentLongitude");
        this.speedElement = document.getElementById("currentSpeed");
        this.averageSpeedElement = document.getElementById("averageSpeed");
        this.requiredGSElement = document.getElementById("requiredGS");
        this.deltaGSElement = document.getElementById("deltaGS");
        this.courseElement = document.getElementById("currentCourse");
        this.altitudeElement = document.getElementById("currentAltitude");
        this.accuracyElement = document.getElementById("currentAccuracy");
        this.timestampElement = document.getElementById("currentTimeStamp");
        this.currentTimeElement = document.getElementById("currentTime");
        this.distanceToWaypointElement = document.getElementById("distanceToWaypoint");
        this.timeToWaypointElement = document.getElementById("timeToWaypoint");
        this.timeToGateElement = document.getElementById("timeToGate");
        this.deltaTimeElement = document.getElementById("deltaTime");
    }

    getFeetOrNull(meters)
    {
        var feet = "";

        if (meters)
            feet = (meters * metersToFeet).toFixed(0) + "'";

        return feet;
    }

    update(now, position, requiredSpeed)
    {
        if (position) {
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
            var currentSpeed = position.coords.speed * this.speedConvert;
            this.speedElement.innerHTML = currentSpeed.toFixed(1) + " " + this.speedUnits;
            this.recentGroundSpeeds.unshift(currentSpeed);
            if (this.recentGroundSpeeds.length > 10) {
                this.recentGroundSpeeds.pop();
            }
            var averageSpeed = 0;
            var numberSpeeds = this.recentGroundSpeeds.length;
            for (var i = 0; i < numberSpeeds; i++)
                averageSpeed += this.recentGroundSpeeds[i];
            averageSpeed = averageSpeed / numberSpeeds;
            this.averageSpeedElement.innerHTML = averageSpeed.toFixed(1);
            if (typeof requiredSpeed == "string") {
                this.requiredGSElement.innerHTML = requiredSpeed;
                this.deltaGSElement.innerHTML = "";
                this.deltaGSElement.className = "status-center";
            } else {
                this.requiredGSElement.innerHTML = requiredSpeed.toFixed(1) + " " + this.speedUnits;
                var deltaGS = currentSpeed - requiredSpeed;
                if (deltaGS > 1.0) {
                    this.deltaGSElement.className = "status-center delta-speed-ahead";
                } else if (deltaGS < -1.0) {
                    this.deltaGSElement.className = "status-center delta-speed-behind";
                } else {
                    this.deltaGSElement.className = "status-center delta-speed-close";
                }
                this.deltaGSElement.innerHTML = deltaGS.toFixed(1) + " " + this.speedUnits;
            }
            var heading = "";
            if (position.coords.heading)
                heading = position.coords.heading.toFixed(0) + "&deg";
            this.courseElement.innerHTML = heading;
            this.altitudeElement.innerHTML = this.getFeetOrNull(position.coords.altitude);
            this.accuracyElement.innerHTML = this.getFeetOrNull(position.coords.accuracy);
            var time = new Date(position.timestamp);
            this.timestampElement.innerHTML = time.toTimeString().split(" ")[0];
        }
        this.currentTimeElement.innerHTML = now.toTimeString().split(" ")[0];
        this.distanceToWaypointElement.innerHTML = distanceToWaypoint.toFixed(2);
        if (etaWaypoint instanceof Date)
            this.timeToWaypointElement.innerHTML = etaWaypoint.toTimeString().split(" ")[0];
        if (etaGate instanceof Date)
            this.timeToGateElement.innerHTML = etaGate.toTimeString().split(" ")[0];
        this.deltaTimeElement.innerHTML = deltaTime ? deltaTime.toString() : "";
    }

    resetAverageGS()
    {
        this.recentGroundSpeeds = [];
    }
}

class Waypoint
{
    constructor(name, type, description, latitude, longitude)
    {
        this.name = name;
        this.type = type;
        this.description = description;
        this.latitude = latitude;
        this.longitude = longitude;
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
        this.distanceRemaining = 0;
        this.distanceRemainingAfterThisLeg = 0;
        this.heading = 0;
        this.estTAS = 140;
        this.estGS = 140;
        this.actGS = 0;
        this.ete = 0;
        this.ate = 0;
        this.startTime = 0;
        this.endTime = 0;
        this.timeRemaining = 0;
        this.timeRemainingAfterThisLeg = 0;
        this.estFuel = 0;
        this.actFuel = 0;
        this.row = waypointsTableElement.insertRow(this.index + 1)
        this.cells = [];
        // Wpt, Lat, Long, Leg Dist, Dist remain, Hdg, Est TAS, Est GS, Act GS, ETE, ATE, Time reamin, Est Fuel, Act Fuel
        for (var i = 0; i < 14; i++) {
            this.cells[i] = this.row.insertCell(i);
            this.cells[i].className = "waypoint-cell";
        }
        this.redrawNeeded = true;
        this.redraw();
    }

    remove()
    {
        waypointsTableElement.deleteRow(this.row.rowIndex);
        Leg.allLegs.splice(this.index, 1);
        Leg.updateRows();
    }

    redraw()
    {
        if (!this.redrawNeeded)
            return;

        this.cells[0].innerHTML = this.fix;
        this.cells[1].innerHTML = this.location.latitudeString();
        this.cells[2].innerHTML = this.location.longitudeString();
        this.cells[3].innerHTML = this.distance.toFixed(2);
        this.cells[4].innerHTML = this.distanceRemaining.toFixed(2);
        this.cells[5].innerHTML = this.heading.toFixed(0);
        this.cells[6].innerHTML = this.estTAS;
        this.cells[7].innerHTML = this.estGS;
        this.cells[8].innerHTML = this.actGS;
        this.cells[9].innerHTML = this.ete ? this.ete.toString() : "";
        this.cells[10].innerHTML = this.ate ? this.ate.toString() : "";;
        this.cells[11].innerHTML = this.timeRemaining;
        this.cells[12].innerHTML = this.estFuel;
        this.cells[13].innerHTML = this.actFuel;
        this.redrawNeeded = false;
    }

    select()
    {
        for (var i = 0; i < 14; i++)
            this.cells[i].className = "waypoint-cell-highlight";
    }

    deselect()
    {
        for (var i = 0; i < 14; i++)
            this.cells[i].className = "waypoint-cell";
    }

    updateDistanceAndBearing(other)
    {
        this.distance = this.location.distanceTo(other);
        this.heading = this.location.bearingFrom(other);
        if (this.ete == 0 && this.estGS != 0) {
            var eteSeconds = Math.round(this.distance * 3600 / this.estGS);
            this.ete = new Time(eteSeconds);
        }

        this.redrawNeeded = true;
    }

    updateATE(date)
    {
        this.ate = Time.differenceBetween(date, this.startTime);

        this.redrawNeeded = true;
    }

    static getCurrentLeg()
    {
        if (this.allLegs.length)
            return this.currentLeg;

        return undefined;
    }

    static updatePositionToActiveLeg(currentLocation)
    {
        if (this.allLegs.length && this.currentLeg) {
            this.currentLeg.updateDistanceAndBearing(currentLocation);
            distanceToWaypoint = this.currentLeg.distance;
            return this.currentLeg.distance + this.currentLeg.distanceRemainingAfterThisLeg;
        }
        return 0;
    }

    static updateIndecies()
    {
    }

    static updateRows()
    {
        if (this.allLegs.length == 0)
            return;

        var thisLeg = this.allLegs[0];
        thisLeg.index = 0;
        thisLeg.ete = new Time(0);
        for (var i = 1; i < this.allLegs.length; i++) {
            var nextLeg = this.allLegs[i];
            nextLeg.index = i;
            nextLeg.updateDistanceAndBearing(thisLeg.location);
            thisLeg = nextLeg;
        }

        thisLeg = this.allLegs[this.allLegs.length - 1];
        var distanceRemaining = thisLeg.distance;
        var timeRemaining = thisLeg.ete;
        thisLeg.distanceRemainingAfterThisLeg = 0;
        thisLeg.distanceRemaining = distanceRemaining;
        thisLeg.timeRemainingAfterThisLeg = new Time(0);
        thisLeg.timeRemaining = timeRemaining;
        thisLeg.redraw();
        
        for (var i = this.allLegs.length - 1; i > 0; i--) {
            var prevLeg = this.allLegs[i - 1];
            prevLeg.distanceRemainingAfterThisLeg = distanceRemaining;
            distanceRemaining = distanceRemaining + prevLeg.distance;
            prevLeg.distanceRemaining = distanceRemaining;
            prevLeg.timeRemainingAfterThisLeg = timeRemaining;
            timeRemaining = timeRemaining.add(prevLeg.ete);
            prevLeg.timeRemaining = timeRemaining;
            prevLeg.redraw();
            thisLeg = prevLeg;
        }
    }

    static appendLeg(fix, location)
    {
        var leg = new Leg(this.allLegs.length, fix, location);
        this.allLegs.push(leg);
        this.updateRows();
    }

    static removeAll()
    {
        while (this.allLegs.length) {
            var leg = this.allLegs[0];
            leg.remove();
        }
    }

    static setGroundSpeed(gs)
    {
        for (var i = 0; i < this.allLegs.length; i++) {
            this.allLegs[i].estGS = gs;
            this.allLegs[i].ete = 0;
        }
        this.updateRows();
    }

    static currentRoute()
    {
        var result = "";
        for (var i = 0; i < this.allLegs.length; i++) {
            if (i)
                result = result + " ";
            result = result + this.allLegs[i].fix;
        }

        return result;
    }

    static resetCurrentLeg()
    {
        if (this.allLegs.length && this.currentLeg) {
            this.currentLeg.deselect();
            this.currentLegIndex = 0;
            this.currentLeg = undefined;
        }
    }

    static startTiming(time)
    {
        if (this.allLegs.length > 1) {
            if (this.currentLeg)
                this.currentLeg.deselect();
            this.currentLegIndex = 1;
            var currLeg = this.currentLeg = this.allLegs[this.currentLegIndex];
            currLeg.startTime = time;
            currLeg.select();
            currLeg.redraw();
        }
    }

    static markCurrentLeg(useOriginalETA, markTime)
    {
        if (this.allLegs.length > 1 && this.currentLeg) {
            var currLeg = this.currentLeg;
            currLeg.endTime = markTime;
            currLeg.updateATE(currLeg.endTime);
            currLeg.deselect();
            currLeg.redraw();
            this.currentLegIndex++;
            if (this.currentLegIndex < this.allLegs.length) {
                this.currentLeg = this.allLegs[this.currentLegIndex];
                currLeg = this.currentLeg;
                currLeg.startTime = markTime;
                currLeg.select();
                currLeg.redraw();
            } else {
                this.currentLegIndex = 0;
                this.currentLeg = undefined;
                state = "Stopped";
            }
        }
    }
}

Leg.allLegs = [];
Leg.currentLegIndex = 0;
Leg.currentLeg = undefined;

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
        watchPositionID = navigator.geolocation.watchPosition(updateTimeAndPosition, showGeolocationError, geolocationOptions);
    else
        status("Geolocation is not supported by this browser.");

    if (!timeUpdateInterval)
        timeUpdateInterval = window.setInterval(function() { updateTimeAndPosition(undefined); }, 1000);
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

function updateTimeAndPosition(position) {
    var now = new Date();
    var timeSinceLastUpdate = now.valueOf() - lastUpdate.valueOf();

    if (!position && timeSinceLastUpdate < 1000)
        return;

    timeSinceLastUpdate = now;

    if (state == "Running")
        deltaTime = Time.differenceBetween(etaGate, now);

    var groundSpeedRequired;

    if (position) {
        currentLocation = new GeoLocation(position.coords.latitude, position.coords.longitude);

        var distanceRemaining = Leg.updatePositionToActiveLeg(currentLocation);
        var timeRemaining = Time.differenceBetween(etaGate, now);
        var hours = timeRemaining.hours();

        if (hours > 0)
            groundSpeedRequired = distanceRemaining / hours;
        else
            groundSpeedRequired = "Inf";
    } else
        groundSpeedRequired = undefined;

    if (locationStatus)
        locationStatus.update(now, position, groundSpeedRequired);

    if (Leg.getCurrentLeg()) {
        var currLeg = Leg.getCurrentLeg();
        currLeg.updateATE(now);
        currLeg.redraw();
    }
}

/* Add this via UI */
var userWaypoints = [
    { "name":"OILCAMP", "type":"User", "description":"Oil Camp", "latitude":36.68471, "longitude":-120.50277},
    { "name":"I5.WESTSHIELDS", "type":"User", "description":"I5 & West Shields", "latitude":36.77774, "longitude":-120.72426},
    { "name":"I5.165", "type":"User", "description":"I5 & 165", "latitude":36.93022, "longitude":-120.84068},
    { "name":"I5.VOLTA", "type":"User", "description":"I5 & Volta", "latitude":37.01419, "longitude":-120.92878},
    { "name":"PT.ALPHA", "type":"User", "description":"I5 & 152", "latitude":37.05665, "longitude":-120.96990}
];
/* */

var db;
var dbName = "RallyTrackerDB";

function openDB()
{
    var _indexedDB = window._indexedDB || window.indexedDB || window.webkitIndexedDB;
    var request = _indexedDB.open(dbName, 1);

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

    status("Loaded FAA Records");

    var userRecordsLoaded = 0;
    for (var i in userWaypoints) {
        userWaypointOS.add(userWaypoints[i]);
        userRecordsLoaded++;
    }

    status("Loaded " + faaRecordsLoaded + " FAA records and " + userRecordsLoaded + " user records loaded");

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
    var nextWaypoint = "";

    while (waypointsToLookup.length) {
        nextWaypoint = waypointsToLookup.shift().trim();
        if (nextWaypoint)
            break;
    }

    if (!nextWaypoint)
        return;

    getWaypoint(nextWaypoint, true, userWaypointResult);
}

function getWaypoint(name, user, callback)
{
    var transaction;
    var waypointsObjectStore

    if (user) {
        transaction = db.transaction(["userWaypoints"], "readonly");
        waypointsObjectStore = transaction.objectStore("userWaypoints");
    } else {
        transaction = db.transaction(["faaWaypoints"], "readonly");
        waypointsObjectStore = transaction.objectStore("faaWaypoints");
    }

    var request = waypointsObjectStore.get(name);

    request.onsuccess = function(event) {
        callback(name, request.result);
    }

    request.onerror = function(event) {
        callback(name, undefined);
    }
}

function userWaypointResult(name, waypoint)
{
    if (waypoint)
        waypointResult(name, waypoint);
    else
        getWaypoint(name, false, waypointResult);
}

function waypointResult(name, waypoint)
{
    if (waypoint)
        Leg.appendLeg(waypoint.name, new GeoLocation(waypoint.latitude, waypoint.longitude));
    else
        status("Couldn't find waypoint: " + name);

    getNextWaypoint();
}

function putUserWaypoint(waypoint, callback)
{
    var transaction = db.transaction(["userWaypoints"], "readwrite");
    var waypointsObjectStore = transaction.objectStore("userWaypoints");
    var request = waypointsObjectStore.put(waypoint);

    request.onsuccess = function(event) {
        callback(waypoint, request.result);
    }

    request.onerror = function(event) {
        callback(waypoint, undefined);
    }
}

function showPopup(popupId, show)
{
    if (show) {
        document.getElementById(popupId).style.display='block';
        document.getElementById('fade').style.display='block';
    } else {
        document.getElementById(popupId).style.display='none';
        document.getElementById('fade').style.display='none';
    }
}

function showUserWaypointPopup()
{
    showPopup('user-waypoint-popup', true);
}

function createUserWaypointCallback(waypoint, result)
{
    status("Added User waypoint " + waypoint.name);
}

function createUserWaypoint()
{
    var name = document.getElementById('UserWaypointPopup_name').value;
    var type = "User";
    var description = document.getElementById('UserWaypointPopup_description').value;
    var latitude = Number(document.getElementById('UserWaypointPopup_latitude').value);
    var longitude = Number(document.getElementById('UserWaypointPopup_longitude').value);
    var waypoint = new Waypoint(name, type, description, latitude, longitude);
    putUserWaypoint(waypoint, createUserWaypointCallback);
}

function editUserWaypoint()
{
}

function hideUserWaypointPopup()
{
    showPopup('user-waypoint-popup', false);
}

function showRoutePopup()
{
    var routeElem = document.getElementById('routePopup_route');
    var existingRoute = Leg.currentRoute();
    if (!existingRoute)
        existingRoute = "OILCAMP I5.WESTSHIELDS I5.165 I5.VOLTA PT.ALPHA";
    document.getElementById('routePopup_route').value = existingRoute;
    showPopup('route-popup', true);
}

function cancelRoutePopup()
{
    showPopup('route-popup', false);
}

function submitRoutePopup()
{
    Leg.removeAll();
    var routeElem = document.getElementById('routePopup_route');
    var routeString = routeElem.value;
    routeString = routeString.trim().toUpperCase();
    getWaypoints(routeString);
    cancelRoutePopup();
}

function showGroundSpeedPopup()
{
    var gsElem = document.getElementById('GroundSpeedPopup_gs');
    gsElem.value = EngineConfig.currentTAS();
    showPopup('gs-popup', true);
}

function cancelGroundSpeedPopup()
{
    showPopup('gs-popup', false);
}

function submitGroundSpeedPopup()
{
    var gs = document.getElementById('GroundSpeedPopup_gs').value;
    gs = Number(gs);
    if (gs > 0)
        Leg.setGroundSpeed(gs);
    cancelGroundSpeedPopup();
}

function startTiming()
{
    if (state == "Stopped") {
        startTime = new Date();
        legStartTime = startTime;
        startLocationUpdates();
        state = "Running";
        Leg.resetCurrentLeg();
        Leg.startTiming(startTime);
        var currLeg = Leg.getCurrentLeg();
        currLeg.startTime = legStartTime;
        etaGate = currLeg.timeRemaining.addDate(startTime);
        etaWaypoint = currLeg.ete.addDate(startTime);
    }
}

function markLeg()
{
    if (state == "Running") {
        var now = new Date();
        Leg.markCurrentLeg(false, now)
        if (state == "Stopped")
            deltaTime = Time.differenceBetween(etaGate, now);
        else {
            var leg = Leg.getCurrentLeg();
            etaWaypoint = leg.ete.addDate(now);
        }
    }
}

function markLegAsPlanned()
{
    if (state == "Running") {
    }
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
    // Bonanza configuration
    EngineConfig.appendConfig("Cold Taxi", 1000, "Rich", 2.1, 0);
    EngineConfig.appendConfig("Warm Taxi", 1000, "Rich", 1.85, 0);
    EngineConfig.appendConfig("Runup", 1800, "Rich", 5.79, 0);
    EngineConfig.appendConfig("Takeoff", 2700, "Rich", 26.09, 125);
    EngineConfig.appendConfig("Climb", 2500, 25, 19.15, 125);
    EngineConfig.appendConfig("Cruise", 2400, 20, 14.10, 142);
    EngineConfig.appendConfig("Pattern", 2700, 15, 7.8, 95);
    EngineConfig.selectConfig(5);

/*  // Cessna configuration
    EngineConfig.appendConfig("Cold Taxi", 1000, 0, 1.5, 0);
    EngineConfig.appendConfig("Warm Taxi", 1000, 0, 1.5, 0);
    EngineConfig.appendConfig("Runup", 1800, 0, 4.0, 0);
    EngineConfig.appendConfig("Takeoff", 2700, 0, 10.09, 80);
    EngineConfig.appendConfig("Climb", 2500, 0, 9.00, 90);
    EngineConfig.appendConfig("Cruise", 2400, 0, 8.0, 110);
    EngineConfig.appendConfig("Pattern", 2700, 0, 5.5, 75);
    EngineConfig.selectConfig(5);
*/

    startLocationUpdates();
}
                            
