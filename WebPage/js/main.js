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

var timeUpdateInterval = 0;
var startTime = null;
var lastUpdate = new Date();
var legStartTime = null;
var currentAvgGS = 0;
var distanceToWaypoint = 0;
var etaWaypoint = 0;
var etaGate = 0;
var deltaTime = 0;
var priorFuelUsed = 0;
var fuelUsed = 0;
var TwoPI = Math.PI * 2;

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
            this._seconds = time.valueOf() / 1000;;
            return;
        }

        if (typeof time == "string") {
            var match = time.match(TimeRE);

            if (!match) {
                this._seconds = 0;
                return;
            }

            if (match[3]) {
                var hours = parseInt(match[1].toString());
                var minutes = parseInt(match[2].toString());
                var seconds = parseInt(match[3].toString());

                this._seconds = (hours * 60 + minutes) * 60 + seconds;
            } else if (match[2]) {
                var minutes = parseInt(match[1].toString());
                var seconds = parseInt(match[2].toString());

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
        var seconds1 = (time1.valueOf() + 500) / 1000 | 0;
        var seconds2 = (time2.valueOf() + 500) / 1000 | 0;
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
        var result = "";
        var seconds = this._seconds % 60;
        if (seconds < 0) {
            result = "-";
            seconds = -seconds;
        }
        var minutes = this._seconds / 60 | 0;
        var hours = minutes / 60 | 0;
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
        var latitude = this.latitude.toFixed(4)
        var latitudeSuffix = "&degN";
        if (latitude < 0) {
            latitudeSuffix = "&degS"
            latitude = -latitude;
        }
        return latitude + latitudeSuffix;
    }

    longitudeString()
    {
        var longitude = this.longitude.toFixed(4);
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
        this._type = type;
        this._rpm = rpm;
        this._manifoldPressure = manifoldPressure;
        this._fuelFlow = fuelFlow;
        this._trueAirspeed = trueAirspeed;

        this.cells = [];
        var rows = engineConfigTableElement.rows;

        for (var i = 0; i < 5; i++)
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

        var newConfig = new EngineConfig(type, rpm, manifoldPressure, fuelFlow, trueAirspeed);
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

    static currentTAS()
    {
        return this.allConfigs[this.currentConfig]._trueAirspeed;
    }
}

EngineConfig.allConfigs = [];
EngineConfig.allConfigsByType = {};
EngineConfig.currentConfig = 0;
EngineConfig.ColdTaxi = 0;
EngineConfig.WarmTaxi = 1;
EngineConfig.Runup = 2;
EngineConfig.Takeoff = 3;
EngineConfig.Climb = 4;
EngineConfig.Cruise = 5;
EngineConfig.Pattern= 6;

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
        this.headingElement = document.getElementById("currentHeading");
        this.altitudeElement = document.getElementById("currentAltitude");
        this.accuracyElement = document.getElementById("currentAccuracy");
        this.timestampElement = document.getElementById("currentTimeStamp");
        this.currentTimeElement = document.getElementById("currentTime");
        this.distanceToWaypointElement = document.getElementById("distanceToWaypoint");
        this.timeToWaypointElement = document.getElementById("timeToWaypoint");
        this.timeToGateElement = document.getElementById("timeToGate");
        this.deltaTimeElement = document.getElementById("deltaTime");
        this.fuelUsedElement = document.getElementById("fuelUsed");
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
            this.speedElement.innerHTML = currentSpeed.toFixed(1);
            this.recentGroundSpeeds.unshift(currentSpeed);
            if (this.recentGroundSpeeds.length > 10) {
                this.recentGroundSpeeds.pop();
            }
            var averageSpeed = 0;
            var numberSpeeds = this.recentGroundSpeeds.length;
            for (var i = 0; i < numberSpeeds; i++)
                averageSpeed += this.recentGroundSpeeds[i];
            averageSpeed = averageSpeed / numberSpeeds;
            currentAvgGS = averageSpeed;
            this.averageSpeedElement.innerHTML = averageSpeed.toFixed(1);
            if (typeof requiredSpeed == "string") {
                this.requiredGSElement.innerHTML = requiredSpeed;
                this.deltaGSElement.innerHTML = "";
                this.deltaGSElement.className = "status-center";
            } else {
                this.requiredGSElement.innerHTML = requiredSpeed.toFixed(1);
                var deltaGS = currentSpeed - requiredSpeed;
                if (deltaGS > 1.0) {
                    this.deltaGSElement.className = "status-center delta-speed-ahead";
                } else if (deltaGS < -1.0) {
                    this.deltaGSElement.className = "status-center delta-speed-behind";
                } else {
                    this.deltaGSElement.className = "status-center delta-speed-close";
                }
                this.deltaGSElement.innerHTML = deltaGS.toFixed(1);
            }
            var heading = "";
            if (position.coords.heading) {
                var headingVal = Math.round(position.coords.heading + magneticVariation);
                headingVal = (headingVal + 360) % 360;
                if (!headingVal)
                    headingVal = 360;
                heading = headingVal  + "&deg";
            }
            this.headingElement.innerHTML = heading;
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
        this.fuelUsedElement.innerHTML = fuelUsed.toFixed(3);
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
    constructor(fix, location)
    {
        this.index = Leg.allLegs.length;
        this.fix = fix;
        this.location = location;
        this.startFlightTiming = false;
        this.stopFlightTiming = false;
        this.engineConfig = EngineConfig.Cruise;
        this.distance = 0;
        this.legDistance = 0;
        this.distanceRemaining = 0;
        this.distanceRemainingAfterThisLeg = 0;
        this.course = 0;
        this.estTAS = 0;
        this.windDirection = 0;
        this.windSpeed = 0;
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
        this.oat = 0;
        this.estCummulativeFuel = 0;
        this.actCummulativeFuel = 0;
        this.row = [];
        this.row[0] = waypointsTableElement.insertRow(this.index * 2)
        this.row[1] = waypointsTableElement.insertRow(this.index * 2 + 1)
        this.cells = new Array(22);

        // Waypoint | Lat  | Leg Dist | TAS | WindDir@WindSpd | Est GS | ETE |  ETR | Fuel Flow | Est Fuel | ECF
        //  Notes   | Long | Rem Dist | CRS |       Hdg       | Act GS | ATE |  ATR |    OAT    | Act Fuel | ACF

        for (var col = 0; col <= 10; col++) {
            this.cells[col] = this.row[0].insertCell(col);
            this.cells[col + 11] = this.row[1].insertCell(col);
            var width = "8%";
            if (col == 0)
                width = "19%";
            else if (col == 1)
                width = "9%";

            this.cells[col].style.width = width;
        }

        this.deselect();

        this.cells[Leg.cellIndexTAS].leg = this;
        this.cells[Leg.cellIndexTAS].onclick = function() { Leg.editTAS(this); };

        // Edit wind popup
        this.cells[Leg.cellIndexWind].leg = this;
        this.cells[Leg.cellIndexWind].onclick = function() { Leg.editWind(this); };
    }

    fixName()
    {
        return this.fix;
    }

    remove()
    {
        var rowIndex = this.row[0].rowIndex;
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

        this.cells[Leg.cellIndexNotes].innerHTML = this.notes ? this.notes : "";
        this.cells[Leg.cellIndexLongitude].innerHTML = this.location.longitudeString();
        this.cells[Leg.cellIndexRemainingDistance].innerHTML = this.distanceRemaining.toFixed(2);
        this.cells[Leg.cellIndexCourse].innerHTML = this.course.toFixed(0) + "&deg";
        this.cells[Leg.cellIndexHeading].innerHTML = this.heading.toFixed(0) + "&deg";
        this.cells[Leg.cellIndexActGS].innerHTML = this.actGS.toFixed(1);
        this.cells[Leg.cellIndexATE].innerHTML = this.ate ? this.ate.toString() : "";
        this.cells[Leg.cellIndexATR].innerHTML = this.actTimeRemaining ? this.actTimeRemaining.toString() : "";
        this.cells[Leg.cellIndexOAT].innerHTML = this.oat + "&deg";
        this.cells[Leg.cellIndexActFuel].innerHTML = this.actFuel.toFixed(2);
        this.cells[Leg.cellIndexACF].innerHTML = this.actCummulativeFuel.toFixed(2);

        this.redrawNeeded = false;
    }

    select()
    {
/*  &&&& Trying to automatically scroll into view
        var offsetTop = waypointsTableElement.offsetTop;
        var topRow = this.row[0];
        topRow.scrollTop = offsetTop + topRow.scrollHeight;
*/
        var rowClasses = "waypoint-row-highlight " + (this.index % 2 ? "waypoint-row-odd" : "row-even");
        this.row[0].className = rowClasses;
        this.row[1].className = rowClasses;
    }

    deselect()
    {
        var rowClasses = "waypoint-row " + (this.index % 2 ? "waypoint-row-odd" : "row-even");
        this.row[0].className = rowClasses;
        this.row[1].className = rowClasses;
    }

    toString()
    {
        return this.fix;
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

    updateDistanceAndBearing(other)
    {
        this.distance = this.location.distanceTo(other);
        this.course = Math.round(this.location.bearingFrom(other));
        if (this.ete == undefined && this.estGS != 0) {
            var eteSeconds = Math.round(this.distance * 3600 / this.estGS);
            this.ete = new Time(eteSeconds);
        }

        if (this.ete.seconds())
            this.estFuel = this.fuelFlow * this.ete.hours();

        this.redrawNeeded = true;
    }

    updateActuals(date)
    {
        var previousLeg = this.previousLeg();

        this.ate = Time.differenceBetween(date, this.startTime);
        this.actFuel = this.fuelFlow * this.ate.hours();
        this.actCummulativeFuel = (previousLeg ? previousLeg.actCummulativeFuel : 0) + this.actFuel;

        var distanceCovered = this.legDistance - this.distance;
        this.actGS = (this.ate.seconds() < 10 || distanceCovered < 2) ? currentAvgGS : (distanceCovered / this.ate.hours());
        var estSecondsRemaining = this.actGS ? Math.round(this.distance * 3600 / this.actGS) : 0;
        this.actTimeRemaining = new Time(estSecondsRemaining);
        fuelUsed = priorFuelUsed + this.actFuel;
        this.redrawNeeded = true;
    }

    propagateWind()
    {
        var windDirection = this.windDirection;
        var windSpeed = this.windSpeed;

        windDirection = (windDirection + 360) % 360;
        if (!windDirection)
            windDirection = 360;

        for (var currLeg = this; currLeg; currLeg = currLeg.nextLeg()) {
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

        var windDirectionRadians = this.windDirection.toRadians();
        var courseRadians = this.course.toRadians();
        var swc = (this.windSpeed / this.estTAS) * Math.sin(windDirectionRadians - courseRadians);
        if (Math.abs(swc) > 1) {
            status("Wind to strong to fly!");
            return;
        }

        var headingRadians = courseRadians + Math.asin(swc);
        if (headingRadians < 0)
            headingRadians += TwoPI;
        if (headingRadians > TwoPI)
            headingRadians -= TwoPI
        var groundSpeed = this.estTAS * Math.sqrt(1 - swc * swc) -
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
        var engineConfig = EngineConfig.getConfig(this.engineConfig);

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

        var previousLeg = this.previousLeg();
        var havePrevious = true;
        if (!previousLeg) {
            havePrevious = false;
            previousLeg = this;
            if (!this.ete)
                this.ete = new Time(0);
        }

        var thisLegType = this.type;
        if (thisLegType == "Climb" && havePrevious)
            this.location = previousLeg.location;
        else {
            this.updateDistanceAndBearing(previousLeg.location);
            this.updateForWind();
            this.legDistance = this.distance;
            var nextLeg = this.nextLeg();
            var previousLegType = previousLeg.type;
            if (havePrevious) {
                if (previousLegType == "Climb") {
                    var climbDistance = distanceFromSpeedAndTime(previousLeg.estGS, previousLeg.climbTime);
                    if (climbDistance < this.distance) {
                        var climbStartLocation = previousLeg.location;
                        var climbEndLocation = climbStartLocation.locationFrom(this.course, climbDistance);
                        previousLeg.location = climbEndLocation;
                        previousLeg.updateDistanceAndBearing(climbStartLocation);
                        this.ete = undefined;
                        this.updateDistanceAndBearing(climbEndLocation);
                    } else {
                        status("Not enough distance to climb in leg #" + previousLeg.index);
                    }
                } else if ((thisLegType == "Left" || thisLegType == "Right") && nextLeg && nextLeg.location) {
                    var standardRateCircumference = this.estTAS / 30;
                    var standardRateRadius = standardRateCircumference / TwoPI;
                    var offsetInboundBearing = 360 + previousLeg.course + (thisLegType == "Left" ? -90 : 90);
                    offsetInboundBearing = Math.round((offsetInboundBearing + 360) % 360);
                    // Save original location
                    if (!previousLeg.originalLocation)
                        previousLeg.originalLocation = previousLeg.location;
                    var previousLocation = previousLeg.originalLocation;
                    var inboundLocation = previousLocation.locationFrom(offsetInboundBearing, standardRateRadius);
                    var bearingToNext = Math.round(nextLeg.location.bearingFrom(previousLocation));
                    var offsetOutboundBearing = bearingToNext + (thisLegType == "Left" ? 90 : -90);
                    offsetOutboundBearing = (offsetOutboundBearing + 360) % 360;
                    var outboundLocation = previousLocation.locationFrom(offsetOutboundBearing, standardRateRadius);
                    var turnAngle = thisLegType == "Left" ? (360 + bearingToNext - previousLeg.course) : (360 + previousLeg.course - bearingToNext);
                    turnAngle = (turnAngle + 360) % 360;
                    var totalDegrees = turnAngle + 360 * this.extraTurns;
                    var secondsInTurn = Math.round(totalDegrees / 3);
                    this.ete = new Time(Math.round((turnAngle + 360 * this.extraTurns) / 3));
                    this.estFuel = this.fuelFlow * this.ete.hours();
                    this.location = outboundLocation;
                    this.legDistance = this.distance = distanceFromSpeedAndTime(this.estTAS, this.ete);
                    previousLeg.location = inboundLocation;
                    var prevPrevLeg = previousLeg.previousLeg();
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
        var nextLeg = this.nextLeg();

        var distanceRemaining;
        var timeRemaining;

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
        if (this.allLegs.length == 0)
            return;

        for (var i = 0; i < this.allLegs.length; i++)
            this.allLegs[i].index = i;
    }

    static updateRows()
    {
        if (this.allLegs.length == 0)
            return;

        var haveStartTiming = false;
        var haveStopTiming = false;
        for (var i = 0; i < this.allLegs.length; i++) {
            var thisLeg = this.allLegs[i];
            thisLeg.index = i;
            thisLeg.calculateRow();
            if (thisLeg.startFlightTiming) {
                if (haveStartTiming)
                    status("Have duplicate Start timing leg in row " + thisLeg.toString());
                haveStartTiming = true
            }
            if (thisLeg.stopFlightTiming) {
                if (haveStopTiming)
                    status("Have duplicate Timing leg in row " + thisLeg.toString());
                haveStopTiming = true
            }
        }

        if (!haveStartTiming)
            Leg.getFirstLeg().startFlightTiming = true;
        if (!haveStopTiming)
            Leg.getLastLeg().stopFlightTiming = true;

        for (var i = 0; i < this.allLegs.length; i++)
            this.allLegs[i].updateForward();

        for (var i = this.allLegs.length - 1; i >= 0; i--)
            this.allLegs[i].updateBackward();

        for (var i = 0; i < this.allLegs.length; i++)
            this.allLegs[i].redraw();
    }

    static appendLeg(leg)
    {
        this.allLegs.push(leg);
    }

    static removeAll()
    {
        while (this.allLegs.length) {
            var leg = this.allLegs[0];
            leg.remove();
        }
        RallyLeg.reset();
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
            result = result + this.allLegs[i].toString();
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
            this.currentLegIndex = 1;
            var currLeg = this.currentLeg = this.allLegs[this.currentLegIndex];
            var startTiming = this.allLegs[0].startFlightTiming || currLeg.startFlightTiming;
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
            var currLeg = this.currentLeg;
            currLeg.endTime = markTime;
            currLeg.updateActuals(currLeg.endTime);
            priorFuelUsed = priorFuelUsed + currLeg.actFuel;
            fuelUsed = priorFuelUsed;
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
                    etaGate = currLeg.estTimeRemaining.addDate(markTime);
                }

                currLeg.select();
                EngineConfig.selectConfig(currLeg.engineConfig);
                currLeg.redraw();
            } else {
                this.currentLegIndex = 0;
                this.currentLeg = undefined;
                EngineConfig.selectConfig(EngineConfig.ColdTaxi);
                state.clearRunning();
            }
        }
    }
}

Leg.allLegs = [];
Leg.currentLegIndex = 0;
Leg.currentLeg = undefined;
Leg.cellCount = 22;
// Top row: Waypoint | Lat  | Leg Dist | TAS | WindDir@WindSpd | Est GS | ETE |  ETR | Fuel Flow | Est Fuel | ECF
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
// Bot row:  Notes   | Long | Rem Dist | CRS |       Hdg       | Act GS | ATE |  ATR |    OAT    | Act Fuel | ACF
Leg.cellIndexNotes = 11;
Leg.cellIndexLongitude = 12;
Leg.cellIndexRemainingDistance = 13;;
Leg.cellIndexCourse = 14;
Leg.cellIndexHeading = 15;
Leg.cellIndexActGS = 16;
Leg.cellIndexATE = 17;
Leg.cellIndexATR = 18;
Leg.cellIndexOAT = 19;
Leg.cellIndexActFuel = 20;
Leg.cellIndexACF = 21;

var RallyLegNoFixRE = new RegExp("TAXI|RUNUP|TAKEOFF|CLIMB|PATTERN|LEFT|RIGHT", "i");
var RallyLegWithFixRE = new RegExp("^([0-9a-z\.]{3,10})\\|(START|TIMING)", "i");

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
        var barPosition = fix.indexOf("|");
        var firstPart = barPosition < 0 ? fix : fix.substring(0, barPosition);

        return RallyLegNoFixRE.test(firstPart);
    }

    static needsFix(fix)
    {
        return RallyLegWithFixRE.test(fix) != null;
    }

    static fixNeeded(fix)
    {
        var match = fix.match(RallyLegWithFixRE);

        if (!match)
            return "";

        return match[1].toString();
    }

    static appendLegNoFix(waypointText)
    {
        var barPosition = waypointText.indexOf("|");
        var firstPart = barPosition < 0 ? waypointText : waypointText.substring(0, barPosition);
        firstPart = firstPart.toUpperCase();

        var match = firstPart.match(RallyLegNoFixRE);

        if (!match)
            return;

        var legType = match[0].toString();

        switch(legType) {
        case "TAXI":
            var taxiLeg = new TaxiLeg(waypointText);
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
        var match = waypointText.match(RallyLegWithFixRE);

        if (!match)
            return;

        var legType = match[2].toString();

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
        super("Start", fix, location, EngineConfig.ColdTaxi);
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
        super("Timing", fix, location, EngineConfig.Cruise);
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
        var match = fixText.match(TaxiLegRE);

        var engineConfig = (match[1] && match[1].toString().toUpperCase() == "COLD")
            ? EngineConfig.ColdTaxi
            : EngineConfig.WarmTaxi;
        super("Taxi", "", new GeoLocation(-1, -1), engineConfig);

        var taxiTimeString = "5:00";
        if (match[2])
            taxiTimeString = match[2].toString();

        var previousLeg = this.previousLeg();
        if (previousLeg)
            this.location = previousLeg.location;

        this.ete = new Time(taxiTimeString);
    }

    fixName()
    {
        var coldWarm = "Warm";
        if (this.engineConfig == EngineConfig.ColdTaxi)
            coldWarm = "Cold";

        return "Taxi|" + coldWarm + "|" + this.ete.toString();
    }
}

// RUNUP[|<time>]  e.g. RUNUP|0:30
var RunupLegRE = new RegExp("^RUNUP(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))?$", "i");

class RunupLeg extends RallyLeg
{
    constructor(fixText)
    {
        var match = fixText.match(RunupLegRE);

        super("Runup", "", new GeoLocation(-1, -1), EngineConfig.Runup);

        var runupTimeString = "30";
        if (match[1])
            runupTimeString = match[1].toString();

        var previousLeg = this.previousLeg();
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
        var match = fixText.match(TakeoffLegRE);

        var bearingFromStart = 0;
        var distanceFromStart = 0;
        var takeoffEndLocation = RallyLeg.startLocation;
        if (match && match[2] && match[3]) {
            bearingFromStart = parseInt(match[2].toString()) % 360;
            distanceFromStart = parseFloat(match[3].toString());
            takeoffEndLocation = RallyLeg.startLocation.locationFrom(bearingFromStart, distanceFromStart);
        }

        super("Takeoff", "", takeoffEndLocation, EngineConfig.Takeoff);

        this.bearingFromStart = bearingFromStart;
        this.distanceFromStart = distanceFromStart;

        var takeoffTimeString = "2:00";
        if (match[1])
            takeoffTimeString = match[1].toString();

        this.ete = new Time(takeoffTimeString);
        this.startFlightTiming = true;
    }

    fixName()
    {
        var result = "Takeoff";

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
        var match = fixText.match(ClimbLegRE);

        var altitude = 5500;
        if (match && match[1])
            altitude = match[1].toString();

        super("Climb", altitude + "\"", undefined, EngineConfig.Climb);

        var timeToClimb = "8:00";
        if (match && match[2])
            timeToClimb = match[2].toString();

        var previousLeg = this.previousLeg();
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

        var previousLeg = this.previousLeg();
        if (previousLeg)
            this.location = previousLeg.location;

        var match = fixText.match(PatternLegRE);
        var patternTimeString = match[1].toString();
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
        var match = fixText.match(TurnLegRE);

        var direction = "Left";
        if (match && match[1])
            direction = match[1].toString().toUpperCase() == "LEFT" ? "Left" : "Right";

        var engineConfig = EngineConfig.Cruise;
        var lastLeg = Leg.getLastLeg();
        if (lastLeg)
            engineConfig = lastLeg.engineConfig;

        super(direction, "", new GeoLocation(-1, -1), engineConfig);

        this.extraTurns = (match && match[2]) ? parseInt(match[2]) : 0;
    }

    fixName()
    {
        var result = this.type;
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

    if (state.isTiming())
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

    if (!nextWaypoint) {
        Leg.updateRows();
        return;
    }

    if (RallyLeg.isRallyLegWithoutFix(nextWaypoint))
        getRallyWaypointWithoutFix(nextWaypoint);
    else {
        var fixName = RallyLeg.fixNeeded(nextWaypoint);
        var isRallyWaypoint = false;

        if (fixName)
            isRallyWaypoint = true;
        else
            fixName = nextWaypoint;

        getWaypoint(fixName, nextWaypoint, isRallyWaypoint, true, userWaypointResult);
    }
}

function getWaypoint(fixName, originalFix, isRallyWaypoint, user, callback)
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

    var request = waypointsObjectStore.get(fixName);

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
        var location = new GeoLocation(waypoint.latitude, waypoint.longitude);

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
    if (state.isRunning())
        return;

    var routeElem = document.getElementById('routePopup_route');
    var existingRoute = Leg.currentRoute();
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

var legEditing;
function showEditTASPopup(leg)
{
    if (state.isRunning())
        return;

    legEditing = leg;
    var tasElem = document.getElementById('EditTASPopup_tas');
    tasElem.value = leg.estTAS;
    showPopup('tas-popup', true);
}

function cancelEditTASPopup()
{
    showPopup('tas-popup', false);
}

function submitEditTASPopup()
{
    var tas = document.getElementById('EditTASPopup_tas').value;
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
    var windDirectionElem = document.getElementById('WindPopup_direction');
    windDirectionElem.value = leg.windDirection;
    var windSpeedElem = document.getElementById('WindPopup_speed');
    windSpeedElem.value = leg.windSpeed;
    showPopup('wind-popup', true);
}

function cancelWindPopup()
{
    showPopup('wind-popup', false);
}

function submitWindPopup()
{
    var windChanged = false;
    var windDirection = document.getElementById('WindPopup_direction').value;
    if (windDirection) {
        windDirection = parseInt(windDirection);
        if (windDirection >= 0 && windDirection <= 360) {
            legEditing.windDirection = windDirection;
            windChanged = true;
        }
    }

    var windSpeed = document.getElementById('WindPopup_speed').value;
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
        priorFuelUsed = fuelUsed = 0;
        legStartTime = startTime;
        startLocationUpdates();
        state.setRunning();
        Leg.resetCurrentLeg();
        Leg.start(startTime);
        var currLeg = Leg.getCurrentLeg();
        currLeg.startTime = legStartTime;
        etaWaypoint = currLeg.ete.addDate(startTime);
    }
}

function markLeg()
{
    if (state.isRunning()) {
        var now = new Date();
        Leg.markCurrentLeg(false, now)
        if (state.isRunning()) {
            var leg = Leg.getCurrentLeg();
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
    locationStatus = new LocationStatus();

    status("Starting...");

    openDB();
}

function start()
{
    // Bonanza configuration
    EngineConfig.appendConfig("Cold Taxi", 1000, "Rich", 2.10, 0);
    EngineConfig.appendConfig("Warm Taxi", 1000, "Rich", 1.85, 0);
    EngineConfig.appendConfig("Runup", 1800, "Rich", 5.79, 0);
    EngineConfig.appendConfig("Takeoff", 2700, "Rich", 26.09, 105);
    EngineConfig.appendConfig("Climb", 2500, 25, 19.15, 125);
    EngineConfig.appendConfig("Cruise", 2400, 20, 14.10, 142);
    EngineConfig.appendConfig("Pattern", 2700, 15, 7.80, 95);
    EngineConfig.selectConfig(EngineConfig.ColdTaxi);

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
                            
