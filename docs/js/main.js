"use strict";

var statusElement = null;

function status(msg)
{
    statusElement.innerHTML = msg;
}

var maxWaypointNameLen = 15;
var maxWaypointDescLen = 35;

var metersPerSecToMPH = 2.23694;
var metersPerSecToKnots = 1.94384;
var metersToFeet = 3.28084;
var metersToMiles = 0.000621371;
var metersToNauticalMiles = 0.000539957;
var radiusOfEarthInMiles = 3959;
var radiusOfEarthInNauticalMiles = 3440;
var earthRadius = radiusOfEarthInNauticalMiles;
var magneticVariation = -14;  // Whole lot easier than a variation model!
var useMiles = false;
var fuelCompPerDegreeFarenheit = 0.00056;
var timePointsPerSecond = 1.5;
var fuelPointsPerPercentError = 30;

var currentLocation = null;
var waypointsTableElement = null;
var engineConfigTableElement = null;

var timeUpdateInterval = 0;
var startTime = null;
var lastUpdate = new Date();
var legStartTime = null;
var currentAvgGS = 0;
var distanceToWaypoint = 0;
var etaWaypoint = 0;
var etaGate = 0;
var deltaTime = 0;
var TwoPI = Math.PI * 2;

var editKeyCodes = [ 8, 37, 38, 39, 40, 45, 46]; // Backspace, Left Arrow, Up Arrow, Right Arrow, Down Arrow, Insert & Delete


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


var LatRE = new RegExp("^([NS\\-])?(90|[0-8]?\\d)(?:( [0-5]?\\d\\.\\d{0,3})'?|(\\.\\d{0,6})|( ([0-5]?\\d)\" ?([0-5]?\\d)'?))?", "i");

function decimalLatitudeFromString(latitudeString)
{
    if (typeof latitudeString != "string")
        return 0;

    let match = latitudeString.match(LatRE);

    if (!match)
        return 0;

    let result = 0;
    let sign = 1;

    if (match[1] && (match[1].toUpperCase() == "S" || match[1] == "-"))
        sign = -1;

    result = Number(match[2]);

    if (result != 90) {
        if (match[3]) {
            // e.g. N37 42.874
            let minutes = Number(match[3]);
            result = result + (minutes / 60);
        } else if (match[4]) {
            // e.g. N37.30697
            let decimalDegrees = Number(match[4]);
            result = result + decimalDegrees;
        } else if (match[5]) {
            // e.g. N37 18" 27'
            let degrees = Number(match[6]);
            let minutes = Number(match[7]);
            result = result + (degrees + minutes / 60) / 60;
        }
    }

    return result * sign;
}

var LongRE = new RegExp("^([EW\\-]?)(180|(?:1[0-7]|\\d)?\\d)(?:( [0-5]?\\d\\.\\d{0,3})|(\\.\\d{0,6})|( ([0-5]?\\d)\" ?([0-5]?\\d)'?)?)", "i");

function decimalLongitudeFromString(longitudeString)
{
    if (typeof longitudeString != "string")
        return 0;

    let match = longitudeString.match(LongRE);

    if (!match)
        return 0;

    let result = 0;
    let sign = 1;

    if (match[1] && (match[1].toUpperCase() == "W" || match[1] == "-"))
        sign = -1;

    result = Number(match[2]);

    if (result != 180) {
        if (match[3]) {
            // e.g. W121 53.254
            let minutes = Number(match[3]);
            result = result + (minutes / 60);
        } else if (match[4]) {
            // e.g. W121.8876
            let decimalDegrees = Number(match[4]);
            result = result + decimalDegrees;
        } else if (match[5]) {
            // e.g. W121 53" 15'
            let degrees = Number(match[6]);
            let minutes = Number(match[7]);
            result = result + (degrees + minutes / 60) / 60;
        }
    }

    return result * sign;
}

class State
{
    constructor()
    {
        this.state = State.Stopped;
    }

    setRunning()
    {
        if (this.isRunning())
            status("Error: Trying to enter Running state when already in Running state");

        this.state |= State.Running;
        status("Started Running");
    }

    clearRunning()
    {
        if (!this.isRunning())
            status("Error: Trying to exit Running state when not in Running state");

        this.state = this.state & ~State.Running;
        status("Stopped Running");
    }

    isRunning()
    {
        return this.state & State.Running;
    }

    setTiming()
    {
        if (!this.isRunning())
            status("Error: Trying to enter Timing state when already in Timingwe aren't in Running state");

        if (this.isTiming())
            status("Error: Trying to enter Timing state when already in Timing state");

        this.state |= State.Timing;
        status("Started Timing");
    }

    clearTiming()
    {
        if (!this.isTiming())
            status("Error: Trying to exit Timing state when not in Timing state");

        if (!this.state & State.Timing)
            status("Error: Trying to exit Timing state when not in Timing state");

        this.state = this.state & ~State.Timing;
        status("Stopped Timing");
    }

    isTiming()
    {
        return this.state & State.Timing;
    }

    toString()
    {
        return (this.isRunning() ? "Running" : "Stopped") + (this.isTiming() ? "and Timing" : "");
    }
}

State.Stopped = 0x0;
State.Running = 0x1;
State.Timing = 0x2;

var state = new State();

var TimeRE = new RegExp("^([0-9][0-9]?)(?:\:([0-5][0-9]))?(?:\:([0-5][0-9]))?$");

class Time
{
    constructor(time)
    {
        if (time instanceof Date) {
            this._seconds = Math.Round(time.valueOf() / 1000);
            return;
        }

        if (typeof time == "string") {
            let match = time.match(TimeRE);

            if (!match) {
                this._seconds = 0;
                return;
            }

            if (match[3]) {
                let hours = parseInt(match[1].toString());
                let minutes = parseInt(match[2].toString());
                let seconds = parseInt(match[3].toString());

                this._seconds = (hours * 60 + minutes) * 60 + seconds;
            } else if (match[2]) {
                let minutes = parseInt(match[1].toString());
                let seconds = parseInt(match[2].toString());

                this._seconds = minutes * 60 + seconds;
            } else
                this._seconds = parseInt(match[1].toString());
            return;
        }

        if (typeof time == "number") {
            this._seconds = Math.round(time);
            return;
        }

        this._seconds = 0;
    }

    add(otherTime)
    {
        return new Time(this._seconds + otherTime._seconds);
    }

    addDate(otherDate)
    {
        return new Date(this._seconds * 1000 + otherDate.valueOf());
    }

    static differenceBetween(time2, time1)
    {
        let seconds1 = (time1.valueOf() + 500) / 1000 | 0;
        let seconds2 = (time2.valueOf() + 500) / 1000 | 0;
        return new Time(seconds2 - seconds1);
    }

    seconds()
    {
        return this._seconds;
    }

    minutes()
    {
        return this._seconds / 60;
    }

    hours()
    {
        return this._seconds / 3600;
    }

    toString()
    {
        let result = "";
        let seconds = this._seconds % 60;
        if (seconds < 0) {
            result = "-";
            seconds = -seconds;
        }
        let minutes = this._seconds / 60 | 0;
        let hours = minutes / 60 | 0;
        minutes = minutes % 60;

        if (hours)
            result = result + hours + ":";
        if (minutes < 10 && hours)
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
        let latitude = this.latitude;
        let latitudePrefix = "N";
        if (latitude < 0) {
            latitude = -latitude;
            latitudePrefix = "S"
        }
        let latitudeDegrees = Math.floor(latitude);
        let latitudeMinutes = ((latitude - latitudeDegrees) * 60).toFixed(3);
        let latitudeMinutesFiller = latitudeMinutes < 10 ? " " : "";
        return latitudePrefix + latitudeDegrees + "&deg" + latitudeMinutesFiller + latitudeMinutes + "'";
    }

    longitudeString()
    {
        let longitude = this.longitude;
        let longitudePrefix = "E";
        if (longitude < 0) {
            longitude = -longitude;
            longitudePrefix = "W"
        }

        let longitudeDegrees = Math.floor(longitude);
        let longitudeMinutes = ((longitude - longitudeDegrees) * 60).toFixed(3);
        let longitudeMinutesFiller = longitudeMinutes < 10 ? " " : "";
        return longitudePrefix + longitudeDegrees + "&deg" + longitudeMinutesFiller + longitudeMinutes + "'";
    }

    distanceTo(otherLocation)
    {
        let dLat = (otherLocation.latitude - this.latitude).toRadians();
        let dLon = (otherLocation.longitude - this.longitude).toRadians();
        let a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.latitude.toRadians()) * Math.cos(otherLocation.latitude.toRadians()) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
        let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return earthRadius * c;
    }
    
    bearingFrom(otherLocation)
    {
        let dLon = (this.longitude - otherLocation.longitude).toRadians();
        let thisLatitudeRadians = this.latitude.toRadians();
        let otherLatitudeRadians = otherLocation.latitude.toRadians();
        let y = Math.sin(dLon) * Math.cos(this.latitude.toRadians());
        let x = Math.cos(otherLatitudeRadians) * Math.sin(thisLatitudeRadians) -
            Math.sin(otherLatitudeRadians) * Math.cos(thisLatitudeRadians) * Math.cos(dLon);
        return (Math.atan2(y, x).toDegrees() + 720 + magneticVariation) % 360;
    }

    bearingTo(otherLocation)
    {
        let dLon = (otherLocation.longitude - this.longitude).toRadians();
        let thisLatitudeRadians = this.latitude.toRadians();
        let otherLatitudeRadians = otherLocation.latitude.toRadians();
        let y = Math.sin(dLon) * Math.cos(otherLocation.latitude.toRadians());
        let x = Math.cos(thisLatitudeRadians) * Math.sin(otherLatitudeRadians) -
            Math.sin(thisLatitudeRadians) * Math.cos(otherLatitudeRadians) * Math.cos(dLon);
        return (Math.atan2(y, x).toDegrees() + 720 + magneticVariation) % 360
    }

    locationFrom(bearing, distance)
    {
        let bearingRadians = (bearing - magneticVariation).toRadians();
        let thisLatitudeRadians = this.latitude.toRadians();
        let angularDistance = distance / earthRadius;
        let latitudeRadians = Math.asin(Math.sin(thisLatitudeRadians) * Math.cos(angularDistance) +
                                 Math.cos(thisLatitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians));
        let longitudeRadians = this.longitude.toRadians() +
            Math.atan2(Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(thisLatitudeRadians),
                       Math.cos(angularDistance) - Math.sin(thisLatitudeRadians) * Math.sin(latitudeRadians));

        return new GeoLocation(latitudeRadians.toDegrees(), longitudeRadians.toDegrees());
    }
}

class EngineConfig
{
    constructor(type, rpm, manifoldPressure, fuelFlow, trueAirspeed)
    {
        this._type = type;
        this._rpm = rpm;
        this._manifoldPressure = manifoldPressure;
        this._fuelFlow = fuelFlow;
        this._trueAirspeed = trueAirspeed;

        this.cells = [];
        let rows = engineConfigTableElement.rows;

        for (let i = 0; i < 5; i++)
            this.cells[i] = rows.item(i).insertCell(-1);

        this.deselect();
    }

    trueAirspeed()
    {
        return this._trueAirspeed;
    }

    fuelFlow()
    {
        return this._fuelFlow;
    }

    deselect()
    {
        for (let i = 0; i < 5; i++) {
            let classes = "engine-config";
            if (i == 0)
                classes = classes + " engine-config-type";
            this.cells[i].className = classes;
        }

        this.redraw();
    }
    
    select()
    {
        for (let i = 0; i < 5; i++) {
            let classes = "engine-config-highlight";
            if (i == 0)
                classes = classes + " engine-config-type";
            this.cells[i].className = classes;
        }
 
        this.redraw();
    }

    redraw()
    {
        this.cells[0].innerHTML = this._type;
        this.cells[1].innerHTML = this._rpm;
        this.cells[2].innerHTML = this._manifoldPressure;
        this.cells[3].innerHTML = this._fuelFlow;
        this.cells[4].innerHTML = this._trueAirspeed;
    }

    static appendConfig(type, rpm, manifoldPressure, fuelFlow, trueAirspeed)
    {
        if (this.allConfigsByType[type]) {
            status("Duplicate Engine configuration: " + type);
            return;
        }

        let newConfig = new EngineConfig(type, rpm, manifoldPressure, fuelFlow, trueAirspeed);
        this.allConfigs.push(newConfig);
        this.allConfigsByType[type] = newConfig;

    }

    static getConfig(n)
    {
        if (n >= this.allConfigs.length)
            return undefined;

        return this.allConfigs[n];
    }

    static selectConfig(n)
    {
        this.allConfigs[this.currentConfig].deselect();
        this.currentConfig = n;
        this.allConfigs[this.currentConfig].select();
    }

    static setConfigName(aircraft)
    {
        document.getElementById("engine-config-name").innerHTML = aircraft + " Config";
    }

    static selectPowerUnits(label)
    {
        document.getElementById("engine-config-power").innerHTML = label;
    }

    static currentTAS()
    {
        return this.allConfigs[this.currentConfig]._trueAirspeed;
    }
}

EngineConfig.allConfigs = [];
EngineConfig.allConfigsByType = {};
EngineConfig.currentConfig = 0;
EngineConfig.Taxi = 0;
EngineConfig.WarmTaxi = 1;
EngineConfig.Runup = 1;
EngineConfig.Takeoff = 2;
EngineConfig.Climb = 3;
EngineConfig.Cruise = 4;
EngineConfig.LowCruise = 5;
EngineConfig.Pattern= 6;

class FlightStatus
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

        this._takeoffTime = undefined;
        this._origTakeoffTime = undefined;
        this._submittedTime = undefined;
        this._submittedFuel = undefined;
        this._startFuel = 74;
        this._fillOAT = 72;
        this._fuelUsed = 0;
        this._fuelMeter = undefined;
        this._pumpFactor = 1.0;
        this.fuelPumped = undefined;
        this._fuelVector = 0.0;
        this._totalFuel = undefined;
        this.timePoints = 0;
        this._fuelPoints = undefined;

        // First row
        this.latitudeElement = document.getElementById("currentLatitude");
        this.speedElement = document.getElementById("currentSpeed");
        this.requiredGateGSElement = document.getElementById("requiredGateGS");
        this.requiredWPGSElement = document.getElementById("requiredWPGS");
        this.headingElement = document.getElementById("currentHeading");
        this.accuracyElement = document.getElementById("currentAccuracy");
        this.timestampElement = document.getElementById("currentTimeStamp");
        this.takeoffTimeElement = document.getElementById("takeoffTime");
        this.timeToGateElement = document.getElementById("timeToGate");
        this.submittedTimeElement = document.getElementById("submittedTime");
        this.submittedFuelElement = document.getElementById("submittedFuel");
        this.startFuelElement = document.getElementById("startFuel");
        this.fuelMeterElement = document.getElementById("fuelMeter");
        this.fuelPumpedElement = document.getElementById("fuelPumped");
        this.totalFuelElement = document.getElementById("totalFuel");

        // Second row
        this.longitudeElement = document.getElementById("currentLongitude");
        this.averageSpeedElement = document.getElementById("averageSpeed");
        this.deltaGateGSElement = document.getElementById("deltaGateGS");
        this.deltaWPGSElement = document.getElementById("deltaWPGS");
        this.altitudeElement = document.getElementById("currentAltitude");
        this.distanceToWaypointElement = document.getElementById("distanceToWaypoint");
        this.currentTimeElement = document.getElementById("currentTime");
        this.deltaTimeElement = document.getElementById("deltaTime");
        this.timeToWaypointElement = document.getElementById("timeToWaypoint");
        this.timePointsElement = document.getElementById("timePoints");
        this.fillOATElement = document.getElementById("fillOAT");
        this.fuelUsedElement = document.getElementById("fuelUsed");
        this.pumpFactorElement = document.getElementById("pumpFactor");
        this.fuelVectorElement = document.getElementById("fuelVector");
        this.fuelPointsElement = document.getElementById("fuelPoints");

        makeOATElementEditable(this.fillOATElement,
                               function() { return flightStatus.fillOAT() },
                               function(newTemp) {
                                   flightStatus.updateFillOAT(newTemp);
                                   Leg.updateAllFuelCompensation();
                               });

        makeFuelElementEditable(this.submittedFuelElement,
                                function() { return flightStatus.submittedFuel(); },
                                function(newFuel) {
                                    flightStatus.updateSubmittedFuel(newFuel);
                                });

        makeFuelElementEditable(this.startFuelElement,
                                function() { return flightStatus.startFuel(); },
                                function(newFuel) {
                                    flightStatus.updateStartFuel(newFuel);
                                    Leg.updateAllFuelCompensation();
                                });

        makeFuelElementEditable(this.fuelMeterElement,
                                function() { return flightStatus.fuelMeter(); },
                                function(newFuel) {
                                    if (!state.isRunning())
                                        flightStatus.updateFuelMeter(newFuel, false);
                                });

        makeFuelElementEditable(this.fuelVectorElement,
                                function() { return flightStatus.fuelVector(); },
                                function(newFuel) {
                                    if (!state.isRunning())
                                        flightStatus.updateFuelVector(newFuel);
                                });

        makePumpFactorElementEditable(this.pumpFactorElement,
                                      function() { return flightStatus.pumpFactor(); },
                                      function(newFactor) {
                                          flightStatus.updatePumpFactor(newFactor);
                                      });

        this.submittedTimeElement.contentEditable = true;
        this.submittedTimeElement.addEventListener('input', function() {
            // &&&& Validate and set submitted Time
            status('Changing submitted time');
        });

        this.updateFillOAT();
        this.updateStartFuel();
        this.updateActualFuel();
        this.updatePumpFactor(this.pumpFactor(), true);
    }

    getFeetOrNull(meters)
    {
        let feet = "";

        if (meters)
            feet = (meters * metersToFeet).toFixed(0) + "'";

        return feet;
    }

    setSubmittedTime(time)
    {
        this.submittedTimeElement.innerHTML = time.toString();
    }

    setTakeoffTime(time)
    {
        if (!time)
            return;

        this._takeoffTime = time;
        if (!this._origTakeoffTime)
            this._origTakeoffTime = new Date(time.valueOf());
        this.takeoffTimeElement.innerHTML = this._takeoffTime.toTimeString().split(" ")[0];
    }

    getTakeoffTime()
    {
        return this._takeoffTime;
    }

    getOriginalTakeoffTime()
    {
        return this._origTakeoffTime;
    }

    resetActualFuelForFlight()
    {
        this._fuelUsed = 0;
        this._fuelMeter = undefined;
        this.fuelPumped = undefined;
        this._fuelVector = 0.0;
        this._totalFuel = undefined;
        this._fuelPoints = undefined;
    }

    fillOAT()
    {
        return this._fillOAT;
    }

    updateFillOAT(newFillOAT)
    {
        if (newFillOAT != undefined)
            this._fillOAT = newFillOAT;
        this.fillOATElement.innerHTML = this._fillOAT + "&deg";
    }

    updateFuelUsed(fuelAmount)
    {
        this._fuelUsed = fuelAmount;
        this.updateActualFuel();
    }

    submittedFuel()
    {
        return (this._submittedFuel == undefined) ? 0 : this._submittedFuel;
    }

    updateSubmittedFuel(fuelAmount)
    {
        if (fuelAmount != undefined)
            this._submittedFuel = fuelAmount;
        this.submittedFuelElement.innerHTML = this._submittedFuel.toFixed(2);
        this.updateActualFuel();
    }

    fuelMeter()
    {
        return (this._fuelMeter == undefined) ? 0 : this._fuelMeter;
    }

    updateFuelMeter(fuelAmount, isEstimate)
    {
        if (isEstimate)
            this.fuelMeterElement.style.color = "mediumBlue";
        else {
            this.fuelMeterElement.style.color = "black";
            if (fuelAmount != undefined) {
                this._fuelMeter = fuelAmount;
                this.updateActualFuel();
            } else
                fuelAmount = this._fuelMeter;
        }

        this.fuelMeterElement.innerHTML = (fuelAmount == undefined) ? "" : fuelAmount.toFixed(2);
    }

    startFuel()
    {
        return this._startFuel;
    }

    updateStartFuel(fillAmount)
    {
        if (fillAmount != undefined)
            this._startFuel = fillAmount;
        this.startFuelElement.innerHTML = this._startFuel.toFixed(2);
    }

    pumpFactor()
    {
        return (this._pumpFactor == undefined) ? 1.0 : this._pumpFactor;
    }

    updatePumpFactor(newFactor, isEstimate)
    {
        if (isEstimate)
            this.pumpFactorElement.style.color = "mediumBlue";
        else {
            this.pumpFactorElement.style.color = "black";
            if (newFactor != undefined) {
                this._pumpFactor = newFactor;
                this.updateActualFuel();
            } else
                newFactor = this._pumpFactor;
        }

        this.pumpFactorElement.innerHTML = (newFactor == undefined) ? "" : newFactor.toFixed(4);
    }

    updateFuelPumped(fuelAmount, isEstimate)
    {
        if (isEstimate)
            this.fuelPumpedElement.style.color = "mediumBlue";
        else {
            this.fuelPumpedElement.style.color = "black";
            if (fuelAmount != undefined)
                this._fuelPumped = fuelAmount;
            else
                fuelAmount = this._fuelPumped;
        }

        this.fuelPumpedElement.innerHTML = (fuelAmount == undefined) ? "" : fuelAmount.toFixed(2);
    }

    fuelVector()
    {
        return (this._fuelVector == undefined) ? 0 : this._fuelVector;
    }

    updateFuelVector(fuelAmount, isEstimate)
    {
        if (isEstimate)
            this.fuelVectorElement.style.color = "mediumBlue";
        else {
            this.fuelVectorElement.style.color = "black";
            if (fuelAmount != undefined) {
                this._fuelVector = fuelAmount;
                this.updateActualFuel();
            } else
                fuelAmount = this._fuelVector;
        }

        this.fuelVectorElement.innerHTML = (fuelAmount == undefined) ? "" : fuelAmount.toFixed(2);
    }

    updateTotalFuel(fuelAmount, isEstimate)
    {
        if (isEstimate)
            this.totalFuelElement.style.color = "mediumBlue";
        else {
            this.totalFuelElement.style.color = "black";
            if (fuelAmount != undefined)
                this._totalFuel = fuelAmount;
            else
                fuelAmount = this._totalFuel;
        }

        this.totalFuelElement.innerHTML = (fuelAmount == undefined) ? "" : fuelAmount.toFixed(2);
    }


    updateFuelPoints(points, isEstimate)
    {
        if (isEstimate)
            this.fuelPointsElement.style.color = "mediumBlue";
        else {
            this.fuelPointsElement.style.color = "black";
            if (points != undefined)
                this._fuelPoints = points;
            else
                points = this._fuelPoints;
        }

        this.fuelPointsElement.innerHTML = (points == undefined) ? "" : points.toFixed(0);
    }

    update(now, position, requiredSpeeds)
    {
        if (position) {
            var location = new GeoLocation(position.coords.latitude, position.coords.longitude);

            this.latitudeElement.innerHTML = location.latitudeString();
            this.longitudeElement.innerHTML = location.longitudeString();

            let currentSpeed = position.coords.speed * this.speedConvert;
            this.speedElement.innerHTML = currentSpeed.toFixed(1);
            this.recentGroundSpeeds.unshift(currentSpeed);
            if (this.recentGroundSpeeds.length > 10) {
                this.recentGroundSpeeds.pop();
            }
            let averageSpeed = 0;
            let numberSpeeds = this.recentGroundSpeeds.length;
            let requiredGateSpeed = requiredSpeeds.gate;
            let requiredLegSpeed = requiredSpeeds.leg;

            for (let i = 0; i < numberSpeeds; i++)
                averageSpeed += this.recentGroundSpeeds[i];
            averageSpeed = averageSpeed / numberSpeeds;
            currentAvgGS = averageSpeed;
            this.averageSpeedElement.innerHTML = averageSpeed.toFixed(1);

            if (typeof requiredGateSpeed == "string") {
                this.requiredGateGSElement.innerHTML = requiredGateSpeed;
                this.deltaGateGSElement.innerHTML = "";
                this.deltaGateGSElement.className = "status-center";
            } else {
                this.requiredGateGSElement.innerHTML = requiredGateSpeed.toFixed(1);
                let deltaGateGS = currentSpeed - requiredGateSpeed;
                if (deltaGateGS > 1.0) {
                    this.deltaGateGSElement.className = "status-center delta-speed-ahead";
                } else if (deltaGateGS < -1.0) {
                    this.deltaGateGSElement.className = "status-center delta-speed-behind";
                } else {
                    this.deltaGateGSElement.className = "status-center delta-speed-close";
                }
                this.deltaGateGSElement.innerHTML = deltaGateGS.toFixed(1);
            }

            if (typeof requiredLegSpeed == "string") {
                this.requiredWPGSElement.innerHTML = requiredLegSpeed;
                this.deltaWPGSElement.innerHTML = "";
                this.deltaWPGSElement.className = "status-center";
            } else {
                this.requiredWPGSElement.innerHTML = requiredLegSpeed.toFixed(1);
                let deltaWPGS = currentSpeed - requiredLegSpeed;
                if (deltaWPGS > 1.0) {
                    this.deltaWPGSElement.className = "status-center delta-speed-ahead";
                } else if (deltaWPGS < -1.0) {
                    this.deltaWPGSElement.className = "status-center delta-speed-behind";
                } else {
                    this.deltaWPGSElement.className = "status-center delta-speed-close";
                }
                this.deltaWPGSElement.innerHTML = deltaWPGS.toFixed(1);
            }

            let heading = "";
            if (position.coords.heading) {
                let headingVal = Math.round(position.coords.heading + magneticVariation);
                headingVal = (headingVal + 360) % 360;
                if (!headingVal)
                    headingVal = 360;
                heading = headingVal  + "&deg";
            }
            this.headingElement.innerHTML = heading;
            this.altitudeElement.innerHTML = this.getFeetOrNull(position.coords.altitude);
            this.accuracyElement.innerHTML = this.getFeetOrNull(position.coords.accuracy);
            let time = new Date(position.timestamp);
            this.timestampElement.innerHTML = time.toTimeString().split(" ")[0];
        }
        this.currentTimeElement.innerHTML = now.toTimeString().split(" ")[0];
        this.distanceToWaypointElement.innerHTML = distanceToWaypoint.toFixed(2);
        if (etaWaypoint instanceof Date)
            this.timeToWaypointElement.innerHTML = etaWaypoint.toTimeString().split(" ")[0];
        if (etaGate instanceof Date) {
            this.timeToGateElement.innerHTML = etaGate.toTimeString().split(" ")[0];
            this.timePointsElement.innerHTML = Math.abs(deltaTime.seconds()) * timePointsPerSecond;
        }
        this.deltaTimeElement.innerHTML = deltaTime ? deltaTime.toString() : "";
        this.fuelUsedElement.innerHTML = this._fuelUsed.toFixed(3);
    }

    updateActualFuel()
    {
        if (state.isRunning()) {
            // In flight estimates
            let fuelMeter = this._fuelUsed;
            let fuelPumped = fuelMeter * this.pumpFactor();
            let fuelVector = 0.0;
            let submittedFuel = this.submittedFuel();
            if (fuelPumped > submittedFuel)
                fuelVector = fuelPumped - this.submittedFuel();
            let totalFuel = fuelPumped - fuelVector;
            let fuelPoints = 0;
            if (submittedFuel > 0)
                fuelPoints = Math.abs(totalFuel - submittedFuel) / submittedFuel * 100 * fuelPointsPerPercentError;

            this.updateFuelMeter(fuelMeter, true);
            this.updateFuelPumped(fuelPumped, true);
            this.updateFuelVector(fuelVector, true);
            this.updateTotalFuel(totalFuel, true);
            this.updateFuelPoints(fuelPoints, true);
        } else if (this._fuelMeter != undefined && this._pumpFactor != undefined && this._fuelVector != undefined && this.submittedFuel()) {
            // Post flight actuals
            let submittedFuel = this.submittedFuel();
            let fuelPumped = this._fuelMeter * this._pumpFactor;
            let totalFuel = fuelPumped - this._fuelVector;
            let fuelPoints = Math.abs(totalFuel - submittedFuel) / submittedFuel * 3000;

            this.updateFuelPumped(fuelPumped);
            this.updateTotalFuel(totalFuel);
            this.updateFuelPoints(fuelPoints);
        }
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
        this.name = name.trim().toUpperCase();
        this.type = type;
        this.description = description;
        this.latitude = latitude;
        this.longitude = longitude;
    }
}

var LegModifier = new RegExp("(360|3[0-5][0-9]|[0-2][0-9]{2}|[0-9]{1,2})@([0-9]{1,3})|(?:([1-9][0-9]{1,2})kts)|(:(?:LOW-)?CRUISE)", "i");

class Leg
{
    constructor(fix, location)
    {
        this.index = Leg.allLegs.length;
        this.fix = fix;
        this.location = location;
        this.startFlightTiming = false;
        this.stopFlightTiming = false;
        this.engineConfig = Leg.lowCruiseOverride ? EngineConfig.LowCruise : EngineConfig.Cruise;
        this.distance = 0;
        this.legDistance = 0;
        this.distanceRemaining = 0;
        this.distanceRemainingAfterThisLeg = 0;
        this.course = 0;
        this.estTAS = 0;
        if (Leg.tasOverride) {
            this.estTAS = Leg.tasOverride;
            Leg.tasOverride = undefined;
        }
        this.windDirection = Leg.defaultWindDirection;
        this.windSpeed = Leg.defaultWindSpeed;
        this.heading = 0;
        this.estGS = 0;
        this.actGS = 0;
        this.ete = undefined;
        this.ate = 0;
        this.startTime = 0;
        this.endTime = 0;
        this.estTimeRemaining = 0;
        this.estTimeRemainingAfterThisLeg = new Time(0);
        this.actTimeRemaining = 0;
        this.fuelFlow = 0;
        this.estFuel = 0;
        this.actFuel = 0;
        this.oat = flightStatus ? flightStatus.fillOAT() : 0;
        this.estCummulativeFuel = 0;
        this.actCummulativeFuel = 0;
        this.compFuel = 0;
        this.fuelUsed = 0;
        this.row = [];
        this.row[0] = waypointsTableElement.insertRow(this.index * 2)
        this.row[1] = waypointsTableElement.insertRow(this.index * 2 + 1)
        this.cells = new Array(22);

        // Waypoint | Lat  | Leg Dist | TAS | WindDir@WindSpd | Est GS | ETE |  ETR | Fuel Flow | Est Fuel | ECF | Comp
        //  Notes   | Long | Rem Dist | CRS |       Hdg       | Act GS | ATE |  ATR |    OAT    | Act Fuel | ACF | Used

        for (let col = 0; col <= 11; col++) {
            this.cells[col] = this.row[0].insertCell(col);
            this.cells[col + 12] = this.row[1].insertCell(col);
            let width = "7%";
            if (col == 0)
                width = "20%";
            else if (col == 1)
                width = "10%";

            this.cells[col].style.width = width;
        }

        this.deselect();

        this.cells[Leg.cellIndexTAS].leg = this;
        this.cells[Leg.cellIndexTAS].onclick = function() { Leg.editTAS(this); };

        // Edit wind popup
        this.cells[Leg.cellIndexWind].leg = this;
        this.cells[Leg.cellIndexWind].onclick = function() { Leg.editWind(this); };

        this.cells[Leg.cellIndexOAT].leg = this;
        this.updateOAT();

        let thisLeg = this;

        makeOATElementEditable(this.cells[Leg.cellIndexOAT],
                               function() { return thisLeg.oat; },
                               function(newTemp) {
                                                     thisLeg.updateOAT(newTemp);
                                                     Leg.updateAllFuelCompensation();
                                                 });
    }

    fixName()
    {
        return this.fix;
    }

    remove()
    {
        let rowIndex = this.row[0].rowIndex;
        rowIndex = this.row[1].rowIndex;
        waypointsTableElement.deleteRow(this.row[0].rowIndex);
        waypointsTableElement.deleteRow(this.row[1].rowIndex);
        Leg.allLegs.splice(this.index, 1);
        Leg.updateIndecies();
        Leg.updateRows();
    }

    redraw()
    {
        if (!this.redrawNeeded)
            return;

        this.cells[Leg.cellIndexWaypoint].innerHTML = this.fixName();
        this.cells[Leg.cellIndexLatitude].innerHTML = this.location.latitudeString();
        this.cells[Leg.cellIndexLegDistance].innerHTML = this.distance.toFixed(2);
        this.cells[Leg.cellIndexTAS].innerHTML = this.estTAS.toFixed(0);
        this.cells[Leg.cellIndexWind].innerHTML = this.windSpeed > 0 ? this.windDirection + "@" + this.windSpeed : "";
        this.cells[Leg.cellIndexEstGS].innerHTML = this.estGS.toFixed(1);
        this.cells[Leg.cellIndexETE].innerHTML = this.ete ? this.ete.toString() : "";
        this.cells[Leg.cellIndexETR].innerHTML = this.estTimeRemaining;
        this.cells[Leg.cellIndexFuelFlow].innerHTML = this.fuelFlow.toFixed(2);
        this.cells[Leg.cellIndexEstFuel].innerHTML = this.estFuel.toFixed(2);
        this.cells[Leg.cellIndexECF].innerHTML = this.estCummulativeFuel.toFixed(2);
        this.cells[Leg.cellIndexFuelComp].innerHTML = this.compFuel.toFixed(3);

        this.cells[Leg.cellIndexNotes].innerHTML = this.notes ? this.notes : "";
        this.cells[Leg.cellIndexLongitude].innerHTML = this.location.longitudeString();
        this.cells[Leg.cellIndexRemainingDistance].innerHTML = this.distanceRemaining.toFixed(2);
        this.cells[Leg.cellIndexCourse].innerHTML = this.course.toFixed(0) + "&deg";
        this.cells[Leg.cellIndexHeading].innerHTML = this.heading.toFixed(0) + "&deg";
        this.cells[Leg.cellIndexActGS].innerHTML = this.actGS.toFixed(1);
        this.cells[Leg.cellIndexATE].innerHTML = this.ate ? this.ate.toString() : "";
        this.cells[Leg.cellIndexATR].innerHTML = this.actTimeRemaining ? this.actTimeRemaining.toString() : "";
        this.cells[Leg.cellIndexActFuel].innerHTML = this.actFuel.toFixed(2);
        this.cells[Leg.cellIndexACF].innerHTML = this.actCummulativeFuel.toFixed(2);
        this.cells[Leg.cellIndexFuelUsed].innerHTML = this.fuelUsed.toFixed(3);

        this.redrawNeeded = false;
    }

    scrollToTop()
    {
        this.cells[Leg.cellIndexWaypoint].scrollIntoView();
    }

    updateOAT(newOAT)
    {
        if (newOAT != undefined)
            this.oat = newOAT;
        this.cells[Leg.cellIndexOAT].innerHTML = this.oat + "&deg";
    }

    select()
    {
/*  &&&& Trying to automatically scroll into view
        let offsetTop = waypointsTableElement.offsetTop;
        let topRow = this.row[0];
        topRow.scrollTop = offsetTop + topRow.scrollHeight;
*/
        let rowClasses = "waypoint-row-highlight " + (this.index % 2 ? "waypoint-row-odd" : "row-even");
        this.row[0].className = rowClasses;
        this.row[1].className = rowClasses;
    }

    deselect()
    {
        let rowClasses = "waypoint-row " + (this.index % 2 ? "waypoint-row-odd" : "row-even");
        this.row[0].className = rowClasses;
        this.row[1].className = rowClasses;
    }

    toString()
    {
        return this.fix;
    }

    windToString()
    {
        if (!this.windSpeed)
            return "";

        return (this.windDirection ? this.windDirection : "360") + "@" + this.windSpeed;
    }

    estTASToString()
    {
        return this.estTAS + "kts";
    }

    static editTAS(cell)
    {
        status("Trying to edit TAS for row " + cell.leg.index);
        showEditTASPopup(cell.leg);
    }

    static editWind(cell)
    {
        status("Trying to edit wind for row " + cell.leg.index);
        showWindPopup(cell.leg);
    }

    static setDefaultWind(windDirection, windSpeed)
    {
        this.defaultWindDirection = windDirection;
        this.defaultWindSpeed = windSpeed;
    }

    static setTASOverride(tas)
    {
        this.tasOverride = tas;
    }

    static setLowCruiseOverride(enable)
    {
        this.lowCruiseOverride = enable;
    }

    static resetModifiers()
    {
        this.setDefaultWind(0, 0);
        this.setTASOverride(undefined);
        this.setLowCruiseOverride(false);
    }

    static isLegModifier(fix)
    {
        return LegModifier.test(fix);
    }

    static processLegModifier(fix)
    {
        let match = fix.match(LegModifier);

        if (match) {
            if (match[1] && match[2]) {
                let windDirection = parseInt(match[1].toString()) % 360;
                let windSpeed = parseInt(match[2].toString());

                Leg.setDefaultWind(windDirection, windSpeed);
            } else if (match[3]) {
                let tas = parseInt(match[3].toString());
                Leg.setTASOverride(tas);
            } else if (match[4])
                Leg.setLowCruiseOverride(match[4].toUpperCase() == ":LOW-CRUISE");

            setTimeout(getNextWaypoint(), 0);
        }
    }

    isSameWind(windDirection, windSpeed)
    {
        return this.windDirection == windDirection && this.windSpeed == windSpeed;
    }

    isDefaultWind()
    {
        return this.windSpeed && this.isSameWind(Leg.defaultWindDirection, Leg.defaultWindSpeed);
    }

    isSameWindAsPreviousLeg()
    {
        let previousLeg = previousLeg();

        return previousLeg && this.isSameWind(previousLeg.windDirection, previousLeg.windSpeed);
    }

    isStandardTAS()
    {
        let engineConfig = EngineConfig.getConfig(this.engineConfig);

        return (this.estTAS == engineConfig.trueAirspeed());
    }

    previousLeg()
    {
        if (this.index)
            return Leg.allLegs[this.index - 1];
        return undefined;
    }

    nextLeg()
    {
        if (this.index < Leg.allLegs.length - 1)
            return Leg.allLegs[this.index + 1];
        return undefined;
    }

    setWind(windDirection, windSpeed)
    {
        this.windDirection = windDirection;
        this.windSpeed = windSpeed;
    }

    updateDistanceAndBearing(other)
    {
        this.distance = this.location.distanceTo(other);
        this.course = Math.round(this.location.bearingFrom(other));
        if (this.ete == undefined && this.estGS != 0) {
            let eteSeconds = Math.round(this.distance * 3600 / this.estGS);
            this.ete = new Time(eteSeconds);
        }

        if (this.ete.seconds())
            this.estFuel = this.fuelFlow * this.ete.hours();

        this.redrawNeeded = true;
    }

    updateFuelCompensation()
    {
        let previousLeg = this.previousLeg();

        if (flightStatus) {
            let previousOAT = previousLeg ? previousLeg.oat : flightStatus.fillOAT();
            this.compFuel = (previousOAT - this.oat) * fuelCompPerDegreeFarenheit * (flightStatus.startFuel() - this.actCummulativeFuel);
            let priorFuelUsed = previousLeg ? previousLeg.fuelUsed : 0;
            this.fuelUsed = priorFuelUsed + this.actFuel + this.compFuel;
            flightStatus.updateFuelUsed(this.fuelUsed);
        }

        this.redrawNeeded = true;
    }

    updateActuals(date)
    {
        let previousLeg = this.previousLeg();

        this.ate = Time.differenceBetween(date, this.startTime);
        this.actFuel = this.fuelFlow * this.ate.hours();
        this.actCummulativeFuel = (previousLeg ? previousLeg.actCummulativeFuel : 0) + this.actFuel;

        let distanceCovered = this.legDistance - this.distance;
        this.actGS = (this.ate.seconds() < 10 || distanceCovered < 2) ? currentAvgGS : (distanceCovered / this.ate.hours());
        let estSecondsRemaining = this.actGS ? Math.round(this.distance * 3600 / this.actGS) : 0;
        this.actTimeRemaining = new Time(estSecondsRemaining);

        this.updateFuelCompensation();

        this.redrawNeeded = true;
    }

    propagateWind()
    {
        let windDirection = this.windDirection;
        let windSpeed = this.windSpeed;

        windDirection = (windDirection + 360) % 360;
        if (!windDirection)
            windDirection = 360;

        for (let currLeg = this; currLeg; currLeg = currLeg.nextLeg()) {
            currLeg.windDirection = windDirection;
            currLeg.windSpeed = windSpeed;
            if (currLeg.stopFlightTiming)
                break;
        }
    }

    updateForWind()
    {
        if (!this.windSpeed || !this.estTAS) {
            this.heading = this.course;
            this.estGS = this.estTAS;
            return;
        }

        let windDirectionRadians = this.windDirection.toRadians();
        let courseRadians = this.course.toRadians();
        let swc = (this.windSpeed / this.estTAS) * Math.sin(windDirectionRadians - courseRadians);
        if (Math.abs(swc) > 1) {
            status("Wind to strong to fly!");
            return;
        }

        let headingRadians = courseRadians + Math.asin(swc);
        if (headingRadians < 0)
            headingRadians += TwoPI;
        if (headingRadians > TwoPI)
            headingRadians -= TwoPI
        let groundSpeed = this.estTAS * Math.sqrt(1 - swc * swc) -
            this.windSpeed * Math.cos(windDirectionRadians - courseRadians);
        if (groundSpeed < 0) {
            status("Wind to strong to fly!");
            return;
        }

        this.estGS = groundSpeed;
        this.heading = Math.round(headingRadians.toDegrees());
    }

    calculateRow()
    {
        let engineConfig = EngineConfig.getConfig(this.engineConfig);

        if (!this.estTAS)
            this.estTAS = engineConfig.trueAirspeed();

        this.updateForWind();
        this.fuelFlow = engineConfig.fuelFlow();
        this.redrawNeeded = true;
    }

    updateForward()
    {
        if (this.specialUpdateForward)
            this.specialUpdateForward();

        let previousLeg = this.previousLeg();
        let havePrevious = true;
        if (!previousLeg) {
            havePrevious = false;
            previousLeg = this;
            if (!this.ete)
                this.ete = new Time(0);
        }

        let thisLegType = this.type;
        if (thisLegType == "Climb" && havePrevious)
            this.location = previousLeg.location;
        else {
            this.updateDistanceAndBearing(previousLeg.location);
            this.updateForWind();
            this.legDistance = this.distance;
            let nextLeg = this.nextLeg();
            let previousLegType = previousLeg.type;
            if (havePrevious) {
                if (previousLegType == "Climb") {
                    let climbDistance = distanceFromSpeedAndTime(previousLeg.estGS, previousLeg.climbTime);
                    if (climbDistance < this.distance) {
                        let climbStartLocation = previousLeg.location;
                        let climbEndLocation = climbStartLocation.locationFrom(this.course, climbDistance);
                        previousLeg.location = climbEndLocation;
                        previousLeg.updateDistanceAndBearing(climbStartLocation);
                        let previousPreviousLeg = previousLeg.previousLeg();
                        if (previousPreviousLeg)
                            previousLeg.estCummulativeFuel = previousPreviousLeg.estCummulativeFuel + previousLeg.estFuel;
                        this.ete = undefined;
                        this.updateDistanceAndBearing(climbEndLocation);
                    } else {
                        status("Not enough distance to climb in leg #" + previousLeg.index);
                    }
                } else if ((thisLegType == "Left" || thisLegType == "Right") && nextLeg && nextLeg.location) {
                    let standardRateCircumference = this.estTAS / 30;
                    let standardRateRadius = standardRateCircumference / TwoPI;
                    let offsetInboundBearing = 360 + previousLeg.course + (thisLegType == "Left" ? -90 : 90);
                    offsetInboundBearing = Math.round((offsetInboundBearing + 360) % 360);
                    // Save original location
                    if (!previousLeg.originalLocation)
                        previousLeg.originalLocation = previousLeg.location;
                    let previousLocation = previousLeg.originalLocation;
                    let inboundLocation = previousLocation.locationFrom(offsetInboundBearing, standardRateRadius);
                    let bearingToNext = Math.round(nextLeg.location.bearingFrom(previousLocation));
                    let offsetOutboundBearing = bearingToNext + (thisLegType == "Left" ? 90 : -90);
                    offsetOutboundBearing = (offsetOutboundBearing + 360) % 360;
                    let outboundLocation = previousLocation.locationFrom(offsetOutboundBearing, standardRateRadius);
                    let turnAngle = thisLegType == "Left" ? (360 + bearingToNext - previousLeg.course) : (360 + previousLeg.course - bearingToNext);
                    turnAngle = (turnAngle + 360) % 360;
                    let totalDegrees = turnAngle + 360 * this.extraTurns;
                    let secondsInTurn = Math.round(totalDegrees / 3);
                    this.ete = new Time(Math.round((turnAngle + 360 * this.extraTurns) / 3));
                    this.estFuel = this.fuelFlow * this.ete.hours();
                    this.location = outboundLocation;
                    this.legDistance = this.distance = distanceFromSpeedAndTime(this.estTAS, this.ete);
                    previousLeg.location = inboundLocation;
                    let prevPrevLeg = previousLeg.previousLeg();
                    if (prevPrevLeg && prevPrevLeg.location) {
                        previousLeg.ete = undefined;
                        previousLeg.updateDistanceAndBearing(prevPrevLeg.location);
                    }
                }
            }
        }
        this.estCummulativeFuel = (havePrevious ? previousLeg.estCummulativeFuel : 0) + this.estFuel;
        this.redrawNeeded = true;
    }

    updateBackward()
    {
        let nextLeg = this.nextLeg();

        let distanceRemaining;
        let timeRemaining;

        if (nextLeg) {
            distanceRemaining = nextLeg.distanceRemaining;
            timeRemaining = nextLeg.estTimeRemaining;
        } else {
            distanceRemaining = 0;
            timeRemaining = new Time(0);
        }

        if (this.stopFlightTiming || timeRemaining.seconds()) {
            this.distanceRemainingAfterThisLeg = distanceRemaining;
            this.distanceRemaining = distanceRemaining + this.distance;;
            this.estTimeRemainingAfterThisLeg = timeRemaining;
            this.estTimeRemaining = timeRemaining.add(this.ete);
        } else {
            this.estTimeRemainingAfterThisLeg = this.estTimeRemaining = new Time(0);
            this.distanceRemainingAfterThisLeg = this.distanceRemaining = 0;
        }

        this.redrawNeeded = true;
    }

    static count()
    {
        return this.allLegs.length;
    }

    static haveRoute()
    {
        return this.allLegs.length > 1;
    }

    static getFirstLeg()
    {
        if (this.allLegs.length)
            return this.allLegs[0];

        return undefined;
    }

    static getLastLeg()
    {
        if (this.allLegs.length)
            return this.allLegs[this.allLegs.length - 1];

        return undefined;
    }

    static getCurrentLeg()
    {
        if (this.allLegs.length)
            return this.currentLeg;

        return undefined;
    }

    static updateStartLegTakeoffTime(time)
    {
        if (this.startLegIndex < this.allLegs.length && this.startLegIndex == this.currentLegIndex) {
            let startLeg = this.allLegs[this.startLegIndex];
            if (startLeg.startFlightTiming) {
                flightStatus.setTakeoffTime(time);
                startLeg.startTime = time;
                etaGate = startLeg.estTimeRemaining.addDate(time);
            }
        }
    }

    static updatePositionToActiveLeg(currentLocation)
    {
        let distances = {
            leg: 0,
            gate: 0,
        };

        if (this.allLegs.length && this.currentLeg) {
            this.currentLeg.updateDistanceAndBearing(currentLocation);
            distanceToWaypoint = this.currentLeg.distance;

            distances.leg = this.currentLeg.distance;
            distances.gate = this.currentLeg.distance + this.currentLeg.distanceRemainingAfterThisLeg;
        }

        return distances;
    }

    static updateIndecies()
    {
        if (this.allLegs.length == 0)
            return;

        for (let i = 0; i < this.allLegs.length; i++)
            this.allLegs[i].index = i;
    }

    static updateRows()
    {
        if (this.allLegs.length == 0)
            return;

        let haveStartTiming = false;
        let haveStopTiming = false;
        for (let i = 0; i < this.allLegs.length; i++) {
            let thisLeg = this.allLegs[i];
            thisLeg.index = i;
            thisLeg.calculateRow();
            if (thisLeg.startFlightTiming) {
                if (haveStartTiming)
                    status("Have duplicate Start timing leg in row " + thisLeg.toString());
                haveStartTiming = true;
                this.startLegIndex = i;
            }
            if (thisLeg.stopFlightTiming) {
                if (haveStopTiming)
                    status("Have duplicate Timing leg in row " + thisLeg.toString());
                haveStopTiming = true;
            }
        }

        if (!haveStartTiming)
            Leg.getFirstLeg().startFlightTiming = true;
        if (!haveStopTiming)
            Leg.getLastLeg().stopFlightTiming = true;

        for (let i = 0; i < this.allLegs.length; i++)
            this.allLegs[i].updateForward();

        for (let i = this.allLegs.length - 1; i >= 0; i--)
            this.allLegs[i].updateBackward();

        for (let i = 0; i < this.allLegs.length; i++) {
            let thisLeg = this.allLegs[i];
            if (thisLeg.startFlightTiming) {
                if (flightStatus)
                    flightStatus.setSubmittedTime(thisLeg.estTimeRemaining);
            }
        }

        for (let i = 0; i < this.allLegs.length; i++)
            this.allLegs[i].redraw();
    }

    static updateAllFuelCompensation()
    {
        for (let i = 0; i < this.allLegs.length; i++)
            this.allLegs[i].updateFuelCompensation();

        for (let i = 0; i < this.allLegs.length; i++)
            this.allLegs[i].redraw();
    }

    static appendLeg(leg)
    {
        this.allLegs.push(leg);
    }

    static removeAll()
    {
        while (this.allLegs.length) {
            let leg = this.allLegs[0];
            leg.remove();
        }
        Leg.resetModifiers();
        RallyLeg.reset();
    }

    static setGroundSpeed(gs)
    {
        for (let i = 0; i < this.allLegs.length; i++) {
            this.allLegs[i].estGS = gs;
            this.allLegs[i].ete = 0;
        }
        this.updateRows();
    }

    static currentRoute()
    {
        let result = "";
        let lastWindDirection = 0;
        let lastWindSpeed = 0;
        let lastLegEngineConfig = EngineConfig.Cruise;

        for (let i = 0; i < this.allLegs.length; i++) {
            let currentLeg = this.allLegs[i];

            if (i) {
                result = result + " ";
            }

            if (!currentLeg.isSameWind(lastWindDirection, lastWindSpeed)) {
                result = result + currentLeg.windToString() + " ";
                lastWindDirection = currentLeg.windDirection;
                lastWindSpeed = currentLeg.windSpeed;
            }

            if (!currentLeg.isStandardTAS())
                result = result + currentLeg.estTASToString() + " ";

            if (currentLeg.engineConfig != lastLegEngineConfig) {
                if (currentLeg.engineConfig == EngineConfig.LowCruise)
                    result = result + ":LOW-CRUISE ";
                else if (currentLeg.engineConfig == EngineConfig.Cruise)
                    result = result + ":CRUISE ";
                lastLegEngineConfig = currentLeg.engineConfig;

            }

            result = result + currentLeg.toString();
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

    static start(time)
    {
        if (this.allLegs.length > 1) {
            if (this.currentLeg)
                this.currentLeg.deselect();

            Leg.getFirstLeg().updateFuelCompensation();
            Leg.getFirstLeg().redraw();

            this.currentLegIndex = 1;
            let currLeg = this.currentLeg = this.allLegs[this.currentLegIndex];
            let startTiming = this.allLegs[0].startFlightTiming || currLeg.startFlightTiming;
            currLeg.startTime = time;

            if (startTiming) {
                state.setTiming();
                etaGate = currLeg.estTimeRemaining.addDate(startTime);
            }

            currLeg.select();
            EngineConfig.selectConfig(currLeg.engineConfig);
            currLeg.redraw();
        }
    }

    static markCurrentLeg(useOriginalETA, markTime)
    {
        if (this.allLegs.length > 1 && this.currentLeg) {
            let currLeg = this.currentLeg;
            currLeg.endTime = markTime;
            currLeg.updateActuals(currLeg.endTime);
            if (state.isTiming() && (currLeg.stopFlightTiming || currLeg.index == this.allLegs.length - 1)) {
                deltaTime = Time.differenceBetween(etaGate, markTime);
                state.clearTiming();
            }
            currLeg.deselect();
            currLeg.redraw();
            this.currentLegIndex++;
            if (this.currentLegIndex < this.allLegs.length) {
                this.currentLeg = this.allLegs[this.currentLegIndex];
                currLeg = this.currentLeg;
                currLeg.startTime = markTime;

                if (!state.isTiming() && currLeg.startFlightTiming) {
                    state.setTiming();
                    if (flightStatus)
                        flightStatus.setTakeoffTime(markTime);
                    etaGate = currLeg.estTimeRemaining.addDate(markTime);
                }

                currLeg.select();
                EngineConfig.selectConfig(currLeg.engineConfig);
                currLeg.redraw();
            } else {
                this.currentLegIndex = 0;
                this.currentLeg = undefined;
                EngineConfig.selectConfig(EngineConfig.Taxi);
                state.clearRunning();
            }
        }
    }
}

Leg.allLegs = [];
Leg.startLegIndex = 0;
Leg.currentLegIndex = 0;
Leg.currentLeg = undefined;
Leg.defaultWindDirection = 0;
Leg.defaultWindSpeed = 0;
Leg.tasOverride = undefined;
Leg.lowCruiseOverride = false;

Leg.cellCount = 24;
// Top row: Waypoint | Lat  | Leg Dist | TAS | WindDir@WindSpd | Est GS | ETE |  ETR | Fuel Flow | Est Fuel | ECF | Comp
Leg.cellIndexWaypoint = 0;
Leg.cellIndexLatitude = 1;
Leg.cellIndexLegDistance = 2;
Leg.cellIndexTAS = 3;
Leg.cellIndexWind = 4;
Leg.cellIndexEstGS = 5;
Leg.cellIndexETE = 6;
Leg.cellIndexETR = 7;
Leg.cellIndexFuelFlow = 8;
Leg.cellIndexEstFuel = 9;
Leg.cellIndexECF = 10;
Leg.cellIndexFuelComp = 11;
// Bot row:  Notes   | Long | Rem Dist | CRS |       Hdg       | Act GS | ATE |  ATR |    OAT    | Act Fuel | ACF | Used
Leg.cellIndexNotes = 12;
Leg.cellIndexLongitude = 13;
Leg.cellIndexRemainingDistance = 14;
Leg.cellIndexCourse = 15;
Leg.cellIndexHeading = 16;
Leg.cellIndexActGS = 17;
Leg.cellIndexATE = 18;
Leg.cellIndexATR = 19;
Leg.cellIndexOAT = 20;
Leg.cellIndexActFuel = 21;
Leg.cellIndexACF = 22;
Leg.cellIndexFuelUsed = 23;

var RallyLegNoFixRE = new RegExp("TAXI|RUNUP|TAKEOFF|CLIMB|PATTERN|LEFT|RIGHT", "i");
var RallyLegWithFixRE = new RegExp("^([0-9a-z\.]{3," + maxWaypointNameLen + "})\\|(START|TIMING)", "i");

class RallyLeg extends Leg
{
    constructor(type, fix, location, engineConfig)
    {
        super(fix, location);
        this.type = type;
        this.engineConfig = engineConfig;
    }

    fixName()
    {
        return this.type;
    }

    toString()
    {
        return this.fixName();
//        return this.fix + ":" + this.type.toUpperCase();
    }

    static reset()
    {
        this.startLocation = undefined;
        this.startFix = "";
        this.totalTaxiTime = new Time(0);
        this.taxiSegments = [];
    }

    static isRallyLegWithoutFix(fix)
    {
        let barPosition = fix.indexOf("|");
        let firstPart = barPosition < 0 ? fix : fix.substring(0, barPosition);

        return RallyLegNoFixRE.test(firstPart);
    }

    static needsFix(fix)
    {
        return RallyLegWithFixRE.test(fix) != null;
    }

    static fixNeeded(fix)
    {
        let match = fix.match(RallyLegWithFixRE);

        if (!match)
            return "";

        return match[1].toString();
    }

    static appendLegNoFix(waypointText)
    {
        let barPosition = waypointText.indexOf("|");
        let firstPart = barPosition < 0 ? waypointText : waypointText.substring(0, barPosition);
        firstPart = firstPart.toUpperCase();

        let match = firstPart.match(RallyLegNoFixRE);

        if (!match)
            return;

        let legType = match[0].toString();

        switch(legType) {
        case "TAXI":
            let taxiLeg = new TaxiLeg(waypointText);
            this.appendLeg(taxiLeg);
            this.totalTaxiTime.add(taxiLeg.ete)
            this.taxiSegments.push(taxiLeg);
            break;
        case "RUNUP":
            this.appendLeg(new RunupLeg(waypointText));
            break;
        case "TAKEOFF":
            if (!this.startLocation) {
                status("Trying to create a Takeoff leg without start leg");
                return;
            }

            this.appendLeg(new TakeoffLeg(waypointText));
            break;
        case "CLIMB":
            this.appendLeg(new ClimbLeg(waypointText));
            break;
        case "PATTERN":
            this.appendLeg(new PatternLeg(waypointText));
            break;
        case "LEFT":
        case "RIGHT":
            this.appendLeg(new TurnLeg(waypointText, legType == "RIGHT"));
            break;
        default:
            status("Unhandled Rally Leg type " + legType);
        }
    }

    static appendLegWithFix(waypointText, fix, location)
    {
        let match = waypointText.match(RallyLegWithFixRE);

        if (!match)
            return;

        let legType = match[2].toString();

        switch(legType) {
        case "START":
            if (this.startLocation) {
                status("Trying to create second start leg");
                return;
            }

            this.startLocation = location;
            this.startFix = fix;
            this.totalTaxiTime = new Time(0);
            this.taxiSegments = [];

            this.appendLeg(new StartLeg(waypointText, fix, location));
            break;
        case "TIMING":
            this.appendLeg(new TimingLeg(waypointText, fix, location));
            break;
        default:
            status("Unhandled Rally Leg type " + legType);
        }
    }

}

RallyLeg.startLocation = undefined;
RallyLeg.startFix = "";
RallyLeg.totalTaxiTime = new Time(0);
RallyLeg.taxiSegments = [];

class StartLeg extends RallyLeg
{
    constructor(fixText, fix, location)
    {
        super("Start", fix, location, EngineConfig.Taxi);
    }

    fixName()
    {
        return this.fix + "|Start";
    }
}

class TimingLeg extends RallyLeg
{
    constructor(fixText, fix, location)
    {
        super("Timing", fix, location, EngineConfig.LowCruise);
        this.stopFlightTiming = true;
    }

    fixName()
    {
        return this.fix + "|Timing";
    }
}

// TAXI[|{COLD|WARM}][|<time>]  e.g. TAXI|COLD|2:30
var TaxiLegRE = new RegExp("^TAXI(?:\\|(COLD|WARM))?(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))?$", "i");

class TaxiLeg extends RallyLeg
{
    constructor(fixText)
    {
        let match = fixText.match(TaxiLegRE);

        let engineConfig = EngineConfig.Taxi;
        super("Taxi", "", new GeoLocation(-1, -1), engineConfig);

        let taxiTimeString = "5:00";
        if (match[2])
            taxiTimeString = match[2].toString();

        let previousLeg = this.previousLeg();
        if (previousLeg)
            this.location = previousLeg.location;

        this.ete = new Time(taxiTimeString);
    }

    fixName()
    {
        return "Taxi|" + this.ete.toString();
    }
}

// RUNUP[|<time>]  e.g. RUNUP|0:30
var RunupLegRE = new RegExp("^RUNUP(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))?$", "i");

class RunupLeg extends RallyLeg
{
    constructor(fixText)
    {
        let match = fixText.match(RunupLegRE);

        super("Runup", "", new GeoLocation(-1, -1), EngineConfig.Runup);

        let runupTimeString = "30";
        if (match[1])
            runupTimeString = match[1].toString();

        let previousLeg = this.previousLeg();
        if (previousLeg)
            this.location = previousLeg.location;

        this.ete = new Time(runupTimeString);
    }

    fixName()
    {
        return "Runup|" + this.ete.toString();
    }
}

// TAKEOFF[|<time>][|<bearing>|<distance>]  e.g. TAKEOFF|2:00|270@3.5
var TakeoffLegRE = new RegExp("^TAKEOFF(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))?(?:\\|([0-9]{1,2}|[0-2][0-9][0-9]|3[0-5][0-9]|360)(?:@)(\\d{1,2}(?:\\.\\d{1,4})?))?$", "i");

class TakeoffLeg extends RallyLeg
{
    constructor(fixText)
    {
        let match = fixText.match(TakeoffLegRE);

        let bearingFromStart = 0;
        let distanceFromStart = 0;
        let takeoffEndLocation = RallyLeg.startLocation;
        if (match && match[2] && match[3]) {
            bearingFromStart = parseInt(match[2].toString()) % 360;
            distanceFromStart = parseFloat(match[3].toString());
            takeoffEndLocation = RallyLeg.startLocation.locationFrom(bearingFromStart, distanceFromStart);
        }

        super("Takeoff", "", takeoffEndLocation, EngineConfig.Takeoff);

        this.bearingFromStart = bearingFromStart;
        this.distanceFromStart = distanceFromStart;

        let takeoffTimeString = "2:00";
        if (match[1])
            takeoffTimeString = match[1].toString();

        this.ete = new Time(takeoffTimeString);
        this.startFlightTiming = true;
    }

    fixName()
    {
        let result = "Takeoff";

        if (this.ete.seconds() != 120)
            result += "|" + this.ete.toString();
        if (this.distanceFromStart)
            result += "|" + this.bearingFromStart + "@" + this.distanceFromStart;

        return result;
    }
}

// CLIMB|<alt>|<time>  e.g. CLIMB|5000|7:00
var ClimbLegRE = new RegExp("^CLIMB(?:\\|)(\\d{3,5})(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))$", "i");

class ClimbLeg extends RallyLeg
{
    constructor(fixText)
    {
        let match = fixText.match(ClimbLegRE);

        let altitude = 5500;
        if (match && match[1])
            altitude = match[1].toString();

        super("Climb", altitude + "\"", undefined, EngineConfig.Climb);

        let timeToClimb = "8:00";
        if (match && match[2])
            timeToClimb = match[2].toString();

        let previousLeg = this.previousLeg();
        if (previousLeg)
            this.location = previousLeg.location;
        this.altitude = altitude;
        this.climbTime = this.ete = new Time(timeToClimb);
    }

    fixName()
    {
        return "Climb|" + this.altitude + "|" + this.ete.toString();
    }

    //  &&&& Don't know why I added this.
    static isValidFix(fixText)
    {
        return fixText.match(ClimbLegRE) ? true : false;
    }
}

// PATTERN|<time>  e.g. PATTERN|0:30
var PatternLegRE = new RegExp("^PATTERN(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))$", "i");

class PatternLeg extends RallyLeg
{
    constructor(fixText)
    {
        super("Pattern", "", undefined, EngineConfig.Pattern);

        let previousLeg = this.previousLeg();
        if (previousLeg)
            this.location = previousLeg.location;

        let match = fixText.match(PatternLegRE);
        let patternTimeString = match[1].toString();
        this.ete = new Time(patternTimeString);
    }

    fixName()
    {
        return "Pattern|" + this.ete.toString();
    }
}

// {LEFT,RIGHT}[|+<extra_turns>]  e.g. LEFT|2
var TurnLegRE = new RegExp("^(LEFT|RIGHT)(?:\\|\\+(\\d))?$", "i");

class TurnLeg extends RallyLeg
{
    constructor(fixText, isRightTurn)
    {
        let match = fixText.match(TurnLegRE);

        let direction = "Left";
        if (match && match[1])
            direction = match[1].toString().toUpperCase() == "LEFT" ? "Left" : "Right";

        let engineConfig = EngineConfig.Cruise;
        let lastLeg = Leg.getLastLeg();
        if (lastLeg)
            engineConfig = lastLeg.engineConfig;

        super(direction, "", new GeoLocation(-1, -1), engineConfig);

        this.extraTurns = (match && match[2]) ? parseInt(match[2]) : 0;
    }

    fixName()
    {
        let result = this.type;
        if (this.extraTurns)
            result += ("|+" + this.extraTurns);

        return result;
    }
}

function distanceFromSpeedAndTime(speed, time)
{
    return speed * time.hours();
}

var geolocationOptions = {
    enableHighAccuracy: true, 
    maximumAge        : 0, 
    timeout           : 1000
};

var watchPositionID = 0;
var flightStatus = null;
var postedLocationError = false;

function startLocationUpdates()
{
    if (navigator.geolocation) {
        try {
            watchPositionID = navigator.geolocation.watchPosition(updateTimeAndPosition, showGeolocationError, geolocationOptions);
            if (postedLocationError) {
                status("");
                postedLocationError = false;
            }
        } catch(e) {
            status("geolocation.watchPosition error: " + e);
            postedLocationError = true;
        }
    } else
        status("Geolocation is not supported by this browser.");

    if (!timeUpdateInterval)
        timeUpdateInterval = window.setInterval(function() { updateTimeAndPosition(undefined); }, 1000);
}

function installOnFocusHandler()
{
    window.onfocus = function() {
        if (watchPositionID) {
            navigator.geolocation.clearWatch(watchPositionID);
            startLocationUpdates();
        }
    };
}

function showGeolocationError(error) {
    postedLocationError = true;
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

/*
    // &&&& Testing code when GPS location is not available.
    var position = {
        coords: {
            latitude: 39.8961,
            longitude: -122.1621,
            speed: 54,
            heading: 359,
            altitude: 512,
            accuracy: 4
        }
    };
    currentLocation = updateTimeAndPosition(position);
    // &&&&
*/
}

function updateTimeAndPosition(position) {
    let now = new Date();
    let timeSinceLastUpdate = now.valueOf() - lastUpdate.valueOf();

    if (!position && timeSinceLastUpdate < 1000)
        return;

    timeSinceLastUpdate = now;

    if (state.isTiming())
        deltaTime = Time.differenceBetween(etaGate, now);

    let requiredSpeeds = {
        leg: undefined,
        gate: undefined,
    };

    if (position) {
        currentLocation = new GeoLocation(position.coords.latitude, position.coords.longitude);

        let distances = Leg.updatePositionToActiveLeg(currentLocation);
        let gateTimeRemaining = Time.differenceBetween(etaGate, now);
        let gateHours = gateTimeRemaining.hours();

        if (gateHours > 0)
            requiredSpeeds.gate = distances.gate / gateHours;
        else
            requiredSpeeds.gate = "Inf";

        let legTimeRemaining = Time.differenceBetween(etaWaypoint, now);
        let legHours = legTimeRemaining.hours();

        if (legHours > 0)
            requiredSpeeds.leg = distances.leg / legHours;
        else
            requiredSpeeds.leg = "Inf";
    }

    if (flightStatus)
        flightStatus.update(now, position, requiredSpeeds);

    if (Leg.getCurrentLeg()) {
        let currLeg = Leg.getCurrentLeg();
        currLeg.updateActuals(now);
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
    let _indexedDB = window._indexedDB || window.indexedDB || window.webkitIndexedDB;
    let request = undefined;
    let deleteDB = false;
    if (deleteDB)
        request = _indexedDB.deleteDatabase(dbName, 1);
    else        
        request = _indexedDB.open(dbName, 1);

    request.onerror = function(event) {
        status("Could not open " + dbName + " IndexedDB");
        setTimeout(start(), 0);
    };
    request.onsuccess = function(event) {
        db = event.target.result;
//        updateDBIfNeeded();
        setTimeout(start(), 0);
    };
    request.onupgradeneeded = function(event) {
        db = event.target.result;
        createObjectStores();
    };        
}

function updateDBIfNeeded()
{
    updateFAAObjectStore();
}

function updateFAAObjectStore()
{
    let transaction = db.transaction("faaWaypoints", "readwrite");

/*
    // report on the success of opening the transaction
    transaction.oncomplete = function(event) {
        status("Transaction completed: database modification finished.");
    };

    transaction.onerror = function(event) {
        status("Transaction not opened due to error. Duplicate items not allowed.");
    };
*/

    let faaWaypointOS = transaction.objectStore("faaWaypoints");

    let faaRecordsLoaded = 0;
    for (let i in faaWaypoints) {
        faaWaypointOS.add(faaWaypoints);
        faaRecordsLoaded++;
    }

    objectStoreRequest.onsuccess = function(event) {
        status("Loaded " + faaRecordsLoaded + " FAA records");
    };

    faaWaypointOS.transaction.oncomplete = function(event) {
        status("Loaded " + faaRecordsLoaded + " FAA records");
    };
}

function createObjectStores()
{
    let faaWaypointOS = db.createObjectStore("faaWaypoints", { keyPath: "name" });
    faaWaypointOS.createIndex("type", "type", {unique: false });

    let userWaypointOS = db.createObjectStore("userWaypoints", { keyPath: "name" });

    let aircraftOS = db.createObjectStore("aircraft", { keyPath: "nNumber" });

    let flightPlanOS = db.createObjectStore("flightPlans", { keyPath: "name" });
    flightPlanOS.createIndex("description", "description", { unique: false });

    let flightLogOS = db.createObjectStore("flightLogs", { keyPath: "dateFlown" });
    flightLogOS.createIndex("name", "name", { unique: false });

    let faaRecordsLoaded = 0;
    for (let i in faaWaypoints) {
        let request = faaWaypointOS.add(faaWaypoints[i]);
        request.onsuccess = function(event) {
            faaRecordsLoaded++;
        }
    }

    status("Loaded FAA Records");

    let userRecordsLoaded = 0;
    for (let i in userWaypoints) {
        let request = userWaypointOS.add(userWaypoints[i]);
        request.onsuccess = function(event) {
            userRecordsLoaded++;
        }
    }

    faaWaypointOS.transaction.oncomplete = function(event) {
        status("Loaded " + faaRecordsLoaded + " FAA records and " + userRecordsLoaded + " user records loaded");    
    };

    faaWaypointOS.transaction.onerror = function(event) {
        status("Failed to loaded FAA and user records!");    
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
    let nextWaypoint = "";

    while (waypointsToLookup.length) {
        nextWaypoint = waypointsToLookup.shift().trim();
        if (nextWaypoint)
            break;
    }

    if (!nextWaypoint) {
        Leg.updateRows();
        return;
    }

    if (RallyLeg.isLegModifier(nextWaypoint))
        Leg.processLegModifier(nextWaypoint);
    else if (RallyLeg.isRallyLegWithoutFix(nextWaypoint))
        getRallyWaypointWithoutFix(nextWaypoint);
    else {
        let fixName = RallyLeg.fixNeeded(nextWaypoint);
        let isRallyWaypoint = false;

        if (fixName)
            isRallyWaypoint = true;
        else
            fixName = nextWaypoint;

        getWaypoint(fixName, nextWaypoint, isRallyWaypoint, true, userWaypointResult);
    }
}

function getWaypoint(fixName, originalFix, isRallyWaypoint, user, callback)
{
    let transaction;
    let waypointsObjectStore

    if (user) {
        transaction = db.transaction(["userWaypoints"], "readonly");
        waypointsObjectStore = transaction.objectStore("userWaypoints");
    } else {
        transaction = db.transaction(["faaWaypoints"], "readonly");
        waypointsObjectStore = transaction.objectStore("faaWaypoints");
    }

    let request = waypointsObjectStore.get(fixName);

    request.onsuccess = function(event) {
        callback(fixName, originalFix, isRallyWaypoint, request.result);
    }

    request.onerror = function(event) {
        callback(fixName, originalFix, isRallyWaypoint, undefined);
    }
}

function userWaypointResult(name, originalFix, isRallyWaypoint, waypoint)
{
    if (waypoint)
        waypointResult(name, originalFix, isRallyWaypoint, waypoint);
    else
        getWaypoint(name, originalFix, isRallyWaypoint, false, waypointResult);
}

function waypointResult(name, originalFix, isRallyWaypoint, waypoint)
{
    if (waypoint) {
        let location = new GeoLocation(waypoint.latitude, waypoint.longitude);

        if (isRallyWaypoint)
            RallyLeg.appendLegWithFix(originalFix, name, location);
        else
            Leg.appendLeg(new Leg(waypoint.name, location));
    } else
        status("Couldn't find waypoint: " + name);

    getNextWaypoint();
}

function getRallyWaypointWithoutFix(waypoint)
{
    RallyLeg.appendLegNoFix(waypoint);

    setTimeout(getNextWaypoint(), 0);
}

function putUserWaypoint(waypoint, callback)
{
    let transaction = db.transaction(["userWaypoints"], "readwrite");
    let waypointsObjectStore = transaction.objectStore("userWaypoints");
    let request = waypointsObjectStore.put(waypoint);

    request.onsuccess = function(event) {
        callback(waypoint, request.result);
    }

    request.onerror = function(event) {
        callback(waypoint, undefined);
    }
}

function selectElementContents(el)
{
    let range = document.createRange();
    range.selectNodeContents(el);
    let sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function makeElementEditable(element, getCurrentValue, setNewValue, setIfValidValue, isValidKeycode)
{
    element.contentEditable = true;

    element.addEventListener('focus', function() {
        element.innerHTML =  getCurrentValue();
        selectElementContents(element);
    });

    element.addEventListener('keydown', function(event) {
        if (event.keyCode == 13 || event.keyCode == 9 || event.keyCode == 27 || event.keyCode == 192) {
            let newTemp = parseInt(this.innerHTML);
            if (event.keyCode == 27 || event.keyCode == 192) {
                if (setNewValue)
                    setNewValue();
            } else
                setIfValidValue(this.innerHTML);
            element.blur();
        } else if (!editKeyCodes.includes(event.keyCode) && !isValidKeycode(event.keyCode))
            event.preventDefault();
    }, { capture: true});
}

function makeOATElementEditable(element, getCurrentValue, setNewValue)
{
    makeElementEditable(element, getCurrentValue, setNewValue, function(text) {
        let newTemp = parseInt(text);
        if (newTemp > 0 && newTemp < 130)
            setNewValue(newTemp);
    }, function(keyCode) {
        return (keyCode >= 48 && keyCode <= 57);
    });
}

function makeFuelElementEditable(element, getCurrentValue, setNewValue)
{
    makeElementEditable(element, getCurrentValue, setNewValue, function(text) {
        let newFuel = parseFloat(text);
        if (newFuel >= 0.0 && newFuel <= 2000.0)
            setNewValue(newFuel);
    }, function(keyCode) {
        return ((keyCode >= 48 && keyCode <= 57) || keyCode == 190);
    });
}

function makePumpFactorElementEditable(element, getCurrentValue, setNewValue)
{
    makeElementEditable(element, getCurrentValue, setNewValue, function(text) {
        let newFuel = parseFloat(text);
        if (newFuel >= 0.90 && newFuel <= 1.1)
            setNewValue(newFuel);
    }, function(keyCode) {
        return ((keyCode >= 48 && keyCode <= 57) || keyCode == 190);
    });
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

function showStartTimeAdjustPopup()
{
    if (flightStatus) {
        let takeoffTime = flightStatus.getOriginalTakeoffTime();
        document.getElementById("StartTimeAdjustPopup_orig").innerHTML = "Original Takeoff Time: " + takeoffTime.toTimeString().split(" ")[0];
        let takeoffTimeTemp = new Date(takeoffTime.valueOf());
        takeoffTimeTemp.setSeconds(0);
        document.getElementById("StartTimeAdjustPopup_seconds0").innerHTML = "Even Minute Takeoff Time: " + takeoffTimeTemp.toTimeString().split(" ")[0];
        takeoffTimeTemp.setSeconds(15);
        document.getElementById("StartTimeAdjustPopup_seconds15").innerHTML = "Minute 15 Takeoff Time: " + takeoffTimeTemp.toTimeString().split(" ")[0];
        takeoffTimeTemp.setSeconds(30);
        document.getElementById("StartTimeAdjustPopup_seconds30").innerHTML = "Minute 30 Takeoff Time: " + takeoffTimeTemp.toTimeString().split(" ")[0];
        takeoffTimeTemp.setSeconds(45);
        document.getElementById("StartTimeAdjustPopup_seconds45").innerHTML = "Minute 45 Takeoff Time: " + takeoffTimeTemp.toTimeString().split(" ")[0];
        showPopup('start-time-adjust-popup', true);
    }
}

function restoreOriginalTakeoffTime()
{
    if (flightStatus) {
        let origTakeoffTime = flightStatus.getOriginalTakeoffTime();
        let newTakeoffTime = flightStatus.getTakeoffTime();
        newTakeoffTime.setSeconds(origTakeoffTime.getSeconds());
        Leg.updateStartLegTakeoffTime(newTakeoffTime);
    }
    hideStartTimeAdjustPopup();

}

function adjustStartTimeSeconds(sec)
{
    if (flightStatus) {
        let newTakeoffTime = flightStatus.getTakeoffTime();;
        newTakeoffTime.setSeconds(sec);
        Leg.updateStartLegTakeoffTime(newTakeoffTime);
    }
    hideStartTimeAdjustPopup();
}

function hideStartTimeAdjustPopup()
{
    showPopup('start-time-adjust-popup', false);
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
    let name = document.getElementById('UserWaypointPopup_name').value;
    if (name.length > maxWaypointNameLen)
        name = name.substring(0, maxWaypointNameLen - 1);

    let type = "User";
    let description = document.getElementById('UserWaypointPopup_description').value;
    if (description.length > maxWaypointDescLen)
        description = description.substring(0, maxWaypointDescLen - 1);

    let latitude = decimalLatitudeFromString(document.getElementById('UserWaypointPopup_latitude').value);
    let longitude = decimalLongitudeFromString(document.getElementById('UserWaypointPopup_longitude').value);
    let waypoint = new Waypoint(name, type, description, latitude, longitude);
    putUserWaypoint(waypoint, createUserWaypointCallback);
}

function editUserWaypointLookupResult(name, originalFIx, isRallyWaypoint, waypoint)
{
    document.getElementById('UserWaypointPopup_name').value = name;

    if (!waypoint) {
        status("Could not find User waypoint named \"" + name +"\"");
        document.getElementById('UserWaypointPopup_description').value = "";
        document.getElementById('UserWaypointPopup_latitude').value = "";
        document.getElementById('UserWaypointPopup_longitude').value = "";
        return;
    }

    document.getElementById('UserWaypointPopup_description').value = waypoint.description ? waypoint.description : "";
    document.getElementById('UserWaypointPopup_latitude').value = waypoint.latitude;
    document.getElementById('UserWaypointPopup_longitude').value = waypoint.longitude;
}

function editUserWaypoint()
{
    let name = document.getElementById('UserWaypointPopup_name').value;
    if (name.length > maxWaypointNameLen)
        name = name.substring(0, maxWaypointNameLen - 1);

    name = name.trim().toUpperCase();

    getWaypoint(name, undefined, false,  true, editUserWaypointLookupResult);
}

function hideUserWaypointPopup()
{
    showPopup('user-waypoint-popup', false);
}

function showCalcRPMFromPercentHPPopup()
{
    showPopup('calc-rpm-from-percent-powerpopup', true);
}

function calculateRPM()
{
    const rpm65PctAt6000 = 2500;

    let pressureAltStr = document.getElementById('CalcRPMFromPctPowerPopup_pressureAlt').value;
    let oatFStr = document.getElementById('CalcRPMFromPctPowerPopup_OAT').value;
    let percentHPStr = document.getElementById('CalcRPMFromPctPowerPopup_percentHP').value;

    let pressureAlt = parseInt(pressureAltStr);
    let oatF = parseFloat(oatFStr);
    let percentHP = parseInt(percentHPStr);

    let standardTempF = 59 - (3.564 * pressureAlt / 1000);
    let densityAlt = pressureAlt + (66.667 * (oatF - standardTempF));

    let calcRPM = Math.round(rpm65PctAt6000 + (0.03 * (densityAlt - 6000)) - (65 - percentHP) / 0.06);

    document.getElementById("CalcRPMFromPctPowerPopup_calcRPM").innerHTML = calcRPM;
    document.getElementById("CalcRPMFromPctPowerPopup_calcStdTemp").innerHTML = Number(standardTempF).toFixed(1) + "&deg;F";
    document.getElementById("CalcRPMFromPctPowerPopup_calcDensityAlt").innerHTML = Math.round(densityAlt);
}

function hideCalcRPMPopup()
{
    showPopup('calc-rpm-from-percent-powerpopup', false);
}

function showRoutePopup()
{
    if (state.isRunning())
        return;

    let routeElem = document.getElementById('routePopup_route');
    let existingRoute = Leg.currentRoute();
/*
    if (!existingRoute)
        existingRoute = "OILCAMP I5.WESTSHIELDS I5.165 I5.VOLTA PT.ALPHA";
*/
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
    let routeElem = document.getElementById('routePopup_route');
    let routeString = routeElem.value;
    routeString = routeString.trim().toUpperCase();
    getWaypoints(routeString);
    cancelRoutePopup();
}

function showGroundSpeedPopup()
{
    let gsElem = document.getElementById('GroundSpeedPopup_gs');
    gsElem.value = EngineConfig.currentTAS();
    showPopup('gs-popup', true);
}

function cancelGroundSpeedPopup()
{
    showPopup('gs-popup', false);
}

function submitGroundSpeedPopup()
{
    let gs = document.getElementById('GroundSpeedPopup_gs').value;
    gs = Number(gs);
    if (gs > 0)
        Leg.setGroundSpeed(gs);
    cancelGroundSpeedPopup();
}

var legEditing;
function showEditTASPopup(leg)
{
    if (state.isRunning())
        return;

    legEditing = leg;
    let tasElem = document.getElementById('EditTASPopup_tas');
    tasElem.value = leg.estTAS;
    showPopup('tas-popup', true);
}

function cancelEditTASPopup()
{
    showPopup('tas-popup', false);
}

function submitEditTASPopup()
{
    let tas = document.getElementById('EditTASPopup_tas').value;
    tas = Number(tas);
    if (tas > 0) {
        legEditing.estTAS = tas;
        legEditing.ete = undefined;;
    }

    Leg.updateRows();
    cancelEditTASPopup();
}

function showWindPopup(leg)
{
    if (state.isRunning())
        return;

    legEditing = leg;
    let windDirectionElem = document.getElementById('WindPopup_direction');
    windDirectionElem.value = leg.windDirection;
    let windSpeedElem = document.getElementById('WindPopup_speed');
    windSpeedElem.value = leg.windSpeed;
    showPopup('wind-popup', true);
}

function cancelWindPopup()
{
    showPopup('wind-popup', false);
}

function submitWindPopup()
{
    let windChanged = false;
    let windDirection = document.getElementById('WindPopup_direction').value;
    if (windDirection) {
        windDirection = parseInt(windDirection);
        if (windDirection >= 0 && windDirection <= 360) {
            legEditing.windDirection = windDirection;
            windChanged = true;
        }
    }

    let windSpeed = document.getElementById('WindPopup_speed').value;
    if (windSpeed) {
        windSpeed = parseInt(windSpeed);
        legEditing.windSpeed = windSpeed;
        windChanged = true;
    }

    if (windChanged) {
        legEditing.propagateWind();
        Leg.updateRows();
    }

    cancelWindPopup();
}

function startRunning()
{
    if (Leg.haveRoute() && !state.isRunning()) {
        startTime = new Date();
        startTime.setMilliseconds(0);  // Round to the prior whole second.
        if (flightStatus)
            flightStatus.resetActualFuelForFlight();
        legStartTime = startTime;
        state.setRunning();
        Leg.resetCurrentLeg();
        Leg.start(startTime);
        Leg.getFirstLeg().scrollToTop();
        let currLeg = Leg.getCurrentLeg();
        currLeg.startTime = legStartTime;
        etaWaypoint = currLeg.ete.addDate(startTime);
    }
}

function markLeg()
{
    if (state.isRunning()) {
        let now = new Date();
        now.setMilliseconds(0);  // &&&& Should we round to nearest?
        let topLegToView = Leg.getCurrentLeg();
        Leg.markCurrentLeg(false, now)
        topLegToView.scrollToTop();
        if (state.isRunning()) {
            let leg = Leg.getCurrentLeg();
            etaWaypoint = leg.ete.addDate(now);
        }
    }
}

function markLegAsPlanned()
{
    if (state.isRunning()) {
    }
}

function init()
{
    if (useMiles)
        earthRadius = radiusOfEarthInMiles;
    statusElement = document.getElementById("status");
    engineConfigTableElement = document.getElementById("engineConfigs")
    waypointsTableElement = document.getElementById("waypoints");
    flightStatus = new FlightStatus();

    status("Starting...");

    openDB();
}

function start()
{
    // Bonanza configuration
    EngineConfig.setConfigName("N7346R");
    EngineConfig.appendConfig("Taxi", 1000, "Rich", 2.80, 0); // Was 2.10 then 2.45
    EngineConfig.appendConfig("Runup", 1800, "Rich", 5.80, 0); // Was 5.79 then 6.75
    EngineConfig.appendConfig("Takeoff", 2700, "Rich", 24.90, 105); // Was 26.09 then 26.57
    EngineConfig.appendConfig("Climb", 2500, 25, 22.00, 130); // Was 21.07 then 21.85
    EngineConfig.appendConfig("Cruise", 2400, 20, 14.80, 142); // Was 14.12 then 14.18
    EngineConfig.appendConfig("Low Cruise", 2400, 20, 14.80, 142); // Was 14.12 then 14.18
    EngineConfig.appendConfig("Pattern", 2700, 15, 11.10, 95); // Was 7.80 then 11.13
    EngineConfig.selectConfig(EngineConfig.Taxi);
    EngineConfig.selectPowerUnits("MP");

/*
    // Cessna configuration
    EngineConfig.setConfigName("N80377");
    EngineConfig.appendConfig("Taxi", 1000, "20%", 1.40, 0);
    EngineConfig.appendConfig("Runup", 1800, "40%", 3.50, 0);
    EngineConfig.appendConfig("Takeoff", 2700, "100%", 8.90, 85);
    EngineConfig.appendConfig("Climb", 2500, "80%", 8.90, 85);
    EngineConfig.appendConfig("Cruise", 2400, "65%", 6.70, 100);
    EngineConfig.appendConfig("Low Cruise", 2000, "45%", 5.40, 75);
    EngineConfig.appendConfig("Pattern", 1800, "45%", 5.40, 75);
    EngineConfig.selectConfig(EngineConfig.Taxi);
    EngineConfig.selectPowerUnits("%HP");
 */

    startLocationUpdates();
    installOnFocusHandler();
}
